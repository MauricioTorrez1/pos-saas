"""HTTP endpoint that groups equivalent products of different supplier catalogs (E1-63, ADR 0078).

Nothing is stored and nothing about the items is logged: they live only for the request.
"""

import os
from typing import Annotated

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status

from pos_analytics.register_auth import CallerKind, require_owner_or_register

from .matcher import DEFAULT_MODEL, CatalogMatcher, GroupingRequest, GroupingResult, MatchingError

MODEL_VARIABLE = "CATALOG_MATCHER_MODEL"
API_KEY_VARIABLE = "ANTHROPIC_API_KEY"

router = APIRouter()
_matcher: CatalogMatcher | None = None


def get_matcher() -> CatalogMatcher:
    """Build the matcher from the environment, once per process.

    Returns:
        A matcher with the model of `CATALOG_MATCHER_MODEL` (default `claude-opus-5-5`).

    Raises:
        HTTPException: 503 when `ANTHROPIC_API_KEY` is not set.
    """
    global _matcher
    if _matcher is None:
        if not os.environ.get(API_KEY_VARIABLE, "").strip():
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="matcher_not_configured")
        model = os.environ.get(MODEL_VARIABLE, "").strip() or DEFAULT_MODEL
        _matcher = CatalogMatcher(anthropic.Anthropic(timeout=110.0), model)
    return _matcher


@router.post("/catalog-matching/group")
def group_equivalent_items(
    request: GroupingRequest,
    _caller: Annotated[CallerKind, Depends(require_owner_or_register)],
    matcher: Annotated[CatalogMatcher, Depends(get_matcher)],
) -> GroupingResult:
    """Propose which items are the same product. Only the register or the owner may call it, because it costs money.

    Args:
        request: Up to 200 items, with their supplier as a letter.
        _caller: Proof that the caller is the register or the owner.
        matcher: The Claude matcher.

    Returns:
        The proposed groups; the owner approves each one in the register.

    Raises:
        HTTPException: 502 when the items could not be grouped, 503 when trying again later may work.
    """
    try:
        return matcher.group(request)
    except MatchingError as error:
        code = status.HTTP_503_SERVICE_UNAVAILABLE if error.retryable else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(code, detail=error.code) from error
