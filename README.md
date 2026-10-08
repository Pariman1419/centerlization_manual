# Manual Management

Internal React + FastAPI application using the existing PostgreSQL `manual` database and private MinIO `manual` bucket. PostgreSQL stores metadata and the current revision pointer; MinIO stores immutable PDFs. No automatic table creation runs at startup.

Users log in and see only Projects they created, including each Project's Manuals and Revisions. Administrators see all Projects and can create user accounts. All Manuals has been removed from navigation; the old `/manuals` UI route redirects to Projects. Existing Manual APIs are retained with session authentication and ownership checks.

## Start Backend (PowerShell)

From this workspace:

```powershell
python -m venv .venv
python -m pip --python .\.venv\Scripts\python.exe install -r backend/requirements-dev.txt
Copy-Item backend/.env.example backend/.env
```

Edit `backend/.env` for the deployment. For local development, change `MINIO_ENDPOINT` to the host:port from `MINIO_PUBLIC_ENDPOINT`, without `http://`. The default `minio:9000` endpoint is intended for a backend on the MinIO internal network. The backend always signs browser URLs using `MINIO_PUBLIC_ENDPOINT`; that host must be accessible to BA browsers. Credentials remain backend-only. The local `.env` is already configured and is ignored by Git.

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

API documentation: http://127.0.0.1:8000/docs. Health: http://127.0.0.1:8000/health. Health returns 503 if PostgreSQL or the bucket is unavailable.

## Start Frontend

Open another terminal from the workspace:

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173/login. Log in, open a project, add a manual, then use the existing revision upload/preview/download/publish workflow. Vite proxies `/api` and `/health` to the local backend. There are no database or storage credentials in the frontend, and it needs no environment file.

The initial account is `admin`. Its unique generated password is the local `INITIAL_ADMIN_PASSWORD` value in the ignored `backend/.env`; it is not printed in logs or compiled into the frontend. After login, open **Users → Add User** to create BA accounts. Users create their own Projects; the Backend assigns ownership automatically.

For deployment, run `npm.cmd run build` and serve `frontend/dist` using your internal web server with SPA fallback to `index.html`. Proxy `/api` and `/health` to FastAPI on the same origin. Use HTTPS and set `COOKIE_SECURE=true`; false is for local HTTP development. Run Uvicorn under the existing process supervisor. Configure CORS only for actual frontend origins. No public bucket policy is needed.

## Database migration

Read-only inspection results are in `docs/inspection.md`. Both existing tables already had every required column, foreign key and ordinary index. One existing manual status check needed widening to include DRAFT/PUBLISHED while retaining ACTIVE/INACTIVE/ARCHIVED. The migration also adds a partial unique index guarding one PUBLISHED revision per manual, reusing an equivalent existing index when found. It changes no records and creates no tables or columns.

`backend/migrations/001_status_and_publish_guard.sql` has already been applied to the supplied database. It runs as a transaction with short lock/statement timeouts and can be rerun. To inspect or apply it explicitly in another environment with the same inspected schema:

```powershell
Set-Location backend
$env:PYTHONPATH='.'
..\.venv\Scripts\python.exe scripts/inspect_schema.py
..\.venv\Scripts\python.exe scripts/migrate.py
```

Inspect first. The migration fails and rolls back if there are conflicting published revisions; it does not silently rewrite existing history. Bucket `manual` already exists and is private; the application reports a missing bucket rather than inventing another one.

Project Management adds `backend/migrations/002_projects.sql`. It has also been explicitly applied and rerun against the supplied database. It creates `projects`, adds `manuals.project_id`, assigns previously unassigned manuals to the system `LEGACY` project, then enforces NOT NULL, a foreign key and an index. It preserves global manual-code uniqueness, existing revision rows, current pointers and all stored objects. No migration runs at application startup.

```powershell
# From backend, after inspecting the target schema:
$env:PYTHONPATH='.'
..\.venv\Scripts\python.exe scripts/migrate.py 002_projects.sql
```

Login and ownership add `003_users_and_ownership.sql`, explicitly applied and rerun on the supplied database. It creates `users` and `user_sessions`, then adds `projects.owner_user_id` with a foreign key and index. Passwords are hashed; session tokens are stored only as hashes. Untouched Projects without owners are administrator-only. On this workspace, the user explicitly requested deletion of the old test fixtures: exactly two Projects, two Manuals, four Revisions and four PDFs were removed; the deletion manifest is in `docs/deleted-test-fixtures.json`.

For another inspected environment, apply the migrations explicitly in order, then provision the first administrator:

```powershell
# From backend:
$env:PYTHONPATH='.'
..\.venv\Scripts\python.exe scripts/migrate.py 003_users_and_ownership.sql
..\.venv\Scripts\python.exe scripts/create_admin.py --username admin
# The command asks for a password privately. It never overwrites an existing admin.
# Alternatively configure INITIAL_ADMIN_PASSWORD only in the backend environment:
# ..\.venv\Scripts\python.exe scripts/create_admin.py --username admin --from-env
```

## API

All errors use `{"detail":"message"}`. Validation returns 400, missing sessions 401, invalid CSRF/admin access 403, missing or inaccessible records 404, duplicates 409, oversized uploads 413, busy password verification 429, upload storage failures 502, unavailable project-folder checks 503, and unexpected errors 500 without technical details. Protected API responses use Cache-Control: no-store.

Naming and upload rules are documented in [logic-validation.md](docs/logic-validation.md). Upload payloads are limited to `MAX_UPLOAD_MB` combined, not per attachment.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Database, MinIO and bucket health |
| POST | `/api/auth/login` | Username/password; HttpOnly cookie plus user and CSRF token |
| GET | `/api/auth/me` | Current authenticated user and CSRF token |
| POST | `/api/auth/logout` | Revoke session and clear cookie |
| GET | `/api/users` | Admin-only account list; no password hashes returned |
| POST | `/api/users` | Admin-only creation; USER or ADMIN; password at least 12 characters |
| GET | `/api/projects` | Owned Projects for USER, all for ADMIN; counts/search/status |
| POST | `/api/projects` | Create active project owned by the logged-in user; reject duplicate database codes or existing MinIO prefixes |
| GET | `/api/projects/{id}` | Project metadata and manual count |
| PUT | `/api/projects/{id}` | Update name, description or ACTIVE/ARCHIVED status; code changes require no manuals and an available MinIO prefix |
| GET | `/api/projects/{id}/manuals` | Project-scoped list; optional `search`, `category`, `status` |
| POST | `/api/projects/{id}/manuals` | Create manual in the URL project using existing validation |
| GET | `/api/manuals` | List; optional `search`, `category`, `status`, `project_id` |
| POST | `/api/manuals` | Create draft inside an accessible project; admin-only LEGACY fallback when project_id omitted |
| GET | `/api/manuals/{id}` | Metadata with current revision |
| GET | `/api/manuals/{id}/revisions` | History, newest upload first |
| POST | `/api/manuals/{id}/revisions` | Multipart `revision_no`, `revision_detail` plus at least one of `pdf_file` (PDF), `word_file` (.doc/.docx), `other_files` (up to 10 files of any non-executable type); draft. Migration `008_revision_files.sql` adds the `revision_files` table |
| GET | `/api/manuals/{id}/current` | Current published revision, 404 if unpublished |
| GET | `/api/revisions/{id}` | Revision metadata |
| GET | `/api/revisions/{id}/preview` | Ten-minute inline signed URL (PDF only); optional `?file_id=` selects one file |
| GET | `/api/revisions/{id}/download` | Ten-minute attachment signed URL; optional `?file_id=` |
| POST | `/api/revisions/{id}/publish` | Archive previous, publish selected, update pointer atomically |
| PUT | `/api/manuals/{id}` | CONTRIBUTOR+; edit title/category/description (manual code never changes) |
| PUT | `/api/revisions/{id}` | Edit detail text of a DRAFT/REJECTED revision (uploader or OWNER/ADMIN) |
| POST | `/api/revisions/{id}/withdraw` | IN_REVIEW back to DRAFT (submitter/uploader or OWNER/ADMIN) |
| DELETE | `/api/revisions/{id}` | Delete a revision of any status and its PDF (uploader with CONTRIBUTOR, or OWNER/ADMIN); deleting the published revision clears the manual's current pointer |
| DELETE | `/api/manuals/{id}` | OWNER/ADMIN; deletes the manual with all revisions (any status) and PDFs |

The existing consuming web can call `/api/manuals/{id}/current` and then request preview/download access for that revision ID using an authenticated user session. All descendants inherit Project ownership; direct URL requests do not bypass it. No existing consumer code was present in this workspace to modify.

## Validation and state rules

- Codes are unique and use letters/numbers/underscores/hyphens. Titles are required. Category/description are optional.
- Revision numbers are unique per manual. Numeric inputs normalize to at least two digits (`1` and `01` identify the same revision); alphanumeric numbers are supported.
- PDF extension, MIME, byte signature and PDF parse must pass. Empty, encrypted, unreadable and over-50-MB files are rejected. Body traffic is bounded before multipart data can fill temporary storage.
- New files use `{project_code}/{manual_code}/rev-{number padded to 3 digits}/{uuid}.pdf`. Unsafe legacy codes use `project-{id}` or `manual-{id}` for their respective segments. Existing `{manual_code}/rev-XXX/{uuid}.pdf` files remain in place; retrieval always uses the stored revision object key, even after project codes change. Original sanitized filenames, SHA-256 checksums and byte lengths are stored in PostgreSQL.
- Uploads are drafts and never change the current pointer. A failed database insert triggers a best-effort deletion of only the newly uploaded object after an independent database check confirms no durable row references it. A lost commit acknowledgement recovers the saved revision. When the commit outcome cannot be checked, the object is retained and logged for reconciliation; deleting it could break a committed revision. Cleanup failures are logged with the object key for operator follow-up.
- Publishing takes a PostgreSQL lock on the manual row, archives existing publications and changes the selected status and current pointer in one transaction. Repeated publication of the same current revision is idempotent. Archived revisions can be republished explicitly.
- The logged-in username supplies created_by/uploaded_by/published_by and ownership; clients cannot choose another owner's ID. DEFAULT_ACTOR remains a legacy configuration setting. Optional API_TOKEN still checks trusted gateway Bearer tokens, but does not bypass user authentication. Never put a shared gateway token into Vite.
- Sessions expire after SESSION_HOURS (default 8); cookies are HttpOnly/SameSite=Strict. Mutation requests send X-CSRF-Token, obtained from login/me and held in frontend memory. Passwords use salted scrypt; password work is bounded to two simultaneous derivations per backend process. Five failed account logins lock that account for 15 minutes. There is no public registration or anonymous user-management API.

## Verification

Redis caches project/manual counts for 15 seconds and project manual lists for
30 seconds. Configure `REDIS_URL` and an environment-specific
`REDIS_KEY_PREFIX` in `backend/.env`; an empty URL disables caching. Permission
checks always use the database. Root business commits change a shared generation;
Redis outages fall back to DB with short timeouts and a 10-second cooldown.
Payloads above 256 KiB bypass caching. When invalidation fails, cached results
can remain stale until TTL expiry. No shared Redis configuration or keyspace
flush is required. See [Redis cache implementation](docs/redis-cache-design.md)
for complexity, limitations and the isolated live smoke command.

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
$env:PYTHONPATH='.'
# With API running and INITIAL_ADMIN_PASSWORD configured: real users/ownership/storage.
# Temporary verification users, Projects, Manuals and PDFs are cleaned up afterwards.
..\.venv\Scripts\python.exe scripts/smoke_auth.py
```

```powershell
Set-Location frontend
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd audit
```

Current verification: **50 backend tests and 20 frontend tests passed**, TypeScript/build PASS and zero npm audit vulnerabilities. Tests use isolated SQLite and memory storage; new auth tests exercise real password/session/CSRF behavior. Live smoke passed with PostgreSQL, real HTTP and MinIO for two separate users, administrator visibility, every descendant access check, upload/preview/download/publish/current-pointer behavior, and scoped fixture cleanup. Browser admin Login/Users/form/Logout passed. Full browser PDF selection retains the previously documented extension file-access limitation.

The old Phase 1/2 fixtures were removed at the user's request. `docs/implementation-report.md`, `docs/project-management-report.md`, `scripts/smoke.py` and `scripts/smoke_projects.py` describe those historical checks. Use the current `scripts/smoke_auth.py` verification. See `docs/authentication-report.md` for the latest files, schema, test results and login instructions.
