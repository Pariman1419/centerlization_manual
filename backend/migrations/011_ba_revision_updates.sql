-- Add BA update and optional Dev review metadata. Existing revisions retain the original workflow.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.manual_revisions
    ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ba_updated_by varchar(100),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS dev_review_requested boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS dev_reviewed_by varchar(100),
    ADD COLUMN IF NOT EXISTS dev_reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS dev_changes_requested boolean,
    ADD COLUMN IF NOT EXISTS dev_review_comment text;

COMMIT;
