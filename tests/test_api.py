from fastapi.testclient import TestClient
from pytest import mark


def test_version(client: TestClient) -> None:
    response = client.get("/api/version")
    assert response.status_code == 200
    assert response.json()["version"]


def test_static_index(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "<title>Xake</title>" in response.text


def test_config_js_default_language(client: TestClient) -> None:
    response = client.get("/config.js")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")
    assert response.text.startswith(
        'window.XAKE_CONFIG = {"defaultLanguage": "en", "defaultElo": 1500, "playMovetimeMs": 300, '
    )


@mark.parametrize(
    "path",
    [
        "/apple-touch-icon.png",
        "/apple-touch-icon-precomposed.png",
        "/apple-touch-icon-240x240.png",
        "/apple-touch-icon-240x240-precomposed.png",
        "/favicon.ico",
    ],
)
def test_root_icons(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_unknown_apple_touch_variant(client: TestClient) -> None:
    assert client.get("/apple-touch-icon-foo.png").status_code == 404


def test_index_loads_config_before_main(client: TestClient) -> None:
    html = client.get("/").text
    assert html.index('src="config.js"') < html.index('src="js/main.js"')


def test_engine_routes_are_gone(client: TestClient) -> None:
    # Stockfish runs in the browser only (spec 005 §10)
    assert client.post("/api/move", json={"moves": [], "elo": 1500}).status_code in (404, 405)
    assert client.post("/api/analyse", json={"moves": []}).status_code in (404, 405)


def test_wasm_is_served_with_its_mime_type(client: TestClient) -> None:
    response = client.get("/vendor/stockfish/stockfish-19-lite-single.wasm")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/wasm"


@mark.parametrize("path", ["/", "/js/main.js", "/vendor/stockfish/stockfish-19-lite-single.wasm"])
def test_static_files_are_revalidated(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.headers["cache-control"] == "no-cache"
    assert client.get(path, headers={"If-None-Match": response.headers["etag"]}).status_code == 304
