# Manual Management implementation report

Verified 7 October 2026. Running locally at http://127.0.0.1:5173/manuals; API at http://127.0.0.1:8000.

## 1. Files created

- Root: `.gitignore`, `README.md`.
- Backend setup: `.env.example`, ignored local `.env`, `requirements.txt`, `requirements-dev.txt`, `pytest.ini`.
- `backend/app`: `main.py`, `config.py`, `database.py`; models `manual.py`, `manual_revision.py`; schemas `manual.py`, `manual_revision.py`; routers `manuals.py`, `revisions.py`; service `minio_service.py`; package `__init__.py` files.
- Backend migration/scripts: `migrations/001_status_and_publish_guard.sql`; `scripts/inspect_schema.py`, `migrate.py`, `smoke.py`.
- Backend tests: `conftest.py`, `test_foundation.py`, `test_manuals.py`, `test_revisions.py`, `test_security.py`.
- Frontend setup: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`.
- `frontend/src`: `main.tsx`, `App.tsx`, `styles.css`, `api/manuals.ts`, `types/manual.ts`; pages `ManualsPage.tsx`, `ManualDetailPage.tsx`; components `Dialog.tsx`, `ManualForm.tsx`, `UploadRevisionModal.tsx`, `RevisionHistory.tsx`, `PdfPreview.tsx`, `StatusBadge.tsx`.
- Frontend tests: `src/test/setup.ts`, `workflows.test.tsx`, `file-access.test.tsx`.
- Documentation: `docs/inspection.md`, `docs/superpowers/plans/2026-10-07-manual-management.md`, this report.

Dependencies, production build and ignored smoke result are generated artifacts.

## 2. Files modified

No pre-existing source files: the workspace was empty. Newly created files were refined during implementation and review.

## 3. Database changes

Inspected columns, lengths, primary/foreign keys, indexes, checks, triggers and row counts first. Both tables contained zero rows and already had every required column. Reused `manuals` and `manual_revisions`.

Applied the separate migration: widened `chk_manuals_status` to allow DRAFT/PUBLISHED while retaining ACTIVE/INACTIVE/ARCHIVED; added partial unique index `uq_manual_revisions_one_published`. Existing constraints/indexes remain. No database, table or column was created; no table or record was dropped, truncated or deleted. Migration is explicit, transactional, repeatable and never runs at startup.

Created one labelled smoke manual with two revisions; retained its history and files for review.

## 4. API endpoints

- `GET /health`
- `GET /api/manuals`, `POST /api/manuals`
- `GET /api/manuals/{manual_id}`
- `GET /api/manuals/{manual_id}/revisions`, `POST /api/manuals/{manual_id}/revisions`
- `GET /api/manuals/{manual_id}/current`
- `GET /api/revisions/{revision_id}`
- `GET /api/revisions/{revision_id}/preview`
- `GET /api/revisions/{revision_id}/download`
- `POST /api/revisions/{revision_id}/publish`

Safe, consistent `detail` errors. Statuses include 201, 400, 404, 409, 413, 500, 502 and 503. See README for request/response behavior and filters.

## 5. MinIO object structure

Existing private bucket `manual`: `{manual_code}/rev-{number padded to 3 digits}/{uuid}.pdf`. Unsafe legacy codes use `manual-{id}` as the first segment. Sanitized original filenames, byte length and SHA-256 are stored in PostgreSQL. Publishing never overwrites/deletes a file. URLs are signed for the public endpoint and expire after 600 seconds.

## 6. Tests executed

- Backend pytest suite; frontend Vitest suite; TypeScript check; production build; production npm dependency audit.
- Live upload/publish smoke and final fixture recheck, including concurrent publication, current pointer and both revisions.
- Direct HTTP checks through backend port 8000 and frontend proxy port 5173.
- Live PostgreSQL constraints/index verification and recovery row-lock waiting for the original transaction.
- MinIO bucket/policy/stat checks, signed preview/download retrieval, content disposition, SHA-256 and exact bytes.
- Browser review of list, current/history, upload dialog and cancellation.
- Credential scan of frontend source/built assets; independent code review with regression fixes.

## 7. Test results

**32 backend tests passed; 10 frontend tests passed. TypeScript check and production build passed. Production npm audit: zero vulnerabilities. Live database, API and MinIO checks passed.**

The retained fixture is manual **1**, code **SMOKE-20261007-041544-1d2808**, revision IDs **1 and 2**. REV 01 is ARCHIVED; REV 02 is PUBLISHED; `current_revision_id=2`. Both one-page blank PDF files remain retrievable.

Business tests cover required creation/duplicate/missing behavior, PDF validation, upload failures, cleanup, history, publication switching and rollback. Added regressions cover legacy reads, unsafe legacy paths, lost commit acknowledgements, uncertain commit retention, chunked request limits and backend logging. All review findings were resolved.

One non-failing dependency warning remains: current Starlette deprecates httpx-backed TestClient in favor of httpx2.

## 8. Remaining risks/issues

- User SSO/per-user audit identity is outside scope. `DEFAULT_ACTOR` and optional trusted gateway token are structural integration points. Deployment needs internal network/access protection.
- Existing consuming web code was absent. Current-revision/file-access endpoints are ready, but its client integration could not be modified or verified here.
- If commit outcome cannot be verified, the PDF is retained and logged for reconciliation. Cleanup failures are also logged. No background infrastructure was added.
- Local servers are development processes. Production needs the existing supervisor/web server to serve `frontend/dist` and proxy the API. BA browsers must reach the configured public MinIO endpoint.
- Smoke fixture is intentionally visible under category Verification and was not deleted.

## 9. Start Backend

Dependencies and ignored local `.env` are configured. From the workspace root:

```powershell
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Fresh installation/configuration instructions are in README. Local `.env` uses the supplied network MinIO endpoint; `minio:9000` is for internal deployment.

## 10. Start Frontend

From the workspace root in another terminal:

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173/manuals. Complete setup, API table, migration and verification commands are in README.
