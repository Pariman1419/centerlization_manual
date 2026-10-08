from conftest import create_manual
from app.models.manual import Manual


def test_create_manual(context):
    client, _, _ = context
    response = create_manual(client)
    assert response.status_code == 201
    result = response.json()
    assert result['status'] == 'DRAFT'
    assert result['current_revision_id'] is None
    assert result['created_by'] == 'BA'


def test_duplicate_manual_code(context):
    client, _, _ = context
    create_manual(client)
    response = create_manual(client)
    assert response.status_code == 409
    assert set(response.json()) == {'detail'}


def test_get_manual_and_filters(context):
    client, _, _ = context
    manual = create_manual(client).json()
    assert client.get(f'/api/manuals/{manual["id"]}').json()['title'] == manual['title']
    assert len(client.get('/api/manuals?search=plating&category=Operation&status=DRAFT').json()) == 1
    assert client.get('/api/manuals?search=other').json() == []
    assert client.get('/api/manuals?category=other').json() == []
    assert client.get('/api/manuals?status=PUBLISHED').json() == []


def test_missing_manual(context):
    client, _, _ = context
    for suffix in ('', '/revisions', '/current'):
        response = client.get('/api/manuals/999' + suffix)
        assert response.status_code == 404


def test_validation_error_shape(context):
    client, _, _ = context
    response = client.post('/api/manuals', json={'manual_code': ' ', 'title': ''})
    assert response.status_code == 400
    assert isinstance(response.json()['detail'], str)


def test_path_code_rejected(context):
    client, _, _ = context
    assert create_manual(client, '../bad').status_code == 400


def test_legacy_database_records_remain_readable(context):
    client, db, _ = context
    manual = create_manual(client).json()
    row = db.get(Manual, manual['id'])
    row.manual_code = 'LEGACY/001'
    row.description = 'x' * 20001
    db.commit()
    assert client.get('/api/manuals').status_code == 200
    response = client.get(f'/api/manuals/{manual["id"]}')
    assert response.status_code == 200
    assert response.json()['manual_code'] == 'LEGACY/001'
    assert response.json()['description'] == row.description


def test_manual_code_generated_from_category(context):
    client, _, _ = context
    codes = []
    for category in ('THAI', 'EN', 'THAI', 'ภาษาไทย', None):
        body = {'title': 'T'} | ({'category': category} if category else {})
        response = client.post('/api/manuals', json=body)
        assert response.status_code == 201, response.text
        codes.append(response.json()['manual_code'])
    assert codes[0].endswith('-THAI-001') and codes[2].endswith('-THAI-002')
    assert codes[1].endswith('-EN-001')
    assert codes[3].endswith('-OTHER-001')
    assert codes[4].endswith('-GEN-001')
    assert len(set(codes)) == 5


def test_generated_number_uses_numeric_order_and_literal_prefix(context):
    client, _, _ = context
    project = client.post('/api/projects', json={'project_code': 'P_A', 'project_name': 'P'}).json()
    for code in ('P_A-GEN-009', 'P_A-GEN-1000', 'PXA-GEN-9999', 'P_A-GEN-invalid'):
        assert client.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': code, 'title': 'T'}).status_code == 201
    result = client.post(f'/api/projects/{project["id"]}/manuals', json={'title': 'T'})
    assert result.status_code == 201
    assert result.json()['manual_code'] == 'P_A-GEN-1001'
