import io

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.services.minio_service import get_storage
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from app.models.user import User
from app.auth import get_current_user


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch):
    from app.services import redis_cache
    cache = redis_cache.RedisCache()
    monkeypatch.setattr(redis_cache, 'get_cache', lambda: cache)


class MemoryStorage:
    def __init__(self):
        self.objects = {}
        self.fail_upload = False
        self.fail_health = False

    def health(self):
        if self.fail_health:
            raise RuntimeError('storage unavailable')
        return True

    def upload(self, key, data, size, content_type='application/pdf'):
        if self.fail_upload:
            raise RuntimeError('storage unavailable')
        self.objects[key] = data.read()

    def prefix_exists(self, prefix):
        if self.fail_health:
            raise RuntimeError('storage unavailable')
        return any(key.startswith(prefix) for key in self.objects)

    def delete(self, key):
        self.objects.pop(key, None)

    def url(self, key, filename, download=False, content_type='application/pdf'):
        return 'https://storage.example/' + key + ('?download=1' if download else '?preview=1')


@pytest.fixture
def context():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    actor = User(username='BA', display_name='Test BA', role='ADMIN', password_hash='unused-in-business-tests')
    db.add(actor)
    db.commit()
    storage = MemoryStorage()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_current_user] = lambda: actor
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, db, storage
    app.dependency_overrides.clear()
    db.close()
    engine.dispose()


@pytest.fixture
def pdf():
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(output)
    return output.getvalue()


def create_manual(client, code='MAN-001'):
    return client.post('/api/manuals', json={
        'manual_code': code, 'title': 'Plating Operation Manual',
        'category': 'Operation', 'description': 'Machine instructions',
    })


def upload(client, manual_id, pdf, number='01', filename='manual.pdf', mime='application/pdf'):
    return client.post(f'/api/manuals/{manual_id}/revisions',
        data={'revision_no': number, 'revision_detail': 'Update safety instructions'},
        files={'file': (filename, pdf, mime)})
