# Phase 1 inspection — 7 October 2026

Workspace was empty, with no Git repository, AGENTS.md, application, authentication, or reusable storage integration.

Read-only PostgreSQL inspection succeeded against database `manual`. Only `public.manuals` and `public.manual_revisions` are used. Both had zero rows. Both use bigint sequence primary keys and timezone-aware timestamps. Every logical column requested already exists under the requested name.

Manual limits: code 100, title 255, category 100, actor 100, status 20. Revision limits: number 50, filename 255, object key 1000, MIME 100, checksum 128, actor 100, status 20. Description and revision detail are text.

Existing constraints: unique manual_code; unique (manual_id, revision_no); revision manual foreign key with ON DELETE CASCADE; current revision foreign key with ON DELETE SET NULL; nonnegative file_size; revision statuses DRAFT/PUBLISHED/ARCHIVED. Existing manual status check allows ACTIVE/INACTIVE/ARCHIVED only. There are no triggers.

Existing indexes cover code, title, category, manual status, creation date, revision manual_id, revision status, upload date, (manual_id, uploaded_at DESC), and object_key. Do not duplicate these.

Required migration: widen the named manual status check to retain legacy values and permit DRAFT/PUBLISHED. Add a partial unique index allowing at most one PUBLISHED revision per manual, only if no equivalent index exists and no conflicting rows exist. No data changes, duplicate columns, duplicate tables, or startup create_all. Migration uses a transaction and short lock timeout.

Architecture: React → FastAPI routers → SQLAlchemy/PostgreSQL and one MinIO service. Public presigned URLs are signed for the configured public endpoint directly, never rewritten after signing. Backend uses the internal endpoint (network endpoint override for local development). Actor defaults to configured BA; authenticated gateway integration can supply a trusted identity later.
