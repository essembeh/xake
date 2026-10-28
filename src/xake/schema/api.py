from typing import Annotated, Self

import chess
from pydantic import BaseModel, Field, PrivateAttr, model_validator

from ..elo import MAX_ELO, MIN_ELO

UciMove = Annotated[str, Field(pattern=r"^[a-h][1-8][a-h][1-8][qrbn]?$")]


class Position(BaseModel):
    """A position as start FEN plus the moves played from it, validated against the rules."""

    start_fen: str | None = None
    moves: list[UciMove] = Field(default_factory=list, max_length=1000)

    _board: chess.Board = PrivateAttr(default_factory=chess.Board)

    @model_validator(mode="after")
    def _replay(self) -> Self:
        board = chess.Board()
        if self.start_fen is not None:
            try:
                board = chess.Board(self.start_fen)
            except ValueError as error:
                raise ValueError(f"invalid FEN: {error}") from error
            if not board.is_valid():
                raise ValueError(f"illegal position: {self.start_fen}")
        for index, uci in enumerate(self.moves):
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                raise ValueError(f"illegal move #{index}: {uci}")
            board.push(move)
        self._board = board
        return self

    def board(self) -> chess.Board:
        """A copy of the resulting board, history included (repetitions, 50-move rule)."""
        return self._board.copy()


class MoveRequest(Position):
    elo: int = Field(ge=MIN_ELO, le=MAX_ELO)
    movetime_ms: int | None = Field(default=None, ge=10)


class AnalyseRequest(Position):
    multipv: int = Field(default=3, ge=1, le=5)
    movetime_ms: int | None = Field(default=None, ge=10)


class EngineMove(BaseModel):
    uci: str
    san: str


class Score(BaseModel):
    """Always from White's point of view; exactly one of cp / mate is set."""

    cp: int | None = None
    mate: int | None = None


class Line(BaseModel):
    uci: str
    san: str
    score: Score
    pv_san: list[str]


class Outcome(BaseModel):
    result: str
    termination: str


class Analysis(BaseModel):
    score: Score | None
    depth: int
    lines: list[Line]
    outcome: Outcome | None = None
