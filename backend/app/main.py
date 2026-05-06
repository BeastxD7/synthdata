from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import settings
from .core.database import AsyncSessionLocal
from .routers import admin, auth, credits, jobs, users
from .services.credit_service import CreditService
from .utils.errors import AppError
from .utils.response import api_error


@asynccontextmanager
async def lifespan(app: FastAPI):
    from datetime import datetime, timezone
    from sqlalchemy import or_, select
    from .models.job import Job, JobStatus
    from .models.user import User

    async with AsyncSessionLocal() as db:
        await CreditService(db).seed_defaults()

        # Orphan recovery: in-process JobRunner means any job in 'running' or
        # 'queued' at startup has no live task — mark failed and refund credits.
        result = await db.execute(
            select(Job).where(or_(Job.status == JobStatus.running, Job.status == JobStatus.queued))
        )
        orphans = list(result.scalars().all())
        credit_svc = CreditService(db)
        for job in orphans:
            user = (await db.execute(select(User).where(User.id == job.user_id))).scalar_one()
            job.status = JobStatus.failed
            job.error_message = "Backend restarted while job was running — auto-recovered."
            job.completed_at = datetime.now(timezone.utc)
            if job.started_at:
                job.elapsed_seconds = (job.completed_at - job.started_at).total_seconds()
            if job.credits_reserved and not job.credits_used:
                await credit_svc.refund(user, job.credits_reserved, job.id)
        if orphans:
            await db.commit()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Exception handlers ---

@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=api_error(message=str(exc.detail), error={"code": "HTTP_ERROR"}).model_dump(),
    )


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=api_error(message=exc.message, error={"code": exc.code}).model_dump(),
    )


# Field names whose offending value must never be echoed back in 422
# responses or error logs — credentials, passwords, future API keys.
_REDACTED_VALIDATION_FIELDS = frozenset({
    "password",
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_region",
    "api_key",
    "secret_key",
})

# Parent path nodes that may carry a whole credential block as their input
# when validation fails at that level. Whole input is redacted in that case.
_REDACTED_PARENT_NODES = frozenset({"provider", "config"})


def _scrub_input(value):
    """Walk a JSON value and replace sensitive-named keys with <redacted>."""
    if isinstance(value, dict):
        return {
            k: ("<redacted>" if k in _REDACTED_VALIDATION_FIELDS else _scrub_input(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub_input(v) for v in value]
    return value


def _redact_validation_errors(errors: list[dict]) -> list[dict]:
    out: list[dict] = []
    for err in errors:
        loc = list(err.get("loc") or ())
        if any(part in _REDACTED_VALIDATION_FIELDS for part in loc):
            err = {**err, "input": "<redacted>"}
            err.pop("ctx", None)
        elif loc and loc[-1] in _REDACTED_PARENT_NODES:
            err = {**err, "input": "<redacted>"}
            err.pop("ctx", None)
        elif isinstance(err.get("input"), (dict, list)):
            err = {**err, "input": _scrub_input(err["input"])}
        out.append(err)
    return out


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=api_error(
            message="Validation error",
            error={"code": "VALIDATION_ERROR", "detail": _redact_validation_errors(exc.errors())},
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=api_error(
            message="Internal server error",
            error={"code": "INTERNAL_ERROR"},
        ).model_dump(),
    )


# --- Routers ---
PREFIX = "/api/v1"
app.include_router(auth.router, prefix=PREFIX)
app.include_router(users.router, prefix=PREFIX)
app.include_router(credits.router, prefix=PREFIX)
app.include_router(jobs.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
