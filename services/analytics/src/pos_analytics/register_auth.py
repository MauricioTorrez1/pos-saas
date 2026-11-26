"""Access for the register itself, besides the owner of the panel (E1-63, ADR 0078).

The register has no session of the owner: it signs in with a token of its own, `Authorization: Device <token>`, the
same scheme it uses with the core. The token lives only in the environment of both sides (`ANALYTICS_REGISTER_TOKEN`
here, `POS_ANALYTICS_TOKEN` in the register), is compared in constant time, and never appears in a log or an error.
The register already lets only the owner reach the screen that calls this service.
"""

import hmac
import os
from typing import Annotated, Literal

from fastapi import Depends, Header, HTTPException, status

from pos_analytics.owner_auth import CORE_URL_VARIABLE, CoreIdentityVerifier, IdentityVerifier, require_owner

REGISTER_TOKEN_VARIABLE = "ANALYTICS_REGISTER_TOKEN"

type CallerKind = Literal["owner", "register"]

_verifier: IdentityVerifier | None = None


def optional_identity_verifier() -> IdentityVerifier | None:
    """Build the verifier of owner tokens when the core is configured, without failing when it is not.

    Returns:
        The verifier, or `None` when `ANALYTICS_CORE_API_URL` is not set (a store that only has registers).
    """
    global _verifier
    if _verifier is None:
        core_api_url = os.environ.get(CORE_URL_VARIABLE, "").strip()
        if not core_api_url:
            return None
        _verifier = CoreIdentityVerifier(core_api_url)
    return _verifier


def require_owner_or_register(
    verifier: Annotated[IdentityVerifier | None, Depends(optional_identity_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> CallerKind:
    """FastAPI dependency that lets through the register with its token, or the owner with a session token.

    Args:
        verifier: Who to ask about a bearer token, or `None` when the core is not configured.
        authorization: `Device <token>` from a register or `Bearer <token>` from the owner panel.

    Returns:
        Which of the two called.

    Raises:
        HTTPException: 401 for a wrong or missing token, 403 for a role other than owner, 503 when the side that must
            check the token is not configured, so the endpoint fails closed.
    """
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if scheme.lower() == "device":
        expected = os.environ.get(REGISTER_TOKEN_VARIABLE, "").strip()
        if not expected:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="register_not_configured")
        if not token or not hmac.compare_digest(token.encode(), expected.encode()):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="register_not_allowed")
        return "register"
    if verifier is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="identity_not_configured")
    require_owner(verifier, authorization)
    return "owner"
