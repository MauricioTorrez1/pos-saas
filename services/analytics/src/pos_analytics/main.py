"""HTTP entry point of the analytics service."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from pos_analytics.catalog_matching.api import router as catalog_matching_router
from pos_analytics.catalog_pages.api import router as catalog_pages_router

app = FastAPI(title="POS Analytics")
app.include_router(catalog_pages_router)
app.include_router(catalog_matching_router)


class HealthResponse(BaseModel):
    """Body of the health endpoint."""

    status: Literal["ok"]


@app.get("/health")
def read_health() -> HealthResponse:
    """Report that the service can answer requests.

    Returns:
        The status of the service.
    """
    return HealthResponse(status="ok")
