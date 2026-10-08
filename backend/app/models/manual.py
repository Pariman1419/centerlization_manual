from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Manual(Base):
    __tablename__ = 'manuals'
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'), primary_key=True)
    manual_code: Mapped[str] = mapped_column(String(100), unique=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id'), index=True)
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    current_revision_id: Mapped[int | None] = mapped_column(ForeignKey('manual_revisions.id'))
    status: Mapped[str] = mapped_column(String(20), default='DRAFT')
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    current_revision = relationship('ManualRevision', foreign_keys=[current_revision_id], lazy='selectin')
    project = relationship('Project', lazy='selectin')

    @property
    def project_code(self):
        return self.project.project_code

    @property
    def project_name(self):
        return self.project.project_name
