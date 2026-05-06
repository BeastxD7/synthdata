import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from cryptography.fernet import Fernet
from jose import JWTError, jwt

from .config import settings

_fernet = Fernet(settings.ENCRYPTION_KEY.encode())


# --- Passwords ---

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# --- JWT ---

def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": subject, "exp": expire}, settings.SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> str:
    """Returns subject (user id str) or raises JWTError."""
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    sub: str | None = payload.get("sub")
    if sub is None:
        raise JWTError("missing sub")
    return sub


# --- Refresh tokens ---

def generate_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, token_hash). Store hash; send raw to client."""
    raw = secrets.token_urlsafe(64)
    return raw, _hash_token(raw)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_refresh_token(raw: str) -> str:
    return _hash_token(raw)


# --- Credential encryption ---

def encrypt(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return _fernet.decrypt(value.encode()).decode()


# --- Provider credential block (dict of secrets) ---

import json as _json


def encrypt_credentials(creds: dict) -> str:
    """Serialize and encrypt a credential dict (e.g. AWS keys) for storage."""
    return encrypt(_json.dumps(creds, sort_keys=True))


def decrypt_credentials(token: str) -> dict:
    """Reverse of encrypt_credentials. Returns the original dict."""
    return _json.loads(decrypt(token))
