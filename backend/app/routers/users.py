from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import hash_password, require_admin
from app.database import get_db
from app.models.user import User, UserSession
from app.services.audit import AuditAction, write_audit_event
from app.schemas.user import ResetPasswordInput, UserCreate, UserRead, UserUpdate

router = APIRouter(prefix='/api/users', tags=['users'], dependencies=[Depends(require_admin)])


@router.get('', response_model=list[UserRead])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.post('', response_model=UserRead, status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    user = User(**payload.model_dump(exclude={'password'}), password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if db.scalar(select(User.id).where(User.username == payload.username)):
            raise HTTPException(409, 'Username already exists') from None
        raise
    return user


@router.put('/{user_id}', response_model=UserRead)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise HTTPException(404, 'User not found')
    if payload.role is not None and user_id == admin.id and payload.role != 'ADMIN':
        raise HTTPException(400, 'Cannot remove your own admin privileges')
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.role is not None:
        old_role = user.role
        user.role = payload.role
        if old_role != payload.role:
            db.execute(delete(UserSession).where(UserSession.user_id == user.id))
            write_audit_event(db, AuditAction.MEMBER_ROLE_CHANGED, actor=admin, target_user=user,
                details={'from_role': old_role, 'to_role': payload.role})
    if payload.is_active is not None:
        if user_id == admin.id and not payload.is_active:
            raise HTTPException(400, 'Cannot deactivate your own account')
        user.is_active = payload.is_active
        if not user.is_active:
            db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    db.commit()
    return user


@router.post('/{user_id}/reset-password')
def reset_password(user_id: int, payload: ResetPasswordInput, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(400, 'Use Change Password to change your own password')
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise HTTPException(404, 'User not found')
    user.password_hash = hash_password(payload.temporary_password)
    user.must_change_password = True
    user.failed_login_attempts = 0
    user.locked_until = None
    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    write_audit_event(db, AuditAction.PASSWORD_RESET_BY_ADMIN, actor=admin, target_user=user)
    db.commit()
    return {'detail': 'Password reset. The user must change it at next login.'}
