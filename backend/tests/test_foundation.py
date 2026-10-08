def test_health(context):
    client, _, _ = context
    result = client.get('/health')
    assert result.status_code == 200
    assert result.json() == {'status': 'ok', 'database': 'connected', 'minio': 'connected'}


def test_unhealthy_storage(context):
    client, _, storage = context
    storage.fail_health = True
    response = client.get('/health')
    assert response.status_code == 503
    assert response.json()['minio'] == 'unavailable'
    assert 'storage unavailable' not in response.text
