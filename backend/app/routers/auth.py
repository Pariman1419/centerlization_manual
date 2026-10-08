import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import COOKIE_NAME, DUMMY_HASH, as_utc, csrf_token, get_session_user, hash_password, token_hash, verify_password
from app.config import get_settings
from app.database import get_db
from app.models.manual import utcnow
from app.models.user import User, UserSession
from app.services.audit import AuditAction, write_audit_event
from app.schemas.user import AuthRead, ChangePasswordInput, LoginInput

router = APIRouter(prefix='/api/auth', tags=['authentication'])


@router.post('/login', response_model=AuthRead)
def login(payload: LoginInput, request: Request, response: Response, db: Session = Depends(get_db)):
    origin = request.headers.get('Origin')
    allowed = set(get_settings().cors_origins) | {str(request.base_url).rstrip('/')}
    if origin and origin not in allowed:
        raise HTTPException(403, 'Invalid request origin')
    user = db.scalar(select(User).where(User.username == payload.username).with_for_update())
    verified = verify_password(payload.password, user.password_hash if user else DUMMY_HASH)
    now = utcnow()
    locked = user and user.locked_until and as_utc(user.locked_until) > now
    if not user or not user.is_active or locked or not verified:
        if user and user.is_active and not locked:
            if user.locked_until:
                user.failed_login_attempts = 0
                user.locked_until = None
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= 5:
                user.locked_until = now + timedelta(minutes=15)
            db.commit()
        raise HTTPException(401, 'Invalid username or password')
    user.failed_login_attempts = 0
    user.locked_until = None
    previous = request.cookies.get(COOKIE_NAME)
    if previous:
        old = db.get(UserSession, token_hash(previous))
        if old:
            db.delete(old)
    token = secrets.token_urlsafe(32)
    lifetime = get_settings().session_hours * 3600
    db.add(UserSession(token_hash=token_hash(token), user_id=user.id, expires_at=now + timedelta(seconds=lifetime)))
    db.commit()
    response.set_cookie(COOKIE_NAME, token, max_age=lifetime, httponly=True,
        secure=get_settings().cookie_secure, samesite='strict', path='/')
    response.headers['Cache-Control'] = 'no-store'
    return {'user': user, 'csrf_token': csrf_token(token)}


@router.get('/me', response_model=AuthRead)
def me(request: Request, response: Response, user: User = Depends(get_session_user)):
    response.headers['Cache-Control'] = 'no-store'
    return {'user': user, 'csrf_token': csrf_token(request.cookies[COOKIE_NAME])}


@router.post('/logout')
def logout(request: Request, response: Response, user: User = Depends(get_session_user), db: Session = Depends(get_db)):
    session = db.get(UserSession, token_hash(request.cookies[COOKIE_NAME]))
    if session:
        db.delete(session)
        db.commit()
    response.delete_cookie(COOKIE_NAME, path='/', secure=get_settings().cookie_secure, httponly=True, samesite='strict')
    return {'detail': 'Logged out'}


@router.post('/change-password', response_model=AuthRead)
def change_password(payload: ChangePasswordInput, request: Request, response: Response,
        user: User = Depends(get_session_user), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    now = utcnow()
    if user.locked_until and as_utc(user.locked_until) > now:
        raise HTTPException(401, 'Invalid username or password')
    if not verify_password(payload.current_password, user.password_hash):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= 5:
            user.locked_until = now + timedelta(minutes=15)
            db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.commit()
        raise HTTPException(400, 'Current password is incorrect')
    if payload.new_password == payload.current_password:
        raise HTTPException(400, 'New password must be different from the current password')
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.failed_login_attempts = 0
    user.locked_until = None
    token = request.cookies[COOKIE_NAME]
    current = token_hash(token)
    # Other sessions are revoked; the current one stays and its lifetime is refreshed.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.token_hash != current))
    lifetime = get_settings().session_hours * 3600
    db.get(UserSession, current).expires_at = now + timedelta(seconds=lifetime)
    write_audit_event(db, AuditAction.PASSWORD_CHANGED, actor=user, target_user=user)
    db.commit()
    response.set_cookie(COOKIE_NAME, token, max_age=lifetime, httponly=True,
        secure=get_settings().cookie_secure, samesite='strict', path='/')
    response.headers['Cache-Control'] = 'no-store'
    return {'user': user, 'csrf_token': csrf_token(token)}
