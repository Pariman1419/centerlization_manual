import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models.audit_log import AuditLog
from app.models.manual import Manual
from app.models.project import Project
from app.models.user import User
from app.services.audit import ACTIONS, AuditAction, AuditError, sanitize_details, write_audit_event


@pytest.fixture
def db():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


@pytest.fixture
def world(db):
    actor = User(username='actor', display_name='A', password_hash='x', role='ADMIN')
    target = User(username='target', display_name='T', password_hash='x')
    project = Project(project_code='P1', project_name='P', status='ACTIVE', created_by='actor')
    db.add_all([actor, target, project])
    db.commit()
    return actor, target, project


def test_row_has_actor_resource_ids_details_and_timestamp(db, world):
    actor, target, project = world
    before = datetime.now(timezone.utc) - timedelta(seconds=5)
    write_audit_event(db, AuditAction.MEMBER_ADDED, actor=actor, project=project, target_user=target.id,
        manual=7, revision=9, details={'role': 'EDITOR', 'tags': ['a', 'b'], 'n': 3})
    db.commit()
    row = db.scalars(select(AuditLog)).one()
    assert (row.actor_user_id, row.project_id, row.target_user_id) == (actor.id, project.id, target.id)
    assert row.action == 'MEMBER_ADDED' and row.details == {'role': 'EDITOR', 'tags': ['a', 'b'], 'n': 3}
    created = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)
    assert before <= created <= datetime.now(timezone.utc) + timedelta(seconds=5)


def test_optional_fields_and_system_actor(db):
    write_audit_event(db, AuditAction.PASSWORD_CHANGED)
    db.commit()
    row = db.scalars(select(AuditLog)).one()
    assert row.actor_user_id is None and row.details is None and row.project_id is None


def test_reserved_and_existing_actions_accepted_unknown_rejected(db):
    for name in ('PROJECT_CREATED', 'MANUAL_CREATED', 'REVISION_UPLOADED', 'REVISION_PUBLISHED', 'MEMBER_ADDED',
            'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED', 'REVISION_SUBMITTED', 'REVISION_APPROVED',
            'REVISION_REJECTED', 'PASSWORD_RESET_BY_ADMIN', 'PASSWORD_CHANGED'):
        assert name in ACTIONS
    with pytest.raises(ValueError):
        write_audit_event(db, 'MADE_UP')
    assert db.scalars(select(AuditLog)).all() == []


def test_secrets_are_stripped_from_details_and_never_logged(db, caplog):
    details = {'code': 'P1', 'password': 'hunter2hunter2', 'temporary_password': 'tmp', 'password_hash': 'scrypt$x',
        'session_token': 's', 'Cookie': 'c', 'csrf_token': 'x', 'db_password': 'd', 'minio_secret_key': 'm',
        'nested': {'Authorization': 'Bearer z', 'ok': 'fine'}, 'items': [{'api_key': 'k', 'v': 1}]}
    with caplog.at_level(logging.DEBUG):
        write_audit_event(db, AuditAction.PROJECT_CREATED, details=details)
    db.commit()
    stored = db.scalars(select(AuditLog)).one().details
    assert stored == {'code': 'P1', 'nested': {'ok': 'fine'}, 'items': [{'v': 1}]}
    for secret in ('hunter2hunter2', 'scrypt$x', 'Bearer z'):
        assert secret not in str(stored) and secret not in caplog.text


def test_details_are_json_safe_and_bounded():
    clean = sanitize_details({'when': datetime(2026, 1, 1), 'long': 'x' * 5000, 'deep': {'a': {'b': {'c': {'d': 1}}}}})
    assert clean['long'] == 'x' * 1000 and isinstance(clean['when'], str)
    assert clean['deep']['a']['b']['c'] == '[truncated]'


def test_audit_row_shares_transaction_with_business_change(db, world):
    actor, _, project = world
    db.add(Manual(manual_code='M1', title='T', project_id=project.id, status='DRAFT', created_by='actor'))
    write_audit_event(db, AuditAction.MANUAL_CREATED, actor=actor, project=project)
    db.rollback()
    assert db.scalars(select(AuditLog)).all() == [] and db.scalars(select(Manual)).all() == []


def test_audit_failure_fails_closed_without_corrupting_session(db, world, monkeypatch, caplog):
    actor, _, project = world
    pending = Manual(manual_code='M2', title='T', project_id=project.id, status='DRAFT', created_by='actor')
    db.add(pending)

    def boom(self, *a, **k):
        raise RuntimeError('db down password=hunter2')
    monkeypatch.setattr(Session, 'flush', boom)
    with caplog.at_level(logging.DEBUG), pytest.raises(AuditError):
        write_audit_event(db, AuditAction.MANUAL_CREATED, actor=actor, details={'x': 1})
    assert 'hunter2' not in caplog.text
    monkeypatch.undo()
    # Session still usable and the caller's pending business row is intact and committable.
    assert write_audit_event(db, AuditAction.MANUAL_CREATED, actor=actor, best_effort=True) is not None
    db.commit()
    assert db.scalars(select(Manual).where(Manual.manual_code == 'M2')).one()
    assert len(db.scalars(select(AuditLog)).all()) == 1


def test_best_effort_swallows_failure(db, monkeypatch):
    monkeypatch.setattr(Session, 'flush', lambda self, *a, **k: (_ for _ in ()).throw(RuntimeError('x')))
    assert write_audit_event(db, AuditAction.PASSWORD_CHANGED, best_effort=True) is None
