import hashlib
import io
import re

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from conftest import create_manual, upload


def test_upload_revision_and_history(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    response = upload(client, manual['id'], pdf, filename='../../unsafe.pdf')
    assert response.status_code == 201
    revision = response.json()
    assert revision['status'] == 'DRAFT'
    assert revision['file_name'] == 'unsafe.pdf'
    assert revision['checksum'] == hashlib.sha256(pdf).hexdigest()
    assert revision['file_size'] == len(pdf)
    row = db.get(ManualRevision, revision['id'])
    assert re.fullmatch(r'LEGACY/MAN-001/rev-001/[0-9a-f-]{36}\.pdf', row.object_key)
    assert storage.objects[row.object_key] == pdf
    second = upload(client, manual['id'], pdf, '02').json()
    history = client.get(f'/api/manuals/{manual["id"]}/revisions').json()
    assert [r['id'] for r in history] == [second['id'], revision['id']]
    assert client.get(f'/api/manuals/{manual["id"]}/current').status_code == 404


def test_duplicate_revision(context, pdf):
    client, _, storage = context
    manual = create_manual(client).json()
    assert upload(client, manual['id'], pdf).status_code == 201
    assert upload(client, manual['id'], pdf).status_code == 409
    assert upload(client, manual['id'], pdf, '1').status_code == 409
    assert len(storage.objects) == 1


def test_revision_conflict_after_lock_does_not_upload(context, pdf, monkeypatch):
    client, db, storage = context
    manual = create_manual(client).json()
    assert upload(client, manual['id'], pdf).status_code == 201
    original_scalar = db.scalar
    missed = False

    def miss_initial_check(statement, *args, **kwargs):
        nonlocal missed
        if not missed and str(statement).startswith('SELECT manual_revisions.id'):
            missed = True  # Another upload finishes between the precheck and row lock.
            return None
        return original_scalar(statement, *args, **kwargs)

    monkeypatch.setattr(db, 'scalar', miss_initial_check)
    storage.fail_upload = True
    assert upload(client, manual['id'], pdf).status_code == 409
    assert len(storage.objects) == 1


@pytest.mark.parametrize('data,filename,mime', [
    (b'not a pdf', 'file.txt', 'text/plain'),
    (b'not a pdf', 'file.pdf', 'application/pdf'),
    (b'%PDF-1.7\nfake', 'file.pdf', 'application/pdf'),
    (b'', 'file.pdf', 'application/pdf'),
    (b'%PDF-1.7\nfake', 'file.pdf', 'text/plain'),
])
def test_reject_invalid_pdf(context, data, filename, mime):
    client, db, storage = context
    manual = create_manual(client).json()
    assert upload(client, manual['id'], data, filename=filename, mime=mime).status_code == 400
    assert db.scalars(select(ManualRevision)).all() == []
    assert storage.objects == {}


def test_upload_size_limit(context, monkeypatch):
    client, _, storage = context
    manual = create_manual(client).json()
    monkeypatch.setattr(get_settings(), 'max_upload_mb', 1)
    assert upload(client, manual['id'], b'%PDF-' + b'x' * 1024 * 1024).status_code == 413
    assert storage.objects == {}


def test_total_file_size_limit(context, monkeypatch):
    client, db, storage = context
    manual = create_manual(client).json()
    monkeypatch.setattr(get_settings(), 'max_upload_mb', 1)
    response = client.post(f'/api/manuals/{manual["id"]}/revisions',
        data={'revision_no': '01', 'other_type': 'Drawing'},
        files=[('other_files', ('a.txt', b'x' * 600000, 'text/plain')),
               ('other_files', ('b.txt', b'x' * 600000, 'text/plain'))])
    assert response.status_code == 413
    assert 'combined' in response.json()['detail'].lower()
    assert storage.objects == {}
    assert db.scalars(select(ManualRevision)).all() == []


def test_missing_file_or_number(context, pdf):
    client, _, _ = context
    manual = create_manual(client).json()
    assert client.post(f'/api/manuals/{manual["id"]}/revisions', data={'revision_no': '01'}).status_code == 400
    assert upload(client, manual['id'], pdf, ' ').status_code == 400
    assert upload(client, manual['id'], pdf, '../01').status_code == 400
    assert upload(client, 999, pdf).status_code == 404


def test_minio_failure_creates_no_revision(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    storage.fail_upload = True
    assert upload(client, manual['id'], pdf).status_code == 502
    assert db.scalars(select(ManualRevision)).all() == []


def test_database_failure_cleans_uploaded_object(context, pdf, monkeypatch):
    client, db, storage = context
    manual = create_manual(client).json()
    def fail_commit():
        raise SQLAlchemyError('private technical message')
    monkeypatch.setattr(db, 'commit', fail_commit)
    response = upload(client, manual['id'], pdf)
    assert response.status_code == 500
    assert 'private technical message' not in response.text
    assert storage.objects == {}
    assert db.scalars(select(ManualRevision)).all() == []


def test_lost_commit_acknowledgement_preserves_durable_revision_file(context, pdf, monkeypatch):
    client, db, storage = context
    manual = create_manual(client).json()
    original_commit = db.commit
    def committed_but_acknowledgement_lost():
        original_commit()
        raise SQLAlchemyError('connection lost after commit')
    monkeypatch.setattr(db, 'commit', committed_but_acknowledgement_lost)
    response = upload(client, manual['id'], pdf)
    assert response.status_code == 201
    revision = db.get(ManualRevision, response.json()['id'])
    assert storage.objects[revision.object_key] == pdf
    assert client.get(f'/api/manuals/{manual["id"]}/revisions').json()[0]['id'] == revision.id


def test_unverifiable_commit_retains_object_for_reconciliation(context, pdf, monkeypatch):
    client, db, storage = context
    manual = create_manual(client).json()
    def unavailable(*args, **kwargs):
        raise SQLAlchemyError('database unreachable')
    monkeypatch.setattr(db, 'commit', unavailable)
    monkeypatch.setattr('app.routers.manuals.Session', unavailable)
    response = upload(client, manual['id'], pdf)
    assert response.status_code == 500
    assert 'Refresh revision history' in response.json()['detail']
    assert len(storage.objects) == 1
    assert db.scalars(select(ManualRevision)).all() == []


def test_legacy_code_does_not_create_path_segments(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    db.get(Manual, manual['id']).manual_code = '..'
    db.commit()
    response = upload(client, manual['id'], pdf)
    assert response.status_code == 201
    key = next(iter(storage.objects))
    assert key.startswith(f'LEGACY/manual-{manual["id"]}/rev-001/')
    assert '..' not in key


def test_publish_switches_current_and_preserves_files(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    first = upload(client, manual['id'], pdf).json()
    db.get(ManualRevision, first['id']).status = 'APPROVED'
    db.commit()
    assert client.post(f'/api/revisions/{first["id"]}/publish').status_code == 200
    second = upload(client, manual['id'], pdf, '02').json()
    assert client.get(f'/api/manuals/{manual["id"]}/current').json()['id'] == first['id']
    assert client.get(f'/api/revisions/{second["id"]}').json()['status'] == 'DRAFT'
    db.get(ManualRevision, second['id']).status = 'APPROVED'
    db.commit()
    assert client.post(f'/api/revisions/{second["id"]}/publish').status_code == 200
    assert client.get(f'/api/revisions/{first["id"]}').json()['status'] == 'ARCHIVED'
    assert client.get(f'/api/manuals/{manual["id"]}/current').json()['id'] == second['id']
    assert db.get(Manual, manual['id']).current_revision_id == second['id']
    assert db.get(Manual, manual['id']).status == 'PUBLISHED'
    assert len(storage.objects) == 2
    published = client.get(f'/api/revisions/{second["id"]}').json()
    assert published['published_by'] == 'BA'
    assert published['published_at']
    assert client.post(f'/api/revisions/{second["id"]}/publish').json()['published_at'] == published['published_at']
    # Archived revisions remain downloadable and can be republished once approved.
    db.get(ManualRevision, first['id']).status = 'APPROVED'
    db.commit()
    assert client.post(f'/api/revisions/{first["id"]}/publish').status_code == 200
    assert client.get(f'/api/revisions/{second["id"]}').json()['status'] == 'ARCHIVED'


def test_publish_rollback(context, pdf, monkeypatch):
    client, db, _ = context
    manual = create_manual(client).json()
    first = upload(client, manual['id'], pdf).json()
    second = upload(client, manual['id'], pdf, '02').json()
    db.get(ManualRevision, first['id']).status = 'APPROVED'
    db.commit()
    client.post(f'/api/revisions/{first["id"]}/publish')
    db.get(ManualRevision, second['id']).status = 'APPROVED'
    db.commit()
    def fail_commit():
        raise SQLAlchemyError('commit failed')
    monkeypatch.setattr(db, 'commit', fail_commit)
    assert client.post(f'/api/revisions/{second["id"]}/publish').status_code == 500
    db.expire_all()
    assert db.get(Manual, manual['id']).current_revision_id == first['id']
    assert db.get(ManualRevision, first['id']).status == 'PUBLISHED'
    assert db.get(ManualRevision, second['id']).status == 'APPROVED'


def test_file_access_and_missing_revision(context, pdf):
    client, _, _ = context
    manual = create_manual(client).json()
    revision = upload(client, manual['id'], pdf).json()
    for action in ('preview', 'download'):
        response = client.get(f'/api/revisions/{revision["id"]}/{action}')
        assert response.status_code == 200
        assert response.json()['expires_in'] == 600
        assert response.json()['url'].startswith('https://storage.example/')
    for action in ('', '/preview', '/download'):
        assert client.get('/api/revisions/999' + action).status_code == 404
    assert client.post('/api/revisions/999/publish').status_code == 404


def make_docx():
    import zipfile
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', '<w:document/>')
    return buffer.getvalue()


def test_upload_word_pdf_and_other_files(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    response = client.post(f'/api/manuals/{manual["id"]}/revisions', data={'revision_no': '1', 'other_type': 'Excel'}, files=[
        ('pdf_file', ('m.pdf', pdf, 'application/pdf')),
        ('word_file', ('m.docx', make_docx(), 'application/octet-stream')),
        ('other_files', ('data.xlsx', b'sheet', 'application/vnd.ms-excel')),
        ('other_files', ('notes.txt', b'hello', 'text/plain'))])
    assert response.status_code == 201, response.text
    body = response.json()
    assert [f['kind'] for f in body['files']] == ['PDF', 'WORD', 'OTHER', 'OTHER']
    assert body['file_name'] == 'm.pdf'  # PDF stays the primary file
    assert [f['label'] for f in body['files']] == [None, None, 'Excel', 'Excel']
    assert len(storage.objects) == 4
    # Each file can be reached individually; deleting the revision removes them all.
    word = body['files'][1]
    assert client.get(f'/api/revisions/{body["id"]}/download?file_id={word["id"]}').status_code == 200
    assert client.get(f'/api/revisions/{body["id"]}/download?file_id=999999').status_code == 404
    assert client.delete(f'/api/revisions/{body["id"]}').status_code == 200
    assert storage.objects == {}


def test_word_only_revision_and_validation(context, pdf):
    client, _, storage = context
    manual = create_manual(client).json()
    url = f'/api/manuals/{manual["id"]}/revisions'
    ok = client.post(url, data={'revision_no': '1'}, files={'word_file': ('m.docx', make_docx(), 'application/octet-stream')})
    assert ok.status_code == 201 and ok.json()['files'][0]['kind'] == 'WORD'
    assert ok.json()['file_name'] == 'm.docx'
    assert client.post(url, data={'revision_no': '2'}).status_code == 400  # no file at all
    fake = client.post(url, data={'revision_no': '2'}, files={'word_file': ('m.docx', b'not a zip', 'application/octet-stream')})
    assert fake.status_code == 400
    wrong = client.post(url, data={'revision_no': '2'}, files={'word_file': ('m.pdf', pdf, 'application/pdf')})
    assert wrong.status_code == 400
    unlabeled = client.post(url, data={'revision_no': '2'}, files={'other_files': ('a.xlsx', b'x', 'application/octet-stream')})
    assert unlabeled.status_code == 400  # Other files must say what they are
    blocked = client.post(url, data={'revision_no': '2', 'other_type': 'Tool'}, files={'other_files': ('run.exe', b'MZ', 'application/octet-stream')})
    assert blocked.status_code == 400
    assert len(storage.objects) == 1  # failed uploads leave nothing behind
