from pydantic import ValidationError
from pytest import MonkeyPatch, raises

from xake.schema.settings import AppSettings


def test_default_language_from_env(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_DEFAULT_LANGUAGE", "fr")
    assert AppSettings.model_validate({}).default_language == "fr"


def test_default_language_is_english() -> None:
    assert AppSettings.model_validate({}).default_language == "en"


def test_default_elo_from_env(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_DEFAULT_ELO", "1200")
    assert AppSettings.model_validate({}).default_elo == 1200


def test_default_elo_out_of_range_is_rejected(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_DEFAULT_ELO", "5000")
    with raises(ValidationError):
        AppSettings.model_validate({})


def test_unknown_language_is_rejected(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_DEFAULT_LANGUAGE", "eu")
    with raises(ValidationError):
        AppSettings.model_validate({})


def test_play_movetime_from_env(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_PLAY_MOVETIME_MS", "500")
    assert AppSettings.model_validate({}).play_movetime_ms == 500
