import chess
from pydantic import ValidationError
from pytest import mark, raises

from xake.schema.api import Position


def test_initial_position() -> None:
    assert Position().board().fen() == chess.STARTING_FEN


def test_moves_are_replayed_with_history() -> None:
    position = Position(moves=["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"])
    board = position.board()
    assert board.fen().split()[0] == chess.STARTING_BOARD_FEN
    assert board.can_claim_threefold_repetition()


def test_start_fen() -> None:
    fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    assert Position(start_fen=fen, moves=["e2e4"]).board().piece_at(chess.E4) == chess.Piece.from_symbol("P")


def test_board_is_a_copy() -> None:
    position = Position(moves=["e2e4"])
    position.board().push_uci("e7e5")
    assert position.board().fullmove_number == 1


@mark.parametrize(
    "payload",
    [
        {"moves": ["e2e5"]},
        {"moves": ["e2e4", "e2e4"]},
        {"moves": ["xx"]},
        {"start_fen": "not a fen"},
        {"start_fen": "8/8/8/8/8/8/8/8 w - - 0 1"},
    ],
)
def test_invalid(payload: dict[str, object]) -> None:
    with raises(ValidationError):
        Position.model_validate(payload)
