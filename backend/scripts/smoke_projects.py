"""Explicit live HTTP verification; retains the Plating fixture and never deletes data.

Run from backend with PYTHONPATH=.: python scripts/smoke_projects.py
Reruns verify existing revisions without republishing them or replacing objects.
"""
import hashlib
import io
import json
from pathlib import Path

import httpx
from pypdf import PdfWriter
from sqlalchemy import inspect, text

from app.config import get_settings
from app.database import get_engine
from app.services.minio_service import get_storage


def main():
    settings = get_settings()
    token = settings.api_token.get_secret_value()
    headers = {'Authorization': f'Bearer {token}'} if token else {}
    baseline = json.loads((Path(__file__).resolve().parents[2] / 'docs/project-baseline.json').read_text())
    with httpx.Client(base_url='http://127.0.0.1:8000', headers=headers, timeout=30, trust_env=False) as client:
        def checked(response, status=200):
            assert response.status_code == status, (response.status_code, response.text)
            return response.json()

        def stored_key(revision):
            # Object paths are backend metadata, deliberately absent from public DTOs.
            with get_engine().connect() as connection:
                revision['object_key'] = connection.scalar(text(
                    'SELECT object_key FROM manual_revisions WHERE id=:id'), {'id': revision['id']})
            return revision

        assert checked(client.get('/health')) == {'status': 'ok', 'database': 'connected', 'minio': 'connected'}
        projects = checked(client.get('/api/projects', params={'search': 'PRJ-PLATING'}))
        project = next((p for p in projects if p['project_code'] == 'PRJ-PLATING'), None)
        if project is None:
            project = checked(client.post('/api/projects', json={'project_code': 'PRJ-PLATING',
                'project_name': 'Plating Machine', 'description': 'Plating machine manuals and maintenance documents.'}), 201)
        assert project['project_name'] == 'Plating Machine'
        checked(client.post('/api/projects', json={'project_code': 'PRJ-PLATING', 'project_name': 'Duplicate'}), 409)
        checked(client.put(f'/api/projects/{project["id"]}', json={'description': project['description']}))
        manuals = checked(client.get(f'/api/projects/{project["id"]}/manuals'))
        manual = next((m for m in manuals if m['manual_code'] == 'MAN-PLATING-001'), None)
        if manual is None:
            manual = checked(client.post(f'/api/projects/{project["id"]}/manuals', json={
                'manual_code': 'MAN-PLATING-001', 'title': 'Operation Manual', 'category': 'Operation'}), 201)
        assert manual['project_id'] == project['id'] and manual['project_code'] == 'PRJ-PLATING'
        history = checked(client.get(f'/api/manuals/{manual["id"]}/revisions'))
        revisions = []
        for number in ('01', '02'):
            revision = next((r for r in history if r['revision_no'] == number), None)
            if revision is None:
                output = io.BytesIO()
                writer = PdfWriter()
                writer.add_blank_page(width=300, height=200)
                writer.add_metadata({'/Title': f'Operation Manual REV {number} verification fixture'})
                writer.write(output)
                revision = checked(client.post(f'/api/manuals/{manual["id"]}/revisions',
                    data={'revision_no': number, 'revision_detail': 'Initial Release' if number == '01' else 'Update operating procedure'},
                    files={'file': (f'operation_manual_rev{number}.pdf', output.getvalue(), 'application/pdf')}), 201)
                assert revision['status'] == 'DRAFT'
                if number == '02':
                    assert checked(client.get(f'/api/manuals/{manual["id"]}/current'))['id'] == revisions[0]['id']
                checked(client.post(f'/api/revisions/{revision["id"]}/publish'))
            stored_key(revision)
            assert revision['object_key'].startswith(f'PRJ-PLATING/MAN-PLATING-001/rev-{int(number):03d}/')
            revisions.append(revision)
        history = checked(client.get(f'/api/manuals/{manual["id"]}/revisions'))
        assert [(r['revision_no'], r['status']) for r in history] == [('02', 'PUBLISHED'), ('01', 'ARCHIVED')]
        assert checked(client.get(f'/api/manuals/{manual["id"]}/current'))['id'] == revisions[1]['id']
        assert checked(client.get(f'/api/manuals/{manual["id"]}'))['current_revision_id'] == revisions[1]['id']
        project_rows = checked(client.get(f'/api/projects/{project["id"]}/manuals'))
        assert len(project_rows) == 1 and project_rows[0]['current_revision']['revision_no'] == '02'
        assert checked(client.get(f'/api/projects/{project["id"]}'))['manual_count'] == 1
        assert [m['id'] for m in checked(client.get('/api/manuals', params={'project_id': project['id']}))] == [manual['id']]

        for old in baseline['manuals']:
            current = checked(client.get(f'/api/manuals/{old["id"]}'))
            assert all(current[key] == value for key, value in old.items())
            assert current['project_code'] == 'LEGACY'
            assert current['id'] not in [m['id'] for m in project_rows]
        legacy_revisions = []
        for old in baseline['revisions']:
            current = stored_key(checked(client.get(f'/api/revisions/{old["id"]}')))
            assert all(current[key] == old[key] for key in ('id', 'manual_id', 'revision_no', 'object_key', 'checksum', 'status'))
            legacy_revisions.append(current)
        for revision in revisions + legacy_revisions:
            for action in ('preview', 'download'):
                access = checked(client.get(f'/api/revisions/{revision["id"]}/{action}'))
                assert access['expires_in'] == 600
                file = httpx.get(access['url'], timeout=20, trust_env=False)
                assert file.status_code == 200
                assert hashlib.sha256(file.content).hexdigest() == revision['checksum']
                assert ('inline' if action == 'preview' else 'attachment') in file.headers['content-disposition']
            stat = get_storage().client.stat_object(settings.minio_bucket, revision['object_key'])
            assert stat.size == revision['file_size']

        with get_engine().connect() as connection:
            inspector = inspect(connection)
            assert inspector.has_table('projects')
            assert next(c for c in inspector.get_columns('manuals') if c['name'] == 'project_id')['nullable'] is False
            assert any(fk['constrained_columns'] == ['project_id'] and fk['referred_table'] == 'projects'
                for fk in inspector.get_foreign_keys('manuals'))
            assert any(index['name'] == 'idx_manuals_project_id' for index in inspector.get_indexes('manuals'))
            assert any(u['column_names'] == ['manual_code'] for u in inspector.get_unique_constraints('manuals'))
            assert 'project_id' not in [c['name'] for c in inspector.get_columns('manual_revisions')]
            assert connection.scalar(text('SELECT count(*) FROM manuals WHERE project_id IS NULL')) == 0
            assert connection.scalar(text('SELECT current_revision_id FROM manuals WHERE id=:id'), {'id': manual['id']}) == revisions[1]['id']
            counts = {table: connection.scalar(text(f'SELECT count(*) FROM {table}'))
                for table in ('projects', 'manuals', 'manual_revisions')}
        result = {'status': 'passed', 'project_id': project['id'], 'manual_id': manual['id'],
            'revision_ids': [r['id'] for r in revisions], 'object_keys': [r['object_key'] for r in revisions],
            'row_counts': counts, 'legacy_manual_id': 1,
            'checks': ['HTTP health', 'project create/read/update/duplicate', 'scoped manual/filter/count',
                'new uploads/path', 'draft preserves current', 'publish/archive/current pointer',
                'all four files retained', 'new and legacy preview/download/checksums',
                'legacy metadata unchanged', 'schema/FK/index/global uniqueness']}
        Path('.project-smoke-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
