import chess
import chess.engine

from xake.engine import _deepest_complete


def info(depth: int, rank: int, uci: str) -> chess.engine.InfoDict:
    return {"depth": depth, "multipv": rank, "pv": [chess.Move.from_uci(uci)]}


def test_deepest_complete_depth_wins() -> None:
    by_depth = {
        10: {1: info(10, 1, "e2e4"), 2: info(10, 2, "d2d4")},
        11: {1: info(11, 1, "d2d4"), 2: info(11, 2, "e2e4")},
        12: {1: info(12, 1, "g1f3")},
    }
    assert [i["pv"][0].uci() for i in _deepest_complete(by_depth, 2)] == ["d2d4", "e2e4"]


def test_depth_with_a_repeated_move_is_skipped() -> None:
    # Interrupted iteration: rank 2 still holds the move that moved up to rank 1
    by_depth = {
        10: {1: info(10, 1, "e2e4"), 2: info(10, 2, "d2d4")},
        11: {1: info(11, 1, "d2d4"), 2: info(11, 2, "d2d4")},
    }
    assert [i["pv"][0].uci() for i in _deepest_complete(by_depth, 2)] == ["e2e4", "d2d4"]


def test_no_clean_depth_deduplicates_the_deepest() -> None:
    by_depth = {11: {1: info(11, 1, "d2d4"), 2: info(11, 2, "d2d4"), 3: info(11, 3, "c2c4")}}
    assert [i["pv"][0].uci() for i in _deepest_complete(by_depth, 3)] == ["d2d4", "c2c4"]


def test_empty() -> None:
    assert _deepest_complete({}, 3) == []
