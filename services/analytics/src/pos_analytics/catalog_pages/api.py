"""HTTP endpoint that reads one photographed catalog page (E1-53, ADR 0069).

The photo arrives as the raw request body (`image/jpeg` or `image/png`), so it is never written to disk, and it is
dropped when the request ends. Nothing is logged about its content.
"""

import os
from typing import Annotated, Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request, status

from pos_analytics.owner_auth import CallerCheck, require_owner

from .reader import DEFAULT_MODEL, CatalogPageReader, CatalogReadingError, PageReading

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MODEL_VARIABLE = "CATALOG_READER_MODEL"
API_KEY_VARIABLE = "ANTHROPIC_API_KEY"

_SIGNATURES: dict[str, bytes] = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}

router = APIRouter()
_reader: CatalogPageReader | None = None


def get_reader() -> CatalogPageReader:
    """Build the reader from the environment, once per process.

    Returns:
        A reader with the model of `CATALOG_READER_MODEL` (default `claude-opus-5-5`).

    Raises:
        HTTPException: 503 when `ANTHROPIC_API_KEY` is not set.
    """
    global _reader
    if _reader is None:
        if not os.environ.get(API_KEY_VARIABLE, "").strip():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="reader_not_configured")
        model = os.environ.get(MODEL_VARIABLE, "").strip() or DEFAULT_MODEL
        _reader = CatalogPageReader(anthropic.Anthropic(timeout=180.0), model)
    return _reader


async def read_photo(request: Request) -> tuple[bytes, Literal["image/jpeg", "image/png"]]:
    """Read the body as one photo, refusing it as soon as it is too large.

    Args:
        request: The incoming request.

    Returns:
        The bytes and their type.

    Raises:
        HTTPException: 413 when larger than 5 MB, 415 when it is not a JPEG or PNG (by type and by its first bytes).
    """
    media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if media_type not in _SIGNATURES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="photo_type")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="photo_too_large")
    photo = bytearray()
    async for chunk in request.stream():
        photo.extend(chunk)
        if len(photo) > MAX_PHOTO_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="photo_too_large")
    if not bytes(photo).startswith(_SIGNATURES[media_type]):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="photo_type")
    return bytes(photo), media_type  # type: ignore[return-value]


@router.post("/catalog-pages/read")
async def read_catalog_page(
    request: Request,
    _owner: Annotated[CallerCheck, Depends(require_owner)],
    reader: Annotated[CatalogPageReader, Depends(get_reader)],
) -> PageReading:
    """Propose the rows of one supplier catalog page. Only the owner may call it, because every call costs money.

    Args:
        request: Its body is the photo.
        _owner: Proof that the caller is the owner.
        reader: The Claude reader.

    Returns:
        The proposed rows; none is stored.

    Raises:
        HTTPException: 502 when the page could not be read, 503 when trying again later may work.
    """
    photo, media_type = await read_photo(request)
    try:
        return reader.read(photo, media_type)
    except CatalogReadingError as error:
        code = status.HTTP_503_SERVICE_UNAVAILABLE if error.retryable else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(code, detail=error.code) from error
