import json
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://hadirops:hadiropspass@localhost:5432/hadirops"
    DB_SCHEMA: str = "hadirops"

    # JWT
    SECRET_KEY: str = "change-this-secret-key-in-production-min-32-chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    CORS_ORIGINS: str = '["http://localhost:3000", "http://localhost:8000", "http://localhost:8080"]'
    CORS_ORIGIN_REGEX: str = (
        r"^https?://("
        r"localhost|127\.0\.0\.1|"
        r"10\.\d+\.\d+\.\d+|"
        r"192\.168\.\d+\.\d+|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|"
        r"100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+"
        r")(:\d+)?$"
    )

    # Login security
    MAX_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCK_MINUTES: int = 30

    # Rate limiting
    RATE_LIMIT_LOGIN: str = "10/minute"

    # Timezone — DEPRECATED: do not use for attendance/shift logic.
    # Timezone is now per-site (site.timezone). This setting is kept only for
    # backward compatibility and must not be used in any new business logic.
    TIMEZONE: str = "Asia/Jakarta"

    # Face Recognition (Phase 3)
    FACE_MODEL_NAME: str = "buffalo_s"
    FACE_SIMILARITY_THRESHOLD: float = 0.3
    FACE_MAX_WIDTH: int = 640

    @property
    def cors_origins_list(self) -> List[str]:
        try:
            return json.loads(self.CORS_ORIGINS)
        except Exception:
            return ["http://localhost:3000"]

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
