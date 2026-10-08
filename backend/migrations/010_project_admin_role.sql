-- Extend membership roles without changing existing members or system accounts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS chk_project_members_role;
ALTER TABLE public.project_members ADD CONSTRAINT chk_project_members_role
    CHECK (role IN ('ADMIN', 'OWNER', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER', 'BA', 'DEV', 'USER'));

COMMIT;
