"""Read-only schema inspection; never creates tables or changes records."""
import json

from sqlalchemy import inspect, text

from app.database import get_engine


def main():
    with get_engine().connect() as connection:
        connection.execute(text('SET TRANSACTION READ ONLY'))
        inspector = inspect(connection)
        for table in ('users', 'user_sessions', 'projects', 'project_members', 'manuals', 'manual_revisions'):
            if not inspector.has_table(table):
                print(json.dumps({'table': table, 'exists': False}))
                continue
            result = {'table': table, 'columns': inspector.get_columns(table),
                'primary_key': inspector.get_pk_constraint(table),
                'foreign_keys': inspector.get_foreign_keys(table),
                'unique_constraints': inspector.get_unique_constraints(table),
                'checks': inspector.get_check_constraints(table), 'indexes': inspector.get_indexes(table),
                'row_count': connection.scalar(text(f'SELECT count(*) FROM {table}'))}
            print(json.dumps(result, default=str, indent=2))


if __name__ == '__main__':
    main()
