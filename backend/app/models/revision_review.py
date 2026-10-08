from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.manual import utcnow


class RevisionReview(Base):
    __tablename__ = 'revision_reviews'
    __table_args__ = (
        CheckConstraint("decision IN ('APPROVED', 'REJECTED')", name='chk_revision_reviews_decision'),
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, 'sqlite'), primary_key=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey('manual_revisions.id', ondelete='CASCADE'), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey('users.id'), index=True)
    decision: Mapped[str] = mapped_column(String(20))
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    revision = relationship('ManualRevision', back_populates='reviews')
    reviewer = relationship('User', lazy='selectin')

    @property
    def reviewer_username(self) -> str | None:
        return self.reviewer.username if self.reviewer else None

    @property
    def reviewer_display_name(self) -> str | None:
        return self.reviewer.display_name if self.reviewer else None
