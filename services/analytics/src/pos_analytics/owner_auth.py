"""Owner-only access for endpoints that spend money on the Claude API.

The service has no users of its own. It asks the core who the bearer token belongs to (`GET /me`), the same
question the owner panel asks, so the core stays the only place that validates tokens and knows roles (ADR 0042).
"""

import os
from dataclasses import dataclass
from typing import Annotated, Literal, Protocol

import httpx2
from fastapi import Depends, Header, HTTPException, status

CORE_URL_VARIABLE = "ANALYTICS_CORE_API_URL"
CORE_TIMEOUT_SECONDS = 5.0

type MeStatus = Literal["owner", "not_owner", "unauthorized", "unavailable"]


@dataclass(frozen=True)
class CallerCheck:
    """What the core said about the token.

    Attributes:
        status: `owner`, `not_owner`, `unauthorized` (bad or expired token) or `unavailable` (no answer).
        tenant_id: Business of the caller when the core answered, otherwise `None`.
    """

    status: MeStatus
    tenant_id: str | None = None


class IdentityVerifier(Protocol):
    """Anything that can tell whether a bearer token belongs to an owner."""

    def check(self, access_token: str) -> CallerCheck:
        """Ask who the token belongs to.

        Args:
            access_token: The bearer token as the caller sent it.

        Returns:
            The answer of the core.
        """
        ...


class CoreIdentityVerifier:
    """Asks `GET /me` of the core, which validates the token and reads the role from `app_user`."""

    def __init__(self, core_api_url: str, client: httpx2.Client | None = None) -> None:
        """Create a verifier.

        Args:
            core_api_url: Base address of the core, for example `http://core:8080`.
            client: HTTP client; tests pass one with a mock transport.
        """
        self._me_url = f"{core_api_url.rstrip('/')}/me"
        self._client = client or httpx2.Client(timeout=CORE_TIMEOUT_SECONDS)

    def check(self, access_token: str) -> CallerCheck:
        """Ask the core who the token belongs to.

        Args:
            access_token: The bearer token as the caller sent it.

        Returns:
            `owner` only when the core answers 200 with the role `owner`.
        """
        try:
            response = self._client.get(
                self._me_url,
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
        except httpx2.HTTPError:
            return CallerCheck("unavailable")
        if response.status_code == status.HTTP_401_UNAUTHORIZED:
            return CallerCheck("unauthorized")
        if response.status_code == status.HTTP_403_FORBIDDEN:
            return CallerCheck("not_owner")
        if response.status_code != status.HTTP_200_OK:
            return CallerCheck("unavailable")
        try:
            body = response.json()
        except ValueError:
            return CallerCheck("unavailable")
        tenant_id = body.get("tenantId") if isinstance(body, dict) else None
        role = body.get("role") if isinstance(body, dict) else None
        if not isinstance(tenant_id, str):
            return CallerCheck("unavailable")
        return CallerCheck("owner" if role == "owner" else "not_owner", tenant_id)


_verifier: IdentityVerifier | None = None


def get_identity_verifier() -> IdentityVerifier:
    """Build the verifier from `ANALYTICS_CORE_API_URL`, once per process.

    Returns:
        The verifier that asks the core.

    Raises:
        HTTPException: 503 when the address of the core is not set, so the endpoint fails closed.
    """
    global _verifier
    if _verifier is None:
        core_api_url = os.environ.get(CORE_URL_VARIABLE, "").strip()
        if not core_api_url:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="identity_not_configured")
        _verifier = CoreIdentityVerifier(core_api_url)
    return _verifier


def require_owner(
    verifier: Annotated[IdentityVerifier, Depends(get_identity_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> CallerCheck:
    """FastAPI dependency that lets only the owner through.

    Args:
        verifier: Who to ask about the token.
        authorization: The `Authorization` header, which must be `Bearer <token>`.

    Returns:
        The check of an owner.

    Raises:
        HTTPException: 401 without a valid token, 403 for any other role, 503 when the core does not answer.
    """
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="missing_token")
    result = verifier.check(token.strip())
    if result.status == "unauthorized":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid_token")
    if result.status == "not_owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="owner_only")
    if result.status == "unavailable":
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="core_unavailable")
    return result
