from importlib import metadata

from fastapi import APIRouter

router = APIRouter(prefix="/api")


@router.get("/version")
async def version() -> dict[str, str]:
    """Readiness probe of the chart."""
    return {"version": metadata.version("xake")}
