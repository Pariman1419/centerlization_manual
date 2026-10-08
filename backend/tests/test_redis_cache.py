import json

import pytest
from sqlalchemy import event, select

from app.models.manual import Manual
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.user import User
from test_projects import create_project


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.expires = {}
        self.now = 0
        self.fail = False
        self.calls = 0

    def get(self, key):
        self.calls += 1
        if self.fail:
            raise OSError('private connection detail')
        if self.expires.get(key, float('inf')) <= self.now:
            self.values.pop(key, None)
        return self.values.get(key)

    def set(self, key, value, nx=False, ex=None):
        self.calls += 1
        if self.fail:
            raise OSError('private connection detail')
        if nx and self.get(key) is not None:
            return False
        self.values[key] = value
        if ex is not None:
            self.expires[key] = self.now + ex
        return True


@pytest.fixture
def cached(monkeypatch):
    from app.services import redis_cache
    client = FakeRedis()
    cache = redis_cache.RedisCache(client, 'test:cache:')
    monkeypatch.setattr(redis_cache, 'get_cache', lambda: cache)
    return cache, client


def test_json_expiry_shared_generation_and_old_fill(cached):
    from app.services.redis_cache import RedisCache
    cache, client = cached
    other = RedisCache(client, 'test:cache:')
    key = cache.key('manuals')
    cache.write(key, [{'id': 1}], 15)
    assert other.read(other.key('manuals')) == [{'id': 1}]
    client.now = 16
    assert cache.read(key) is None
    assert cache.invalidate()
    cache.write(key, [{'id': 9}], 30)
    assert other.read(other.key('manuals')) is None


def test_malformed_oversized_and_outage_fall_back(cached, monkeypatch, caplog):
    from app.services import redis_cache
    cache, client = cached
    key = cache.key('manuals')
    client.values[key] = '{invalid'
    assert cache.read(key) is None
    cache.write(key, ['x' * 262145], 30)
    assert client.values[key] == '{invalid'
    client.fail = True
    clock = [0]
    monkeypatch.setattr(redis_cache, 'monotonic', lambda: clock[0])
    assert cache.key('manuals') is None
    calls = client.calls
    assert cache.key('manuals') is None
    assert not cache.invalidate()
    assert client.calls == calls
    assert 'private connection detail' not in caplog.text
    client.fail = False
    clock[0] = 11
    assert cache.key('manuals') is not None


def test_savepoint_and_rollback_do_not_invalidate(context, cached):
    _, db, _ = context
    cache, _ = cached
    original = cache.key('counts')
    db.add(Project(project_code='ROLLBACK', project_name='P', created_by='BA'))
    db.flush()
    with db.begin_nested():
        db.flush()
    assert cache.key('counts') == original
    db.rollback()
    assert cache.key('counts') == original
    db.add(Project(project_code='COMMIT', project_name='P', created_by='BA'))
    db.commit()
    assert cache.key('counts') != original


def test_cached_lists_and_counts_skip_work_and_invalidate_after_write(context, cached):
    client, db, _ = context
    project = create_project(client).json()
    url = f'/api/projects/{project["id"]}/manuals'
    assert client.post(url, json={'title': 'First'}).status_code == 201
    first = client.get(url).json()
    assert client.get('/api/projects').json()[0]['manual_count'] == 1
    queries = []
    def record(conn, cursor, statement, *args):
        queries.append(statement)
    event.listen(db.get_bind(), 'before_cursor_execute', record)
    try:
        assert client.get(url).json() == first
        assert client.get('/api/projects').json()[0]['manual_count'] == 1
    finally:
        event.remove(db.get_bind(), 'before_cursor_execute', record)
    assert not any('FROM manuals' in query for query in queries)
    assert client.put(f'/api/manuals/{first[0]["id"]}', json={'title': 'Changed'}).status_code == 200
    assert client.get(url).json()[0]['title'] == 'Changed'
    assert client.post(url, json={'title': 'Second'}).status_code == 201
    assert client.get('/api/projects').json()[0]['manual_count'] == 2


def test_cache_failure_does_not_undo_committed_write(context, cached):
    client, db, _ = context
    project = create_project(client).json()
    _, redis = cached
    redis.fail = True
    url = f'/api/projects/{project["id"]}/manuals'
    assert client.post(url, json={'title': 'Durable'}).status_code == 201
    assert db.scalar(select(Manual.id)) is not None
    assert client.get(url).json()[0]['title'] == 'Durable'


def test_warm_cache_does_not_grant_removed_members_access(context, cached):
    from app.auth import get_current_user
    from app.main import app
    client, db, _ = context
    project = create_project(client).json()
    url = f'/api/projects/{project["id"]}/manuals'
    assert client.post(url, json={'title': 'Private'}).status_code == 201
    viewer = User(username='viewer', display_name='Viewer', role='USER', password_hash='unused')
    db.add(viewer)
    db.flush()
    membership = ProjectMember(project_id=project['id'], user_id=viewer.id, role='VIEWER')
    db.add(membership)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: viewer
    assert client.get(url).status_code == 200
    # Bypass app invalidation to prove authorization is independent of cached data.
    db.connection().exec_driver_sql('DELETE FROM project_members WHERE id = ?', (membership.id,))
    assert client.get(url).status_code == 404


def test_filter_keys_are_separate_and_invalid_payload_is_reloaded(context, cached):
    client, _, _ = context
    cache, redis = cached
    project = create_project(client).json()
    url = f'/api/projects/{project["id"]}/manuals'
    assert client.post(url, json={'title': 'Safety', 'category': 'THAI'}).status_code == 201
    assert len(client.get(url + '?category=THAI').json()) == 1
    assert client.get(url + '?category=EN').json() == []
    for key in tuple(redis.values):
        if ':manuals:' in key:
            redis.values[key] = json.dumps({'invalid': 'schema'})
    assert len(client.get(url + '?category=THAI').json()) == 1


def test_unserializable_cache_value_is_skipped(cached):
    cache, redis = cached
    key = cache.key('bad')
    cache.write(key, {'bad': object()}, 15)
    assert key not in redis.values


def test_deeply_nested_payload_falls_back(cached):
    cache, redis = cached
    key = cache.key('nested')
    redis.values[key] = '[' * 20000 + '0' + ']' * 20000
    assert cache.read(key) is None
    value = []
    for _ in range(20000):
        value = [value]
    cache.write(key, value, 15)
    assert redis.values[key].startswith('[' * 20000)


def test_publishing_invalidates_cached_current_revision(context, cached, pdf):
    from conftest import upload
    client, _, _ = context
    project = create_project(client).json()
    url = f'/api/projects/{project["id"]}/manuals'
    manual = client.post(url, json={'title': 'Operation'}).json()
    revision = upload(client, manual['id'], pdf).json()
    assert client.get(url).json()[0]['current_revision'] is None
    assert client.post(f'/api/revisions/{revision["id"]}/submit-review').status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/approve').status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/publish').status_code == 200
    current = client.get(url).json()[0]['current_revision']
    assert current['id'] == revision['id']
    assert current['status'] == 'PUBLISHED'


def test_recovered_commit_invalidates_even_if_commit_hook_missed(context, cached, pdf, monkeypatch):
    from conftest import upload
    from sqlalchemy.exc import SQLAlchemyError
    client, db, _ = context
    cache, _ = cached
    project = create_project(client).json()
    manual = client.post(f'/api/projects/{project["id"]}/manuals', json={'title': 'T'}).json()
    original_key = cache.key('counts')
    invalidate = cache.invalidate
    calls = 0
    def miss_first_invalidation():
        nonlocal calls
        calls += 1
        return False if calls == 1 else invalidate()
    monkeypatch.setattr(cache, 'invalidate', miss_first_invalidation)
    commit = db.commit
    def lost_ack():
        commit()
        raise SQLAlchemyError('lost acknowledgement')
    monkeypatch.setattr(db, 'commit', lost_ack)
    assert upload(client, manual['id'], pdf).status_code == 201
    assert cache.key('counts') != original_key
