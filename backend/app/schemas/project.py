from datetime import datetime
import re
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator

ProjectRole = Literal['OWNER', 'REVIEWER', 'CONTRIBUTOR', 'VIEWER']


def validate_code(value):
    if isinstance(value, str):
        value = value.strip()
        if not 1 <= len(value) <= 100 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', value):
            raise ValueError('Code must be 1-100 characters, start with an English letter or number, and use only English letters, numbers, underscores or hyphens (for example PRJ-001 or MAN-001)')
    return value


Code = Annotated[str, BeforeValidator(validate_code), Field(min_length=1, max_length=100)]


class ProjectCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    project_code: Code
    project_name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20000)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    project_code: Code | None = None
    project_name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20000)
    status: Literal['ACTIVE', 'ARCHIVED'] | None = None

    @field_validator('project_code', 'project_name', 'status')
    @classmethod
    def required_if_provided(cls, value):
        if value is None:
            raise ValueError('Must not be null')
        return value


class ProjectRead(BaseModel):
    owner_user_id: int | None = None
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_code: str
    project_name: str
    description: str | None
    status: str
    manual_count: int = 0
    my_role: str | None = None
    created_by: str
    created_at: datetime
    updated_at: datetime


class ProjectMemberCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    user_id: int | None = None
    username: str | None = None
    role: ProjectRole = 'VIEWER'


class ProjectMemberUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    role: ProjectRole


class ProjectMemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    user_id: int
    username: str
    display_name: str
    role: ProjectRole
    added_by: int | None = None
    created_at: datetime
    updated_at: datetime
