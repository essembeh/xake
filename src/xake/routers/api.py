from importlib import metadata
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..engine import EngineError, Engines, GameOverError
from ..schema.api import AnalyseRequest, Analysis, EngineMove, MoveRequest

router = APIRouter(prefix="/api")


def get_engines(request: Request) -> Engines:
    engines: Engines = request.app.state.engines
    return engines


EnginesDep = Annotated[Engines, Depends(get_engines)]


@router.post("/move")
async def move(payload: MoveRequest, engines: EnginesDep) -> EngineMove:
    try:
        return await engines.best_move(payload.board(), payload.elo, payload.movetime_ms)
    except GameOverError as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "game is over") from error
    except EngineError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error


@router.post("/analyse")
async def analyse(payload: AnalyseRequest, engines: EnginesDep) -> Analysis:
    try:
        return await engines.analyse(payload.board(), payload.multipv, payload.movetime_ms)
    except EngineError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error


@router.get("/version")
async def version() -> dict[str, str]:
    # Engine-free on purpose: used by Kubernetes probes, which must not wait for a busy pool.
    return {"version": metadata.version("xake")}


@router.get("/health")
async def health(engines: EnginesDep) -> dict[str, str]:
    try:
        await engines.ping()
    except EngineError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(error)) from error
    return {"status": "ok"}
