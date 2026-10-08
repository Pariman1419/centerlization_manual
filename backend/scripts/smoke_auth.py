"""Verify live Login/ownership/storage with temporary, labelled fixtures and cleanup.

Uses INITIAL_ADMIN_PASSWORD from backend environment; never logs passwords/tokens.
Only removes records created by this invocation, not existing application data.
"""
import hashlib
import io
import json
import secrets
from pathlib import Path
from uuid import uuid4

import httpx
from pypdf import PdfWriter
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_engine
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from app.models.project import Project
from app.models.user import User, UserSession
from app.services.minio_service import get_storage


def main():
    settings = get_settings()
    gateway = settings.api_token.get_secret_value()
    headers = {'Authorization': f'Bearer {gateway}'} if gateway else {}
    clients = [httpx.Client(base_url='http://127.0.0.1:8000', headers=headers, timeout=30, trust_env=False) for _ in range(3)]
    admin, first, second = clients
    created_users, created_projects = [], []
    prefix = 'AUTH-VERIFY-' + uuid4().hex[:10]
    result = {'status': 'passed', 'checks': []}

    def checked(response, status=200):
        assert response.status_code == status, (response.status_code, response.text)
        return response.json()

    def login(client, username, password):
        data = checked(client.post('/api/auth/login', json={'username': username, 'password': password}))
        client.headers['X-CSRF-Token'] = data['csrf_token']
        return data['user']

    try:
        assert checked(admin.get('/health'))['status'] == 'ok'
        checked(first.get('/api/projects'), 401)
        login(admin, 'admin', settings.initial_admin_password.get_secret_value())
        users = []
        for suffix in ('a', 'b'):
            username, password = prefix.lower() + '-' + suffix, secrets.token_urlsafe(24)
            user = checked(admin.post('/api/users', json={'username': username, 'display_name': 'Temporary ownership verification',
                'password': password, 'role': 'USER'}), 201)
            created_users.append(user['id'])
            users.append((username, password))
        for index, client in enumerate((first, second)):
            actor = login(client, *users[index])
            checked(client.get('/api/users'), 403)
            project = checked(client.post('/api/projects', json={'project_code': prefix + '-' + str(index),
                'project_name': 'Temporary ownership verification'}), 201)
            created_projects.append(project['id'])
            assert project['owner_user_id'] == actor['id'] and project['created_by'] == actor['username']
        assert {p['id'] for p in checked(first.get('/api/projects'))} == {created_projects[0]}
        assert {p['id'] for p in checked(second.get('/api/projects'))} == {created_projects[1]}
        assert set(created_projects).issubset({p['id'] for p in checked(admin.get('/api/projects'))})
        manual = checked(first.post(f'/api/projects/{created_projects[0]}/manuals', json={
            'manual_code': prefix + '-MAN', 'title': 'Temporary verification manual', 'category': 'Verification'}), 201)
        output = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.write(output)
        pdf = output.getvalue()
        revisions = []
        for number in ('01', '02'):
            revision = checked(first.post(f'/api/manuals/{manual["id"]}/revisions',
                data={'revision_no': number, 'revision_detail': 'Temporary verification'},
                files={'file': ('verification.pdf', pdf, 'application/pdf')}), 201)
            revisions.append(revision)
            assert revision['status'] == 'DRAFT' and revision['uploaded_by'] == users[0][0]
            if number == '02':
                assert checked(first.get(f'/api/manuals/{manual["id"]}/current'))['id'] == revisions[0]['id']
            published = checked(first.post(f'/api/revisions/{revision["id"]}/publish'))
            assert published['published_by'] == users[0][0]
        assert checked(first.get(f'/api/manuals/{manual["id"]}/current'))['id'] == revisions[1]['id']
        assert [r['status'] for r in checked(first.get(f'/api/manuals/{manual["id"]}/revisions'))] == ['PUBLISHED', 'ARCHIVED']
        for path in (f'/api/projects/{created_projects[0]}', f'/api/projects/{created_projects[0]}/manuals',
                f'/api/manuals/{manual["id"]}', f'/api/manuals/{manual["id"]}/revisions', f'/api/manuals/{manual["id"]}/current'):
            checked(second.get(path), 404)
        for revision in revisions:
            for path in (f'/api/revisions/{revision["id"]}', f'/api/revisions/{revision["id"]}/preview', f'/api/revisions/{revision["id"]}/download'):
                checked(second.get(path), 404)
                checked(httpx.get('http://127.0.0.1:8000' + path, headers=headers, timeout=15, trust_env=False), 401)
            checked(second.post(f'/api/revisions/{revision["id"]}/publish'), 404)
            for client in (first, admin):
                for action in ('preview', 'download'):
                    access = checked(client.get(f'/api/revisions/{revision["id"]}/{action}'))
                    assert access['expires_in'] == 600
                    file = httpx.get(access['url'], timeout=15, trust_env=False)
                    assert file.status_code == 200 and file.content == pdf
                    assert hashlib.sha256(file.content).hexdigest() == revision['checksum']
                    assert ('inline' if action == 'preview' else 'attachment') in file.headers['content-disposition']
        checked(second.post(f'/api/projects/{created_projects[0]}/manuals', json={'manual_code': prefix+'-BAD','title':'Forbidden'}),404)
        checked(second.post(f'/api/manuals/{manual["id"]}/revisions', data={'revision_no':'03'},files={'file':('verification.pdf',pdf,'application/pdf')}),404)
        assert checked(second.get('/api/manuals')) == []
        assert first.get('/api/projects').headers['cache-control'] == 'no-store'
        result['checks'] = ['login/logout', 'admin-only user creation', 'ownership assigned by server',
            'user lists isolated; admin sees both', 'direct URL denial through every descendant',
            'real MinIO uploads/checksums and signed retrieval', 'draft/publish/archive/current pointer', 'authenticated no-store responses']
        for client in clients:
            checked(client.post('/api/auth/logout'))
            checked(client.get('/api/projects'), 401)
    finally:
        # Fixture identity guards prevent cleanup from touching unrelated Projects/users.
        with Session(get_engine()) as db:
            projects = db.scalars(select(Project).where(Project.id.in_(created_projects))).all()
            assert all(p.project_code.startswith(prefix+'-') and p.owner_user_id in created_users for p in projects)
            users = db.scalars(select(User).where(User.id.in_(created_users))).all()
            assert all(u.username.startswith(prefix.lower()+'-') and u.role == 'USER' for u in users)
            manual_ids = list(db.scalars(select(Manual.id).where(Manual.project_id.in_(created_projects))))
            objects = list(db.scalars(select(ManualRevision.object_key).where(ManualRevision.manual_id.in_(manual_ids))))
            db.execute(update(Manual).where(Manual.id.in_(manual_ids)).values(current_revision_id=None))
            db.execute(delete(ManualRevision).where(ManualRevision.manual_id.in_(manual_ids)))
            db.execute(delete(Manual).where(Manual.id.in_(manual_ids)))
            db.execute(delete(Project).where(Project.id.in_(created_projects)))
            db.execute(delete(UserSession).where(UserSession.user_id.in_(created_users)))
            db.execute(delete(User).where(User.id.in_(created_users)))
            db.commit()
        for key in objects:
            get_storage().client.remove_object(settings.minio_bucket, key)
        for client in clients:
            client.close()
        result['temporary_fixtures_removed'] = True
    Path('.auth-smoke-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
