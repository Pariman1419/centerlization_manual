from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.manual import utcnow


class ManualRevision(Base):
    __tablename__ = 'manual_revisions'
    __table_args__ = (
        UniqueConstraint('manual_id', 'revision_no', name='uq_manual_revision'),
        CheckConstraint(
            "status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'ARCHIVED')",
            name='chk_manual_revision_status',
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'), primary_key=True)
    manual_id: Mapped[int] = mapped_column(ForeignKey('manuals.id'))
    revision_no: Mapped[str] = mapped_column(String(50))
    revision_detail: Mapped[str | None] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255))
    object_key: Mapped[str] = mapped_column(String(1000))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    checksum: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(20), default='DRAFT')
    uploaded_by: Mapped[str] = mapped_column(String(100))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    submitted_by: Mapped[str | None] = mapped_column(String(100))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[str | None] = mapped_column(String(100))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    reviews = relationship('RevisionReview', back_populates='revision', cascade='all, delete-orphan', lazy='selectin')
    files = relationship('RevisionFile', back_populates='revision', cascade='all, delete-orphan', lazy='selectin',
        order_by='RevisionFile.id')

    @property
    def all_object_keys(self):
        return {self.object_key, *(f.object_key for f in self.files)}


class RevisionFile(Base):
    """One stored file of a revision: a Word document, a PDF, or any other attachment."""
    __tablename__ = 'revision_files'
    __table_args__ = (CheckConstraint("kind IN ('WORD', 'PDF', 'OTHER')", name='chk_revision_files_kind'),)
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'), primary_key=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey('manual_revisions.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    file_name: Mapped[str] = mapped_column(String(255))
    object_key: Mapped[str] = mapped_column(String(1000))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    mime_type: Mapped[str | None] = mapped_column(String(150))
    checksum: Mapped[str | None] = mapped_column(String(128))
    label: Mapped[str | None] = mapped_column(String(100))  # what an OTHER file is, e.g. 'Excel', 'Drawing'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    revision = relationship('ManualRevision', back_populates='files')

