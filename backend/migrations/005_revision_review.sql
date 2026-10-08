-- Revision review / approval workflow migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. Safely extend revision statuses
ALTER TABLE public.manual_revisions DROP CONSTRAINT IF EXISTS chk_manual_revision_status;
ALTER TABLE public.manual_revisions ADD CONSTRAINT chk_manual_revision_status
    CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED'));

-- 2. Add submission metadata if missing
ALTER TABLE public.manual_revisions ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(100);
ALTER TABLE public.manual_revisions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- 3. Create revision_reviews table
CREATE TABLE IF NOT EXISTS public.revision_reviews (
    id BIGSERIAL PRIMARY KEY,
    revision_id BIGINT NOT NULL REFERENCES public.manual_revisions(id) ON DELETE CASCADE,
    reviewer_id BIGINT NOT NULL REFERENCES public.users(id),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revision_reviews_revision_id ON public.revision_reviews(revision_id);
CREATE INDEX IF NOT EXISTS idx_revision_reviews_reviewer_id ON public.revision_reviews(reviewer_id);

COMMIT;
