from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.manual import utcnow


class Project(Base):
    __tablename__ = 'projects'
    __table_args__ = (CheckConstraint("status IN ('ACTIVE', 'ARCHIVED')", name='chk_projects_status'),)
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'), primary_key=True)
    project_code: Mapped[str] = mapped_column(String(100), unique=True)
    project_name: Mapped[str] = mapped_column(String(255))
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default='ACTIVE')
    created_by: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    members = relationship('ProjectMember', back_populates='project', cascade='all, delete-orphan')
