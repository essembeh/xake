import shutil
from collections.abc import Iterator

from fastapi.testclient import TestClient
from pytest import fixture, skip

from xake.schema.settings import AppSettings
from xake.webapp import create_app


@fixture(scope="module")
def settings() -> AppSettings:
    out = AppSettings.model_validate({"play_movetime_ms": 50, "analyse_movetime_ms": 100, "acquire_timeout_s": 5})
    if shutil.which(out.stockfish_path) is None:
        skip(f"Stockfish not found ({out.stockfish_path}), run inside nix-shell or set XAKE_STOCKFISH_PATH")
    return out


@fixture(scope="module")
def client(settings: AppSettings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as out:
        yield out
