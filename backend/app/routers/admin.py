import logging
from datetime import timezone
from fastapi import APIRouter, Depends
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.auth import as_utc, require_admin
from app.database import get_db
from app.models.manual import Manual, utcnow
from app.models.manual_revision import ManualRevision
from app.models.project import Project
from app.models.user import User, UserSession
from app.services import redis_cache
from app.services.audit import AuditAction, write_audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/admin', tags=['admin'], dependencies=[Depends(require_admin)])


@router.get('/overview')
def system_overview(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Summary metrics for the Admin Dashboard."""
    total_users = db.scalar(select(func.count(User.id))) or 0
    active_users = db.scalar(select(func.count(User.id)).where(User.is_active == True)) or 0
    total_projects = db.scalar(select(func.count(Project.id))) or 0
    active_projects = db.scalar(select(func.count(Project.id)).where(Project.status == 'ACTIVE')) or 0
    total_manuals = db.scalar(select(func.count(Manual.id))) or 0
    total_revisions = db.scalar(select(func.count(ManualRevision.id))) or 0
    active_sessions = db.scalar(select(func.count(UserSession.token_hash)).where(UserSession.expires_at > utcnow())) or 0

    cache = redis_cache.get_cache()
    cache_connected = cache._available() if hasattr(cache, '_available') else False

    return {
        'total_users': total_users,
        'active_users': active_users,
        'total_projects': total_projects,
        'active_projects': active_projects,
        'total_manuals': total_manuals,
        'total_revisions': total_revisions,
        'active_sessions': active_sessions,
        'cache_status': 'connected' if cache_connected else 'fallback_memory_or_disabled',
    }


@router.post('/cache/flush')
def flush_system_cache(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Admin-only: force purge Redis cache generation and invalidate all backend cached queries."""
    cache = redis_cache.get_cache()
    invalidated = cache.invalidate()
    write_audit_event(
        db,
        AuditAction.CACHE_FLUSHED,
        actor=admin,
        details={'action': 'flush_cache', 'result': 'success' if invalidated else 'cache_not_available'},
    )
    db.commit()
    return {
        'status': 'ok',
        'message': 'System cache generation invalidated successfully. Fresh data will be read on next request.',
        'cache_flushed': invalidated,
    }


@router.post('/cleanup')
def cleanup_stale_data(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """Admin-only: clean up expired user sessions and orphan test records."""
    now = utcnow()
    # Delete expired sessions
    expired_result = db.execute(delete(UserSession).where(UserSession.expires_at <= now))
    deleted_sessions = expired_result.rowcount or 0

    # Flush cache to keep data in sync
    cache = redis_cache.get_cache()
    cache.invalidate()

    write_audit_event(
        db,
        AuditAction.SYSTEM_CLEANUP,
        actor=admin,
        details={'action': 'cleanup_stale_data', 'deleted_sessions': deleted_sessions},
    )
    db.commit()

    return {
        'status': 'ok',
        'message': f'Cleanup completed successfully. Removed {deleted_sessions} expired sessions.',
        'deleted_sessions': deleted_sessions,
    }
