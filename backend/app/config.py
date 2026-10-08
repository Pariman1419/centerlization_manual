from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / '.env', extra='ignore',
    )
    postgres_host: str
    postgres_port: int = 5432
    postgres_db: str
    postgres_user: str
    postgres_password: SecretStr
    minio_endpoint: str
    minio_public_endpoint: str
    minio_access_key: SecretStr
    minio_secret_key: SecretStr
    minio_bucket: str = 'manual'
    minio_secure: bool = False
    minio_region: str = 'us-east-1'
    max_upload_mb: int = Field(default=50, ge=1, le=50)
    default_actor: str = Field(default='BA', min_length=1, max_length=100)
    api_token: SecretStr = SecretStr('')
    session_hours: int = Field(default=8, ge=1, le=24)
    cookie_secure: bool = False
    initial_admin_password: SecretStr = SecretStr('')
    redis_url: SecretStr = SecretStr('')
    redis_key_prefix: str = Field(default='manuel:development:cache:v1:', pattern=r'^[A-Za-z0-9:_-]{1,100}:$')
    cors_origins: list[str] = ['http://localhost:5173', 'http://127.0.0.1:5173']

    @property
    def database_url(self) -> URL:
        return URL.create('postgresql+psycopg', username=self.postgres_user,
            password=self.postgres_password.get_secret_value(), host=self.postgres_host,
            port=self.postgres_port, database=self.postgres_db)


@lru_cache
def get_settings() -> Settings:
    return Settings()
