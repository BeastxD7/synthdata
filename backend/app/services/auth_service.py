from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.user import RefreshToken, User, UserRole
from ..utils.errors import ConflictError, UnauthorizedError
from ..core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from ..core.config import settings
from .credit_service import CreditService


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def register(self, name: str, email: str, password: str) -> tuple[User, str, str]:
        existing = await self.db.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            raise ConflictError("An account with this email already exists")

        user = User(
            name=name,
            email=email,
            hashed_password=hash_password(password),
            role=UserRole.user,
            credits=0,
        )
        self.db.add(user)
        await self.db.flush()  # get user.id without committing

        # Grant signup credits
        credit_svc = CreditService(self.db)
        await credit_svc.grant_signup_credits(user)

        await self.db.commit()
        await self.db.refresh(user)

        access_token, refresh_token = await self._issue_tokens(user)
        await self.db.commit()
        return user, access_token, refresh_token

    async def login(self, email: str, password: str) -> tuple[User, str, str]:
        result = await self.db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if not user or not verify_password(password, user.hashed_password):
            raise UnauthorizedError("Invalid email or password")

        if not user.is_active:
            raise UnauthorizedError("Account is deactivated")

        access_token, refresh_token = await self._issue_tokens(user)
        await self.db.commit()
        return user, access_token, refresh_token

    async def refresh(self, raw_token: str) -> tuple[str, str]:
        token_hash = hash_refresh_token(raw_token)
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked == False,  # noqa: E712
                RefreshToken.expires_at > datetime.now(timezone.utc),
            )
        )
        stored = result.scalar_one_or_none()
        if not stored:
            raise UnauthorizedError("Invalid or expired refresh token")

        # Rotate: revoke old, issue new
        stored.revoked = True

        user_result = await self.db.execute(select(User).where(User.id == stored.user_id))
        user = user_result.scalar_one()

        access_token, new_refresh_token = await self._issue_tokens(user)
        await self.db.commit()
        return access_token, new_refresh_token

    async def logout(self, raw_token: str) -> None:
        token_hash = hash_refresh_token(raw_token)
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        if stored:
            stored.revoked = True
            await self.db.commit()

    async def _issue_tokens(self, user: User) -> tuple[str, str]:
        access_token = create_access_token(str(user.id))
        raw_refresh, token_hash = generate_refresh_token()

        rt = RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
        self.db.add(rt)
        return access_token, raw_refresh
