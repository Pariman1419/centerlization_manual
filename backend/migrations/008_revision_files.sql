-- A revision can hold several files: Word, PDF and any other attachments. Additive only.
-- The existing manual_revisions file columns keep describing the primary file.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.revision_files (
    id BIGSERIAL PRIMARY KEY,
    revision_id BIGINT NOT NULL REFERENCES public.manual_revisions(id) ON DELETE CASCADE,
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('WORD', 'PDF', 'OTHER')),
    file_name VARCHAR(255) NOT NULL,
    object_key VARCHAR(1000) NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(150),
    checksum VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_revision_files_revision_id ON public.revision_files(revision_id);

-- Existing revisions were all uploaded as PDFs.
INSERT INTO public.revision_files (revision_id, kind, file_name, object_key, file_size, mime_type, checksum, created_at)
SELECT r.id, 'PDF', r.file_name, r.object_key, r.file_size, COALESCE(r.mime_type, 'application/pdf'), r.checksum, r.uploaded_at
FROM public.manual_revisions r
WHERE NOT EXISTS (SELECT 1 FROM public.revision_files f WHERE f.revision_id = r.id);
COMMIT;
