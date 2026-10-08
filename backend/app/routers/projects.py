import hashlib
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import TypeAdapter, ValidationError

from app.auth import accessible_project, get_current_user
from app.database import get_db
from app.models.manual import Manual, utcnow
from app.models.manual_revision import ManualRevision
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.models.user import User
from app.routers.manuals import create_manual_record, list_manuals
from app.services.audit import AuditAction, write_audit_event
from app.services.minio_service import get_storage
from app.services import redis_cache
from app.schemas.manual import ManualCreate, ManualRead
from app.schemas.project import (
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberRead,
    ProjectMemberUpdate,
    ProjectRead,
    ProjectUpdate,
)

router = APIRouter(prefix='/api/projects', tags=['projects'], dependencies=[Depends(get_current_user)])
logger = logging.getLogger(__name__)
manual_list_adapter = TypeAdapter(list[ManualRead])


def lock_project(db, project_id):
    # Serialize member changes so concurrent demote/remove cannot leave a Project without an OWNER.
    db.scalar(select(Project.id).where(Project.id == project_id).with_for_update())


def cached_manual_counts(db):
    cache = redis_cache.get_cache()
    key = cache.key('manual-counts')
    if key is None:
        return None
    counts = cache.read(key)
    if isinstance(counts, dict) and all(isinstance(k, str) and k.isdigit()
            and type(v) is int and v >= 0 for k, v in counts.items()):
        return counts
    rows = db.execute(select(Manual.project_id, func.count(Manual.id)).group_by(Manual.project_id)).all()
    counts = {str(project_id): count for project_id, count in rows}
    cache.write(key, counts, 15)
    return counts


def require_available_project_code(db, storage, code, exclude_id=None):
    query = select(Project.id).where(Project.project_code == code)
    if exclude_id is not None:
        query = query.where(Project.id != exclude_id)
    if db.scalar(query) is not None:
        raise HTTPException(409, f'Project code {code} already exists')
    try:
        # This is a precheck, not a reservation against external MinIO writers.
        exists = storage.prefix_exists(f'{code}/')
    except Exception:
        logger.exception('Cannot check project storage folder')
        raise HTTPException(503, 'Cannot check the project folder in MinIO. Please try again. Project was not saved.') from None
    if exists:
        raise HTTPException(409, f'Folder {code} already exists in MinIO. Please use another Project Code.')


@router.get('', response_model=list[ProjectRead])
def list_projects(search: str = '', status: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    cached_counts = cached_manual_counts(db)
    member_sub = select(ProjectMember.project_id, ProjectMember.role.label('member_role')).where(ProjectMember.user_id == user.id).subquery()

    if cached_counts is None:
        counts = select(Manual.project_id, func.count(Manual.id).label('manual_count')).group_by(Manual.project_id).subquery()
        query = select(Project, func.coalesce(counts.c.manual_count, 0), member_sub.c.member_role).outerjoin(
            counts, counts.c.project_id == Project.id)
    else:
        query = select(Project, member_sub.c.member_role)
    if user.role != 'ADMIN':
        query = query.join(member_sub, member_sub.c.project_id == Project.id)
    else:
        query = query.outerjoin(member_sub, member_sub.c.project_id == Project.id)

    if search.strip():
        pattern = '%' + search.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        query = query.where(or_(Project.project_code.ilike(pattern, escape='\\'), Project.project_name.ilike(pattern, escape='\\')))
    if status:
        query = query.where(Project.status == status)

    rows = db.execute(query.order_by(Project.updated_at.desc(), Project.id.desc())).all()
    results = []
    for row in rows:
        if cached_counts is None:
            project, count, role = row
        else:
            project, role = row
            count = cached_counts.get(str(project.id), 0)
        effective_role = 'ADMIN' if user.role == 'ADMIN' else role
        results.append(ProjectRead.model_validate(project).model_copy(update={'manual_count': count, 'my_role': effective_role}))
    return results


@router.post('', response_model=ProjectRead, status_code=201)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    require_available_project_code(db, storage, payload.project_code)
    try:
        project = Project(**payload.model_dump(), status='ACTIVE', created_by=user.username, owner_user_id=user.id)
        db.add(project)
        db.flush()
        member = ProjectMember(project_id=project.id, user_id=user.id, role='OWNER', added_by=user.id)
        db.add(member)
        db.flush()
        write_audit_event(db, AuditAction.PROJECT_CREATED, actor=user, project=project,
            details={'project_code': project.project_code})
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.scalar(select(Project.id).where(Project.project_code == payload.project_code)):
            raise HTTPException(409, f'Project code {payload.project_code} already exists') from None
        raise
    return ProjectRead.model_validate(project).model_copy(update={'manual_count': 0, 'my_role': 'ADMIN' if user.role == 'ADMIN' else 'OWNER'})


@router.get('/{project_id}', response_model=ProjectRead)
def get_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = accessible_project(db, project_id, user, min_role='VIEWER')
    counts = cached_manual_counts(db)
    count = counts.get(str(project_id), 0) if counts is not None else db.scalar(
        select(func.count(Manual.id)).where(Manual.project_id == project_id))
    return ProjectRead.model_validate(project).model_copy(update={'manual_count': count, 'my_role': project.my_role})


@router.put('/{project_id}', response_model=ProjectRead)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    project = accessible_project(db, project_id, user, min_role='OWNER')
    # Manual creation takes the same lock before choosing its code.
    db.refresh(project, with_for_update=True)
    if payload.project_code is not None and payload.project_code != project.project_code:
        if db.scalar(select(Manual.id).where(Manual.project_id == project_id).limit(1)) is not None:
            raise HTTPException(409, 'Project Code cannot be changed after manuals have been created. Change the Project Name instead.')
        require_available_project_code(db, storage, payload.project_code, exclude_id=project_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    project.updated_at = utcnow()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if payload.project_code and db.scalar(select(Project.id).where(Project.project_code == payload.project_code, Project.id != project_id)):
            raise HTTPException(409, f'Project code {payload.project_code} already exists') from None
        raise
    return get_project(project_id, db, user)


@router.delete('/{project_id}')
def delete_project(project_id: int, db: Session = Depends(get_db), storage=Depends(get_storage), user: User = Depends(get_current_user)):
    accessible_project(db, project_id, user, min_role='OWNER')
    try:
        project = db.scalar(select(Project).where(Project.id == project_id).with_for_update())
        if project is None:
            raise HTTPException(404, 'Project not found')
        manuals = db.scalars(select(Manual).where(Manual.project_id == project_id).with_for_update()).all()
        revisions = db.scalars(select(ManualRevision).join(Manual, ManualRevision.manual_id == Manual.id)
            .where(Manual.project_id == project_id).with_for_update()).all()
        keys = sorted({key for revision in revisions for key in revision.all_object_keys})
        for manual in manuals:
            manual.current_revision_id = None
        db.flush()
        for revision in revisions:
            db.delete(revision)
        db.flush()
        for manual in manuals:
            db.delete(manual)
        db.flush()
        details = {'project_id': project.id, 'project_code': project.project_code,
            'project_name': project.project_name, 'manuals_deleted': len(manuals),
            'revisions_deleted': len(revisions)}
        db.delete(project)
        db.flush()
        # Keep identifying details without a FK to the deleted project.
        write_audit_event(db, AuditAction.PROJECT_DELETED, actor=user, details=details)
        db.commit()
    except Exception:
        db.rollback()
        raise
    # Match manual deletion: only remove stored files once the database commits.
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            logger.exception('Project deleted but object cleanup failed; remove manually: %s', key)
    return {'deleted': True}


@router.get('/{project_id}/manuals', response_model=list[ManualRead])
def project_manuals(project_id: int, search: str = '', category: str | None = None,
        status: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    accessible_project(db, project_id, user, min_role='VIEWER')
    cache = redis_cache.get_cache()
    query_hash = hashlib.sha256(json.dumps([search.strip(), category or None, status or None]).encode()).hexdigest()
    key = cache.key(f'project:{project_id}:manuals:{query_hash}')
    cached = cache.read(key)
    if cached is not None:
        try:
            validated = manual_list_adapter.validate_python(cached)
            if all(manual.project_id == project_id for manual in validated):
                return validated
        except ValidationError:
            pass
    manuals = list_manuals(search=search, category=category, status=status, project_id=project_id, db=db, user=user)
    result = [ManualRead.model_validate(manual) for manual in manuals]
    cache.write(key, [manual.model_dump(mode='json') for manual in result], 30)
    return result


@router.post('/{project_id}/manuals', response_model=ManualRead, status_code=201)
def create_project_manual(project_id: int, payload: ManualCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return create_manual_record(payload, db, project_id, user)


@router.get('/{project_id}/members', response_model=list[ProjectMemberRead])
def list_project_members(project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    accessible_project(db, project_id, user, min_role='VIEWER')
    return db.scalars(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.created_at.asc(), ProjectMember.id.asc())
    ).all()


@router.post('/{project_id}/members', response_model=ProjectMemberRead, status_code=201)
def add_project_member(project_id: int, payload: ProjectMemberCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = accessible_project(db, project_id, user, min_role='OWNER')

    target_user = None
    if payload.user_id is not None:
        target_user = db.get(User, payload.user_id)
    elif payload.username:
        normalized = payload.username.strip().lower()
        target_user = db.scalar(select(User).where(User.username == normalized))
    else:
        raise HTTPException(400, 'User ID or username is required')

    if target_user is None:
        raise HTTPException(404, 'User not found')
    if not target_user.is_active:
        raise HTTPException(400, 'Cannot add an inactive user')

    existing = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == target_user.id
        )
    )
    if existing:
        raise HTTPException(409, f'User {target_user.username} is already a member of this project')

    member = ProjectMember(
        project_id=project.id,
        user_id=target_user.id,
        role=payload.role,
        added_by=user.id
    )
    db.add(member)
    write_audit_event(db, AuditAction.MEMBER_ADDED, actor=user, project=project, target_user=target_user,
        details={'role': payload.role})
    db.commit()
    db.refresh(member)
    return member


@router.put('/{project_id}/members/{user_id}', response_model=ProjectMemberRead)
def update_project_member(project_id: int, user_id: int, payload: ProjectMemberUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = accessible_project(db, project_id, user, min_role='OWNER')
    lock_project(db, project.id)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user_id
        )
    )
    if member is None:
        raise HTTPException(404, 'Member not found')

    if member.role == 'OWNER' and payload.role != 'OWNER':
        owner_count = db.scalar(
            select(func.count(ProjectMember.id)).where(
                ProjectMember.project_id == project.id,
                ProjectMember.role == 'OWNER'
            )
        )
        if owner_count <= 1:
            raise HTTPException(409, 'Cannot demote the last OWNER of a project')

    previous_role = member.role
    member.role = payload.role
    member.updated_at = utcnow()
    if previous_role != payload.role:
        write_audit_event(db, AuditAction.MEMBER_ROLE_CHANGED, actor=user, project=project, target_user=user_id,
            details={'from_role': previous_role, 'to_role': payload.role})
    db.commit()
    db.refresh(member)
    return member


@router.delete('/{project_id}/members/{user_id}')
def remove_project_member(project_id: int, user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    project = accessible_project(db, project_id, user, min_role='OWNER')
    lock_project(db, project.id)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user_id
        )
    )
    if member is None:
        raise HTTPException(404, 'Member not found')

    if member.role == 'OWNER':
        owner_count = db.scalar(
            select(func.count(ProjectMember.id)).where(
                ProjectMember.project_id == project.id,
                ProjectMember.role == 'OWNER'
            )
        )
        if owner_count <= 1:
            raise HTTPException(409, 'Cannot remove the last OWNER of a project')

    db.delete(member)
    write_audit_event(db, AuditAction.MEMBER_REMOVED, actor=user, project=project, target_user=user_id,
        details={'role': member.role})
    db.commit()
    return {'detail': 'Member removed'}
