"""Sécurité : hachage des mots de passe (bcrypt) et jetons JWT.

- Les mots de passe ne sont JAMAIS stockés en clair : hachage bcrypt.
- Pré-hachage SHA-256 (+ base64) pour supprimer la limite bcrypt de 72 octets
  sans perte d'entropie, et accepter des mots de passe longs.
- Les jetons d'accès sont des JWT signés avec SECRET_KEY (jamais dans le code).
"""
from __future__ import annotations

import base64
import hashlib
from datetime import timedelta

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings
from app.core.timezone import utcnow


def _prehash(plain: str) -> bytes:
    """SHA-256 du mot de passe, encodé base64 (44 octets, < 72)."""
    digest = hashlib.sha256(plain.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_prehash(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, role: str, extra: dict | None = None) -> str:
    expire = utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict = {"sub": str(subject), "role": role, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
