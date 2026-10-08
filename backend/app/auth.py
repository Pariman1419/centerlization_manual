"""Password hashing, opaque database sessions and Project ownership checks."""
import hashlib
import secrets
from datetime import timezone
from threading import BoundedSemaphore

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.manual import utcnow
from app.models.user import User, UserSession

COOKIE_NAME = 'manual_session'
_PASSWORD_SLOTS = BoundedSemaphore(2)


def _password_key(password, salt):
    # Bound memory-heavy work per worker; excess attempts do not queue or weaken hashes.
    if not _PASSWORD_SLOTS.acquire(blocking=False):
        raise HTTPException(429, 'Login service is busy. Please try again shortly.')
    try:
        return hashlib.scrypt(password.encode(), salt=salt, n=131072, r=8, p=1, maxmem=256 * 1024 * 1024)
    finally:
        _PASSWORD_SLOTS.release()


def hash_password(password):
    salt = secrets.token_bytes(16)
    key = _password_key(password, salt)
    return f'scrypt$131072$8$1${salt.hex()}${key.hex()}'


def verify_password(password, encoded):
    try:
        algorithm, n, r, p, salt, expected = encoded.split('$')
        if (algorithm, n, r, p) != ('scrypt', '131072', '8', '1'):
            return False
        key = _password_key(password, bytes.fromhex(salt))
        return secrets.compare_digest(key.hex(), expected)
    except (ValueError, TypeError):
        return False


# Unknown names perform the same expensive password verification.
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token(token):
    return hashlib.sha256(('csrf:' + token).encode()).hexdigest()


def as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def get_session_user(request: Request, db: Session = Depends(get_db)):
    """Authenticate the session (and CSRF) without the forced-password-change restriction."""
    token = request.cookies.get(COOKIE_NAME, '')
    session = db.get(UserSession, token_hash(token)) if token else None
    user = db.get(User, session.user_id) if session and as_utc(session.expires_at) > utcnow() else None
    if user is None or not user.is_active:
        raise HTTPException(401, 'Please log in')
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and not secrets.compare_digest(
            request.headers.get('X-CSRF-Token', ''), csrf_token(token)):
        raise HTTPException(403, 'Invalid request token. Refresh the page and try again.')
    return user


def get_current_user(user: User = Depends(get_session_user)):
    # Backend-enforced: accounts with a temporary password may only reach the password-change flow.
    if user.must_change_password:
        raise HTTPException(403, 'Password change required')
    return user


def require_admin(user: User = Depends(get_current_user)):
    if user.role != 'ADMIN':
        raise HTTPException(403, 'Administrator access required')
    return user


PROJECT_ROLES = ('OWNER', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER', 'BA', 'DEV', 'USER')
PROJECT_ROLE_LEVELS = {
    'VIEWER': 1,
    'USER': 1,
    'CONTRIBUTOR': 2,
    'DEV': 2,
    'REVIEWER': 3,
    'OWNER': 4,
    'BA': 4,
    'ADMIN': 5,
}


def accessible_project(db, project_id, user, min_role: str = 'VIEWER'):
    """The single Project authorization path. Non-members get 404 (no existence leak)."""
    from app.models.project import Project
    from app.models.project_member import ProjectMember
    from sqlalchemy import select

    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, 'Project not found')
    if user.role == 'ADMIN':  # global override, regardless of any membership row
        project.my_role = 'ADMIN'
        return project
    role = db.scalar(select(ProjectMember.role).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user.id))
    if role is None:
        raise HTTPException(404, 'Project not found')
    if PROJECT_ROLE_LEVELS.get(role, 0) < PROJECT_ROLE_LEVELS.get(min_role, 1):
        raise HTTPException(403, 'Insufficient permissions for this project')
    project.my_role = role
    return project
