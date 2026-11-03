"""HTTP entry point of the analytics service."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="POS Analytics")


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
