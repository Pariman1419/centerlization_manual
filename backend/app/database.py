from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.config import get_settings
from app.services import redis_cache  # Register shared post-commit invalidation hooks.


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine():
    return create_engine(get_settings().database_url, pool_pre_ping=True,
        connect_args={'connect_timeout': 5}, hide_parameters=True)


def get_db():
    with Session(get_engine(), expire_on_commit=False) as session:
        yield session
