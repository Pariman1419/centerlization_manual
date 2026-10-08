-- Explicit authentication migration. No startup migration or destructive data changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions(expires_at);

-- Unassigned existing Projects are administrator-only; new Projects always have an owner.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS owner_user_id BIGINT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.projects'::regclass
          AND c.confrelid = 'public.users'::regclass AND c.contype = 'f'
          AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
              WHERE attrelid = 'public.projects'::regclass AND attname = 'owner_user_id')]
    ) THEN
        ALTER TABLE public.projects ADD CONSTRAINT fk_projects_owner
            FOREIGN KEY (owner_user_id) REFERENCES public.users(id);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_projects_owner_user_id ON public.projects(owner_user_id);
COMMIT;
