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
    comment: str | None = Field(default=None, max_length=20000)
    expected_version: int | None = Field(default=None, ge=0)


class RevisionVersionInput(BaseModel):
    expected_version: int = Field(ge=0)


class DevReviewInput(RevisionVersionInput):
    changes_requested: bool
    comment: str | None = Field(default=None, max_length=20000)


class RevisionUpdateEventRead(BaseModel):
    id: int
    action: str
    actor_username: str | None
    created_at: datetime
    details: dict | None


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
    content_version: int = 0
    ba_updated_by: str | None = None
    updated_at: datetime | None = None
    dev_review_requested: bool = False
    dev_reviewed_by: str | None = None
    dev_reviewed_at: datetime | None = None
    dev_changes_requested: bool | None = None
    dev_review_comment: str | None = None
    submitted_by: str | None = None
    submitted_at: datetime | None = None
    published_by: str | None
    published_at: datetime | None
    files: list[RevisionFileRead] = []


class FileAccess(BaseModel):
    url: str
    expires_in: int = 600
