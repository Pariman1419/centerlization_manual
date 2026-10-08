import pytest
from sqlalchemy import select
from app.auth import get_current_user
from app.main import app
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from app.models.project_member import ProjectMember
from app.models.user import User
from app.models.audit_log import AuditLog
from conftest import create_manual, upload


def setup_review(context, pdf):
    client, db, storage = context
    ba = db.scalar(select(User).where(User.username == 'BA'))
    manual = create_manual(client).json()
    dev = User(username='dev-update', display_name='Developer', role='USER', password_hash='unused')
    viewer = User(username='viewer-update', display_name='Viewer', role='USER', password_hash='unused')
    db.add_all([dev, viewer])
    db.commit()
    db.add_all([ProjectMember(project_id=manual['project_id'], user_id=dev.id, role='CONTRIBUTOR'),
                ProjectMember(project_id=manual['project_id'], user_id=viewer.id, role='VIEWER')])
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: dev
    revision = upload(client, manual['id'], pdf).json()
    assert client.post(f'/api/revisions/{revision["id"]}/submit-review').status_code == 200
    app.dependency_overrides[get_current_user] = lambda: ba
    return client, db, storage, ba, dev, viewer, manual, revision


def replace(client, revision, pdf, version=0):
    return client.post(f'/api/revisions/{revision["id"]}/update-files',
        data={'expected_version': str(version), 'revision_detail': 'BA corrected safety instructions'},
        files={'pdf_file': ('corrected.pdf', pdf, 'application/pdf')})


def test_ba_replaces_in_review_file_keeps_revision_and_can_approve(context, pdf):
    client, db, storage, ba, dev, _, manual, revision = setup_review(context, pdf)
    old_key = db.get(ManualRevision, revision['id']).object_key
    result = replace(client, revision, pdf)
    assert result.status_code == 200, result.text
    data = result.json()
    assert (data['id'], data['revision_no'], data['status']) == (revision['id'], '01', 'DRAFT')
    assert data['uploaded_by'] == dev.username
    assert data['ba_updated_by'] == ba.username
    assert data['content_version'] == 1
    assert data['file_name'] == 'corrected.pdf'
    db.expire_all()
    row = db.get(ManualRevision, revision['id'])
    assert row.object_key != old_key
    assert storage.objects[row.object_key] == pdf
    assert old_key not in storage.objects
    assert db.get(Manual, manual['id']).current_revision_id is None
    events = db.scalars(select(AuditLog).where(AuditLog.action == 'REVISION_UPDATED')).all()
    assert events[0].details['previous_files'][0]['file_name'] == 'manual.pdf'
    assert events[0].details['files'][0]['file_name'] == 'corrected.pdf'
    approved = client.post(f'/api/revisions/{revision["id"]}/approve', json={'expected_version': 1})
    assert approved.status_code == 200, approved.text
    assert approved.json()['status'] == 'APPROVED'
    assert client.post(f'/api/revisions/{revision["id"]}/publish').status_code == 200


def test_initial_draft_cannot_use_direct_approval(context, pdf):
    client, _, _ = context
    manual = create_manual(client).json()
    revision = upload(client, manual['id'], pdf).json()
    assert client.post(f'/api/revisions/{revision["id"]}/approve').status_code == 409


def test_dev_review_blocks_approval_until_dev_reports_no_changes(context, pdf):
    client, db, _, _, dev, _, _, revision = setup_review(context, pdf)
    result = replace(client, revision, pdf)
    assert result.status_code == 200, result.text
    requested = client.post(f'/api/revisions/{revision["id"]}/request-dev-review', json={'expected_version': 1})
    assert requested.status_code == 200, requested.text
    assert requested.json()['dev_review_requested'] is True
    assert client.post(f'/api/revisions/{revision["id"]}/approve', json={'expected_version': 1}).status_code == 409
    # Submit-for-review must not bypass the Dev gate.
    assert client.post(f'/api/revisions/{revision["id"]}/submit-review').status_code == 409
    app.dependency_overrides[get_current_user] = lambda: dev
    feedback = client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': False, 'comment': 'Safety section is correct'})
    assert feedback.status_code == 200, feedback.text
    assert feedback.json()['dev_reviewed_by'] == dev.username
    assert client.post(f'/api/revisions/{revision["id"]}/approve').status_code == 403
    ba = db.scalar(select(User).where(User.username == 'BA'))
    app.dependency_overrides[get_current_user] = lambda: ba
    assert client.post(f'/api/revisions/{revision["id"]}/approve', json={'expected_version': 1}).status_code == 200


def test_dev_changes_require_ba_update_and_old_feedback_cannot_approve_new_file(context, pdf):
    client, _, _, ba, dev, _, _, revision = setup_review(context, pdf)
    assert replace(client, revision, pdf).status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/request-dev-review', json={'expected_version': 1}).status_code == 200
    app.dependency_overrides[get_current_user] = lambda: dev
    assert client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': True, 'comment': '  '}).status_code == 400
    feedback = client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': True, 'comment': 'Correct page 2'})
    assert feedback.status_code == 200
    app.dependency_overrides[get_current_user] = lambda: ba
    assert client.post(f'/api/revisions/{revision["id"]}/approve', json={'expected_version': 1}).status_code == 409
    new = replace(client, revision, pdf, version=1)
    assert new.status_code == 200
    assert new.json()['dev_reviewed_by'] is None
    assert new.json()['content_version'] == 2
    assert client.post(f'/api/revisions/{revision["id"]}/request-dev-review', json={'expected_version': 2}).status_code == 200
    app.dependency_overrides[get_current_user] = lambda: dev
    assert client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': False}).status_code == 409
    app.dependency_overrides[get_current_user] = lambda: ba
    assert client.post(f'/api/revisions/{revision["id"]}/approve', json={'expected_version': 1}).status_code == 409


@pytest.mark.parametrize('role', ['dev', 'viewer', 'outsider'])
def test_only_ba_project_managers_can_replace_files(context, pdf, role):
    client, db, storage, _, dev, viewer, _, revision = setup_review(context, pdf)
    outsider = User(username='outside', display_name='Outside', role='USER', password_hash='unused')
    db.add(outsider)
    db.commit()
    actor = {'dev': dev, 'viewer': viewer, 'outsider': outsider}[role]
    app.dependency_overrides[get_current_user] = lambda: actor
    before = dict(storage.objects)
    assert replace(client, revision, pdf).status_code == (404 if role == 'outsider' else 403)
    assert storage.objects == before


@pytest.mark.parametrize('status', ['PUBLISHED', 'ARCHIVED'])
def test_ba_cannot_replace_released_files(context, pdf, status):
    client, db, storage, _, _, _, _, revision = setup_review(context, pdf)
    db.get(ManualRevision, revision['id']).status = status
    db.commit()
    before = dict(storage.objects)
    assert replace(client, revision, pdf).status_code == 409
    assert storage.objects == before


def test_replacement_validation_storage_failure_and_stale_update_preserve_file(context, pdf):
    client, db, storage, _, _, _, _, revision = setup_review(context, pdf)
    before = dict(storage.objects)
    bad = client.post(f'/api/revisions/{revision["id"]}/update-files', data={'expected_version': '0'},
        files={'pdf_file': ('bad.pdf', b'not a pdf', 'application/pdf')})
    assert bad.status_code == 400
    assert storage.objects == before
    storage.fail_upload = True
    assert replace(client, revision, pdf).status_code == 502
    assert storage.objects == before
    storage.fail_upload = False
    assert replace(client, revision, pdf).status_code == 200
    latest = dict(storage.objects)
    assert replace(client, revision, pdf).status_code == 409
    assert storage.objects == latest
    db.expire_all()
    assert db.get(ManualRevision, revision['id']).content_version == 1


def test_replacement_preserves_other_file_types(context, pdf):
    client, db, storage, _, _, _, _, revision = setup_review(context, pdf)
    row = db.get(ManualRevision, revision['id'])
    from app.models.manual_revision import RevisionFile
    attachment_key = 'attachment/source.txt'
    storage.objects[attachment_key] = b'keep source'
    row.files.append(RevisionFile(kind='OTHER', file_name='source.txt', object_key=attachment_key,
        file_size=11, mime_type='text/plain', label='Source'))
    db.commit()
    result = replace(client, revision, pdf)
    assert result.status_code == 200, result.text
    assert sorted(f['file_name'] for f in result.json()['files']) == ['corrected.pdf', 'source.txt']
    assert storage.objects[attachment_key] == b'keep source'


def test_reject_keeps_reason_and_dev_can_upload_new_revision(context, pdf):
    client, _, _, _, dev, _, manual, revision = setup_review(context, pdf)
    assert client.post(f'/api/revisions/{revision["id"]}/reject', json={'comment': ' '}).status_code == 400
    assert client.post(f'/api/revisions/{revision["id"]}/reject', json={'comment': 'Fix diagram'}).status_code == 200
    app.dependency_overrides[get_current_user] = lambda: dev
    new = upload(client, manual['id'], pdf, number='02')
    assert new.status_code == 201
    assert client.post(f'/api/revisions/{new.json()["id"]}/submit-review').status_code == 200
    history = client.get(f'/api/revisions/{revision["id"]}/reviews').json()
    assert history[0]['comment'] == 'Fix diagram'

def test_ba_update_reopens_approved_revision_and_retains_review_history(context, pdf):
    client, _, _, _, _, _, _, revision = setup_review(context, pdf)
    assert client.post(f'/api/revisions/{revision["id"]}/approve').status_code == 200
    changed = replace(client, revision, pdf)
    assert changed.status_code == 200
    assert changed.json()['status'] == 'DRAFT'
    assert client.post(f'/api/revisions/{revision["id"]}/publish').status_code == 400
    history = client.get(f'/api/revisions/{revision["id"]}/reviews').json()
    assert history[0]['decision'] == 'APPROVED'


def test_ba_update_database_failure_preserves_original(context, pdf, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    client, db, storage, _, _, _, _, revision = setup_review(context, pdf)
    before = dict(storage.objects)
    def fail():
        raise SQLAlchemyError('commit unavailable')
    monkeypatch.setattr(db, 'commit', fail)
    assert replace(client, revision, pdf).status_code == 500
    assert storage.objects == before
    db.expire_all()
    assert db.get(ManualRevision, revision['id']).status == 'IN_REVIEW'
    assert db.get(ManualRevision, revision['id']).content_version == 0


def test_ba_update_lost_commit_acknowledgement_keeps_new_file(context, pdf, monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    client, db, storage, _, _, _, _, revision = setup_review(context, pdf)
    original = db.commit
    def lost_ack():
        original()
        raise SQLAlchemyError('acknowledgement lost')
    monkeypatch.setattr(db, 'commit', lost_ack)
    result = replace(client, revision, pdf)
    assert result.status_code == 200, result.text
    db.expire_all()
    row = db.get(ManualRevision, revision['id'])
    assert storage.objects[row.object_key] == pdf
    assert row.content_version == 1
    assert len(storage.objects) == 1


def test_update_history_is_scoped_and_records_dev_feedback(context, pdf):
    client, db, _, ba, dev, viewer, _, revision = setup_review(context, pdf)
    assert replace(client, revision, pdf).status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/request-dev-review', json={'expected_version': 1}).status_code == 200
    app.dependency_overrides[get_current_user] = lambda: dev
    assert client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': False, 'comment': 'Ready'}).status_code == 200
    events = client.get(f'/api/revisions/{revision["id"]}/updates').json()
    assert [e['action'] for e in events] == ['DEV_REVIEW_COMPLETED', 'DEV_REVIEW_REQUESTED', 'REVISION_UPDATED']
    assert events[0]['actor_username'] == dev.username
    app.dependency_overrides[get_current_user] = lambda: viewer
    assert client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': False}).status_code == 403
    outsider = User(username='history-outsider', display_name='Outsider', role='USER', password_hash='unused')
    db.add(outsider)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: outsider
    assert client.get(f'/api/revisions/{revision["id"]}/updates').status_code == 404


def test_ba_detail_update_supports_direct_approval_without_changing_files(context, pdf):
    client, _, storage, _, _, _, _, revision = setup_review(context, pdf)
    before = dict(storage.objects)
    result = client.post(f'/api/revisions/{revision["id"]}/update-files',
        data={'expected_version': '0', 'revision_detail': 'Corrected details'})
    assert result.status_code == 200
    assert result.json()['revision_detail'] == 'Corrected details'
    assert storage.objects == before
    assert client.post(f'/api/revisions/{revision["id"]}/approve', json={'expected_version': 1}).status_code == 200


def test_old_dev_feedback_cannot_be_replaced_after_review_completed(context, pdf):
    client, _, _, _, dev, _, _, revision = setup_review(context, pdf)
    assert replace(client, revision, pdf).status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/request-dev-review', json={'expected_version': 1}).status_code == 200
    app.dependency_overrides[get_current_user] = lambda: dev
    assert client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': True, 'comment': 'Fix safety'}).status_code == 200
    assert client.post(f'/api/revisions/{revision["id"]}/dev-review',
        json={'expected_version': 1, 'changes_requested': False}).status_code == 409

@pytest.mark.parametrize('action', ['approve', 'submit-review', 'edit-detail'])
def test_waiting_action_rechecks_ba_update_after_lock(context, pdf, monkeypatch, action):
    from sqlalchemy.orm import Session
    client, db, _, ba, dev, _, _, revision = setup_review(context, pdf)
    # Keep the previously loaded row alive, as the detail-edit handler does.
    cached = db.get(ManualRevision, revision['id'])
    if action != 'approve':
        cached.status = 'DRAFT'
        db.commit()
    if action == 'edit-detail':
        app.dependency_overrides[get_current_user] = lambda: dev
    original = db.scalar
    changed = False
    def competing_update(statement, *args, **kwargs):
        nonlocal changed
        if not changed and getattr(statement, '_for_update_arg', None) is not None and (
                statement.column_descriptions[0].get('entity') is ManualRevision):
            changed = True
            with Session(db.get_bind()) as concurrent:
                row = concurrent.get(ManualRevision, revision['id'])
                row.status = 'DRAFT'
                row.content_version = 1
                row.ba_updated_by = ba.username
                row.dev_review_requested = True
                row.revision_detail = 'BA latest detail'
                concurrent.commit()
        return original(statement, *args, **kwargs)
    monkeypatch.setattr(db, 'scalar', competing_update)
    if action == 'edit-detail':
        result = client.put(f'/api/revisions/{revision["id"]}', json={'revision_detail': 'Stale Dev text'})
    else:
        result = client.post(f'/api/revisions/{revision["id"]}/{action}', json={'expected_version': 0})
    assert result.status_code == 409, result.text
    db.expire_all()
    assert cached.revision_detail == 'BA latest detail'
    assert cached.status == 'DRAFT'

def test_rejected_file_cannot_be_resubmitted_without_new_upload(context, pdf):
    client, _, _, _, dev, _, _, revision = setup_review(context, pdf)
    assert client.post(f'/api/revisions/{revision["id"]}/reject', json={'comment': 'Replace diagram'}).status_code == 200
    app.dependency_overrides[get_current_user] = lambda: dev
    assert client.post(f'/api/revisions/{revision["id"]}/submit-review').status_code == 400
