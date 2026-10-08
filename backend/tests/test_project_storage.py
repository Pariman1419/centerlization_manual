import re

from app.models.manual_revision import ManualRevision
from app.models.project import Project
from conftest import create_manual, upload
from test_projects import create_project


def test_new_upload_includes_project_code(context, pdf):
    client, db, storage = context
    project = create_project(client).json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'MAN-PLATING-001', 'title': 'Operation'}).json()
    response = upload(client, manual['id'], pdf)
    assert response.status_code == 201
    revision = db.get(ManualRevision, response.json()['id'])
    assert re.fullmatch(r'PRJ-PLATING/MAN-PLATING-001/rev-001/[0-9a-f-]{36}\.pdf', revision.object_key)
    revision.status = 'APPROVED'
    db.commit()
    assert client.post(f'/api/revisions/{revision.id}/publish').status_code == 200
    assert client.get(f'/api/manuals/{manual["id"]}/current').json()['id'] == revision.id


def test_stored_legacy_paths_still_preview_and_download(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    revision = db.get(ManualRevision, upload(client, manual['id'], pdf).json()['id'])
    old_key = 'SMOKE-20261007-041544-1d2808/rev-001/legacy.pdf'
    storage.objects[old_key] = storage.objects.pop(revision.object_key)
    revision.object_key = old_key
    db.commit()
    assert client.put(f'/api/projects/{manual["project_id"]}', json={'project_code': 'RENAMED'}).status_code == 409
    # Simulate metadata changed by an older release; never reconstruct an old key.
    db.get(Project, manual['project_id']).project_code = 'RENAMED'
    db.commit()
    for action in ('preview', 'download'):
        response = client.get(f'/api/revisions/{revision.id}/{action}')
        assert response.status_code == 200
        assert response.json()['url'].split('?')[0] == 'https://storage.example/' + old_key
    assert storage.objects[old_key] == pdf


def test_unsafe_legacy_project_code_uses_safe_id_segment(context, pdf):
    client, db, storage = context
    project = create_project(client).json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'MAN-001', 'title': 'Operation'}).json()
    db.get(Project, project['id']).project_code = '../bad\x00'
    db.commit()
    assert upload(client, manual['id'], pdf).status_code == 201
    key = next(iter(storage.objects))
    assert key.startswith(f'project-{project["id"]}/MAN-001/rev-001/')
    assert '..' not in key and '\x00' not in key
