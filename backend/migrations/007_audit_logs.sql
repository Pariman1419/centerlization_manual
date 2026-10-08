-- Lightweight audit trail. Additive only; no existing table is modified.
-- Foreign keys use ON DELETE SET NULL so audit rows survive deletion of business records
-- (the application never hard-deletes these today; membership/session rows are the only cascades).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    project_id BIGINT REFERENCES public.projects(id) ON DELETE SET NULL,
    manual_id BIGINT REFERENCES public.manuals(id) ON DELETE SET NULL,
    revision_id BIGINT REFERENCES public.manual_revisions(id) ON DELETE SET NULL,
    target_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON public.audit_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_manual ON public.audit_logs(manual_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_revision ON public.audit_logs(revision_id);
COMMIT;
