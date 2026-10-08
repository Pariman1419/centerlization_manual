from datetime import datetime, timezone

import pytest
from sqlalchemy import event, select

from app.models.project import Project

from conftest import create_manual


def test_delete_project_with_manuals_revisions_and_files(context, pdf):
    from conftest import upload
    from app.models.audit_log import AuditLog
    from app.models.manual import Manual
    from app.models.manual_revision import ManualRevision, RevisionFile
    from app.models.project_member import ProjectMember
    from sqlalchemy import select

    client, db, storage = context
    db.connection().exec_driver_sql('PRAGMA foreign_keys=ON')
    project = create_project(client).json()
    other = create_project(client, 'KEEP', 'Keep Project').json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'title': 'Manual'}).json()
    revision = upload(client, manual['id'], pdf).json()
    assert client.post(f'/api/revisions/{revision["id"]}/submit-review').status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/approve').status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/publish').status_code == 200
    attachment = RevisionFile(revision_id=revision['id'], kind='OTHER', file_name='drawing.txt', object_key='drawing.txt')
    db.add(attachment)
    db.commit()
    storage.objects['drawing.txt'] = b'drawing'
    assert storage.objects

    response = client.delete(f'/api/projects/{project["id"]}')
    assert response.status_code == 200
    assert response.json() == {'deleted': True}
    assert client.get(f'/api/projects/{project["id"]}').status_code == 404
    assert client.get(f'/api/projects/{other["id"]}').status_code == 200
    assert db.scalars(select(Manual).where(Manual.project_id == project['id'])).all() == []
    assert db.scalars(select(ManualRevision)).all() == []
    assert db.scalars(select(RevisionFile)).all() == []
    assert db.scalars(select(ProjectMember).where(ProjectMember.project_id == project['id'])).all() == []
    assert storage.objects == {}
    audit = db.scalar(select(AuditLog).where(AuditLog.action == 'PROJECT_DELETED'))
    assert audit.details['project_code'] == project['project_code']
    assert audit.details['manuals_deleted'] == 1
    assert client.delete(f'/api/projects/{project["id"]}').status_code == 404


def test_delete_empty_project(context):
    client, _, _ = context
    project = create_project(client).json()
    assert client.delete(f'/api/projects/{project["id"]}').status_code == 200


def test_delete_project_rolls_back_and_retains_files_when_commit_fails(context, pdf, monkeypatch):
    from conftest import upload
    from sqlalchemy import select
    from app.models.audit_log import AuditLog

    client, db, storage = context
    project = create_project(client).json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'title': 'Manual'}).json()
    revision = upload(client, manual['id'], pdf).json()
    objects = dict(storage.objects)

    def fail_commit():
        raise RuntimeError('commit failed')

    monkeypatch.setattr(db, 'commit', fail_commit)
    assert client.delete(f'/api/projects/{project["id"]}').status_code == 500
    assert client.get(f'/api/projects/{project["id"]}').status_code == 200
    assert client.get(f'/api/manuals/{manual["id"]}/revisions').json()[0]['id'] == revision['id']
    assert storage.objects == objects
    assert db.scalar(select(AuditLog).where(AuditLog.action == 'PROJECT_DELETED')) is None


def create_project(client, code='PRJ-PLATING', name='Plating Machine'):
    return client.post('/api/projects', json={'project_code': code,
        'project_name': name, 'description': 'Plating machine manuals'})


def test_create_project_and_trim(context):
    client, _, _ = context
    response = create_project(client, '  PRJ-PLATING  ', '  Plating Machine  ')
    assert response.status_code == 201
    project = response.json()
    assert project['project_code'] == 'PRJ-PLATING'
    assert project['project_name'] == 'Plating Machine'
    assert project['status'] == 'ACTIVE'
    assert project['created_by'] == 'BA'
    assert project['manual_count'] == 0


def test_duplicate_project_code(context):
    client, _, _ = context
    assert create_project(client).status_code == 201
    response = create_project(client)
    assert response.status_code == 409
    assert response.json() == {'detail': 'Project code PRJ-PLATING already exists'}


@pytest.mark.parametrize('key', ['PRJ-PLATING/', 'PRJ-PLATING/old/file.pdf'])
def test_create_rejects_existing_storage_folder(context, key):
    client, db, storage = context
    storage.objects[key] = b'old'
    response = create_project(client)
    assert response.status_code == 409
    assert 'MinIO' in response.json()['detail']
    assert db.scalar(select(Project.id)) is None
    assert storage.objects[key] == b'old'


def test_storage_failure_does_not_create_project(context):
    client, db, storage = context
    storage.fail_health = True
    response = create_project(client)
    assert response.status_code == 503
    assert db.scalar(select(Project.id)) is None


def test_update_checks_storage_before_changing_fields(context):
    client, _, storage = context
    project = create_project(client).json()
    storage.objects['TAKEN/'] = b''
    response = client.put(f'/api/projects/{project["id"]}', json={'project_code': 'TAKEN', 'project_name': 'Changed'})
    assert response.status_code == 409
    unchanged = client.get(f'/api/projects/{project["id"]}').json()
    assert unchanged['project_code'] == 'PRJ-PLATING'
    assert unchanged['project_name'] == 'Plating Machine'
    storage.fail_health = True
    assert client.put(f'/api/projects/{project["id"]}', json={'project_code': 'NEW'}).status_code == 503
    # Metadata-only edits do not require storage connectivity.
    assert client.put(f'/api/projects/{project["id"]}', json={'project_name': 'Changed'}).status_code == 200


def test_code_locked_after_manual_creation(context):
    client, _, _ = context
    project = create_project(client).json()
    assert client.post(f'/api/projects/{project["id"]}/manuals', json={'title': 'Manual'}).status_code == 201
    response = client.put(f'/api/projects/{project["id"]}', json={'project_code': 'NEW'})
    assert response.status_code == 409
    assert 'manuals' in response.json()['detail']
    assert client.get(f'/api/projects/{project["id"]}').json()['project_code'] == 'PRJ-PLATING'
    assert client.put(f'/api/projects/{project["id"]}', json={'project_code': 'PRJ-PLATING', 'project_name': 'Changed'}).status_code == 200


def test_empty_project_can_change_code_without_prefix_overlap(context):
    client, _, storage = context
    storage.objects['PRJ-PLATING-OTHER/file.pdf'] = b'old'
    project = create_project(client).json()
    response = client.put(f'/api/projects/{project["id"]}', json={'project_code': 'FREE'})
    assert response.status_code == 200
    assert response.json()['project_code'] == 'FREE'


@pytest.mark.parametrize('code', ['../bad', 'ไทย', 'A B', 'A/B', 'A\\B', 'A\x00', '_BAD'])
def test_invalid_code_has_actionable_create_and_update_error(context, code):
    client, _, _ = context
    project = create_project(client).json()
    responses = [create_project(client, code), client.put(f'/api/projects/{project["id"]}', json={'project_code': code})]
    for response in responses:
        assert response.status_code == 400
        assert 'PRJ-001' in response.json()['detail']


def test_project_detail_and_missing(context):
    client, _, _ = context
    project = create_project(client).json()
    detail = client.get(f'/api/projects/{project["id"]}').json()
    assert detail.keys() == project.keys()
    for field in detail:
        if field in ('created_at', 'updated_at'):
            # SQLite drops timezone metadata on reload; compare the actual UTC instants.
            def utc(value):
                parsed = datetime.fromisoformat(value)
                return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
            assert utc(detail[field]) == utc(project[field])
        else:
            assert detail[field] == project[field]
    for action in ('', '/manuals'):
        assert client.get('/api/projects/999' + action).status_code == 404
    assert client.put('/api/projects/999', json={'project_name': 'Changed'}).status_code == 404
    assert client.post('/api/projects/999/manuals', json={'manual_code': 'MAN-001', 'title': 'Operation'}).status_code == 404


def test_project_update_search_status_and_conflict(context):
    client, _, _ = context
    first = create_project(client).json()
    create_project(client, 'PRJ-WB', 'Wire Bond')
    response = client.put(f'/api/projects/{first["id"]}', json={'project_name': '  Plating  ', 'description': None, 'status': 'ARCHIVED'})
    assert response.status_code == 200
    assert response.json()['project_name'] == 'Plating'
    assert response.json()['description'] is None
    assert response.json()['status'] == 'ARCHIVED'
    assert client.put(f'/api/projects/{first["id"]}', json={'project_code': 'PRJ-WB'}).status_code == 409
    assert len(client.get('/api/projects?search=Wire&status=ACTIVE').json()) == 1
    assert len(client.get('/api/projects?status=ARCHIVED').json()) == 1
    assert client.get('/api/projects?search=missing').json() == []
    assert client.get('/api/projects?search=%25').json() == []


def test_project_validation(context):
    client, _, _ = context
    for payload in ({'project_code': '', 'project_name': ''}, {'project_code': '../bad', 'project_name': 'Name'}, {'project_code': 'PRJ', 'project_name': ' '}):
        assert client.post('/api/projects', json=payload).status_code == 400
    project = create_project(client).json()
    for payload in ({'status': 'DRAFT'}, {'project_name': None}, {'project_code': ''}):
        assert client.put(f'/api/projects/{project["id"]}', json=payload).status_code == 400


def test_create_manual_inside_project_and_isolation(context):
    client, _, _ = context
    a = create_project(client).json()
    b = create_project(client, 'PRJ-WB', 'Wire Bond').json()
    payload = {'manual_code': 'MAN-PLATING-001', 'title': 'Operation Manual', 'category': 'Operation', 'project_id': b['id']}
    response = client.post(f'/api/projects/{a["id"]}/manuals', json=payload)
    assert response.status_code == 201
    manual = response.json()
    assert manual['project_id'] == a['id']
    assert manual['project_code'] == 'PRJ-PLATING'
    assert manual['project_name'] == 'Plating Machine'
    assert client.get(f'/api/projects/{a["id"]}/manuals').json()[0]['id'] == manual['id']
    assert client.get(f'/api/projects/{b["id"]}/manuals').json() == []
    assert client.get(f'/api/manuals?project_id={b["id"]}').json() == []
    assert client.get(f'/api/manuals?project_id={a["id"]}').json()[0]['id'] == manual['id']
    assert client.get(f'/api/manuals/{manual["id"]}').json()['project_id'] == a['id']
    assert client.post(f'/api/projects/{b["id"]}/manuals', json=payload).status_code == 409
    assert len(client.get(f'/api/projects/{a["id"]}/manuals?search=operation&category=Operation&status=DRAFT').json()) == 1
    assert client.get(f'/api/projects/{a["id"]}/manuals?category=other').json() == []
    assert client.get(f'/api/projects/{a["id"]}/manuals?status=PUBLISHED').json() == []


def test_manual_count_is_grouped_without_n_plus_one(context):
    client, db, _ = context
    projects = [create_project(client, f'PRJ-{i}', f'Project {i}').json() for i in range(3)]
    for i, project_id in enumerate((projects[0]['id'], projects[0]['id'], projects[1]['id'])):
        assert client.post(f'/api/projects/{project_id}/manuals', json={'manual_code': f'MAN-{i}', 'title': 'Manual'}).status_code == 201
    selects = []
    def record(conn, cursor, statement, params, ctx, many):
        if statement.lstrip().upper().startswith('SELECT'):
            selects.append(statement)
    engine = db.get_bind()
    event.listen(engine, 'before_cursor_execute', record)
    try:
        response = client.get('/api/projects')
    finally:
        event.remove(engine, 'before_cursor_execute', record)
    assert response.status_code == 200
    counts = {p['id']: p['manual_count'] for p in response.json()}
    assert [counts[p['id']] for p in projects] == [2, 1, 0]
    assert len(selects) == 1
    assert client.get(f'/api/projects/{projects[0]["id"]}').json()['manual_count'] == 2


def test_existing_manual_creation_defaults_to_legacy(context):
    client, _, _ = context
    response = create_manual(client)
    assert response.status_code == 201
    manual = response.json()
    assert manual['project_code'] == 'LEGACY'
    assert manual['project_name'] == 'Legacy / Unassigned Manuals'
    assert client.get(f'/api/projects/{manual["project_id"]}').json()['manual_count'] == 1
    assert client.get('/api/manuals').json()[0]['id'] == manual['id']
    project = create_project(client).json()
    assert client.post('/api/manuals', json={'manual_code': 'MAN-PROJECT', 'title': 'Manual', 'project_id': project['id']}).json()['project_id'] == project['id']
    assert client.post('/api/manuals', json={'manual_code': 'MAN-MISSING', 'title': 'Manual', 'project_id': 999}).status_code == 404
