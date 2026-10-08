from datetime import timedelta

from app.auth import get_current_user, hash_password, token_hash
from app.models.user import User, UserSession
from app.models.manual import utcnow
from app.models.manual_revision import ManualRevision
from conftest import upload


def auth_context(context):
    client, db, storage = context
    from app.main import app
    app.dependency_overrides.pop(get_current_user, None)
    for username, role in [('admin', 'ADMIN'), ('ba01', 'USER'), ('ba02', 'USER')]:
        db.add(User(username=username, display_name=username, role=role, password_hash=hash_password('Test-password-123!')))
    db.commit()
    return client, db, storage


def login(client, username='ba01'):
    response = client.post('/api/auth/login', json={'username': username, 'password': 'Test-password-123!'})
    assert response.status_code == 200
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return response


def test_login_logout_cookie_and_password_storage(context):
    client, db, _ = auth_context(context)
    assert client.get('/api/projects').status_code == 401
    response = login(client)
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert 'samesite=strict' in response.headers['set-cookie'].lower()
    assert 'password' not in response.json()['user']
    assert client.get('/api/auth/me').json()['user']['username'] == 'ba01'
    assert db.query(User).filter_by(username='ba01').one().password_hash != 'Test-password-123!'
    assert db.query(UserSession).one().token_hash == token_hash(client.cookies['manual_session'])
    assert client.post('/api/auth/logout').status_code == 200
    assert client.get('/api/projects').status_code == 401


def test_wrong_credentials_lockout_and_bad_origin(context):
    client, db, _ = auth_context(context)
    for name in ('missing', 'ba01'):
        assert client.post('/api/auth/login', json={'username': name, 'password': 'wrong'}).json() == {'detail': 'Invalid username or password'}
    for _ in range(4):
        assert client.post('/api/auth/login', json={'username': 'ba01', 'password': 'wrong'}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'ba01', 'password': 'Test-password-123!'}).status_code == 401
    assert client.post('/api/auth/login', headers={'Origin': 'https://evil.example'}, json={'username': 'admin', 'password': 'Test-password-123!'}).status_code == 403


def test_session_expiry_disabled_user_and_csrf(context):
    client, db, _ = auth_context(context)
    login(client)
    assert client.post('/api/projects', headers={'X-CSRF-Token': ''}, json={'project_code': 'P', 'project_name': 'P'}).status_code == 403
    session = db.query(UserSession).one()
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.get('/api/projects').status_code == 401
    login(client)
    db.query(User).filter_by(username='ba01').one().is_active = False
    db.commit()
    assert client.get('/api/projects').status_code == 401


def test_project_manual_revision_isolation_and_admin(context, pdf):
    client, db, storage = auth_context(context)
    login(client)
    project = client.post('/api/projects', json={'project_code': 'OWN', 'project_name': 'Owned', 'owner_user_id': 999}).json()
    assert project['created_by'] == 'ba01'
    assert project['owner_user_id'] == db.query(User).filter_by(username='ba01').one().id
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'OWN-M', 'title': 'Own'}).json()
    revision = upload(client, manual['id'], pdf).json()
    db.get(ManualRevision, revision['id']).status = 'APPROVED'
    db.commit()
    assert client.post(f'/api/revisions/{revision["id"]}/publish').json()['published_by'] == 'ba01'
    client.post('/api/auth/logout')
    login(client, 'ba02')
    assert client.get('/api/projects').json() == []
    assert client.get('/api/manuals').json() == []
    for path in [f'/api/projects/{project["id"]}', f'/api/projects/{project["id"]}/manuals',
            f'/api/manuals/{manual["id"]}', f'/api/manuals/{manual["id"]}/revisions', f'/api/manuals/{manual["id"]}/current',
            f'/api/revisions/{revision["id"]}', f'/api/revisions/{revision["id"]}/preview', f'/api/revisions/{revision["id"]}/download']:
        assert client.get(path).status_code == 404, path
    assert client.put(f'/api/projects/{project["id"]}', json={'project_name': 'Attack'}).status_code == 404
    assert client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'ATTACK', 'title': 'Attack'}).status_code == 404
    assert upload(client, manual['id'], pdf, '02').status_code == 404
    assert client.post(f'/api/revisions/{revision["id"]}/publish').status_code == 404
    assert client.post('/api/manuals', json={'manual_code': 'ATTACK', 'title': 'Attack', 'project_id': project['id']}).status_code == 404
    assert client.post('/api/manuals', json={'manual_code': 'UNASSIGNED', 'title': 'Missing project'}).status_code == 400
    assert len(storage.objects) == 1
    client.post('/api/auth/logout')
    login(client, 'admin')
    assert client.get('/api/projects').json()[0]['id'] == project['id']
    assert client.get(f'/api/revisions/{revision["id"]}/preview').status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/publish').status_code == 200


def test_only_admin_can_create_users(context):
    client, db, _ = auth_context(context)
    login(client)
    payload = {'username': 'ba03', 'display_name': 'Third BA', 'password': 'Another-password-123!', 'role': 'USER'}
    assert client.get('/api/users').status_code == 403
    assert client.post('/api/users', json=payload).status_code == 403
    client.post('/api/auth/logout')
    login(client, 'admin')
    assert client.post('/api/users', json=payload).status_code == 201
    assert client.post('/api/users', json=payload).status_code == 409
    assert all('password_hash' not in row for row in client.get('/api/users').json())


def test_password_work_rejects_excess_concurrency(context):
    from app.auth import _PASSWORD_SLOTS
    client, _, _ = auth_context(context)
    assert _PASSWORD_SLOTS.acquire(blocking=False)
    assert _PASSWORD_SLOTS.acquire(blocking=False)
    try:
        response = client.post('/api/auth/login', json={'username': 'missing', 'password': 'wrong'})
        assert response.status_code == 429
        assert response.json()['detail'] == 'Login service is busy. Please try again shortly.'
    finally:
        _PASSWORD_SLOTS.release()
        _PASSWORD_SLOTS.release()
    assert login(client).status_code == 200


def test_user_validation_never_prints_password():
    import pytest
    from pydantic import ValidationError
    from app.schemas.user import UserCreate
    with pytest.raises(ValidationError) as error:
        UserCreate(username='admin', display_name='Admin', password='SECRET-DEMO')
    assert 'SECRET-DEMO' not in str(error.value)
