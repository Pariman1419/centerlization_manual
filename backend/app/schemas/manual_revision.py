from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RevisionReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    revision_id: int
    reviewer_id: int
    reviewer_username: str | None = None
    reviewer_display_name: str | None = None
    decision: str
    comment: str | None = None
    created_at: datetime


class ReviewActionInput(BaseModel):
    comment: str | None = None


class RevisionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    revision_detail: str | None = Field(default=None, max_length=20000)


class RevisionFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    file_name: str
    file_size: int | None
    mime_type: str | None
    label: str | None = None


class RevisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    manual_id: int
    revision_no: str
    revision_detail: str | None
    file_name: str
    file_size: int | None
    mime_type: str | None
    checksum: str | None
    status: str
    uploaded_by: str
    uploaded_at: datetime
    submitted_by: str | None = None
    submitted_at: datetime | None = None
    published_by: str | None
    published_at: datetime | None
    files: list[RevisionFileRead] = []


class FileAccess(BaseModel):
    url: str
    expires_in: int = 600
