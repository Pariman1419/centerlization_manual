-- Inspected schema: public.manuals already has every required column.
-- Preserve legacy statuses; no records are modified or deleted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.manuals DROP CONSTRAINT chk_manuals_status;
ALTER TABLE public.manuals ADD CONSTRAINT chk_manuals_status
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED', 'DRAFT', 'PUBLISHED'));

-- An existing equivalent guard must be reused, regardless of its name.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        JOIN pg_class t ON t.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'manual_revisions'
          AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 1
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'manual_id'
          AND pg_get_expr(i.indpred, i.indrelid) IN (
              '(status = ''PUBLISHED''::text)',
              '((status)::text = ''PUBLISHED''::text)',
              '(status = ''PUBLISHED''::character varying)'
          )
    ) THEN
        CREATE UNIQUE INDEX uq_manual_revisions_one_published
        ON public.manual_revisions (manual_id) WHERE status = 'PUBLISHED';
    END IF;
END $$;
COMMIT;
