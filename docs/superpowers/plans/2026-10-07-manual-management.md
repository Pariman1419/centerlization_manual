# Manual Management Implementation Plan

**Goal:** Implement the user's complete manual upload, history, preview/download and publish flow.

**Architecture:** Two frontend pages, reusable forms/history, one API client. FastAPI routers operate directly on SQLAlchemy models and a small MinIO service. PostgreSQL owns current-revision metadata; files have immutable UUID keys.

**Tech Stack:** React, TypeScript, Vite, Tailwind; Python, FastAPI, SQLAlchemy, psycopg, Pydantic, MinIO SDK; existing PostgreSQL and MinIO.

**Spec:** User's implementation task; schema evidence in `docs/inspection.md`.

## Constraints and review focus

- Existing tables/bucket only; no destructive data operations or automatic schema creation.
- Environment-only credentials; browser receives temporary signed URLs only.
- PDF extension, MIME, signature and parser validation; 50 MB read limit; sanitize filenames.
- Row-lock publishing, preserve all files, archive previous publication and atomically update pointer.
- Clean up storage after failed insert; concurrent duplicates return 409.
- Check public endpoint signing, concurrent publish, invalid PDF, upload failures, filename traversal, missing records and safe error responses.

## Tasks

1. [x] Foundation: `backend/app/config.py`, `database.py`, `main.py`, models, schemas, `services/minio_service.py`; failing health tests, implement, run. Verify actual connectivity/bucket separately; apply reviewed migration from `backend/migrations/001_status_and_publish_guard.sql`.
2. [x] Manual API: `routers/manuals.py`, test creation/duplicate/read/filter/not-found, implement and run.
3. [x] Upload: multipart PDF validation/checksum/UUID/insert/cleanup in manual router; tests for success, duplicates, invalid files, limits and both failure paths; implement and run.
4. [x] Revision API: `routers/revisions.py`, history/current/metadata/preview/download and transactional publishing; tests for switching and preservation; implement and run.
5. [x] Frontend: `frontend/src/api/manuals.ts`, types, pages, shared forms/history/dialog/file actions. Tests for create, upload and publish confirmation/cancel/error handling; implement restrained slate/blue enterprise UI, run Vitest, typecheck and build.
6. [x] Verification: full suites, schema inspection, live uniquely named two-revision smoke fixture, signed URL retrieval, concurrent publication check. Keep smoke history/files available and identify fixture. Document start commands, results and limitations in README and implementation report.

Execution is continuous as requested. Use local test SQLite with fake storage for focused tests; prove PostgreSQL locking and real storage separately against an explicitly labelled live smoke manual. Do not delete smoke records or existing production data. No Git commits since this workspace has no Git repository.

## Execution record

All six tasks complete. Final evidence: 32 backend tests, 10 frontend tests, TypeScript/build, live two-revision smoke, HTTP proxy/API checks, PostgreSQL lock/constraint checks, MinIO retrieval/privacy and frontend credential scan passed. Independent review findings fixed: permissive legacy read DTO, safe legacy key segment, durable/in-flight commit verification before cleanup, and explicit exception logging. Details and limitations are in docs/implementation-report.md.
