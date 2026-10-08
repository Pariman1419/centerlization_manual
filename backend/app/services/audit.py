"""Small audit helper: one row per call, written inside the caller's transaction.

    write_audit_event(db, AuditAction.PROJECT_CREATED, actor=user, project=project, details={'code': project.project_code})

The helper never commits. The row is committed (or rolled back) together with the business change,
so a rolled-back operation leaves no audit row and a committed one always has its row.
"""
import logging
import re

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


class AuditAction:
    PROJECT_CREATED = 'PROJECT_CREATED'
    PROJECT_DELETED = 'PROJECT_DELETED'
    MANUAL_CREATED = 'MANUAL_CREATED'
    REVISION_UPLOADED = 'REVISION_UPLOADED'
    REVISION_PUBLISHED = 'REVISION_PUBLISHED'
    REVISION_DELETED = 'REVISION_DELETED'
    MANUAL_DELETED = 'MANUAL_DELETED'
    MANUAL_UPDATED = 'MANUAL_UPDATED'
    REVISION_UPDATED = 'REVISION_UPDATED'
    REVISION_WITHDRAWN = 'REVISION_WITHDRAWN'
    DEV_REVIEW_REQUESTED = 'DEV_REVIEW_REQUESTED'
    DEV_REVIEW_COMPLETED = 'DEV_REVIEW_COMPLETED'
    # Reserved for later branches (no workflow implemented here).
    MEMBER_ADDED = 'MEMBER_ADDED'
    MEMBER_REMOVED = 'MEMBER_REMOVED'
    MEMBER_ROLE_CHANGED = 'MEMBER_ROLE_CHANGED'
    REVISION_SUBMITTED = 'REVISION_SUBMITTED'
    REVISION_APPROVED = 'REVISION_APPROVED'
    REVISION_REJECTED = 'REVISION_REJECTED'
    PASSWORD_RESET_BY_ADMIN = 'PASSWORD_RESET_BY_ADMIN'
    PASSWORD_CHANGED = 'PASSWORD_CHANGED'
    SETTINGS_CHANGED = 'SETTINGS_CHANGED'
    CACHE_FLUSHED = 'CACHE_FLUSHED'
    SYSTEM_CLEANUP = 'SYSTEM_CLEANUP'


ACTIONS = frozenset(v for k, v in vars(AuditAction).items() if k.isupper())


class AuditError(RuntimeError):
    pass


# Keys containing any of these fragments are dropped before persistence.
_SECRET_KEY = re.compile(
    r'pass(word|wd|phrase)?|hash|token|cookie|csrf|secret|credential|authorization|api[_-]?key|access[_-]?key|private[_-]?key|session',
    re.IGNORECASE)
_MAX_STRING, _MAX_ITEMS, _MAX_DEPTH = 1000, 50, 4


def sanitize_details(value, _depth=0):
    """Return a JSON-safe copy with secret-looking keys removed and size bounded."""
    if _depth >= _MAX_DEPTH:
        return '[truncated]'
    if isinstance(value, dict):
        return {str(k)[:100]: sanitize_details(v, _depth + 1)
                for k, v in list(value.items())[:_MAX_ITEMS] if not _SECRET_KEY.search(str(k))}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [sanitize_details(v, _depth + 1) for v in list(value)[:_MAX_ITEMS]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:_MAX_STRING]


def _id(value):
    return getattr(value, 'id', value)


def write_audit_event(db: Session, action, *, actor=None, project=None, manual=None, revision=None,
        target_user=None, details=None, best_effort=False):
    """Add an audit row to the current transaction. Resources may be ORM objects or integer ids.

    Fails closed by default (raises AuditError, session stays usable). With best_effort=True the
    failure is logged and swallowed. Either way only the audit savepoint is rolled back; the caller's
    pending business changes are untouched.
    """
    if action not in ACTIONS:
        raise ValueError(f'Unknown audit action: {action!r}')
    try:
        row = AuditLog(action=action, actor_user_id=_id(actor), project_id=_id(project), manual_id=_id(manual),
            revision_id=_id(revision), target_user_id=_id(target_user),
            details=sanitize_details(details) if details is not None else None)
        with db.begin_nested():
            db.add(row)
            db.flush()
        return row
    except Exception as exc:
        logger.error('Audit write failed for action %s (%s)', action, type(exc).__name__)
        if best_effort:
            return None
        raise AuditError(f'Audit write failed for {action}') from exc
