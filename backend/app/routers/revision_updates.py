"""BA replaces draft files in-place; Dev provides feedback without approval authority."""
import hashlib
import io
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import accessible_project, get_current_user
from app.config import get_settings
from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.manual import Manual, utcnow
from app.models.manual_revision import ManualRevision, RevisionFile
from app.models.user import User
from app.routers.manuals import MAX_OTHER_FILES, prepare_other, prepare_pdf, prepare_word, safe_path_segment
from app.routers.revisions import require_revision
from app.schemas.manual_revision import DevReviewInput, RevisionRead, RevisionUpdateEventRead, RevisionVersionInput
from app.services.audit import AuditAction, write_audit_event
from app.services.minio_service import get_storage
from app.services.revision_workflow import check_version, reset_dev_review

router = APIRouter(prefix='/api/revisions', tags=['revision updates'], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)
EDITABLE = ('DRAFT', 'IN_REVIEW', 'REJECTED', 'APPROVED')


def lock_revision(db, revision_id, user, min_role):
    revision = require_revision(db, revision_id, user, min_role=min_role)
    # Match publishing's lock order and re-read data after a competing transaction.
    manual = db.scalar(select(Manual).where(Manual.id == revision.manual_id).with_for_update()
        .execution_options(populate_existing=True))
    revision = db.scalar(select(ManualRevision).where(ManualRevision.id == revision_id).with_for_update()
        .execution_options(populate_existing=True))
    if manual is None or revision is None:
        raise HTTPException(404, 'Revision not found')
    return revision, manual


def file_summary(files):
    return [{'kind': f.kind, 'file_name': f.file_name, 'file_size': f.file_size, 'checksum': f.checksum} for f in files]


def cleanup(storage, keys):
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            logger.exception('Revision file cleanup failed; reconcile object %s', key)


@router.get('/{revision_id}/updates', response_model=list[RevisionUpdateEventRead])
def update_history(revision_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_revision(db, revision_id, user)
    events = db.execute(select(AuditLog, User.username).outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(AuditLog.revision_id == revision_id, AuditLog.action.in_([
            AuditAction.REVISION_UPDATED, AuditAction.DEV_REVIEW_REQUESTED, AuditAction.DEV_REVIEW_COMPLETED]))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(100)).all()
    return [{'id': event.id, 'action': event.action, 'actor_username': username,
             'created_at': event.created_at, 'details': event.details} for event, username in events]


@router.post('/{revision_id}/update-files', response_model=RevisionRead)
def replace_files(revision_id: int, expected_version: int = Form(..., ge=0),
        revision_detail: str | None = Form(None, max_length=20000),
        other_type: str = Form('', max_length=100),
        pdf_file: UploadFile | None = File(None), word_file: UploadFile | None = File(None),
        other_files: list[UploadFile] = File(default=[]),
        db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    revision, manual = lock_revision(db, revision_id, user, 'REVIEWER')
    check_version(revision, expected_version)
    if revision.status not in EDITABLE:
        raise HTTPException(409, 'Published and archived revisions cannot be replaced. Upload a new revision.')
    others = [f for f in other_files if f.filename]
    if len(others) > MAX_OTHER_FILES:
        raise HTTPException(400, f'At most {MAX_OTHER_FILES} other files can be attached to a revision')
    if others and not other_type.strip():
        raise HTTPException(400, 'Describe what the Other file is')
    prepared = []
    if pdf_file and pdf_file.filename:
        prepared.append(prepare_pdf(pdf_file))
    if word_file and word_file.filename:
        prepared.append(prepare_word(word_file))
    prepared.extend({**prepare_other(f), 'label': other_type.strip()} for f in others)
    detail = revision.revision_detail if revision_detail is None else revision_detail.strip()
    if not prepared and detail == revision.revision_detail:
        raise HTTPException(400, 'Change the revision detail or select replacement files.')
    if sum(len(f['data']) for f in prepared) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, 'Combined file size exceeds the upload limit.')

    previous_keys = revision.all_object_keys
    previous_detail = revision.revision_detail
    previous_status = revision.status
    previous_files = list(revision.files)
    if not previous_files:
        # Historical revisions stored the primary file directly on the revision row.
        previous_files = [RevisionFile(kind='PDF' if revision.mime_type == 'application/pdf' else 'OTHER',
            file_name=revision.file_name, object_key=revision.object_key, file_size=revision.file_size,
            mime_type=revision.mime_type, checksum=revision.checksum)]
    old_summary = file_summary(previous_files)
    uploaded = []
    prefix = revision.revision_no.zfill(3) if revision.revision_no.isdigit() else revision.revision_no
    project_segment = safe_path_segment(manual.project_code, f'project-{manual.project_id}')
    manual_segment = safe_path_segment(manual.manual_code, f'manual-{manual.id}')
    try:
        for item in prepared:
            item['key'] = f'{project_segment}/{manual_segment}/rev-{prefix}/{uuid4()}{item["ext"]}'
            # Include the attempted key: a failed acknowledgement can still have stored the object.
            uploaded.append(item['key'])
            storage.upload(item['key'], io.BytesIO(item['data']), len(item['data']), content_type=item['mime'])
    except Exception:
        db.rollback()
        cleanup(storage, uploaded)
        logger.exception('BA replacement upload failed for revision %s', revision_id)
        raise HTTPException(502, 'File storage is unavailable. The original revision is unchanged.') from None

    replaced_kinds = {item['kind'] for item in prepared}
    revision.files = [f for f in previous_files if f.kind not in replaced_kinds] + [
        RevisionFile(kind=item['kind'], file_name=item['name'], object_key=item['key'],
            file_size=len(item['data']), mime_type=item['mime'], checksum=hashlib.sha256(item['data']).hexdigest(),
            label=item.get('label')) for item in prepared]
    primary = next(f for kind in ('PDF', 'WORD', 'OTHER') for f in revision.files if f.kind == kind)
    for field in ('file_name', 'object_key', 'file_size', 'mime_type', 'checksum'):
        setattr(revision, field, getattr(primary, field))
    revision.revision_detail = detail
    revision.status = 'DRAFT'
    revision.content_version += 1
    revision.ba_updated_by = user.username
    revision.updated_at = utcnow()
    revision.submitted_by = None
    revision.submitted_at = None
    revision.published_by = None
    revision.published_at = None
    reset_dev_review(revision)
    manual.updated_at = utcnow()
    new_keys = revision.all_object_keys
    try:
        write_audit_event(db, AuditAction.REVISION_UPDATED, actor=user, project=manual.project_id,
            manual=manual, revision=revision, details={'revision_no': revision.revision_no,
                'content_version': revision.content_version, 'previous_status': previous_status,
                'previous_detail': previous_detail, 'revision_detail': detail,
                'previous_files': old_summary, 'files': file_summary(revision.files)})
        db.commit()
    except Exception:
        db.rollback()
        # A lost COMMIT acknowledgement must never delete files that are now referenced.
        try:
            with Session(db.get_bind()) as verification:
                if verification.bind.dialect.name == 'postgresql':
                    verification.execute(text("SET LOCAL lock_timeout = '5s'"))
                verification.scalar(select(Manual).where(Manual.id == manual.id).with_for_update())
                saved = verification.get(ManualRevision, revision_id)
                if saved is not None and saved.content_version == expected_version + 1 and new_keys == saved.all_object_keys:
                    logger.warning('Recovered committed BA update for revision %s', revision_id)
                    cleanup(storage, previous_keys - new_keys)
                    return saved
                # Only a confirmed rollback permits cleanup. A later update makes outcome ambiguous.
                if saved is not None and saved.content_version == expected_version and previous_keys == saved.all_object_keys:
                    cleanup(storage, uploaded)
        except Exception:
            logger.exception('BA update commit outcome unknown; retained objects %s', uploaded)
        raise HTTPException(500, 'Update could not be confirmed. Refresh revision history before retrying.') from None
    cleanup(storage, previous_keys - new_keys)
    db.refresh(revision)
    return revision


@router.post('/{revision_id}/request-dev-review', response_model=RevisionRead)
def request_dev_review(revision_id: int, payload: RevisionVersionInput,
        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    revision, manual = lock_revision(db, revision_id, user, 'REVIEWER')
    check_version(revision, payload.expected_version)
    if revision.status != 'DRAFT' or not revision.ba_updated_by:
        raise HTTPException(409, 'Only a BA-updated draft can be sent for Dev review.')
    if revision.dev_review_requested:
        raise HTTPException(409, 'Dev review was already requested. Update the draft before requesting another review.')
    reset_dev_review(revision)
    revision.dev_review_requested = True
    try:
        write_audit_event(db, AuditAction.DEV_REVIEW_REQUESTED, actor=user, project=manual.project_id,
            manual=manual, revision=revision, details={'content_version': revision.content_version})
        db.commit()
        db.refresh(revision)
        return revision
    except Exception:
        db.rollback()
        raise


@router.post('/{revision_id}/dev-review', response_model=RevisionRead)
def dev_review(revision_id: int, payload: DevReviewInput,
        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    revision, manual = lock_revision(db, revision_id, user, 'CONTRIBUTOR')
    role = accessible_project(db, manual.project_id, user, min_role='CONTRIBUTOR').my_role
    if role not in ('DEV', 'CONTRIBUTOR'):
        raise HTTPException(403, 'Dev / Contributor access is required for this review.')
    check_version(revision, payload.expected_version)
    if revision.status != 'DRAFT' or not revision.dev_review_requested or revision.dev_reviewed_by:
        raise HTTPException(409, 'This draft is not awaiting Dev review.')
    comment = (payload.comment or '').strip()
    if payload.changes_requested and not comment:
        raise HTTPException(400, 'Feedback is required when requesting changes.')
    revision.dev_reviewed_by = user.username
    revision.dev_reviewed_at = utcnow()
    revision.dev_changes_requested = payload.changes_requested
    revision.dev_review_comment = comment or None
    try:
        write_audit_event(db, AuditAction.DEV_REVIEW_COMPLETED, actor=user, project=manual.project_id,
            manual=manual, revision=revision, details={'content_version': revision.content_version,
                'changes_requested': payload.changes_requested, 'comment': comment})
        db.commit()
        db.refresh(revision)
        return revision
    except Exception:
        db.rollback()
        raise
