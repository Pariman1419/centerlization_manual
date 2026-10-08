"""Verify two cache clients with disposable keys; no PostgreSQL/MinIO mutations."""
import time
from uuid import uuid4

from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from app.config import get_settings
from app.services.redis_cache import RedisCache


def main():
    settings = get_settings()
    url = settings.redis_url.get_secret_value()
    if not url:
        raise SystemExit('REDIS_URL is not configured')
    prefix = settings.redis_key_prefix + 'smoke:' + str(uuid4()) + ':'
    clients = [Redis.from_url(url, decode_responses=True, protocol=2,
        socket_connect_timeout=0.2, socket_timeout=0.2,
        retry=Retry(NoBackoff(), 0)) for _ in range(2)]
    first, second = [RedisCache(client, prefix) for client in clients]
    keys = {prefix + 'generation'}
    try:
        assert clients[0].ping()
        key = first.key('counts')
        assert key is not None
        keys.add(key)
        first.write(key, {'1': 2}, 2)
        assert second.read(second.key('counts')) == {'1': 2}
        assert 0 < clients[0].ttl(key) <= 2
        assert second.invalidate()
        new_key = second.key('counts')
        assert new_key != key
        keys.add(new_key)
        first.write(key, {'1': 9}, 2)  # A delayed reader cannot fill the new generation.
        assert second.read(new_key) is None
        second.write(new_key, {'1': 3}, 1)
        time.sleep(1.2)
        assert first.read(new_key) is None
        print('PASS: Redis PING, shared hit, TTL, invalidation, old-fill isolation and expiry')
    finally:
        clients[0].delete(*keys)
        for client in clients:
            client.close()


if __name__ == '__main__':
    main()
