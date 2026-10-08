from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.manual import utcnow

_ID = BigInteger().with_variant(Integer, 'sqlite')


class AuditLog(Base):
    __tablename__ = 'audit_logs'
    id: Mapped[int] = mapped_column(_ID, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey('projects.id', ondelete='SET NULL'), index=True)
    manual_id: Mapped[int | None] = mapped_column(ForeignKey('manuals.id', ondelete='SET NULL'), index=True)
    revision_id: Mapped[int | None] = mapped_column(ForeignKey('manual_revisions.id', ondelete='SET NULL'), index=True)
    target_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    details: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB, 'postgresql'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
