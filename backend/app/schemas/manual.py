from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.manual_revision import RevisionRead
from app.schemas.project import Code


class ManualCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    # Optional: when omitted the server generates the code from the project and category.
    manual_code: Code | None = None
    title: str = Field(min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=20000)
    project_id: int | None = Field(default=None, gt=0)


class ManualUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=255)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=20000)


class ManualRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    project_code: str
    project_name: str
    manual_code: str
    title: str
    category: str | None
    description: str | None
    current_revision_id: int | None
    current_revision: RevisionRead | None
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
