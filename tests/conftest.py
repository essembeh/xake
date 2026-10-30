from collections.abc import Iterator

from fastapi.testclient import TestClient
from pytest import fixture

from xake.schema.settings import AppSettings
from xake.webapp import create_app


@fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(create_app(AppSettings.model_validate({}))) as out:
        yield out
