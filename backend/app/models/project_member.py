from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.manual import utcnow


class ProjectMember(Base):
    __tablename__ = 'project_members'
    __table_args__ = (
        UniqueConstraint('project_id', 'user_id', name='uq_project_members_project_user'),
        CheckConstraint("role IN ('OWNER', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER', 'BA', 'DEV', 'USER', 'ADMIN')", name='chk_project_members_role'),
    )
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'), primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    role: Mapped[str] = mapped_column(String(20))
    added_by: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user = relationship('User', foreign_keys=[user_id], lazy='selectin')
    project = relationship('Project', foreign_keys=[project_id], back_populates='members', lazy='selectin')

    @property
    def username(self) -> str:
        return self.user.username if self.user else ''

    @property
    def display_name(self) -> str:
        return self.user.display_name if self.user else ''
