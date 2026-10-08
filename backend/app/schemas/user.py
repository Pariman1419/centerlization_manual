from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.password_policy import MAX_LENGTH, validate_password


class LoginInput(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)

    @field_validator('username', mode='before')
    @classmethod
    def normalize_username(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class UserCreate(LoginInput):
    username: str = Field(min_length=1, max_length=100, pattern=r'^[a-z0-9][a-z0-9_.-]*$')
    password: str = Field(max_length=MAX_LENGTH)
    display_name: str = Field(min_length=1, max_length=255)
    role: Literal['USER', 'ADMIN', 'BA', 'DEV'] = 'USER'

    password_policy = field_validator('password')(validate_password)

    @field_validator('display_name', mode='before')
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    display_name: str
    role: Literal['USER', 'ADMIN', 'BA', 'DEV']
    is_active: bool
    must_change_password: bool = False
    created_at: datetime


class AuthRead(BaseModel):
    user: UserRead
    csrf_token: str


class ResetPasswordInput(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)
    temporary_password: str = Field(max_length=MAX_LENGTH)
    password_policy = field_validator('temporary_password')(validate_password)


class ChangePasswordInput(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True)
    current_password: str = Field(min_length=1, max_length=MAX_LENGTH)
    new_password: str = Field(max_length=MAX_LENGTH)
    password_policy = field_validator('new_password')(validate_password)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: Literal['USER', 'ADMIN', 'BA', 'DEV'] | None = None
    is_active: bool | None = None
