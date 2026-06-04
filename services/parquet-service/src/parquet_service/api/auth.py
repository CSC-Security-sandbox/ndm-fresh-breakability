"""Inbound worker Bearer-JWT guard (D15).

The worker calls this API on workflow start with `Authorization: Bearer <accessToken>` (from
`AuthService.getAccessToken()` on the TS side). We verify the same way jobs-service's `JwtAuthGuard`
does (`JwtService.verifyToken`): decode + verify signature/issuer/audience, require a `user` claim.

Configure the signing material via env (see config.Settings): JWT_PUBLIC_KEY_PATH (RS*) or JWT_SECRET
(HS*), JWT_ALGORITHMS, JWT_ISSUER, JWT_AUDIENCE.
"""

from __future__ import annotations

import logging

import jwt
from fastapi import Depends, Header, HTTPException, status

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)


def _verify_key(settings: Settings) -> str:
    if settings.jwt_public_key_path:
        with open(settings.jwt_public_key_path, encoding="utf-8") as fh:
            return fh.read()
    return settings.jwt_secret


async def require_worker_auth(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    """FastAPI dependency: validate the worker's Bearer JWT; return the decoded `user` claim."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    key = _verify_key(settings)
    if not key:
        # Fail closed: never run unauthenticated in a real deployment.
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="JWT not configured")
    try:
        decoded = jwt.decode(
            token,
            key,
            algorithms=list(settings.jwt_algorithms),
            audience=settings.jwt_audience or None,
            issuer=settings.jwt_issuer or None,
            options={"require": ["exp"]},
        )
    except jwt.PyJWTError as exc:
        logger.warning("JWT verification failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token") from exc
    user = decoded.get("user")
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="no user claim")
    return user
