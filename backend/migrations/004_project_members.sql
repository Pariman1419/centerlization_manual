-- Explicit project membership migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.project_members (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER')),
    added_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_members_project_user UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members(user_id);

-- Migrate every existing projects.owner_user_id into:
-- project_members(..., role='OWNER')
INSERT INTO public.project_members (project_id, user_id, role, added_by, created_at, updated_at)
SELECT p.id, p.owner_user_id, 'OWNER', p.owner_user_id, p.created_at, p.updated_at
FROM public.projects p
WHERE p.owner_user_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;

COMMIT;
