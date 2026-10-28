"""Pool of long-lived UCI engine processes, shared by stateless requests (spec §2)."""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass

import chess
import chess.engine
from loguru import logger

from .elo import strength_for
from .schema.api import Analysis, EngineMove, Line, Outcome, Score
from .schema.settings import AppSettings


class EngineError(Exception):
    """Base class for engine failures."""


class EngineBusyError(EngineError):
    """No engine became available within the acquire timeout."""


class EngineCrashedError(EngineError):
    """The engine process died during a command; it has been replaced."""


class GameOverError(Exception):
    """The position is terminal, there is no move to play."""


class EnginePool:
    """Fixed-size pool of engine processes; an engine is lent to one request at a time."""

    def __init__(
        self,
        name: str,
        command: str,
        size: int,
        options: Mapping[str, chess.engine.ConfigValue],
        acquire_timeout_s: float,
    ) -> None:
        self.name = name
        self.command = command
        self.size = size
        self.acquire_timeout_s = acquire_timeout_s
        self.options = dict(options)
        self._idle: asyncio.Queue[chess.engine.UciProtocol] = asyncio.Queue()
        self._engines: set[chess.engine.UciProtocol] = set()

    async def _spawn(self) -> chess.engine.UciProtocol:
        _, engine = await chess.engine.popen_uci(self.command)
        await engine.configure(self.options)
        self._engines.add(engine)
        return engine

    async def start(self) -> None:
        for _ in range(self.size):
            self._idle.put_nowait(await self._spawn())
        logger.info("Engine pool {}: {} x {}", self.name, self.size, self.command)

    async def close(self) -> None:
        for engine in self._engines:
            with contextlib.suppress(chess.engine.EngineError, asyncio.TimeoutError):
                await asyncio.wait_for(engine.quit(), timeout=2)
        self._engines.clear()

    async def _replace(self, engine: chess.engine.UciProtocol) -> None:
        self._engines.discard(engine)
        try:
            self._idle.put_nowait(await self._spawn())
        except Exception:
            logger.exception("Engine pool {}: cannot respawn engine, pool shrinks", self.name)

    @contextlib.asynccontextmanager
    async def acquire(self) -> AsyncIterator[chess.engine.UciProtocol]:
        try:
            async with asyncio.timeout(self.acquire_timeout_s):
                engine = await self._idle.get()
        except TimeoutError as error:
            raise EngineBusyError(f"no {self.name} engine available after {self.acquire_timeout_s}s") from error
        try:
            yield engine
        except chess.engine.EngineTerminatedError as error:
            logger.warning("Engine pool {}: engine died, respawning", self.name)
            await self._replace(engine)
            raise EngineCrashedError(str(error)) from error
        except BaseException:
            self._idle.put_nowait(engine)
            raise
        else:
            self._idle.put_nowait(engine)


@dataclass
class Engines:
    play_pool: EnginePool
    analyse_pool: EnginePool
    settings: AppSettings

    @classmethod
    def from_settings(cls, settings: AppSettings) -> "Engines":
        options: dict[str, chess.engine.ConfigValue] = {
            "Threads": settings.engine_threads,
            "Hash": settings.engine_hash_mb,
        }
        return cls(
            play_pool=EnginePool(
                "play", settings.stockfish_path, settings.play_pool_size, options, settings.acquire_timeout_s
            ),
            analyse_pool=EnginePool(
                "analyse", settings.stockfish_path, settings.analyse_pool_size, options, settings.acquire_timeout_s
            ),
            settings=settings,
        )

    async def start(self) -> None:
        await self.play_pool.start()
        await self.analyse_pool.start()

    async def close(self) -> None:
        await self.play_pool.close()
        await self.analyse_pool.close()

    def _movetime(self, requested_ms: int | None, default_ms: int) -> float:
        return min(requested_ms or default_ms, self.settings.max_movetime_ms) / 1000

    async def ping(self) -> None:
        async with self.analyse_pool.acquire() as engine:
            await engine.ping()

    async def best_move(self, board: chess.Board, elo: int, movetime_ms: int | None = None) -> EngineMove:
        if board.is_game_over():
            raise GameOverError(board.fen())
        strength = strength_for(elo)
        limit = chess.engine.Limit(
            time=self._movetime(movetime_ms, self.settings.play_movetime_ms), nodes=strength.nodes
        )
        async with self.play_pool.acquire() as engine:
            result = await engine.play(board, limit, options=strength.options)
        if result.move is None:
            raise GameOverError(board.fen())
        return EngineMove(uci=result.move.uci(), san=board.san(result.move))

    async def analyse(self, board: chess.Board, multipv: int, movetime_ms: int | None = None) -> Analysis:
        if (outcome := board.outcome()) is not None:
            return _terminal_analysis(outcome)
        limit = chess.engine.Limit(time=self._movetime(movetime_ms, self.settings.analyse_movetime_ms))
        by_depth: dict[int, dict[int, chess.engine.InfoDict]] = {}
        async with self.analyse_pool.acquire() as engine:
            with await engine.analysis(board, limit, multipv=multipv) as search:
                async for info in search:
                    # Bound-only infos carry a truncated PV (spec 001 §2): only exact ones are kept.
                    if "pv" in info and "depth" in info and not info.get("lowerbound") and not info.get("upperbound"):
                        by_depth.setdefault(info["depth"], {})[info.get("multipv", 1)] = info
        infos = _deepest_complete(by_depth, min(multipv, board.legal_moves.count()))
        lines = [line for info in infos if (line := _to_line(board, info)) is not None]
        return Analysis(
            score=lines[0].score if lines else None,
            depth=max((info.get("depth", 0) for info in infos), default=0),
            lines=lines,
        )


def _to_score(score: chess.engine.PovScore) -> Score:
    white = score.white()
    if white.is_mate():
        return Score(mate=white.mate())
    return Score(cp=white.score())


def _deepest_complete(
    by_depth: dict[int, dict[int, chess.engine.InfoDict]], expected: int
) -> list[chess.engine.InfoDict]:
    # A depth interrupted mid-iteration can repeat a move across ranks (spec 001 §2): skip it.
    for depth in sorted(by_depth, reverse=True):
        infos = [by_depth[depth][rank] for rank in sorted(by_depth[depth])]
        if len(infos) >= expected and len({info["pv"][0] for info in infos}) == len(infos):
            return infos
    if not by_depth:
        return []
    out: list[chess.engine.InfoDict] = []
    for rank in sorted(ranks := by_depth[max(by_depth)]):
        if all(info["pv"][0] != ranks[rank]["pv"][0] for info in out):
            out.append(ranks[rank])
    return out


def _to_line(board: chess.Board, info: chess.engine.InfoDict) -> Line | None:
    pv = info.get("pv")
    score = info.get("score")
    if not pv or score is None:
        return None
    pv_san: list[str] = []
    replay = board.copy(stack=False)
    for move in pv:
        pv_san.append(replay.san(move))
        replay.push(move)
    return Line(uci=pv[0].uci(), san=pv_san[0], score=_to_score(score), pv_san=pv_san)


def _terminal_analysis(outcome: chess.Outcome) -> Analysis:
    # No score on a terminal position: the client reads the outcome instead.
    return Analysis(
        score=None,
        depth=0,
        lines=[],
        outcome=Outcome(result=outcome.result(), termination=outcome.termination.name.lower()),
    )
