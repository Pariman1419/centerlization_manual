import hashlib
import pytest
from sqlalchemy import select

from app.auth import get_current_user
from app.main import app
from app.models.manual import Manual
from app.models.manual_revision import ManualRevision
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.revision_review import RevisionReview
from app.models.user import User
from conftest import create_manual, upload


def test_draft_to_in_review(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    assert rev['status'] == 'DRAFT'

    response = client.post(f'/api/revisions/{rev["id"]}/submit-review')
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'IN_REVIEW'
    assert data['submitted_by'] == 'BA'
    assert data['submitted_at'] is not None

    # Database check
    db_rev = db.get(ManualRevision, rev['id'])
    assert db_rev.status == 'IN_REVIEW'
    assert db_rev.submitted_by == 'BA'


def test_in_review_to_approved(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')

    # Another authorized reviewer
    reviewer = User(username='reviewer_alice', display_name='Alice Reviewer', role='ADMIN', password_hash='hash')
    db.add(reviewer)
    db.commit()

    app.dependency_overrides[get_current_user] = lambda: reviewer
    response = client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'Looks good to approve!'})
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'APPROVED'

    # Check reviews created
    reviews = db.scalars(select(RevisionReview).where(RevisionReview.revision_id == rev['id'])).all()
    assert len(reviews) == 1
    assert reviews[0].decision == 'APPROVED'
    assert reviews[0].comment == 'Looks good to approve!'
    assert reviews[0].reviewer_id == reviewer.id

    # Not automatically published
    db_manual = db.get(Manual, manual['id'])
    assert db_manual.status == 'DRAFT'
    assert db_manual.current_revision_id is None


def test_in_review_to_rejected(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')

    reviewer = User(username='reviewer_bob', display_name='Bob Reviewer', role='ADMIN', password_hash='hash')
    db.add(reviewer)
    db.commit()

    app.dependency_overrides[get_current_user] = lambda: reviewer
    response = client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'Missing safety precautions on page 3'})
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'REJECTED'

    # MinIO PDF file must not be deleted
    db_rev = db.get(ManualRevision, rev['id'])
    assert db_rev.object_key in storage.objects
    assert storage.objects[db_rev.object_key] == pdf

    # Check review recorded
    reviews = db.scalars(select(RevisionReview).where(RevisionReview.revision_id == rev['id'])).all()
    assert len(reviews) == 1
    assert reviews[0].decision == 'REJECTED'
    assert reviews[0].comment == 'Missing safety precautions on page 3'


def test_reject_requires_comment(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')

    reviewer = User(username='reviewer_bob', display_name='Bob Reviewer', role='ADMIN', password_hash='hash')
    db.add(reviewer)
    db.commit()

    app.dependency_overrides[get_current_user] = lambda: reviewer
    # Empty comment
    res1 = client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': ''})
    assert res1.status_code == 400
    assert 'Comment is required' in res1.json()['detail']

    # Whitespace only
    res2 = client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': '   '})
    assert res2.status_code == 400

    # Revision remains IN_REVIEW
    db.expire_all()
    assert db.get(ManualRevision, rev['id']).status == 'IN_REVIEW'


def test_self_approval_allowed(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')

    # The uploader/submitter may approve within their own project.
    response = client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'Self approving'})
    assert response.status_code == 200
    assert response.json()['status'] == 'APPROVED'


def test_unapproved_cannot_publish(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()

    # 1. DRAFT cannot publish
    rev = upload(client, manual['id'], pdf).json()
    assert rev['status'] == 'DRAFT'
    p1 = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert p1.status_code == 400
    assert 'Only APPROVED revisions can be published' in p1.json()['detail']

    # 2. IN_REVIEW cannot publish
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    p2 = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert p2.status_code == 400

    # 3. REJECTED cannot publish
    reviewer = User(username='reviewer_bob', display_name='Bob Reviewer', role='ADMIN', password_hash='hash')
    db.add(reviewer)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: reviewer
    client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'Rejected'})
    app.dependency_overrides[get_current_user] = lambda: db.query(User).filter_by(username='BA').first()
    p3 = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert p3.status_code == 400


def test_approved_can_publish_and_archives_old(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()

    # Revision 1
    rev1 = upload(client, manual['id'], pdf, '01').json()
    client.post(f'/api/revisions/{rev1["id"]}/submit-review')

    reviewer = User(username='reviewer_alice', display_name='Alice', role='ADMIN', password_hash='hash')
    db.add(reviewer)
    db.commit()

    # Approve rev1
    app.dependency_overrides[get_current_user] = lambda: reviewer
    client.post(f'/api/revisions/{rev1["id"]}/approve')

    # Publish rev1 as owner/admin
    owner = db.query(User).filter_by(username='BA').first()
    app.dependency_overrides[get_current_user] = lambda: owner
    pub1 = client.post(f'/api/revisions/{rev1["id"]}/publish')
    assert pub1.status_code == 200
    assert pub1.json()['status'] == 'PUBLISHED'
    assert pub1.json()['published_by'] == 'BA'

    # Check manual
    db.expire_all()
    m1 = db.get(Manual, manual['id'])
    assert m1.status == 'PUBLISHED'
    assert m1.current_revision_id == rev1['id']

    # Revision 2
    rev2 = upload(client, manual['id'], pdf, '02').json()
    client.post(f'/api/revisions/{rev2["id"]}/submit-review')

    app.dependency_overrides[get_current_user] = lambda: reviewer
    client.post(f'/api/revisions/{rev2["id"]}/approve')

    app.dependency_overrides[get_current_user] = lambda: owner
    pub2 = client.post(f'/api/revisions/{rev2["id"]}/publish')
    assert pub2.status_code == 200
    assert pub2.json()['status'] == 'PUBLISHED'

    # Revision 1 is now ARCHIVED
    db.expire_all()
    assert db.get(ManualRevision, rev1['id']).status == 'ARCHIVED'
    assert db.get(ManualRevision, rev2['id']).status == 'PUBLISHED'
    assert db.get(Manual, manual['id']).current_revision_id == rev2['id']


def test_resubmission_and_review_history_retained(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()

    # Submit for review
    client.post(f'/api/revisions/{rev["id"]}/submit-review')

    reviewer = User(username='reviewer_alice', display_name='Alice', role='ADMIN', password_hash='hash')
    db.add(reviewer)
    db.commit()

    # Reject
    app.dependency_overrides[get_current_user] = lambda: reviewer
    client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'Please fix diagram on page 2'})

    # Resubmit as contributor
    uploader = db.query(User).filter_by(username='BA').first()
    app.dependency_overrides[get_current_user] = lambda: uploader
    resub = client.post(f'/api/revisions/{rev["id"]}/submit-review')
    assert resub.status_code == 200
    assert resub.json()['status'] == 'IN_REVIEW'

    # Approve
    app.dependency_overrides[get_current_user] = lambda: reviewer
    appr = client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'Page 2 is resolved. Looks great!'})
    assert appr.status_code == 200

    # Retrieve reviews list
    reviews_res = client.get(f'/api/revisions/{rev["id"]}/reviews')
    assert reviews_res.status_code == 200
    reviews = reviews_res.json()
    assert len(reviews) == 2

    # Most recent first
    assert reviews[0]['decision'] == 'APPROVED'
    assert reviews[0]['comment'] == 'Page 2 is resolved. Looks great!'
    assert reviews[0]['reviewer_username'] == 'reviewer_alice'

    assert reviews[1]['decision'] == 'REJECTED'
    assert reviews[1]['comment'] == 'Please fix diagram on page 2'
    assert reviews[1]['reviewer_username'] == 'reviewer_alice'


def test_concurrent_review_actions_safe(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')

    reviewer1 = User(username='reviewer_one', display_name='Reviewer One', role='ADMIN', password_hash='h')
    reviewer2 = User(username='reviewer_two', display_name='Reviewer Two', role='ADMIN', password_hash='h')
    db.add_all([reviewer1, reviewer2])
    db.commit()

    # Reviewer 1 approves
    app.dependency_overrides[get_current_user] = lambda: reviewer1
    r1 = client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'Done first'})
    assert r1.status_code == 200

    # Reviewer 2 tries to reject the stale revision
    app.dependency_overrides[get_current_user] = lambda: reviewer2
    r2 = client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'Conflicting decision'})
    assert r2.status_code == 409
    assert 'Revision is not in review' in r2.json()['detail']

    # Also trying to approve again gets 409
    r3 = client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'Second approve'})
    assert r3.status_code == 409


def test_historical_published_works(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()

    # Simulate historical published revision (no reviews, no submitted_by)
    db_rev = db.get(ManualRevision, rev['id'])
    db_rev.status = 'PUBLISHED'
    db_rev.published_by = 'historical_user'
    db_manual = db.get(Manual, manual['id'])
    db_manual.status = 'PUBLISHED'
    db_manual.current_revision_id = rev['id']
    db.commit()
    db.expire_all()

    # Current revision endpoint works
    cur = client.get(f'/api/manuals/{manual["id"]}/current')
    assert cur.status_code == 200
    assert cur.json()['id'] == rev['id']
    assert cur.json()['status'] == 'PUBLISHED'
    assert cur.json()['submitted_by'] is None

    # Reviews endpoint returns empty list
    reviews = client.get(f'/api/revisions/{rev["id"]}/reviews')
    assert reviews.status_code == 200
    assert reviews.json() == []

    # Idempotent publish of already current published revision succeeds
    repub = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert repub.status_code == 200
    assert repub.json()['status'] == 'PUBLISHED'


def test_minio_objects_unchanged(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    key = db.get(ManualRevision, rev['id']).object_key
    initial_bytes = storage.objects[key]

    # Submit
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    assert storage.objects[key] == initial_bytes

    # Reject
    reviewer = User(username='rev_user', display_name='Rev', role='ADMIN', password_hash='h')
    db.add(reviewer)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: reviewer
    client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'Check details'})
    assert storage.objects[key] == initial_bytes

    # Resubmit & Approve
    app.dependency_overrides[get_current_user] = lambda: db.query(User).filter_by(username='BA').first()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    app.dependency_overrides[get_current_user] = lambda: reviewer
    client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'OK'})
    assert storage.objects[key] == initial_bytes

    # Publish
    app.dependency_overrides[get_current_user] = lambda: db.query(User).filter_by(username='BA').first()
    client.post(f'/api/revisions/{rev["id"]}/publish')
    assert storage.objects[key] == initial_bytes


def test_preview_and_download_regression_all_statuses(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    rev_id = rev['id']

    for status in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'):
        db.get(ManualRevision, rev_id).status = status
        db.commit()
        for action in ('preview', 'download'):
            res = client.get(f'/api/revisions/{rev_id}/{action}')
            assert res.status_code == 200
            assert res.json()['expires_in'] == 600
            assert res.json()['url'].startswith('https://storage.example/')


def test_project_member_role_permissions(context, pdf):
    client, db, _ = context
    manual_data = create_manual(client).json()
    manual = db.get(Manual, manual_data['id'])
    project = db.get(Project, manual.project_id)

    # Create users
    contributor = User(username='contrib', display_name='Contributor', role='USER', password_hash='h')
    reviewer = User(username='rev_alice', display_name='Reviewer Alice', role='USER', password_hash='h')
    db.add_all([contributor, reviewer])
    db.commit()

    # Add project members
    db.add(ProjectMember(project_id=project.id, user_id=contributor.id, role='CONTRIBUTOR'))
    db.add(ProjectMember(project_id=project.id, user_id=reviewer.id, role='REVIEWER'))
    db.commit()

    # 1. Contributor uploads and submits
    rev = upload(client, manual.id, pdf).json()

    app.dependency_overrides[get_current_user] = lambda: contributor
    sub_res = client.post(f'/api/revisions/{rev["id"]}/submit-review')
    assert sub_res.status_code == 200
    assert sub_res.json()['status'] == 'IN_REVIEW'

    # Contributor cannot approve or reject
    appr_res = client.post(f'/api/revisions/{rev["id"]}/approve')
    assert appr_res.status_code == 403

    rej_res = client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'Attempt'})
    assert rej_res.status_code == 403

    # Contributor cannot publish
    pub_res = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert pub_res.status_code == 403

    # 2. Reviewer can approve
    app.dependency_overrides[get_current_user] = lambda: reviewer
    appr_ok = client.post(f'/api/revisions/{rev["id"]}/approve', json={'comment': 'Reviewer approved'})
    assert appr_ok.status_code == 200
    assert appr_ok.json()['status'] == 'APPROVED'

    # Reviewer cannot publish
    pub_rev = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert pub_rev.status_code == 403

    # 3. Owner/Admin can publish
    admin = db.query(User).filter_by(username='BA').first()
    app.dependency_overrides[get_current_user] = lambda: admin
    pub_ok = client.post(f'/api/revisions/{rev["id"]}/publish')
    assert pub_ok.status_code == 200
    assert pub_ok.json()['status'] == 'PUBLISHED'


def _count_audit(db, action):
    from app.models.audit_log import AuditLog
    return len(db.scalars(select(AuditLog).where(AuditLog.action == action)).all())


def _member(db, project_id, username, role):
    user = User(username=username, display_name=username, role='USER', password_hash='h')
    db.add(user)
    db.commit()
    db.add(ProjectMember(project_id=project_id, user_id=user.id, role=role))
    db.commit()
    return user


def test_delete_draft_removes_row_and_object(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    key = db.get(ManualRevision, rev['id']).object_key
    assert key in storage.objects

    assert client.delete(f'/api/revisions/{rev["id"]}').status_code == 200
    assert db.get(ManualRevision, rev['id']) is None
    assert key not in storage.objects
    assert _count_audit(db, 'REVISION_DELETED') == 1
    assert client.get(f'/api/manuals/{manual["id"]}/revisions').json() == []


def test_delete_rejected_allowed_and_reviews_removed(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    reviewer = User(username='rev2', display_name='R', role='ADMIN', password_hash='h')
    db.add(reviewer)
    db.commit()
    app.dependency_overrides[get_current_user] = lambda: reviewer
    assert client.post(f'/api/revisions/{rev["id"]}/reject', json={'comment': 'no'}).status_code == 200
    assert client.delete(f'/api/revisions/{rev["id"]}').status_code == 200
    assert db.scalars(select(RevisionReview).where(RevisionReview.revision_id == rev['id'])).all() == []


@pytest.mark.parametrize('target', ['IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED'])
def test_delete_any_status(context, pdf, target):
    client, db, storage = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    row = db.get(ManualRevision, rev['id'])
    row.status = target
    db.commit()
    key = row.object_key
    assert client.delete(f'/api/revisions/{rev["id"]}').status_code == 200
    db.expire_all()
    assert db.get(ManualRevision, rev['id']) is None
    assert key not in storage.objects


def test_contributor_deletes_only_own_revision(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()  # uploaded_by == 'BA'
    contributor = _member(db, manual['project_id'], 'contrib', 'CONTRIBUTOR')
    app.dependency_overrides[get_current_user] = lambda: contributor
    assert client.delete(f'/api/revisions/{rev["id"]}').status_code == 403
    assert db.get(ManualRevision, rev['id']) is not None

    own = upload(client, manual['id'], pdf, number='02').json()
    assert client.delete(f'/api/revisions/{own["id"]}').status_code == 200


def test_viewer_cannot_delete_revision(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    viewer = _member(db, manual['project_id'], 'viewer1', 'VIEWER')
    app.dependency_overrides[get_current_user] = lambda: viewer
    assert client.delete(f'/api/revisions/{rev["id"]}').status_code == 403


def test_delete_manual_with_only_drafts(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    upload(client, manual['id'], pdf)
    upload(client, manual['id'], pdf, number='02')
    assert client.delete(f'/api/manuals/{manual["id"]}').status_code == 200
    assert db.get(Manual, manual['id']) is None
    assert storage.objects == {}
    assert _count_audit(db, 'MANUAL_DELETED') == 1


def test_delete_manual_when_published(context, pdf):
    client, db, storage = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    row = db.get(ManualRevision, rev['id'])
    row.status = 'PUBLISHED'
    db.get(Manual, manual['id']).current_revision_id = row.id
    db.commit()
    key = row.object_key
    assert client.delete(f'/api/manuals/{manual["id"]}').status_code == 200
    db.expire_all()
    assert db.get(Manual, manual['id']) is None
    assert db.get(ManualRevision, rev['id']) is None
    assert key not in storage.objects


def test_contributor_cannot_delete_manual(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    contributor = _member(db, manual['project_id'], 'contrib2', 'CONTRIBUTOR')
    app.dependency_overrides[get_current_user] = lambda: contributor
    assert client.delete(f'/api/manuals/{manual["id"]}').status_code == 403


def test_edit_manual_keeps_code(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    response = client.put(f'/api/manuals/{manual["id"]}', json={'title': 'New title', 'category': 'EN', 'description': None})
    assert response.status_code == 200
    data = response.json()
    assert (data['title'], data['category'], data['description']) == ('New title', 'EN', None)
    assert data['manual_code'] == manual['manual_code']
    assert _count_audit(db, 'MANUAL_UPDATED') == 1
    assert client.put(f'/api/manuals/{manual["id"]}', json={'title': '  '}).status_code == 400


def test_viewer_cannot_edit_manual(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    viewer = _member(db, manual['project_id'], 'viewer2', 'VIEWER')
    app.dependency_overrides[get_current_user] = lambda: viewer
    assert client.put(f'/api/manuals/{manual["id"]}', json={'title': 'x'}).status_code == 403


def test_edit_revision_detail_only_when_draft_or_rejected(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    ok = client.put(f'/api/revisions/{rev["id"]}', json={'revision_detail': 'Fixed typo'})
    assert ok.status_code == 200 and ok.json()['revision_detail'] == 'Fixed typo'
    assert ok.json()['revision_no'] == rev['revision_no']
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    assert client.put(f'/api/revisions/{rev["id"]}', json={'revision_detail': 'x'}).status_code == 409


def test_withdraw_returns_to_draft(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    assert client.post(f'/api/revisions/{rev["id"]}/withdraw').status_code == 409  # still DRAFT
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    response = client.post(f'/api/revisions/{rev["id"]}/withdraw')
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'DRAFT' and data['submitted_by'] is None and data['submitted_at'] is None
    assert _count_audit(db, 'REVISION_WITHDRAWN') == 1
    # can be submitted again
    assert client.post(f'/api/revisions/{rev["id"]}/submit-review').status_code == 200


def test_reviewer_cannot_withdraw(context, pdf):
    client, db, _ = context
    manual = create_manual(client).json()
    rev = upload(client, manual['id'], pdf).json()
    client.post(f'/api/revisions/{rev["id"]}/submit-review')
    reviewer = _member(db, manual['project_id'], 'rev3', 'REVIEWER')
    app.dependency_overrides[get_current_user] = lambda: reviewer
    assert client.post(f'/api/revisions/{rev["id"]}/withdraw').status_code == 403
    assert db.get(ManualRevision, rev['id']).status == 'IN_REVIEW'
