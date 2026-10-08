"""Bounded JSON cache; database authorization and transactions remain authoritative."""
import json
import logging
from functools import lru_cache
from time import monotonic
from uuid import uuid4

from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.config import get_settings

logger = logging.getLogger(__name__)
MAX_PAYLOAD = 256 * 1024


class RedisCache:
    def __init__(self, client=None, prefix='manuel:development:cache:v1:'):
        self.client = client
        self.prefix = prefix
        self.retry_at = 0

    def _available(self):
        return self.client is not None and monotonic() >= self.retry_at

    def _failed(self, error):
        self.retry_at = monotonic() + 10
        logger.warning('Redis cache unavailable (%s); using database', type(error).__name__)

    def key(self, suffix):
        if not self._available():
            return None
        try:
            generation_key = self.prefix + 'generation'
            generation = self.client.get(generation_key)
            if generation is None:
                candidate = str(uuid4())
                if self.client.set(generation_key, candidate, nx=True):
                    generation = candidate
                else:
                    generation = self.client.get(generation_key)
            if generation is None:
                return None
            return f'{self.prefix}g:{generation}:{suffix}'
        except Exception as error:
            self._failed(error)
            return None

    def read(self, key):
        if key is None or not self._available():
            return None
        try:
            payload = self.client.get(key)
        except Exception as error:
            self._failed(error)
            return None
        try:
            if payload is None or len(payload.encode('utf-8')) > MAX_PAYLOAD:
                return None
            return json.loads(payload)
        except (ValueError, TypeError, UnicodeError, RecursionError):
            return None

    def write(self, key, value, ttl):
        if key is None or not self._available():
            return
        try:
            payload = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            if len(payload.encode('utf-8')) > MAX_PAYLOAD:
                return
        except (TypeError, ValueError, UnicodeError, RecursionError):
            return
        try:
            self.client.set(key, payload, ex=ttl)
        except Exception as error:
            self._failed(error)

    def invalidate(self):
        if not self._available():
            return False
        try:
            # ponytail: one shared generation; use per-project generations if write churn lowers hit rate.
            return bool(self.client.set(self.prefix + 'generation', str(uuid4())))
        except Exception as error:
            self._failed(error)
            return False


@lru_cache
def get_cache():
    settings = get_settings()
    url = settings.redis_url.get_secret_value()
    if not url:
        return RedisCache()
    try:
        client = Redis.from_url(url, decode_responses=True, protocol=2,
            socket_connect_timeout=0.2, socket_timeout=0.2, max_connections=16,
            retry=Retry(NoBackoff(), 0))
        return RedisCache(client, settings.redis_key_prefix)
    except Exception as error:
        logger.warning('Redis cache configuration rejected (%s); using database', type(error).__name__)
        return RedisCache()


@event.listens_for(Session, 'before_flush')
def mark_cache_changes(session, flush_context, instances):
    tables = {'projects', 'manuals', 'manual_revisions', 'revision_files', 'project_members'}
    if any(getattr(type(item), '__tablename__', None) in tables
           for group in (session.new, session.dirty, session.deleted) for item in group):
        session.info['response_cache_dirty'] = True


@event.listens_for(Session, 'after_commit')
def invalidate_committed_changes(session):
    # Audit savepoints also emit after_commit; only invalidate a durable root commit.
    if not session.in_nested_transaction() and session.info.pop('response_cache_dirty', False):
        get_cache().invalidate()


@event.listens_for(Session, 'after_rollback')
def discard_rolled_back_changes(session):
    # Preserve outer writes after savepoint rollback; a later root commit may
    # conservatively invalidate even if only the savepoint changed cached data.
    if not session.in_nested_transaction():
        session.info.pop('response_cache_dirty', None)
