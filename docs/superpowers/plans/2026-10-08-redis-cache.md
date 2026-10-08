# Redis Cache Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Reduce repeated manual-list/count queries using the existing Redis service.

**Architecture:** JSON cache-aside, short TTL, shared UUID generation, fresh DB
authorization. Invalidate after root commit using shared SQLAlchemy session events;
explicitly invalidate verified durable uploads after a lost acknowledgement.

**Tech Stack:** FastAPI, SQLAlchemy, redis-py, PostgreSQL, pytest.

**Spec:** docs/redis-cache-design.md (approved for implementation in chat).

## Global Constraints

- TTL 15 seconds for manual counts; 30 seconds for project manual lists.
- 256 KiB payload ceiling, 200 ms socket timeouts, no retry, 10 second failure cooldown.
- Application-specific namespace; no keyspace flush or configuration changes.
- Permissions, numbering, MinIO checks and signed URLs stay fresh.
- DB commit remains authoritative; cache failures never undo a successful write.

## Review Focus

- Nested audit savepoint commits must not invalidate before the root commit.
- Rolled-back writes must leave cache generation unchanged.
- Old fills must not become reachable in a newer generation.
- Membership removal/deactivation must block warmed-cache access.
- Oversized/malformed cache entries and outages must fall back to DB.

## Task 1: Cache client and transaction lifecycle

Files: backend/app/services/redis_cache.py, backend/app/config.py,
backend/app/database.py, backend/tests/test_redis_cache.py, requirements.txt.
Interfaces: get_cache(), RedisCache.read(key), write(key,value,ttl), invalidate().
- [x] Add failing tests for sharing, expiry, generation races, failures and root transactions.
- [x] Implement the small JSON helper, bounded pool and commit/rollback hooks.
- [x] Run tests and verify independent clients against an isolated live Redis namespace.

## Task 2: Cached routes and live authorization

Files: backend/app/routers/projects.py, backend/app/routers/manuals.py,
backend/tests/test_redis_cache.py, backend/tests/conftest.py.
- [x] Add failing query-count, mutation-invalidation and permission tests.
- [x] Cache counts and project manual lists with fresh permission checks.
- [x] Preserve one-query grouped fallback when caching is disabled.
- [x] Handle verified durable uploads and run full backend/frontend checks.

## Task 3: Activation, documentation and review

Files: backend/.env.example, ignored backend/.env, docs/redis-cache-design.md,
backend/scripts/smoke_redis_cache.py, README.md.
- [x] Configure the supplied Redis endpoint without modifying other applications.
- [x] Smoke-test hit/miss/invalidation/expiry under a disposable namespace.
- [x] Document Big O, TTL limits and observed query counts; request independent code review.
- [x] Report all verification results, including existing suite failures.

This workspace has no Git repository; commits/worktrees do not apply.

Review: fixed malformed deeply nested JSON raising RecursionError during decoding
or encoding. Eleven cache tests pass. Retained conservative savepoint rollback
invalidation to preserve outer writes; documented the possible extra cache miss.
Frontend 48 tests and production build pass. Live two-client Redis smoke passes.
Final full backend run: 145 passed, 1 existing failure in
`test_all_reserved_actions_are_defined` (expects 17 actions, registry has 18).
