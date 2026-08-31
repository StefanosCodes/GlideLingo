from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health/live", include_in_schema=False)
def live() -> dict[str, str]:
    return {"status": "ok"}
