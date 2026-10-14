from app.auth import get_current_user
from app.main import app
from app.models.manual_revision import ManualRevision
from app.models.project_member import ProjectMember
from app.models.user import User
from conftest import upload


def navigation_world(context, pdf):
    client, db, _ = context
    reader = User(username='reader', display_name='Reader', password_hash='unused', role='USER')
    db.add(reader)
    db.flush()
    projects, manuals, revisions = [], [], []
    for code in ('NAV-A', 'NAV-B'):
        project = client.post('/api/projects', json={'project_code': code, 'project_name': code}).json()
        manual = client.post(f'/api/projects/{project["id"]}/manuals',
            json={'manual_code': f'{code}-001', 'title': 'Navigation 100%_needle'}).json()
        revision = upload(client, manual['id'], pdf).json()
        db.get(ManualRevision, revision['id']).status = 'IN_REVIEW'
        projects.append(project)
        manuals.append(manual)
        revisions.append(revision)
    db.add_all([
        ProjectMember(project_id=projects[0]['id'], user_id=reader.id, role='REVIEWER'),
        ProjectMember(project_id=projects[1]['id'], user_id=reader.id, role='VIEWER'),
    ])
    db.commit()
    return client, db, reader, projects, manuals, revisions


def test_review_queue_only_contains_projects_user_can_review(context, pdf):
    client, _, reader, _, manuals, revisions = navigation_world(context, pdf)
    app.dependency_overrides[get_current_user] = lambda: reader
    response = client.get('/api/manuals/review-queue')
    assert response.status_code == 200
    body = response.json()
    assert body['can_review'] is True
    assert body['count'] == 1
    assert [(item['manual_id'], item['revision_id']) for item in body['items']] == [
        (manuals[0]['id'], revisions[0]['id'])]


def test_admin_queue_counts_reviews_and_excludes_other_states(context, pdf):
    client, db, _, _, _, revisions = navigation_world(context, pdf)
    db.get(ManualRevision, revisions[0]['id']).status = 'DRAFT'
    db.commit()
    response = client.get('/api/manuals/review-queue')
    assert response.status_code == 200
    assert response.json()['count'] == 1
    assert response.json()['items'][0]['revision_id'] == revisions[1]['id']


def test_review_queue_checks_current_membership_even_after_removal(context, pdf):
    client, db, reader, _, _, _ = navigation_world(context, pdf)
    app.dependency_overrides[get_current_user] = lambda: reader
    first = client.get('/api/manuals/review-queue')
    assert first.status_code == 200
    assert first.json()['count'] == 1
    membership = db.query(ProjectMember).filter_by(user_id=reader.id, role='REVIEWER').one()
    db.delete(membership)
    db.commit()
    second = client.get('/api/manuals/review-queue').json()
    assert second == {'can_review': False, 'count': 0, 'items': []}


def test_search_is_literal_scoped_and_bounded(context, pdf):
    client, db, reader, projects, manuals, _ = navigation_world(context, pdf)
    admin_override = app.dependency_overrides[get_current_user]
    db.delete(db.query(ProjectMember).filter_by(user_id=reader.id, project_id=projects[1]['id']).one())
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: reader
    response = client.get('/api/manuals', params={'search': '100%_needle', 'limit': 20})
    assert response.status_code == 200
    assert [item['id'] for item in response.json()] == [manuals[0]['id']]
    app.dependency_overrides[get_current_user] = admin_override
    assert len(client.get('/api/manuals', params={'search': 'Navigation', 'limit': 1}).json()) == 1
    assert client.get('/api/manuals', params={'limit': 101}).status_code == 400


def test_review_preview_is_bounded_while_count_includes_every_pending_revision(context, pdf):
    client, db, _, _, manuals, _ = navigation_world(context, pdf)
    db.add_all([ManualRevision(manual_id=manuals[0]['id'], revision_no=f'{number:02d}',
        revision_detail='', file_name='qa.pdf', object_key=f'qa/{number}.pdf', status='IN_REVIEW', uploaded_by='BA')
        for number in range(3, 26)])
    db.commit()
    body = client.get('/api/manuals/review-queue').json()
    assert body['count'] == 25
    assert len(body['items']) == 20
    assert len({item['revision_id'] for item in body['items']}) == 20
