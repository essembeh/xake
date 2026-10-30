from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Stockfish's Elo range in the browser engine (spec 001 §4)
MIN_ELO = 400
MAX_ELO = 3190


class AppSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="XAKE_", env_file=".env", extra="ignore")

    # UI language until the user picks one in the settings (spec 003).
    default_language: Literal["en", "fr"] = "en"
    # Stockfish level of a first visit; then each browser remembers the last level chosen (spec 001 §6.1).
    default_elo: int = Field(default=1500, ge=MIN_ELO, le=MAX_ELO)
    # Thinking time of the opponent per move, in the player's browser (spec 005).
    play_movetime_ms: int = Field(default=300, ge=10, le=10_000)
