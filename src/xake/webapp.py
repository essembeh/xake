from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from . import __file__ as app_root
from .routers import api, web
from .schema.settings import AppSettings
from .settings import current_settings

static_folder = Path(app_root).parent / "static"


class RevalidatedStaticFiles(StaticFiles):
    """Without Cache-Control, browsers guess a lifetime and may run a stale app after a deploy (spec 001 §8)."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        out = await super().get_response(path, scope)
        out.headers.setdefault("Cache-Control", "no-cache")
        return out


def create_app(settings: AppSettings = current_settings) -> FastAPI:
    out = FastAPI(title="xake")
    out.state.settings = settings
    out.include_router(api.router)
    out.include_router(web.router)
    # Mounted last: the static app shell catches every path not served by the API.
    out.mount("/", RevalidatedStaticFiles(directory=static_folder, html=True), name="static")
    return out


app = create_app()


def run() -> None:
    uvicorn.run("xake.webapp:app", host="0.0.0.0", port=8000)  # noqa: S104 - served behind the ingress
