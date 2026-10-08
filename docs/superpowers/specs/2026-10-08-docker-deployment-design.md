# Docker Deployment Design — Manual Management

Date: 2026-10-08

## Goal

Package the existing Manual Management app (FastAPI backend + React/Vite
frontend) into Docker containers and deploy them on the shared Docker host
(`10.153.90.17`), without colliding with ports already used by other apps
running on that host, and without disturbing the existing external
PostgreSQL/MinIO/Redis infrastructure the app depends on.

## Host survey

A `docker ps -a` sweep of the target host found ~50 existing containers.
Two defaults from this project's own README collide directly with containers
already running there:

- Host port `8000` (this app's documented backend port) is bound by
  `stencil-ai-backend`.
- Host port `5173` (this app's documented frontend dev port) is bound by
  `stencil-ai-frontend`.

The host also already runs the exact shared infrastructure this app's
`.env.example` points at:

- `shared-minio` container — network aliases `shared-minio` and `minio`,
  published on `9000-9001`, network `shared-minio_default`.
- `redis-server` container — network aliases `redis-server` and `redis`,
  published on `6379`, network `redis_default`.
- PostgreSQL at `10.151.28.2:5432` is a separate remote server, not a
  container on this host. Reachability confirmed with
  `Test-NetConnection -ComputerName 10.151.28.2 -Port 5432` → succeeded.

## Decisions

1. **Backend reaches MinIO/Redis via their existing docker networks**, not
   via the host IP. `manual-backend` joins the external networks
   `shared-minio_default` and `redis_default` and uses `MINIO_ENDPOINT=minio:9000`
   / `REDIS_URL=redis://redis:6379/0`. This matches what `.env.example`
   already documents ("`minio:9000` is intended for a backend on the MinIO
   internal network") and avoids a hairpin through the host's NAT.
2. **Only the frontend is exposed on the host.** `manual-frontend` (nginx)
   publishes a single host port and reverse-proxies `/api` and `/health` to
   `manual-backend:8000` over the compose-internal network. `manual-backend`
   publishes no host port — matching the README's own deployment guidance
   ("Proxy `/api` and `/health` to FastAPI on the same origin") and the
   pattern used by `odrreview`/`lss` on the same host.
3. **Frontend host port: `8013`.** Checked against every port currently
   bound on the host (`docker ps -a`, ~60 unique host ports) — free.
4. **No TLS inside the containers; `COOKIE_SECURE=false`.** Every other app
   on this host is plain HTTP on its published port with no shared
   TLS-terminating proxy in front of them. Matches that pattern.
5. **No migration step in this deploy.** The target PostgreSQL database
   already has schema `010_project_admin_role.sql` applied — confirmed live
   via `scripts/inspect_schema.py`: the `project_members_role_check`
   constraint already allows `'ADMIN'`. Containers only need to point at the
   existing, already-migrated database; nothing runs migrations at startup
   (unchanged project invariant).
6. **A Windows Firewall inbound rule for TCP 8013 is part of the deploy
   steps.** Several existing app ports on this host (e.g. `5180`, `5181`,
   `8012`) have no matching inbound-allow rule in the local firewall, and
   the `Public` profile's default inbound action is not explicitly set to
   allow. Rather than assume reachability from other machines, an explicit
   `New-NetFirewallRule` for `8013` is added so the frontend is reachable
   from other machines on the network without depending on an unverified
   assumption.

## Architecture

```
Browser → host:8013 (manual-frontend, nginx) ──serves built SPA──
                      │
                      └─ proxy_pass /api, /health → manual-backend:8000
                                      │             (compose network "manual_default")
                                      ├─ shared-minio_default network → minio:9000
                                      ├─ redis_default network → redis:6379
                                      └─ LAN → 10.151.28.2:5432 (PostgreSQL, external, unchanged)
```

- `manual-frontend`: multi-stage build — `node:24-alpine` runs `npm ci && npm run build`;
  result is served by `nginx:alpine`. Custom `nginx.conf` does SPA fallback
  (`try_files … /index.html`) and proxies `/api/` and `/health` to `backend:8000`.
  Published as `8013:80`.
- `manual-backend`: `python:3.13-slim`, installs `requirements.txt` (runtime
  deps only, not `requirements-dev.txt`), runs
  `uvicorn app.main:app --host 0.0.0.0 --port 8000` as a non-root user.
  No published port. `scripts/` and `migrations/` are included in the image
  so future migrations can still be run explicitly via
  `docker compose exec backend python scripts/migrate.py <file>.sql`,
  preserving the existing "no migration at startup" rule.
- Both services get a `HEALTHCHECK`: the backend's reuses the app's own
  `/health` endpoint (already checks DB + MinIO reachability).
- `restart: unless-stopped` on both, matching the long-running pattern of
  every sibling container on this host.

## Rejected alternatives

- **Single combined container** (nginx + uvicorn via a supervisor process).
  Rejected: breaks independent updates/scaling of frontend vs. backend, and
  no other app on this host is built this way.
- **FastAPI serving the built SPA directly** via `StaticFiles`, one
  container, one port. Rejected: would force exposing the backend's port
  directly to satisfy serving the UI, contradicting decision 2 above.

## Configuration changes for this deployment

Relative to `backend/.env.example`, the deployment `backend/.env` changes
two values (everything else — PostgreSQL host, MinIO credentials/bucket,
upload limits, session settings — is unchanged):

- `REDIS_URL`: `redis://10.153.90.17:6379/0` → `redis://redis:6379/0`
  (use the docker-network alias now that the backend joins `redis_default`).
- `CORS_ORIGINS`: `["http://localhost:5173","http://127.0.0.1:5173"]` →
  `["http://10.153.90.17:8013","http://localhost:8013"]` (the real origins
  browsers will use to reach the deployed frontend).

`MINIO_ENDPOINT` was already `minio:9000` in the example and needs no change
now that the backend joins `shared-minio_default`.

## Files added

- `backend/Dockerfile`, `backend/.dockerignore`, `backend/healthcheck.py`
- `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore`
- `docker-compose.yml` (repo root)

## Verification plan

1. `docker compose build`
2. `docker compose up -d`
3. `docker compose ps` — both containers healthy
4. `docker compose exec backend` has no bound host port (confirms decision 2
   actually took effect)
5. `curl http://127.0.0.1:8013/health` → `200`, reports database/minio connected
6. `curl http://127.0.0.1:8013/login` → serves the SPA shell
7. Open a Windows Firewall inbound rule for TCP `8013`
8. From another machine on the LAN, load `http://10.153.90.17:8013/login`,
   log in, open a project, exercise the existing upload/preview workflow as
   a smoke test
