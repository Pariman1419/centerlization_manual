-- Describes what an OTHER file is (e.g. Excel, Drawing). Additive only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.revision_files ADD COLUMN IF NOT EXISTS label VARCHAR(100);
COMMIT;
