import json
from importlib import metadata

from fastapi import APIRouter, Request, Response

from ..schema.settings import AppSettings

router = APIRouter()


@router.get("/config.js", include_in_schema=False)
async def config_js(request: Request) -> Response:
    """Service settings the front-end needs before its first paint (spec 003)."""
    settings: AppSettings = request.app.state.settings
    config = {"defaultLanguage": settings.default_language, "version": metadata.version("xake")}
    return Response(
        f"window.XAKE_CONFIG = {json.dumps(config)};\n",
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache"},
    )
