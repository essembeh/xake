from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import __file__ as app_root
from .routers import api, web
from .schema.settings import AppSettings
from .settings import current_settings

static_folder = Path(app_root).parent / "static"


def create_app(settings: AppSettings = current_settings) -> FastAPI:
    out = FastAPI(title="xake")
    out.state.settings = settings
    out.include_router(api.router)
    out.include_router(web.router)
    # Mounted last: the static app shell catches every path not served by the API.
    out.mount("/", StaticFiles(directory=static_folder, html=True), name="static")
    return out


app = create_app()


def run() -> None:
    uvicorn.run("xake.webapp:app", host="0.0.0.0", port=8000)  # noqa: S104 - served behind the ingress
