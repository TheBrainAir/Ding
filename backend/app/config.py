"""Runtime settings. Secrets come from backend/.env; model ids and the voice live in the DB."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The product name. Change it here and everything user-facing follows.
APP_NAME = "Ding"

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = ""
    elevenlabs_api_key: str = ""

    data_dir: Path = Field(default=BACKEND_DIR / "data", validation_alias="DING_DATA_DIR")
    # Embedding model weights are kept apart from data_dir so tests with a temp
    # data dir reuse the downloaded model.
    model_cache_dir: Path = Field(default=BACKEND_DIR / "data" / "models", validation_alias="DING_MODEL_CACHE")
    embedding_model: str = Field(
        default="sentence-transformers/paraphrase-multilingual-mpnet-base-v2", validation_alias="DING_EMBEDDING_MODEL"
    )

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # A guest session closes after an order was placed and the table went quiet
    # for this long, or after a long silence without any order.
    session_close_after_order_minutes: int = 10
    session_abandon_minutes: int = 120

    @property
    def db_path(self) -> Path:
        return self.data_dir / "ding.db"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def voice_enabled(self) -> bool:
        return bool(self.elevenlabs_api_key.strip())


settings = Settings()
