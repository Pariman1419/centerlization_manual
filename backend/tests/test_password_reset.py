import logging

from fastapi.testclient import TestClient

from app.auth import hash_password, verify_password
from app.main import app
from app.models.user import User, UserSession
from test_auth import auth_context, login

TEMP = 'Temporary-pass-456!'
NEW = 'Brand-new-pass-789!'
OLD = 'Test-password-123!'


def make_clients(context):
    client, db, storage = auth_context(context)
    return client, TestClient(app, raise_server_exceptions=False), db


def user_id(db, name):
    return db.query(User).filter_by(username=name).one().id


def reset(client, uid, password=TEMP):
    return client.post(f'/api/users/{uid}/reset-password', json={'temporary_password': password})


def sign_in(client, username, password):
    response = client.post('/api/auth/login', json={'username': username, 'password': password})
    assert response.status_code == 200
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return response


def test_admin_reset_flags_user_and_invalidates_sessions(context):
    admin, user, db = make_clients(context)
    login(admin, 'admin')
    sign_in(user, 'ba01', OLD)
    assert user.get('/api/projects').status_code == 200
    response = reset(admin, user_id(db, 'ba01'))
    assert response.status_code == 200
    assert TEMP not in response.text and 'hash' not in response.text
    row = db.query(User).filter_by(username='ba01').one()
    assert row.must_change_password is True
    assert row.password_hash.startswith('scrypt$') and verify_password(TEMP, row.password_hash)
    assert db.query(UserSession).filter_by(user_id=row.id).count() == 0
    assert user.get('/api/auth/me').status_code == 401
    assert user.get('/api/projects').status_code == 401


def test_reset_requires_admin_csrf_and_valid_target(context):
    admin, user, db = make_clients(context)
    sign_in(user, 'ba01', OLD)
    assert reset(user, user_id(db, 'ba02')).status_code == 403
    assert db.query(User).filter_by(username='ba02').one().must_change_password is False
    login(admin, 'admin')
    del admin.headers['X-CSRF-Token']
    assert reset(admin, user_id(db, 'ba02')).status_code == 403
    admin.headers['X-CSRF-Token'] = 'bad'
    assert reset(admin, user_id(db, 'ba02')).status_code == 403
    assert db.query(User).filter_by(username='ba02').one().must_change_password is False
    login(admin, 'admin')
    assert reset(admin, 99999).status_code == 404
    assert reset(admin, user_id(db, 'admin')).status_code == 400
    assert reset(admin, user_id(db, 'ba02'), 'short').status_code == 400
    assert reset(admin, user_id(db, 'ba02'), ' ' * 20).status_code == 400
    assert admin.post(f"/api/users/{user_id(db, 'ba02')}/reset-password", json={}).status_code == 400


def test_unauthenticated_reset_rejected(context):
    admin, _, db = make_clients(context)
    assert reset(admin, 1).status_code == 401


def test_forced_change_blocks_business_apis_until_changed(context):
    admin, user, db = make_clients(context)
    login(admin, 'admin')
    reset(admin, user_id(db, 'ba01'))
    sign_in(user, 'ba01', TEMP)
    me = user.get('/api/auth/me')
    assert me.status_code == 200 and me.json()['user']['must_change_password'] is True
    for method, path in [('get', '/api/projects'), ('post', '/api/projects'), ('get', '/api/manuals'),
                         ('get', '/api/revisions/1'), ('get', '/api/users')]:
        assert getattr(user, method)(path).status_code == 403, path
    bad = {'current_password': 'wrong-password-1', 'new_password': NEW}
    assert user.post('/api/auth/change-password', json=bad).status_code == 400
    assert user.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': 'short'}).status_code == 400
    assert user.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': TEMP}).status_code == 400
    assert user.get('/api/projects').status_code == 403
    done = user.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': NEW})
    assert done.status_code == 200 and done.json()['user']['must_change_password'] is False
    assert 'hash' not in done.text and NEW not in done.text
    assert user.get('/api/projects').status_code == 200
    row = db.query(User).filter_by(username='ba01').one()
    assert row.must_change_password is False and verify_password(NEW, row.password_hash)


def test_change_password_revokes_other_sessions_and_needs_auth_and_csrf(context):
    client, second, db = make_clients(context)
    sign_in(client, 'ba01', OLD)
    sign_in(second, 'ba01', OLD)
    payload = {'current_password': OLD, 'new_password': NEW}
    token = client.headers.pop('X-CSRF-Token')
    assert client.post('/api/auth/change-password', json=payload).status_code == 403
    client.headers['X-CSRF-Token'] = token
    assert client.post('/api/auth/change-password', json=payload).status_code == 200
    assert client.get('/api/projects').status_code == 200
    assert second.get('/api/projects').status_code == 401
    assert client.post('/api/auth/login', json={'username': 'ba01', 'password': OLD}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'ba01', 'password': NEW}).status_code == 200
    anon = TestClient(app, raise_server_exceptions=False)
    assert anon.post('/api/auth/change-password', json=payload).status_code == 401


def test_change_password_uses_hash_password_and_lockout(context, monkeypatch):
    import app.routers.auth as auth_router
    import app.routers.users as users_router
    calls = []
    real = hash_password
    monkeypatch.setattr(auth_router, 'hash_password', lambda p: calls.append('change') or real(p))
    monkeypatch.setattr(users_router, 'hash_password', lambda p: calls.append('reset') or real(p))
    admin, user, db = make_clients(context)
    login(admin, 'admin')
    reset(admin, user_id(db, 'ba01'))
    sign_in(user, 'ba01', TEMP)
    for _ in range(5):
        assert user.post('/api/auth/change-password',
            json={'current_password': 'wrong-password-1', 'new_password': NEW}).status_code in (400, 401)
    assert user.get('/api/auth/me').status_code == 401
    assert user.post('/api/auth/login', json={'username': 'ba01', 'password': TEMP}).status_code == 401
    assert calls == ['reset']
    row = db.query(User).filter_by(username='ba01').one()
    row.locked_until = None
    row.failed_login_attempts = 0
    db.commit()
    sign_in(user, 'ba01', TEMP)
    assert user.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': NEW}).status_code == 200
    assert calls == ['reset', 'change']


def test_reset_clears_lockout_and_logout_works_while_forced(context):
    admin, user, db = make_clients(context)
    for _ in range(5):
        user.post('/api/auth/login', json={'username': 'ba01', 'password': 'wrong'})
    assert user.post('/api/auth/login', json={'username': 'ba01', 'password': OLD}).status_code == 401
    login(admin, 'admin')
    reset(admin, user_id(db, 'ba01'))
    sign_in(user, 'ba01', TEMP)
    assert user.post('/api/auth/logout').status_code == 200
    assert user.get('/api/auth/me').status_code == 401


def test_passwords_never_logged_or_in_validation_errors(context, caplog):
    admin, user, db = make_clients(context)
    login(admin, 'admin')
    with caplog.at_level(logging.DEBUG):
        reset(admin, user_id(db, 'ba01'))
        bad = reset(admin, user_id(db, 'ba01'), 'tooshort')
        sign_in(user, 'ba01', TEMP)
        user.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': 'tiny'})
        user.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': NEW})
    assert 'tooshort' not in bad.text
    for secret in (TEMP, NEW, 'tooshort', 'tiny'):
        assert secret not in caplog.text
