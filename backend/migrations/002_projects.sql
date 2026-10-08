-- Incremental, explicit migration. No revision rows, old object keys or files change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.projects (
    id BIGSERIAL PRIMARY KEY,
    project_code VARCHAR(100) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_project_code UNIQUE (project_code),
    CONSTRAINT chk_projects_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

ALTER TABLE public.manuals ADD COLUMN IF NOT EXISTS project_id BIGINT;

-- Also keeps the existing project-less POST /api/manuals endpoint compatible.
INSERT INTO public.projects (project_code, project_name, description, created_by)
VALUES ('LEGACY', 'Legacy / Unassigned Manuals',
    'Manuals created before Project Management was introduced.', 'SYSTEM')
ON CONFLICT (project_code) DO NOTHING;

UPDATE public.manuals
SET project_id = (SELECT id FROM public.projects WHERE project_code = 'LEGACY')
WHERE project_id IS NULL;

ALTER TABLE public.manuals ALTER COLUMN project_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.manuals'::regclass
          AND c.confrelid = 'public.projects'::regclass AND c.contype = 'f'
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.manuals'::regclass AND attname = 'project_id')]
          AND c.confkey = ARRAY[(SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.projects'::regclass AND attname = 'id')]
    ) THEN
        ALTER TABLE public.manuals ADD CONSTRAINT fk_manuals_project
            FOREIGN KEY (project_id) REFERENCES public.projects(id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = 'public.manuals'::regclass AND i.indisvalid
          AND i.indpred IS NULL
          AND pg_get_indexdef(i.indexrelid, 1, true) = 'project_id'
    ) THEN
        CREATE INDEX idx_manuals_project_id ON public.manuals(project_id);
    END IF;
END $$;

COMMIT;
