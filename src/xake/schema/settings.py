from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="XAKE_", env_file=".env", extra="ignore")

    # UI language until the user picks one in the settings (spec 003).
    default_language: Literal["en", "fr"] = "en"
    stockfish_path: str = "stockfish"
    play_pool_size: int = Field(default=1, ge=1)
    analyse_pool_size: int = Field(default=2, ge=1)
    engine_threads: int = Field(default=1, ge=1)
    engine_hash_mb: int = Field(default=64, ge=1)
    play_movetime_ms: int = Field(default=300, ge=10)
    analyse_movetime_ms: int = Field(default=500, ge=10)
    # Upper bound on any client-requested movetime: the only CPU guard without auth (spec §3).
    max_movetime_ms: int = Field(default=3000, ge=10)
    acquire_timeout_s: float = Field(default=10.0, gt=0)
