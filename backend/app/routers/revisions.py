import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth import PROJECT_MANAGER_ROLES, accessible_project, get_current_user
from app.database import get_db
from app.models.manual import Manual, utcnow
from app.models.manual_revision import ManualRevision
from app.models.revision_review import RevisionReview
from app.models.user import User
from app.routers.manuals import require_manual, safe_filename
from app.schemas.manual_revision import FileAccess, ReviewActionInput, RevisionRead, RevisionReviewRead, RevisionUpdate
from app.services.audit import AuditAction, write_audit_event
from app.services.minio_service import get_storage

router = APIRouter(prefix='/api/revisions', tags=['revisions'], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)


def require_revision(db, revision_id, user, min_role: str = 'VIEWER'):
    revision = db.get(ManualRevision, revision_id)
    if revision is None:
        raise HTTPException(404, 'Revision not found')
    require_manual(db, revision.manual_id, user, min_role=min_role)
    return revision


def audit_project(db, revision):
    return db.scalar(select(Manual.project_id).where(Manual.id == revision.manual_id))


@router.get('/{revision_id}', response_model=RevisionRead)
def metadata(revision_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return require_revision(db, revision_id, user)


def file_access(db, storage, revision_id, download, user, file_id=None):
    revision = require_revision(db, revision_id, user)
    target = revision
    if file_id is not None:
        target = next((f for f in revision.files if f.id == file_id), None)
        if target is None:
            raise HTTPException(404, 'File not found')
    try:
        url = storage.url(target.object_key, safe_filename(target.file_name), download=download,
            content_type=target.mime_type or 'application/pdf')
    except Exception:
        logger.exception('Unable to sign file access for revision %s', revision_id)
        raise HTTPException(502, 'File access is temporarily unavailable') from None
    return {'url': url, 'expires_in': 600}


@router.get('/{revision_id}/preview', response_model=FileAccess)
def preview(revision_id: int, file_id: int | None = None, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    return file_access(db, storage, revision_id, False, user, file_id)


@router.get('/{revision_id}/download', response_model=FileAccess)
def download(revision_id: int, file_id: int | None = None, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    return file_access(db, storage, revision_id, True, user, file_id)


@router.get('/{revision_id}/reviews', response_model=list[RevisionReviewRead])
def list_reviews(revision_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_revision(db, revision_id, user, min_role='VIEWER')
    return db.scalars(
        select(RevisionReview)
        .where(RevisionReview.revision_id == revision_id)
        .order_by(RevisionReview.created_at.desc(), RevisionReview.id.desc())
    ).all()


@router.post('/{revision_id}/submit-review', response_model=RevisionRead)
def submit_review(revision_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_revision(db, revision_id, user, min_role='CONTRIBUTOR')
    try:
        locked = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update())
        if locked is None:
            raise HTTPException(404, 'Revision not found')
        if locked.status == 'IN_REVIEW':
            raise HTTPException(409, 'Revision is already in review')
        if locked.status not in ('DRAFT', 'REJECTED'):
            raise HTTPException(400, f'Revision cannot be submitted for review from status {locked.status}')

        locked.status = 'IN_REVIEW'
        locked.submitted_by = user.username
        locked.submitted_at = utcnow()
        write_audit_event(db, AuditAction.REVISION_SUBMITTED, actor=user, project=audit_project(db, locked),
            manual=locked.manual_id, revision=locked, details={'revision_no': locked.revision_no})
        db.commit()
        db.refresh(locked)
        return locked
    except Exception:
        db.rollback()
        raise


@router.post('/{revision_id}/approve', response_model=RevisionRead)
def approve(revision_id: int, payload: ReviewActionInput | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_revision(db, revision_id, user, min_role='REVIEWER')

    try:
        locked = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update())
        if locked is None:
            raise HTTPException(404, 'Revision not found')
        if locked.status != 'IN_REVIEW':
            raise HTTPException(409, f'Revision is not in review (current status: {locked.status})')

        review = RevisionReview(
            revision_id=locked.id,
            reviewer_id=user.id,
            decision='APPROVED',
            comment=payload.comment.strip() if payload and payload.comment else None,
            created_at=utcnow(),
        )
        db.add(review)
        locked.status = 'APPROVED'
        write_audit_event(db, AuditAction.REVISION_APPROVED, actor=user, project=audit_project(db, locked),
            manual=locked.manual_id, revision=locked,
            details={'revision_no': locked.revision_no, 'has_comment': bool(review.comment)})
        db.commit()
        db.refresh(locked)
        return locked
    except Exception:
        db.rollback()
        raise


@router.post('/{revision_id}/reject', response_model=RevisionRead)
def reject(revision_id: int, payload: ReviewActionInput, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_revision(db, revision_id, user, min_role='REVIEWER')
    if not payload or not payload.comment or not payload.comment.strip():
        raise HTTPException(400, 'Comment is required when rejecting a revision')

    try:
        locked = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update())
        if locked is None:
            raise HTTPException(404, 'Revision not found')
        if locked.status != 'IN_REVIEW':
            raise HTTPException(409, f'Revision is not in review (current status: {locked.status})')

        review = RevisionReview(
            revision_id=locked.id,
            reviewer_id=user.id,
            decision='REJECTED',
            comment=payload.comment.strip(),
            created_at=utcnow(),
        )
        db.add(review)
        locked.status = 'REJECTED'
        write_audit_event(db, AuditAction.REVISION_REJECTED, actor=user, project=audit_project(db, locked),
            manual=locked.manual_id, revision=locked, details={'revision_no': locked.revision_no, 'has_comment': True})
        db.commit()
        db.refresh(locked)
        return locked
    except Exception:
        db.rollback()
        raise


DELETABLE_STATUSES = ('DRAFT', 'REJECTED')


def require_revision_manager(db, revision_id, user, action, owner_field='uploaded_by'):
    """CONTRIBUTOR may act on their own revisions; combined BA/Reviewer and ADMIN on any."""
    revision = require_revision(db, revision_id, user, min_role='CONTRIBUTOR')
    manual = db.get(Manual, revision.manual_id)
    role = accessible_project(db, manual.project_id, user, min_role='CONTRIBUTOR').my_role
    if role not in PROJECT_MANAGER_ROLES and user.username not in (revision.uploaded_by, getattr(revision, owner_field)):
        raise HTTPException(403, f'You can only {action} revisions you uploaded')
    return revision, manual


@router.put('/{revision_id}', response_model=RevisionRead)
def update_revision(revision_id: int, payload: RevisionUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Edit the detail text of a DRAFT/REJECTED revision (file and number are immutable)."""
    _, manual = require_revision_manager(db, revision_id, user, 'edit')
    try:
        locked = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update())
        if locked is None:
            raise HTTPException(404, 'Revision not found')
        if locked.status not in DELETABLE_STATUSES:
            raise HTTPException(409, f'Only DRAFT or REJECTED revisions can be edited (current status: {locked.status})')
        if (locked.revision_detail or None) != (payload.revision_detail or None):
            locked.revision_detail = payload.revision_detail or None
            write_audit_event(db, AuditAction.REVISION_UPDATED, actor=user, project=manual.project_id, manual=manual,
                revision=locked, details={'revision_no': locked.revision_no})
        db.commit()
        db.refresh(locked)
        return locked
    except Exception:
        db.rollback()
        raise


@router.post('/{revision_id}/withdraw', response_model=RevisionRead)
def withdraw_review(revision_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Pull a revision back from review to DRAFT (submitter, uploader, OWNER or ADMIN)."""
    _, manual = require_revision_manager(db, revision_id, user, 'withdraw', owner_field='submitted_by')
    try:
        locked = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update())
        if locked is None:
            raise HTTPException(404, 'Revision not found')
        if locked.status != 'IN_REVIEW':
            raise HTTPException(409, f'Only revisions in review can be withdrawn (current status: {locked.status})')
        locked.status = 'DRAFT'
        locked.submitted_by = None
        locked.submitted_at = None
        write_audit_event(db, AuditAction.REVISION_WITHDRAWN, actor=user, project=manual.project_id, manual=manual,
            revision=locked, details={'revision_no': locked.revision_no})
        db.commit()
        db.refresh(locked)
        return locked
    except Exception:
        db.rollback()
        raise


@router.delete('/{revision_id}')
def delete_revision(revision_id: int, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    """Delete a revision in any status. Contributors only their own uploads; OWNER/ADMIN any."""
    _, manual = require_revision_manager(db, revision_id, user, 'delete')
    try:
        locked = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update())
        if locked is None:
            raise HTTPException(404, 'Revision not found')
        keys = sorted(locked.all_object_keys)
        current = db.scalar(select(Manual).where(Manual.id == locked.manual_id).with_for_update())
        if current is not None and current.current_revision_id == locked.id:
            current.current_revision_id = None
            current.status = 'DRAFT'
            db.flush()
        # The revision row disappears, so keep identifying data in the audit details instead of the FK.
        write_audit_event(db, AuditAction.REVISION_DELETED, actor=user, project=manual.project_id, manual=manual,
            details={'revision_id': locked.id, 'revision_no': locked.revision_no, 'status': locked.status,
                'file_name': locked.file_name})
        db.delete(locked)
        db.commit()
    except Exception:
        db.rollback()
        raise
    # Database is the source of truth: a failed object cleanup is logged for the operator, not surfaced.
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            logger.exception('Revision deleted but object cleanup failed; remove manually: %s', key)
    return {'deleted': True}


@router.post('/{revision_id}/publish', response_model=RevisionRead)
def publish(revision_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    revision = require_revision(db, revision_id, user, min_role='OWNER')
    try:
        manual = db.scalar(select(Manual).where(Manual.id == revision.manual_id).with_for_update())
        if manual is None:
            raise HTTPException(404, 'Manual not found')
        # Re-read after waiting on the lock: another request may have published it.
        db.refresh(revision)
        if revision.status == 'PUBLISHED' and manual.current_revision_id == revision.id:
            db.commit()
            return revision
        if revision.status != 'APPROVED':
            raise HTTPException(400, f'Only APPROVED revisions can be published (current status: {revision.status})')

        db.execute(update(ManualRevision).where(ManualRevision.manual_id == manual.id,
            ManualRevision.status == 'PUBLISHED', ManualRevision.id != revision.id).values(status='ARCHIVED'))
        # Flush archive UPDATE before promoting, satisfying the partial unique index.
        revision.status = 'PUBLISHED'
        revision.published_by = user.username
        revision.published_at = utcnow()
        manual.current_revision_id = revision.id
        manual.status = 'PUBLISHED'
        manual.updated_at = utcnow()
        write_audit_event(db, AuditAction.REVISION_PUBLISHED, actor=user, project=manual.project_id,
            manual=manual, revision=revision, details={'revision_no': revision.revision_no})
        db.commit()
        db.refresh(revision)
    except Exception:
        db.rollback()
        raise
    return revision
