"""HTTP endpoint that reads one photographed catalog page or a short scanned PDF (E1-53 and E1-63, ADR 0069 and 0077).

The page arrives as the raw request body (`image/jpeg`, `image/png` or `application/pdf`), so it is never written to
disk, and it is dropped when the request ends. Nothing is logged about its content.
"""

import os
import re
from typing import Annotated, Literal

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request, status

from pos_analytics.owner_auth import CallerCheck, require_owner

from .reader import DEFAULT_MODEL, CatalogPageReader, CatalogReadingError, PageReading

MAX_PHOTO_BYTES = 5 * 1024 * 1024
# A scanned page is about 1 MB; the request to Claude must stay under 32 MB once in base64.
MAX_PDF_BYTES = 20 * 1024 * 1024
# The answer of one request fits about this many pages of a dense catalog; a longer PDF goes in parts.
MAX_PDF_PAGES = 4
MODEL_VARIABLE = "CATALOG_READER_MODEL"
API_KEY_VARIABLE = "ANTHROPIC_API_KEY"

_SIGNATURES: dict[str, bytes] = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "application/pdf": b"%PDF-",
}
# Each page object of a PDF says "/Type /Page"; "/Type /Pages" is the tree that holds them.
_PAGE_OBJECT = re.compile(rb"/Type\s*/Page(?![a-zA-Z])")

type PageMediaType = Literal["image/jpeg", "image/png", "application/pdf"]


def count_pdf_pages(document: bytes) -> int:
    """Count the page objects a PDF declares, without parsing it.

    Pages stored inside compressed object streams are not seen, so the count can be low but never high; Claude's own
    limits still apply to those.

    Args:
        document: The bytes of the PDF.

    Returns:
        How many page objects were found.
    """
    return len(_PAGE_OBJECT.findall(document))

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


async def read_photo(request: Request) -> tuple[bytes, PageMediaType]:
    """Read the body as one photo or one PDF, refusing it as soon as it is too large.

    Args:
        request: The incoming request.

    Returns:
        The bytes and their type.

    Raises:
        HTTPException: 413 when a photo is larger than 5 MB, a PDF larger than 20 MB or with more than 4 pages;
            415 when it is not a JPEG, PNG or PDF (by type and by its first bytes).
    """
    media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if media_type not in _SIGNATURES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="photo_type")
    is_pdf = media_type == "application/pdf"
    limit = MAX_PDF_BYTES if is_pdf else MAX_PHOTO_BYTES
    too_large = "pdf_too_large" if is_pdf else "photo_too_large"
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail=too_large)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail=too_large)
    page = bytes(body)
    if not page.startswith(_SIGNATURES[media_type]):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="photo_type")
    if is_pdf and count_pdf_pages(page) > MAX_PDF_PAGES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="pdf_too_many_pages")
    return page, media_type  # type: ignore[return-value]


@router.post("/catalog-pages/read")
async def read_catalog_page(
    request: Request,
    _owner: Annotated[CallerCheck, Depends(require_owner)],
    reader: Annotated[CatalogPageReader, Depends(get_reader)],
) -> PageReading:
    """Propose the rows of a supplier catalog page or short PDF. Only the owner may call it, because it costs money.

    Args:
        request: Its body is the photo or the PDF.
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
