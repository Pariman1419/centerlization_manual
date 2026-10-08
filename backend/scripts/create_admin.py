"""Explicitly provision the first administrator; never runs at application startup."""
import argparse
from getpass import getpass
from pydantic import ValidationError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import get_settings
from app.database import get_engine
from app.models.user import User
from app.models import manual_revision, project  # Register related models for this standalone CLI.
from app.schemas.user import UserCreate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', default='admin')
    parser.add_argument('--from-env', action='store_true', help='Use INITIAL_ADMIN_PASSWORD from backend environment')
    args = parser.parse_args()
    with Session(get_engine()) as db:
        if db.scalar(select(User.id).where(User.role == 'ADMIN')):
            raise SystemExit('An administrator already exists; no accounts or passwords changed.')
        password = get_settings().initial_admin_password.get_secret_value() if args.from_env else getpass('Admin password (12+ characters): ')
        if not args.from_env and password != getpass('Confirm password: '):
            raise SystemExit('Passwords do not match.')
        try:
            payload = UserCreate(username=args.username, display_name='Administrator', password=password, role='ADMIN')
        except ValidationError as error:
            messages = ['.'.join(str(part) for part in item['loc']) + ': ' + item['msg']
                for item in error.errors(include_input=False, include_context=False)]
            raise SystemExit('Invalid administrator input: ' + '; '.join(messages)) from None
        db.add(User(**payload.model_dump(exclude={'password'}), password_hash=hash_password(payload.password)))
        db.commit()
    print(f'Administrator {payload.username} created. Password was not logged.')


if __name__ == '__main__':
    main()
