"""Explicitly apply the inspected, non-destructive migration. Never runs at startup."""
from pathlib import Path
import argparse

import psycopg

from app.config import get_settings

# Deterministic order. No history table exists: apply only migrations known to be pending
# (all are idempotent/additive, but never re-run blindly against a live database).
MIGRATIONS = ['001_status_and_publish_guard.sql', '002_projects.sql', '003_users_and_ownership.sql',
    '004_project_members.sql', '005_revision_review.sql', '006_password_reset.sql', '007_audit_logs.sql',
    '008_revision_files.sql', '009_revision_file_label.sql']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('migration', nargs='?', default='001_status_and_publish_guard.sql',
        choices=MIGRATIONS)
    args = parser.parse_args()
    settings = get_settings()
    migration = Path(__file__).resolve().parents[1] / 'migrations' / args.migration
    with psycopg.connect(host=settings.postgres_host, port=settings.postgres_port,
            dbname=settings.postgres_db, user=settings.postgres_user,
            password=settings.postgres_password.get_secret_value(), connect_timeout=5) as connection:
        connection.execute(migration.read_text())
    print(f'{args.migration} applied successfully.')


if __name__ == '__main__':
    main()
