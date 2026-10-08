"""Create one labelled live test manual and retain its history/files for review.

Run from backend: python scripts/smoke.py (with PYTHONPATH=.).
No existing manual or revision is modified or deleted.
"""
import argparse
import hashlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import text

from app.config import get_settings
from app.database import get_engine
from app.main import app
from app.services.minio_service import get_storage


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-manual-id', type=int, help='Resume verification of an existing smoke fixture')
    args = parser.parse_args()
    output = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=200)
    writer.write(output)
    pdf = output.getvalue()
    code = 'SMOKE-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '-' + uuid4().hex[:6]
    token = get_settings().api_token.get_secret_value()
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    with TestClient(app, headers=headers) as client:
        def checked(response, status=200):
            assert response.status_code == status, (response.status_code, response.text)
            return response.json()

        checked(client.get('/health'))
        if args.verify_manual_id:
            manual = checked(client.get(f'/api/manuals/{args.verify_manual_id}'))
            assert manual['manual_code'].startswith('SMOKE-') and manual['category'] == 'Verification'
            code = manual['manual_code']
            revisions = sorted(checked(client.get(f'/api/manuals/{manual["id"]}/revisions')), key=lambda r: r['revision_no'])
            assert len(revisions) == 2
        else:
            manual = checked(client.post('/api/manuals', json={'manual_code': code,
                'title': 'Verification fixture — Manual Management', 'category': 'Verification',
                'description': 'Retained automated smoke fixture; two blank PDF revisions.'}), 201)
            checked(client.post('/api/manuals', json={'manual_code': code, 'title': 'Duplicate'}), 409)
            checked(client.get(f'/api/manuals/{manual["id"]}'))
            revisions = []
            for number in ('01', '02'):
                revision = checked(client.post(f'/api/manuals/{manual["id"]}/revisions',
                    data={'revision_no': number, 'revision_detail': f'Verification revision {number}'},
                    files={'file': (f'verification-rev{number}.pdf', pdf, 'application/pdf')}), 201)
                assert revision['status'] == 'DRAFT'
                revisions.append(revision)
                if number == '01':
                    checked(client.post(f'/api/revisions/{revision["id"]}/publish'))
                else:
                    assert checked(client.get(f'/api/manuals/{manual["id"]}/current'))['id'] == revisions[0]['id']
            checked(client.post(f'/api/revisions/{revisions[1]["id"]}/publish'))
            assert checked(client.get(f'/api/revisions/{revisions[0]["id"]}'))['status'] == 'ARCHIVED'

        # Simultaneous publication requests must serialize on the same manual.
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda r: client.post(f'/api/revisions/{r["id"]}/publish'), revisions))
        for response in responses:
            checked(response)
        checked(client.post(f'/api/revisions/{revisions[1]["id"]}/publish'))

        for revision in revisions:
            for action in ('preview', 'download'):
                access = checked(client.get(f'/api/revisions/{revision["id"]}/{action}'))
                assert access['expires_in'] == 600
                # Private network storage must not go through environment HTTP proxies.
                file = httpx.get(access['url'], timeout=15, trust_env=False)
                assert file.status_code == 200, (action, file.status_code)
                assert file.content == pdf
                assert hashlib.sha256(file.content).hexdigest() == revision['checksum']
                assert ('attachment' if action == 'download' else 'inline') in file.headers['content-disposition']
        history = checked(client.get(f'/api/manuals/{manual["id"]}/revisions'))
        assert [r['status'] for r in history] == ['PUBLISHED', 'ARCHIVED']
        assert checked(client.get(f'/api/manuals/{manual["id"]}/current'))['id'] == revisions[1]['id']
        with get_engine().connect() as connection:
            rows = connection.execute(text('SELECT id, object_key, status FROM manual_revisions WHERE manual_id=:id'), {'id': manual['id']}).all()
            assert len(rows) == 2 and sum(r.status == 'PUBLISHED' for r in rows) == 1
            assert connection.scalar(text('SELECT current_revision_id FROM manuals WHERE id=:id'), {'id': manual['id']}) == revisions[1]['id']
            for row in rows:
                assert get_storage().client.stat_object(get_settings().minio_bucket, row.object_key).size == len(pdf)
        result = {'manual_id': manual['id'], 'manual_code': code,
            'revision_ids': [r['id'] for r in revisions], 'status': 'passed',
            'checks': ['health', 'create/duplicate/read', 'upload/checksum/history', 'draft keeps current',
                'publish/archive/pointer', 'concurrent publish', 'public preview/download', 'both files retained']}
        Path('.smoke-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
