import hashlib
import io
import logging
import os
import re
import zipfile
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pypdf import PdfReader
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.auth import accessible_project, get_current_user
from app.database import get_db
from app.models.manual import Manual, utcnow
from app.models.manual_revision import ManualRevision, RevisionFile
from app.models.project import Project
from app.models.user import User
from app.schemas.manual import ManualCreate, ManualRead, ManualUpdate
from app.schemas.manual_revision import RevisionRead
from app.services.audit import AuditAction, write_audit_event
from app.services.minio_service import get_storage
from app.services import redis_cache

router = APIRouter(prefix='/api/manuals', tags=['manuals'], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)


def require_manual(db, manual_id, user, min_role: str = 'VIEWER'):
    manual = db.get(Manual, manual_id)
    if manual is None:
        raise HTTPException(404, 'Manual not found')
    accessible_project(db, manual.project_id, user, min_role=min_role)
    return manual


@router.get('', response_model=list[ManualRead])
def list_manuals(search: str = '', category: str | None = None, status: str | None = None,
                 project_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    query = select(Manual)
    if user.role != 'ADMIN':
        from app.models.project_member import ProjectMember
        query = query.join(Project, Manual.project_id == Project.id).where(
            Project.id.in_(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id))
        )
    if search.strip():
        # Escape wildcard input so search means literal text.
        pattern = '%' + search.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.where(or_(Manual.manual_code.ilike(pattern, escape='\\'), Manual.title.ilike(pattern, escape='\\')))
    if category:
        query = query.where(Manual.category == category)
    if status:
        query = query.where(Manual.status == status)
    if project_id is not None:
        query = query.where(Manual.project_id == project_id)
    return db.scalars(query.order_by(Manual.updated_at.desc(), Manual.id.desc())).all()


@router.post('', response_model=ManualRead, status_code=201)
def create_manual(payload: ManualCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return create_manual_record(payload, db, payload.project_id, user)


def category_slug(category: str | None) -> str:
    """THAI / EN / custom category -> safe uppercase code segment (OTHER when nothing safe remains)."""
    slug = re.sub(r'[^A-Za-z0-9]+', '-', (category or '').strip()).strip('-').upper()
    return slug[:30] or ('OTHER' if category else 'GEN')


def generate_manual_code(db, project, category):
    prefix = f'{project.project_code}-{category_slug(category)}'[:90]
    suffix = func.substr(Manual.manual_code, len(prefix) + 2)
    number = func.ltrim(suffix, '0')
    # Compare digit length before digits: numeric order without integer overflow.
    # The DB returns one value; existing project locks/unique constraints guard allocation.
    largest = db.scalar(select(number).where(
        Manual.manual_code.startswith(prefix + '-', autoescape=True),
        suffix.regexp_match(r'^[0-9]+$'),
    ).order_by(func.length(number).desc(), number.desc()).limit(1))
    return f'{prefix}-{int(largest or "0") + 1:03d}'


def create_manual_record(payload: ManualCreate, db: Session, project_id: int | None, user):
    if project_id is None:
        if user.role != 'ADMIN':
            raise HTTPException(400, 'Create a manual inside a project')
        project = db.scalar(select(Project).where(Project.project_code == 'LEGACY'))
        if project is None:
            # Legacy API callers still work if the system project was renamed.
            try:
                with db.begin_nested():
                    project = Project(project_code='LEGACY', project_name='Legacy / Unassigned Manuals',
                        description='Manuals created before Project Management was introduced.', created_by='SYSTEM')
                    db.add(project)
                    db.flush()
            except IntegrityError:
                project = db.scalar(select(Project).where(Project.project_code == 'LEGACY'))
    else:
        project = accessible_project(db, project_id, user, min_role='CONTRIBUTOR')
    if project is None:
        raise HTTPException(404, 'Project not found')
    fields = payload.model_dump(exclude={'project_id'})
    auto_code = fields['manual_code'] is None
    for _attempt in range(5):
        db.refresh(project, with_for_update=True)
        if auto_code:
            fields['manual_code'] = generate_manual_code(db, project, fields['category'])
        manual = Manual(**fields, project_id=project.id, status='DRAFT', created_by=user.username)
        project.updated_at = utcnow()
        db.add(manual)
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            if not auto_code:
                if db.scalar(select(Manual.id).where(Manual.manual_code == payload.manual_code)):
                    raise HTTPException(409, f'Manual code {payload.manual_code} already exists') from None
                raise
            project = db.get(Project, project.id)  # lost a numbering race: regenerate and retry
    else:
        raise HTTPException(409, 'Unable to allocate a manual code, please retry')
    try:
        write_audit_event(db, AuditAction.MANUAL_CREATED, actor=user, project=project, manual=manual,
            details={'manual_code': manual.manual_code})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return manual


@router.put('/{manual_id}', response_model=ManualRead)
def update_manual(manual_id: int, payload: ManualUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Edit title/category/description. The generated manual code never changes (it anchors storage paths)."""
    require_manual(db, manual_id, user, min_role='CONTRIBUTOR')
    try:
        manual = db.scalar(select(Manual).where(Manual.id == manual_id).with_for_update())
        if manual is None:
            raise HTTPException(404, 'Manual not found')
        changes = {k: v for k, v in payload.model_dump().items() if getattr(manual, k) != v}
        for key, value in changes.items():
            setattr(manual, key, value)
        if changes:
            manual.updated_at = utcnow()
            write_audit_event(db, AuditAction.MANUAL_UPDATED, actor=user, project=manual.project_id, manual=manual,
                details={'changed': sorted(changes)})
        db.commit()
        db.refresh(manual)
        return manual
    except Exception:
        db.rollback()
        raise


@router.delete('/{manual_id}')
def delete_manual(manual_id: int, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    """Delete a manual with all its revisions, in any status (OWNER/ADMIN)."""
    require_manual(db, manual_id, user, min_role='OWNER')
    try:
        manual = db.scalar(select(Manual).where(Manual.id == manual_id).with_for_update())
        if manual is None:
            raise HTTPException(404, 'Manual not found')
        revisions = db.scalars(select(ManualRevision).where(ManualRevision.manual_id == manual_id)).all()
        keys = sorted({k for r in revisions for k in r.all_object_keys})
        write_audit_event(db, AuditAction.MANUAL_DELETED, actor=user, project=manual.project_id,
            details={'manual_id': manual.id, 'manual_code': manual.manual_code, 'title': manual.title,
                'revisions_deleted': len(revisions)})
        manual.current_revision_id = None  # break the manual <-> revision FK cycle first
        db.flush()
        for revision in revisions:
            db.delete(revision)
        db.flush()
        db.delete(manual)
        db.commit()
    except Exception:
        db.rollback()
        raise
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            logger.exception('Manual deleted but object cleanup failed; remove manually: %s', key)
    return {'deleted': True}


@router.get('/{manual_id}', response_model=ManualRead)
def get_manual(manual_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return require_manual(db, manual_id, user)


@router.get('/{manual_id}/revisions', response_model=list[RevisionRead])
def history(manual_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_manual(db, manual_id, user)
    return db.scalars(select(ManualRevision).where(ManualRevision.manual_id == manual_id)
        .order_by(ManualRevision.uploaded_at.desc(), ManualRevision.id.desc())).all()


@router.get('/{manual_id}/current', response_model=RevisionRead)
def current(manual_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    manual = require_manual(db, manual_id, user)
    revision = manual.current_revision
    if not revision or revision.manual_id != manual.id or revision.status != 'PUBLISHED':
        raise HTTPException(404, 'No published revision')
    return revision


def safe_filename(filename: str) -> str:
    name = filename.replace('\\', '/').split('/')[-1]
    name = re.sub(r'[\x00-\x1f\x7f<>:"|?*]', '_', name).strip(' .')
    if not name:
        return 'manual.pdf'
    if len(name) > 255:
        stem, ext = os.path.splitext(name)
        ext = ext[:20]
        name = stem[:255 - len(ext)] + ext
    return name


def safe_path_segment(code: str, fallback: str) -> str:
    return code if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', code) else fallback


DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
MAX_OTHER_FILES = 10
# Files that could run code when opened are never accepted, even as "other" attachments.
BLOCKED_EXTENSIONS = {'.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.ps1', '.vbs', '.js', '.jar', '.dll',
    '.sh', '.html', '.htm', '.svg'}


def read_upload(upload: UploadFile, label: str) -> bytes:
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f'{label} must be at most {get_settings().max_upload_mb} MB')
    if not data:
        raise HTTPException(400, f'{label} is empty')
    return data


def prepare_pdf(upload: UploadFile) -> dict:
    if not (upload.filename or '').lower().endswith('.pdf') or upload.content_type != 'application/pdf':
        raise HTTPException(400, 'Select a PDF file with application/pdf content type')
    data = read_upload(upload, 'PDF')
    if not data.startswith(b'%PDF-'):
        raise HTTPException(400, 'File is empty or is not a valid PDF')
    try:
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted or len(reader.pages) == 0:
            raise ValueError('Encrypted or empty PDF')
    except Exception:
        raise HTTPException(400, 'PDF cannot be read. Upload a valid, unencrypted PDF with at least one page.') from None
    return {'kind': 'PDF', 'name': safe_filename(upload.filename), 'data': data, 'ext': '.pdf', 'mime': 'application/pdf'}


def prepare_word(upload: UploadFile) -> dict:
    ext = os.path.splitext((upload.filename or '').lower())[1]
    if ext not in ('.doc', '.docx'):
        raise HTTPException(400, 'Select a Word file (.doc or .docx)')
    data = read_upload(upload, 'Word file')
    if ext == '.docx':
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
            valid = '[Content_Types].xml' in names and 'word/document.xml' in names
        except zipfile.BadZipFile:
            valid = False
        mime = DOCX_MIME
    else:
        valid = data.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
        mime = 'application/msword'
    if not valid:
        raise HTTPException(400, 'The Word file is not a valid document')
    return {'kind': 'WORD', 'name': safe_filename(upload.filename), 'data': data, 'ext': ext, 'mime': mime}


def prepare_other(upload: UploadFile) -> dict:
    name = safe_filename(upload.filename or '')
    ext = os.path.splitext(name.lower())[1]
    if ext in BLOCKED_EXTENSIONS:
        raise HTTPException(400, f'Files of type {ext} are not allowed')
    data = read_upload(upload, name)
    return {'kind': 'OTHER', 'name': name, 'data': data, 'ext': ext if re.fullmatch(r'\.[a-z0-9]{1,10}', ext) else '',
        'mime': upload.content_type or 'application/octet-stream'}


@router.post('/{manual_id}/revisions', response_model=RevisionRead, status_code=201)
def upload_revision(manual_id: int, revision_no: str = Form(..., max_length=50),
        revision_detail: str = Form('', max_length=20000), other_type: str = Form('', max_length=100),
        file: UploadFile | None = File(None), pdf_file: UploadFile | None = File(None),
        word_file: UploadFile | None = File(None), other_files: list[UploadFile] = File(default=[]),
        db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    manual = require_manual(db, manual_id, user, min_role='CONTRIBUTOR')
    number = revision_no.strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,49}', number):
        raise HTTPException(400, 'Revision number is required and must use letters, numbers, dots, underscores or hyphens')
    if number.isascii() and number.isdigit():
        number = str(int(number)).zfill(2)
    if db.scalar(select(ManualRevision.id).where(ManualRevision.manual_id == manual_id,
            ManualRevision.revision_no == number)):
        raise HTTPException(409, f'Revision {number} already exists for {manual.manual_code}')

    pdf_upload = next((u for u in (pdf_file, file) if u is not None and u.filename), None)
    word_upload = word_file if word_file is not None and word_file.filename else None
    other_uploads = [u for u in other_files if u.filename]
    if pdf_upload is None and word_upload is None and not other_uploads:
        raise HTTPException(400, 'Select at least one file: Word, PDF or other')
    other_label = other_type.strip()
    if other_uploads and not other_label:
        raise HTTPException(400, 'Describe what the Other file is (for example Excel or Drawing)')
    if len(other_uploads) > MAX_OTHER_FILES:
        raise HTTPException(400, f'At most {MAX_OTHER_FILES} other files can be attached to a revision')
    prepared = []
    if pdf_upload is not None:
        prepared.append(prepare_pdf(pdf_upload))
    if word_upload is not None:
        prepared.append(prepare_word(word_upload))
    prepared.extend({**prepare_other(u), 'label': other_label} for u in other_uploads)
    if sum(len(item['data']) for item in prepared) > get_settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f'Combined file size must be at most {get_settings().max_upload_mb} MB. Remove a file or reduce its size.')

    # Serialize uploads and publishing for this manual; DB uniqueness is the final guard.
    manual = db.scalar(select(Manual).where(Manual.id == manual_id).with_for_update())
    if manual is None:
        raise HTTPException(404, 'Manual not found')
    if db.scalar(select(ManualRevision.id).where(ManualRevision.manual_id == manual_id,
            ManualRevision.revision_no == number)) is not None:
        raise HTTPException(409, f'Revision {number} already exists for {manual.manual_code}')
    prefix = number.zfill(3) if number.isdigit() else number
    # Legacy codes outside the new validation rule use an unambiguous safe ID segment.
    code_segment = safe_path_segment(manual.manual_code, f'manual-{manual.id}')
    project_segment = safe_path_segment(manual.project_code, f'project-{manual.project_id}')
    uploaded_keys = []
    try:
        for item in prepared:
            item['key'] = f'{project_segment}/{code_segment}/rev-{prefix}/{uuid4()}{item["ext"]}'
            storage.upload(item['key'], io.BytesIO(item['data']), len(item['data']), content_type=item['mime'])
            uploaded_keys.append(item['key'])
    except Exception:
        logger.exception('File upload failed for manual %s', manual_id)
        db.rollback()
        for stored in uploaded_keys:
            try:
                storage.delete(stored)
            except Exception:
                logger.exception('Orphan cleanup failed for bucket object %s', stored)
        raise HTTPException(502, 'File storage is unavailable. Revision was not saved.') from None
    primary = next(p for kind in ('PDF', 'WORD', 'OTHER') for p in prepared if p['kind'] == kind)
    key = primary['key']
    revision = ManualRevision(manual_id=manual_id, revision_no=number, revision_detail=revision_detail.strip(),
        file_name=primary['name'], object_key=key, file_size=len(primary['data']), mime_type=primary['mime'],
        checksum=hashlib.sha256(primary['data']).hexdigest(), status='DRAFT', uploaded_by=user.username)
    revision.files = [RevisionFile(kind=p['kind'], file_name=p['name'], object_key=p['key'], file_size=len(p['data']),
        mime_type=p['mime'], checksum=hashlib.sha256(p['data']).hexdigest(), label=p.get('label')) for p in prepared]
    db.add(revision)
    manual.updated_at = utcnow()
    try:
        db.flush()
        write_audit_event(db, AuditAction.REVISION_UPLOADED, actor=user, project=manual.project_id, manual=manual,
            revision=revision, details={'revision_no': number, 'file_size': len(primary['data']),
                'files': [p['kind'] for p in prepared]})
        db.commit()
    except Exception as error:
        logger.exception('Revision commit failed for manual %s', manual_id)
        db.rollback()
        # A connection can drop after COMMIT succeeds. Never delete a durable row's files.
        try:
            with Session(db.get_bind()) as verification:
                if verification.bind.dialect.name == 'postgresql':
                    verification.execute(text("SET LOCAL lock_timeout = '5s'"))
                # The original transaction holds this row lock. Wait for its outcome
                # before checking absence, including COMMIT still in flight on server.
                verification.scalar(select(Manual.id).where(Manual.id == manual_id).with_for_update())
                saved = verification.scalar(select(ManualRevision).where(ManualRevision.object_key == key))
                if saved is not None:
                    logger.warning('Recovered committed revision %s after lost acknowledgement', saved.id)
                    redis_cache.get_cache().invalidate()
                    return saved
                duplicate = verification.scalar(select(ManualRevision.id).where(
                    ManualRevision.manual_id == manual_id, ManualRevision.revision_no == number))
        except Exception:
            logger.exception('Commit outcome unconfirmed; retained bucket objects %s', uploaded_keys)
            raise HTTPException(500, 'Upload could not be confirmed. Refresh revision history before retrying.') from None
        for stored in uploaded_keys:
            try:
                storage.delete(stored)
            except Exception:
                logger.exception('Orphan cleanup failed for bucket object %s', stored)
        if isinstance(error, IntegrityError) and duplicate:
            raise HTTPException(409, f'Revision {number} already exists for {manual.manual_code}') from None
        raise HTTPException(500, 'Revision could not be saved. Please try again.') from None
    return revision
