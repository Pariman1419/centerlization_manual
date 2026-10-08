"""Cross-feature integration: RBAC + review workflow + forced password change + audit trail."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.audit_log import AuditLog
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from app.models.project_member import ProjectMember
from app.models.revision_review import RevisionReview
from app.models.user import User, UserSession
from test_project_members import auth_users, make_pdf  # noqa: F401  (fixture re-export)

PW = 'Password123!'
TEMP = 'Temporary-pass-456!'
NEW = 'Brand-new-pass-789!'


def client_for(name, password=PW):
    client = TestClient(app, raise_server_exceptions=False)
    response = client.post('/api/auth/login', json={'username': name, 'password': password})
    assert response.status_code == 200, response.text
    client.headers['X-CSRF-Token'] = response.json()['csrf_token']
    return client


def upload(client, manual_id, number):
    return client.post(f'/api/manuals/{manual_id}/revisions', data={'revision_no': number, 'revision_detail': 'x'},
        files={'file': ('m.pdf', make_pdf(), 'application/pdf')})


def team(users, owner_client):
    project = owner_client.post('/api/projects', json={'project_code': 'INT-1', 'project_name': 'Integration'}).json()
    for name, role in [('contributor', 'CONTRIBUTOR'), ('reviewer', 'REVIEWER')]:
        assert owner_client.post(f'/api/projects/{project["id"]}/members', json={'username': name, 'role': role}).status_code == 201
    return project


def test_full_workflow_roles_isolation_and_audit(auth_users):
    _, db, storage, users = auth_users
    ba01, ba02, eng, ba03, admin = (client_for(n) for n in ('owner', 'contributor', 'reviewer', 'outsider', 'admin'))
    project = team(users, ba01)
    manual = ba02.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'INT-M1', 'title': 'T'}).json()
    rev1 = upload(ba02, manual['id'], '01')
    assert rev1.status_code == 201 and rev1.json()['status'] == 'DRAFT'
    r1 = rev1.json()['id']
    assert ba02.post(f'/api/revisions/{r1}/submit-review').json()['status'] == 'IN_REVIEW'
    assert ba02.post(f'/api/revisions/{r1}/approve', json={}).status_code == 403
    assert eng.post(f'/api/revisions/{r1}/approve', json={'comment': 'ok'}).json()['status'] == 'APPROVED'
    # Reviewer now shares the combined BA role, including publication.
    assert eng.post(f'/api/revisions/{r1}/publish').json()['status'] == 'PUBLISHED'

    r2 = upload(ba02, manual['id'], '02').json()['id']
    assert ba02.post(f'/api/revisions/{r2}/submit-review').status_code == 200
    assert eng.post(f'/api/revisions/{r2}/reject', json={'comment': 'fix it'}).json()['status'] == 'REJECTED'
    assert ba02.post(f'/api/revisions/{r2}/submit-review').status_code == 400
    rejected_revision = r2
    r2 = upload(ba02, manual['id'], '03').json()['id']
    assert ba02.post(f'/api/revisions/{r2}/submit-review').json()['status'] == 'IN_REVIEW'
    assert eng.post(f'/api/revisions/{r2}/approve', json={}).status_code == 200
    assert ba01.post(f'/api/revisions/{r2}/publish').status_code == 200

    db.expire_all()
    assert db.get(ManualRevision, r1).status == 'ARCHIVED' and db.get(ManualRevision, r2).status == 'PUBLISHED'
    assert db.get(Manual, manual['id']).current_revision_id == r2
    assert len(storage.objects) == 3
    decisions = [r.decision for r in db.scalars(select(RevisionReview).where(
        RevisionReview.revision_id.in_([rejected_revision, r2])).order_by(RevisionReview.id))]
    assert decisions == ['REJECTED', 'APPROVED']
    assert ba02.get(f'/api/revisions/{rejected_revision}/reviews').json()[0]['comment'] == 'fix it'
    assert len(ba02.get(f'/api/revisions/{r2}/reviews').json()) == 1

    # BA03 (non-member): everything denied and no presigned URL is ever generated.
    signed = []
    original = storage.url
    storage.url = lambda *a, **k: signed.append(a) or original(*a, **k)
    for path in (f'/api/projects/{project["id"]}', f'/api/projects/{project["id"]}/members', f'/api/manuals/{manual["id"]}',
                 f'/api/manuals/{manual["id"]}/revisions', f'/api/revisions/{r2}', f'/api/revisions/{r2}/preview',
                 f'/api/revisions/{r2}/download', f'/api/revisions/{r2}/reviews'):
        assert ba03.get(path).status_code == 404, path
    for path in (f'/api/revisions/{r2}/submit-review', f'/api/revisions/{r2}/approve', f'/api/revisions/{r2}/publish'):
        assert ba03.post(path, json={'comment': 'x'}).status_code == 404, path
    assert ba03.get('/api/projects').json() == []
    assert signed == []
    assert ba02.get(f'/api/revisions/{r2}/preview').status_code == 200 and len(signed) == 1
    assert admin.get(f'/api/revisions/{r2}/download').status_code == 200
    assert any(p['id'] == project['id'] for p in admin.get('/api/projects').json())

    # Audit trail covers every workflow action with safe details only.
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    seen = {r.action for r in rows}
    assert {'PROJECT_CREATED', 'MEMBER_ADDED', 'MANUAL_CREATED', 'REVISION_UPLOADED', 'REVISION_SUBMITTED',
            'REVISION_APPROVED', 'REVISION_REJECTED', 'REVISION_PUBLISHED'} <= seen
    approved = next(r for r in rows if r.action == 'REVISION_APPROVED')
    assert approved.actor_user_id == users['reviewer'].id and approved.project_id == project['id']
    assert approved.manual_id == manual['id'] and approved.revision_id == r1
    assert 'fix it' not in json.dumps([r.details for r in rows])


def test_member_audit_and_last_owner_and_removed_owner_loses_access(auth_users):
    _, db, _, users = auth_users
    ba01 = client_for('owner')
    project = team(users, ba01)
    pid = project['id']
    assert ba01.post(f'/api/projects/{pid}/members', json={'username': 'extra_owner', 'role': 'OWNER'}).status_code == 201
    assert ba01.put(f'/api/projects/{pid}/members/{users["reviewer"].id}', json={'role': 'CONTRIBUTOR'}).status_code == 200
    extra = client_for('extra_owner')
    assert extra.delete(f'/api/projects/{pid}/members/{users["owner"].id}').status_code == 200
    # projects.owner_user_id still points at the removed owner, but that grants nothing any more.
    assert ba01.get(f'/api/projects/{pid}').status_code == 404
    assert extra.delete(f'/api/projects/{pid}/members/{users["extra_owner"].id}').status_code == 409
    assert extra.put(f'/api/projects/{pid}/members/{users["extra_owner"].id}', json={'role': 'VIEWER'}).status_code == 409
    actions = [r.action for r in db.scalars(select(AuditLog).order_by(AuditLog.id))]
    assert actions.count('MEMBER_ADDED') == 3 and 'MEMBER_ROLE_CHANGED' in actions and actions.count('MEMBER_REMOVED') == 1
    changed = db.scalars(select(AuditLog).where(AuditLog.action == 'MEMBER_ROLE_CHANGED')).one()
    assert changed.details == {'from_role': 'REVIEWER', 'to_role': 'CONTRIBUTOR'} and changed.target_user_id == users['reviewer'].id


def test_admin_override_wins_over_member_row_and_can_self_approve(auth_users):
    _, db, _, users = auth_users
    ba01 = client_for('owner')
    project = team(users, ba01)
    pid = project['id']
    db.add(ProjectMember(project_id=pid, user_id=users['admin'].id, role='VIEWER'))
    db.commit()
    admin = client_for('admin')
    manual = admin.post(f'/api/projects/{pid}/manuals', json={'manual_code': 'ADM-1', 'title': 'T'})
    assert manual.status_code == 201   # a VIEWER row never limits a global ADMIN
    rev = upload(admin, manual.json()['id'], '01').json()['id']
    assert admin.post(f'/api/revisions/{rev}/submit-review').status_code == 200
    assert admin.post(f'/api/revisions/{rev}/approve', json={}).status_code == 200   # self-approval is allowed
    assert next(p for p in admin.get('/api/projects').json() if p['id'] == pid)['my_role'] == 'ADMIN'
    assert admin.post(f'/api/revisions/{rev}/publish').status_code == 200


def test_forced_password_change_blocks_owner_and_admin_everywhere(auth_users):
    _, db, _, users = auth_users
    ba01 = client_for('owner')
    project = team(users, ba01)
    pid = project['id']
    manual = ba01.post(f'/api/projects/{pid}/manuals', json={'manual_code': 'F-1', 'title': 'T'}).json()
    rev = upload(ba01, manual['id'], '01').json()['id']
    admin = client_for('admin')
    assert admin.post(f'/api/users/{users["owner"].id}/reset-password', json={'temporary_password': TEMP}).status_code == 200
    assert ba01.get('/api/projects').status_code == 401   # old session gone
    forced = client_for('owner', TEMP)
    blocked = [('get', '/api/projects'), ('get', f'/api/projects/{pid}'), ('get', f'/api/projects/{pid}/members'),
        ('post', f'/api/projects/{pid}/members'), ('get', f'/api/manuals/{manual["id"]}'), ('get', f'/api/revisions/{rev}'),
        ('get', f'/api/revisions/{rev}/preview'), ('get', f'/api/revisions/{rev}/download'), ('get', f'/api/revisions/{rev}/reviews'),
        ('post', f'/api/revisions/{rev}/submit-review'), ('post', f'/api/revisions/{rev}/publish'), ('get', '/api/users')]
    for method, path in blocked:
        assert getattr(forced, method)(path).status_code == 403, path
    assert forced.get('/api/auth/me').status_code == 200
    # Same for a forced ADMIN.
    db.get(User, users['admin'].id).must_change_password = True
    db.commit()
    assert admin.get('/api/projects').status_code == 403 and admin.get('/api/users').status_code == 403
    assert admin.post('/api/auth/change-password', json={'current_password': PW, 'new_password': NEW}).status_code == 200
    assert admin.get('/api/projects').status_code == 200
    # Owner changes the password and keeps OWNER membership.
    assert forced.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': NEW}).status_code == 200
    assert forced.get(f'/api/projects/{pid}').json()['my_role'] == 'OWNER'


def test_password_reset_keeps_membership_and_audits_without_secrets(auth_users):
    _, db, _, users = auth_users
    ba01 = client_for('owner')
    project = team(users, ba01)
    ba02 = client_for('contributor')
    admin = client_for('admin')
    assert admin.post(f'/api/users/{users["contributor"].id}/reset-password', json={'temporary_password': TEMP}).status_code == 200
    assert ba02.get('/api/projects').status_code == 401
    assert db.query(UserSession).filter_by(user_id=users['contributor'].id).count() == 0
    fresh = TestClient(app, raise_server_exceptions=False)
    assert fresh.post('/api/auth/login', json={'username': 'contributor', 'password': PW}).status_code == 401
    temp = client_for('contributor', TEMP)
    assert temp.get('/api/projects').status_code == 403
    assert temp.post('/api/auth/change-password', json={'current_password': TEMP, 'new_password': NEW}).status_code == 200
    projects = temp.get('/api/projects').json()
    assert [(p['id'], p['my_role']) for p in projects] == [(project['id'], 'CONTRIBUTOR')]
    resets = db.scalars(select(AuditLog).where(AuditLog.action == 'PASSWORD_RESET_BY_ADMIN')).all()
    changed = db.scalars(select(AuditLog).where(AuditLog.action == 'PASSWORD_CHANGED')).all()
    assert len(resets) == len(changed) == 1
    assert resets[0].actor_user_id == users['admin'].id and resets[0].target_user_id == users['contributor'].id
    assert changed[0].actor_user_id == changed[0].target_user_id == users['contributor'].id
    dump = json.dumps([(r.action, r.details) for r in db.scalars(select(AuditLog))])
    for secret in (TEMP, NEW, PW, 'scrypt$', 'csrf', 'manual_session'):
        assert secret not in dump


def test_audit_failure_rolls_back_business_change(auth_users, monkeypatch):
    _, db, _, users = auth_users
    ba01 = client_for('owner')
    project = team(users, ba01)
    manual = ba01.post(f'/api/projects/{project["id"]}/manuals', json={'manual_code': 'A-1', 'title': 'T'}).json()
    rev = upload(ba01, manual['id'], '01').json()['id']
    ba01.post(f'/api/revisions/{rev}/submit-review')
    import app.routers.revisions as revisions
    from app.services.audit import AuditError

    def boom(*a, **k):
        raise AuditError('down')
    monkeypatch.setattr(revisions, 'write_audit_event', boom)
    assert client_for('reviewer').post(f'/api/revisions/{rev}/approve', json={}).status_code == 500
    db.expire_all()
    assert db.get(ManualRevision, rev).status == 'IN_REVIEW'
    assert db.scalars(select(RevisionReview)).all() == []
    assert not db.scalars(select(AuditLog).where(AuditLog.action == 'REVISION_APPROVED')).all()


def test_unknown_audit_action_is_rejected_without_writing(context):
    from app.services.audit import write_audit_event
    _, db, _ = context
    with pytest.raises(ValueError, match='Unknown audit action'):
        write_audit_event(db, 'NOT_A_WORKFLOW_ACTION')
    assert db.scalars(select(AuditLog)).all() == []
