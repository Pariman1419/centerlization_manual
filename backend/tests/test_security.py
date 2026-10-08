from urllib.parse import parse_qs, urlsplit

from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.routers.manuals import safe_filename
from app.services.minio_service import MinioStorage
from conftest import create_manual


def test_filename_is_safe():
    assert safe_filename('..\\folder\\bad\r\n".pdf') == 'bad___.pdf'
    assert len(safe_filename('x' * 300 + '.pdf')) == 255


def test_signs_public_host_and_ten_minute_expiry(monkeypatch):
    monkeypatch.setattr(get_settings(), 'minio_public_endpoint', 'https://files.example:9443')
    storage = MinioStorage()
    for download in (False, True):
        parsed = urlsplit(storage.url('MAN-001/rev-001/test.pdf', 'chemical preparation.pdf', download))
        query = parse_qs(parsed.query)
        assert parsed.netloc == 'files.example:9443'
        assert parsed.scheme == 'https'
        assert query['X-Amz-Expires'] == ['600']
        assert query['response-content-type'] == ['application/pdf']
        assert query['response-content-disposition'][0].startswith('attachment' if download else 'inline')


def test_optional_gateway_auth(context, monkeypatch):
    from pydantic import SecretStr
    client, _, _ = context
    monkeypatch.setattr(get_settings(), 'api_token', SecretStr('gateway-test-only'))
    assert client.get('/api/manuals').status_code == 401
    assert client.get('/api/manuals', headers={'Authorization': 'Bearer gateway-test-only'}).status_code == 200


def test_database_error_is_not_returned(context, monkeypatch, caplog):
    client, db, _ = context
    def fail():
        raise SQLAlchemyError('SQL and private internal details')
    monkeypatch.setattr(db, 'commit', fail)
    result = create_manual(client)
    assert result.status_code == 500
    assert result.json() == {'detail': 'Unable to complete the request. Please try again.'}
    assert any(record.exc_info and isinstance(record.exc_info[1], SQLAlchemyError) for record in caplog.records)


def test_request_body_limit(context, monkeypatch):
    client, _, _ = context
    monkeypatch.setattr(get_settings(), 'max_upload_mb', 1)
    response = client.post('/api/manuals', content=b'x' * (2 * 1024 * 1024 + 1), headers={'Content-Type': 'application/json'})
    assert response.status_code == 413


def test_chunked_body_cannot_bypass_limit(context, monkeypatch):
    client, _, _ = context
    monkeypatch.setattr(get_settings(), 'max_upload_mb', 1)
    chunks = iter([b'x' * 1024 * 1024, b'x' * (1024 * 1024 + 1)])
    response = client.post('/api/manuals', content=chunks, headers={'Content-Type': 'application/json'})
    assert response.status_code == 413
