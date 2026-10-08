# Redis cache implementation

## Outcome and scope

Use the existing Redis endpoint at 10.153.90.17:6379 to reduce repeated database
reads across backend workers. Keep PostgreSQL authoritative for permissions,
uniqueness, code allocation, and write transactions. The existing frontend
in-flight cache and memoized filters remain complementary.

Start with two cached results: the project-to-manual-count map, and manual lists
inside an accessible project. Keep project metadata and membership reads fresh.
Do not cache sessions, users, permission decisions, name availability, MinIO
prefix checks, signed file URLs, errors, or the next manual/revision number.

## Options

1. **Recommended: cache-aside with short TTL and one shared version token.**
   Small implementation, shared by workers, and no key scans on writes. Every
   successful business mutation changes the version, so unrelated data may be
   refreshed too. This is appropriate for the initial read-heavy scope.
2. **Per-project version tokens.** Less cache churn when unrelated projects are
   updated, but more invalidation rules for moves, membership, and global counts.
   Add only if measured hit rates show coarse invalidation is too expensive.
3. **No Redis, frontend in-flight sharing only.** Already implemented and useful
   for duplicate requests in one browser; it cannot share completed reads across
   users or backend workers.

## Connection and ownership

- Configure REDIS_URL in the backend environment. For plain Redis without ACL,
  the address is `redis://10.153.90.17:6379/0`. Use configured ACL credentials or
  `rediss://` when required by the existing service. Never embed secrets in code,
  browser assets, error messages, or connection logs.
- Use the standard redis-py client and a bounded connection pool. Start with
  200 ms connection/read timeouts and no automatic retries on the request path.
- Use the application's own key prefix, such as `manuel:prod:cache:v1:`; configure
  the environment segment per deployment. Do not modify shared Redis settings
  or use FLUSHDB/FLUSHALL.
- A cache exception immediately falls back to DB for that request. Suppress
  Redis attempts for 10 seconds in that worker after a failure, then retry.
  Cache availability must not decide whether a business write succeeds.

## Keys, payloads, and TTL

| Result | Key suffix under the application prefix | Initial TTL |
| --- | --- | --- |
| Shared version | `generation` | No expiry |
| Project/manual count map | `g:{token}:manual-counts` | 15 seconds |
| Project manual list | `g:{token}:project:{id}:manuals:{query-hash}` | 30 seconds |

Store JSON, not ORM objects or pickle. Canonicalize supported query parameters
before hashing; validate them as usual. Bypass cache for a serialized result
above 256 KiB so existing large lists do not consume excessive Redis memory.
TTL ensures obsolete versioned results expire without scanning the keyspace.

The generation value is a random UUID. Initialize it with SET NX when absent
and reread the winning value. Use a fresh UUID after invalidation, rather than
resetting a counter that could reuse an old generation after eviction.

## Read flow and authorization

1. Authenticate and check current user activity/password-change requirements.
2. For project lists, query currently accessible projects and membership roles
   from DB, then attach cached counts only to those rows. Cached counts do not
   grant access or provide cached project names.
3. For a project manual list, call accessible_project against DB before consulting
   cache. Require the existing minimum role, even on a cache hit.
4. Read the generation token and look up its result key. On a hit, decode JSON
   and return the result. Invalid JSON behaves like a miss.
5. On a miss, query DB and SET the result with its TTL under the captured token.
   Redis errors or oversized payloads return the DB result without caching it.

If a write changes the generation while a read is filling cache, that read can
only populate the old generation. Subsequent reads use the new token. Reads
already in flight may finish with their earlier snapshot; this is not a
strong-consistency mechanism.

## Write flow and invalidation

Commit the existing DB transaction first. Then SET a fresh generation UUID for
every successful project/manual/revision/member mutation and workflow action
that can affect these cached results. Do not invalidate on rollback. Put the
invalidation in shared SQLAlchemy session hooks for changes to projects, manuals,
manual revisions, revision files and project members. Nested audit savepoint
commits do not invalidate before the durable root commit. Cache helpers never
commit transactions or change existing cleanup/uncertain-commit recovery.
After a savepoint rollback, retain the dirty marker to preserve outer writes;
a later empty root commit can conservatively invalidate unnecessarily. Root
rollback clears the marker. Direct SQL writes outside these ORM paths are not
automatically tracked and may remain stale until TTL expiry.

Include the recovered-success upload path when a lost commit acknowledgement is
verified as durable. When commit outcome cannot be verified, preserve the existing
refresh-before-retry behavior and avoid pretending the write failed definitively.

If invalidation fails after a commit, return the successful business result and
log the cache failure without secrets. Old results can remain until their TTL
expires, so a successful write does not guarantee immediate visibility when Redis
is unavailable. A backend crash between DB commit and invalidation has the same
bounded-staleness limitation. Strict visibility would require a transactional
outbox; it is outside this initial cache scope.

## Complexity and limits

A cache hit avoids the aggregation or manual-list database query, but permission
queries remain. Returning K rows still requires O(K) serialization, transfer,
and rendering; caching does not make the entire endpoint O(1). Cache misses retain
the existing DB cost. Lists still need pagination when dataset size demands it.
Start without Redis locks, Pub/Sub, or prewarming. Add stampede protection only
if concurrent miss traffic is measured to overload DB.

## Verification and activation (2026-10-08)

Test cache hit/miss, expiry, malformed payload, oversized bypass, post-commit
invalidation, rollback, old-reader/new-generation races, and Redis outages.
Verify permissions after membership removal/deactivation on cache hits. Use two
backend workers to verify shared invalidation. Measure DB query counts, cache
hit rate, response size, and p95 latency before/after.

After the administrator updated firewall rules, Redis PING succeeded from this
workstation. The ignored backend/.env now configures the supplied endpoint and
`manuel:development:cache:v1:` namespace; production must use its own prefix.
Redis server configuration was not changed. Run from the backend directory:

```powershell
..\.venv\Scripts\python.exe -m scripts.smoke_redis_cache
```

The live smoke passed PING, shared hits across two independent clients, TTL,
cross-client invalidation, old-fill isolation and expiry. It deletes only its
own disposable UUID-prefixed keys. It does not perform business DB writes.

Eleven cache regression tests pass, including malformed/deeply nested JSON,
payload bounds, outage cooldown, root commit/rollback, nested audit savepoints,
membership removal, filter isolation, publish invalidation and recovered commits.
The warmed route tests execute no `FROM manuals` queries for the cached list
and counts. Disabled Redis retains the existing single grouped project-list
query. These are isolated SQLite tests, not PostgreSQL EXPLAIN/load measurements.
The count map is still O(P) to decode for P projects; manual list responses remain
O(K) in returned rows. p95 latency and cache hit rates are not yet measured.

Frontend: 48 tests and TypeScript/production build passed. Full backend results
are recorded in the implementation plan; the existing audit-action-count test
expects 17 while the registry contains 18. Independent review found one important
deeply nested JSON fallback issue, fixed with a regression test; the conservative
savepoint invalidation noted above is an accepted performance tradeoff.

Reference: https://redis.io/docs/latest/develop/use-cases/cache-aside/
