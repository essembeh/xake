import chess
from fastapi.testclient import TestClient
from pytest import mark

FOOL_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def test_version(client: TestClient) -> None:
    response = client.get("/api/version")
    assert response.status_code == 200
    assert response.json()["version"]


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@mark.parametrize("elo", [400, 1000, 1500, 3190])
def test_move_is_legal(client: TestClient, elo: int) -> None:
    response = client.post("/api/move", json={"moves": ["e2e4"], "elo": elo})
    assert response.status_code == 200
    move = chess.Move.from_uci(response.json()["uci"])
    board = chess.Board()
    board.push_uci("e2e4")
    assert move in board.legal_moves
    assert response.json()["san"] == board.san(move)


def test_move_on_game_over(client: TestClient) -> None:
    response = client.post("/api/move", json={"moves": FOOL_MATE, "elo": 1500})
    assert response.status_code == 409


def test_move_illegal_position(client: TestClient) -> None:
    response = client.post("/api/move", json={"moves": ["e2e5"], "elo": 1500})
    assert response.status_code == 422


def test_analyse_multipv(client: TestClient) -> None:
    response = client.post("/api/analyse", json={"moves": ["e2e4"], "multipv": 3})
    assert response.status_code == 200
    analysis = response.json()
    assert len(analysis["lines"]) == 3
    assert analysis["depth"] > 0
    assert analysis["score"] == analysis["lines"][0]["score"]
    assert analysis["outcome"] is None
    assert all(line["pv_san"][0] == line["san"] for line in analysis["lines"])
    assert all(len(line["pv_san"]) > 1 for line in analysis["lines"])


def test_analyse_score_is_white_pov(client: TestClient) -> None:
    # Black to move, a queen up for White: the score must stay positive.
    fen = "4k3/8/8/8/8/8/8/3QK3 b - - 0 1"
    analysis = client.post("/api/analyse", json={"start_fen": fen, "multipv": 1}).json()
    score = analysis["score"]
    assert (score["cp"] or 0) > 300 or (score["mate"] or 0) > 0


def test_analyse_mate_in_one(client: TestClient) -> None:
    analysis = client.post("/api/analyse", json={"moves": FOOL_MATE[:3], "multipv": 1}).json()
    assert analysis["lines"][0]["san"] == "Qh4#"
    assert analysis["score"]["mate"] == -1


def test_analyse_terminal(client: TestClient) -> None:
    analysis = client.post("/api/analyse", json={"moves": FOOL_MATE, "multipv": 3}).json()
    assert analysis["lines"] == []
    assert analysis["score"] is None
    assert analysis["outcome"] == {"result": "0-1", "termination": "checkmate"}


def test_static_index(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "<title>Xake</title>" in response.text


@mark.parametrize(
    "moves", [[], ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f6e4", "d2d4"]]
)
def test_analyse_lines_are_distinct_and_ordered(client: TestClient, moves: list[str]) -> None:
    analysis = client.post("/api/analyse", json={"moves": moves, "multipv": 5}).json()
    firsts = [line["uci"] for line in analysis["lines"]]
    assert len(firsts) == 5
    assert len(set(firsts)) == len(firsts)
    sign = 1 if len(moves) % 2 == 0 else -1
    values = [sign * (line["score"]["cp"] or 0) for line in analysis["lines"]]
    assert values == sorted(values, reverse=True)


def test_analyse_few_legal_moves(client: TestClient) -> None:
    # Only Kg8 is legal: multipv is capped by the move count.
    fen = "7k/8/5Q1K/8/8/8/8/8 b - - 0 1"
    analysis = client.post("/api/analyse", json={"start_fen": fen, "multipv": 5}).json()
    assert [line["san"] for line in analysis["lines"]] == ["Kg8"]


def test_config_js_default_language(client: TestClient) -> None:
    response = client.get("/config.js")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/javascript")
    assert response.text.startswith('window.XAKE_CONFIG = {"defaultLanguage": "en", "version": ')


def test_index_loads_config_before_main(client: TestClient) -> None:
    html = client.get("/").text
    assert html.index('src="config.js"') < html.index('src="js/main.js"')
