import json
import re
from importlib import metadata
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..schema.settings import AppSettings

router = APIRouter()

icons_folder = Path(__file__).parent.parent / "static" / "icons"
# iOS probes these root paths when adding to the home screen, whatever the page declares (spec 001, PWA).
APPLE_TOUCH_VARIANT = re.compile(r"(-\d+x\d+)?(-precomposed)?")
ICON_CACHE = {"Cache-Control": "public, max-age=86400"}


@router.get("/config.js", include_in_schema=False)
async def config_js(request: Request) -> Response:
    """Service settings the front-end needs before its first paint (spec 003)."""
    settings: AppSettings = request.app.state.settings
    config = {
        "defaultLanguage": settings.default_language,
        "defaultElo": settings.default_elo,
        "version": metadata.version("xake"),
    }
    return Response(
        f"window.XAKE_CONFIG = {json.dumps(config)};\n",
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/apple-touch-icon.png", include_in_schema=False)
async def apple_touch_icon() -> FileResponse:
    return FileResponse(icons_folder / "apple-touch-icon.png", media_type="image/png", headers=ICON_CACHE)


@router.get("/apple-touch-icon{variant}.png", include_in_schema=False)
async def apple_touch_icon_variant(variant: str) -> FileResponse:
    """`-precomposed`, `-<w>x<h>` and both: always the 180x180 icon, iOS scales it."""
    if not APPLE_TOUCH_VARIANT.fullmatch(variant):
        raise HTTPException(status_code=404)
    return await apple_touch_icon()


@router.get("/favicon.ico", include_in_schema=False)
async def favicon() -> FileResponse:
    return FileResponse(icons_folder / "icon-192.png", media_type="image/png", headers=ICON_CACHE)
