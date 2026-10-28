from pydantic import ValidationError
from pytest import MonkeyPatch, raises

from xake.schema.settings import AppSettings


def test_default_language_from_env(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_DEFAULT_LANGUAGE", "fr")
    assert AppSettings.model_validate({}).default_language == "fr"


def test_default_language_is_english() -> None:
    assert AppSettings.model_validate({}).default_language == "en"


def test_unknown_language_is_rejected(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("XAKE_DEFAULT_LANGUAGE", "eu")
    with raises(ValidationError):
        AppSettings.model_validate({})
