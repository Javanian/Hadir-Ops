import json
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database (MongoDB). Transactions need a replica set; a single-node set is
    # enough for development (see docker-compose.yml).
    MONGODB_URL: str = "mongodb://localhost:27017/?replicaSet=rs0"
    MONGODB_DB: str = "hadirops"

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
    FACE_ENABLED: bool = True
    FACE_MODEL_NAME: str = "buffalo_s"
    FACE_SIMILARITY_THRESHOLD: float = 0.3
    FACE_MAX_WIDTH: int = 640
    MAX_UPLOAD_BYTES: int = 5 * 1024 * 1024  # face photos; phones send well under 1 MB
    # A face token proves a successful verification. It is accepted for a
    # check-in or check-out whose event time is within this many minutes of
    # the verification, so a token fetched just before the signal dropped
    # still counts when the queued event is delivered later.
    FACE_TOKEN_WINDOW_MINUTES: int = 10

    # Offline and device-time handling
    OFFLINE_MAX_AGE_HOURS: int = 72          # older queued events are refused
    OFFLINE_THRESHOLD_SECONDS: int = 120     # event older than this = delivered late
    CLOCK_SKEW_TOLERANCE_SECONDS: int = 300  # device clock vs monotonic age

    # Geofence: a reading whose accuracy circle touches the site radius is
    # accepted and flagged for review. Accuracy beyond the cap is not trusted.
    GPS_ACCURACY_CAP_M: int = 150

    # Runtime
    ENVIRONMENT: str = "development"  # "production" enables startup checks
    AUTO_CHECKOUT_ENABLED: bool = True
    AUTO_CHECKOUT_INTERVAL_SECONDS: int = 60

    @property
    def cors_origins_list(self) -> List[str]:
        try:
            return json.loads(self.CORS_ORIGINS)
        except Exception:
            return ["http://localhost:3000"]

    def check_production_safety(self) -> None:
        """Refuse to start a production instance with development secrets."""
        if self.ENVIRONMENT.lower() != "production":
            return
        if self.SECRET_KEY.startswith("change-this") or len(self.SECRET_KEY) < 32:
            raise RuntimeError(
                "SECRET_KEY is the development default or shorter than 32 characters. "
                "Set a random SECRET_KEY before running with ENVIRONMENT=production."
            )

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
