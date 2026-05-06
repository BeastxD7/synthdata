"""Job lifecycle management + SSE broadcasting."""

import asyncio
import csv
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.security import decrypt_credentials, encrypt_credentials
from ..models.job import Job, JobEvent, JobStatus
from ..models.user import User
from ..utils.errors import BadRequestError, NotFoundError
from .credit_service import CreditService

_BEDROCK_CRED_FIELDS = ("aws_access_key_id", "aws_secret_access_key", "aws_region")


class JobRunner:
    """In-process SSE broadcaster. One instance per app (stored in app.state)."""

    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, list[asyncio.Queue]] = {}
        self._tasks: dict[uuid.UUID, asyncio.Task] = {}

    def subscribe(self, job_id: uuid.UUID, queue: asyncio.Queue) -> None:
        self._subscribers.setdefault(job_id, []).append(queue)

    def unsubscribe(self, job_id: uuid.UUID, queue: asyncio.Queue) -> None:
        subs = self._subscribers.get(job_id, [])
        if queue in subs:
            subs.remove(queue)

    async def broadcast(self, job_id: uuid.UUID, event: dict) -> None:
        for q in list(self._subscribers.get(job_id, [])):
            await q.put(event)

    def cancel(self, job_id: uuid.UUID) -> bool:
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            return True
        return False

    def start(self, job_id: uuid.UUID, coro) -> None:
        task = asyncio.create_task(coro)
        self._tasks[job_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(job_id, None))


# Global runner — attached to app.state on startup
runner = JobRunner()


class JobService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.credit_svc = CreditService(db)

    async def create(self, user: User, name: str, output_format: str, config: dict) -> Job:
        target_count = config.get("dataset", {}).get("target_count", 0)
        if target_count <= 0:
            raise BadRequestError("dataset.target_count must be a positive integer")

        # Encrypt provider credentials before persistence. After this call the
        # snapshot contains a Fernet token under provider.credentials_encrypted
        # and the plaintext fields are gone.
        config = _encrypt_provider_credentials(config)

        cost_estimate = await self.credit_svc.estimate_job_cost(target_count)

        job = Job(
            user_id=user.id,
            name=name,
            status=JobStatus.created,
            config_snapshot=config,
            output_format=output_format,
            credits_reserved=cost_estimate,
        )
        self.db.add(job)
        await self.db.flush()

        await self.credit_svc.reserve(user, cost_estimate, job.id)
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def enqueue(self, job: Job, user: User) -> None:
        """Mark as queued and kick off the background runner."""
        job.status = JobStatus.queued
        await self.db.commit()

        from ..core.database import AsyncSessionLocal
        runner.start(job.id, self._run(job.id, user.id, job.config_snapshot, job.output_format))

    async def get(self, job_id: uuid.UUID, user_id: uuid.UUID) -> Job:
        result = await self.db.execute(
            select(Job).where(Job.id == job_id, Job.user_id == user_id)
        )
        job = result.scalar_one_or_none()
        if not job:
            raise NotFoundError("Job")
        return job

    async def list_jobs(self, user_id: uuid.UUID, limit: int, offset: int) -> tuple[list[Job], int]:
        q = select(Job).where(Job.user_id == user_id).order_by(Job.created_at.desc())
        count_q = select(func.count()).select_from(Job).where(Job.user_id == user_id)

        result = await self.db.execute(q.limit(limit).offset(offset))
        count_result = await self.db.execute(count_q)
        return list(result.scalars().all()), count_result.scalar_one()

    async def cancel(self, job_id: uuid.UUID, user_id: uuid.UUID) -> Job:
        job = await self.get(job_id, user_id)
        if job.status not in (JobStatus.created, JobStatus.queued, JobStatus.running):
            raise BadRequestError(f"Cannot cancel a job with status '{job.status}'")

        runner.cancel(job_id)
        job.status = JobStatus.cancelled
        await self.db.commit()
        await self.db.refresh(job)
        return job

    async def get_events(self, job_id: uuid.UUID, user_id: uuid.UUID) -> list[JobEvent]:
        await self.get(job_id, user_id)  # ownership check
        result = await self.db.execute(
            select(JobEvent).where(JobEvent.job_id == job_id).order_by(JobEvent.sequence)
        )
        return list(result.scalars().all())

    # --- Internal runner ---

    async def _run(self, job_id: uuid.UUID, user_id: uuid.UUID, config: dict, output_format: str) -> None:
        """Background task: runs the engine and writes events + final state to DB."""
        from ..core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            svc = JobService(db)
            result = await db.execute(select(Job).where(Job.id == job_id))
            job = result.scalar_one()
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one()

            job.status = JobStatus.running
            job.started_at = datetime.now(timezone.utc)
            await db.commit()

            seq = 0
            # Stage 4 fires N parallel generation tasks, each calling emit().
            # AsyncSession is not concurrency-safe — without this lock, racing
            # commits raise IllegalStateChangeError and orphan the job at 'running'.
            emit_lock = asyncio.Lock()

            async def emit(event_type: str, stage: str, payload: dict) -> None:
                nonlocal seq
                async with emit_lock:
                    event = JobEvent(
                        job_id=job_id, sequence=seq, event_type=event_type, stage=stage, payload=payload
                    )
                    db.add(event)
                    await db.commit()
                    seq += 1
                await runner.broadcast(job_id, {"type": event_type, "stage": stage, "payload": payload})

            try:
                from synthdata_engine.config import JobConfig
                from synthdata_engine.pipeline import run_job
                from synthdata_engine.providers import BedrockCredentials

                # Decrypt creds for this job; they live only in this stack frame
                # for the duration of the run, never back in the snapshot dict.
                bedrock_creds = None
                provider_block = config.get("provider", {})
                token = provider_block.get("credentials_encrypted")
                if token and provider_block.get("type") == "bedrock":
                    plain = decrypt_credentials(token)
                    bedrock_creds = BedrockCredentials(
                        access_key_id=plain["aws_access_key_id"],
                        secret_access_key=plain["aws_secret_access_key"],
                        region=plain["aws_region"],
                        model_id=provider_block.get("model") or "",
                    )

                # Strip the encrypted token before handing to the engine — it
                # validates against JobConfig which doesn't know that field.
                engine_config = {**config, "provider": {
                    k: v for k, v in provider_block.items() if k != "credentials_encrypted"
                }}
                cfg = JobConfig.model_validate(engine_config)

                async def on_stage(stage: str, payload: dict) -> None:
                    await emit("stage", stage, payload)

                async def on_progress(event: dict) -> None:
                    await emit("progress", "generate", event)

                engine_result = await run_job(
                    cfg,
                    on_stage=on_stage,
                    on_progress=on_progress,
                    bedrock_creds=bedrock_creds,
                )

                output_dir = Path(settings.OUTPUTS_DIR) / str(job_id)
                output_dir.mkdir(parents=True, exist_ok=True)
                output_path = str(output_dir / f"output.{output_format}")
                _write_output(engine_result.samples, output_path, output_format)

                output_row_count = len(engine_result.samples)

                job.status = JobStatus.completed
                job.output_path = output_path
                job.output_row_count = output_row_count
                job.completed_at = datetime.now(timezone.utc)
                job.elapsed_seconds = engine_result.elapsed_seconds

                credit_svc = CreditService(db)
                await credit_svc.finalize(user, job.credits_reserved, output_row_count, job_id)

                await db.commit()
                await runner.broadcast(job_id, {"type": "done", "stage": "done", "payload": {
                    "samples": output_row_count,
                    "elapsed": engine_result.elapsed_seconds,
                }})
                await runner.broadcast(job_id, None)
                return

            except asyncio.CancelledError:
                job.status = JobStatus.cancelled
                await db.commit()
                await runner.broadcast(job_id, {"type": "cancelled", "stage": "cancelled", "payload": {}})

            except Exception as exc:
                # The shared session may be poisoned (mid-transaction, broken state).
                # Use a fresh session so the failure write itself can't fail.
                async with AsyncSessionLocal() as fail_db:
                    fail_job = (await fail_db.execute(select(Job).where(Job.id == job_id))).scalar_one()
                    fail_user = (await fail_db.execute(select(User).where(User.id == user_id))).scalar_one()
                    fail_job.status = JobStatus.failed
                    fail_job.error_message = str(exc)
                    fail_job.completed_at = datetime.now(timezone.utc)
                    if fail_job.started_at:
                        fail_job.elapsed_seconds = (fail_job.completed_at - fail_job.started_at).total_seconds()
                    await CreditService(fail_db).refund(fail_user, fail_job.credits_reserved, job_id)
                    await fail_db.commit()
                await runner.broadcast(job_id, {"type": "error", "stage": "error", "payload": {"message": str(exc)}})

            # Sentinel: tells SSE generator the stream is done (error/cancel paths)
            await runner.broadcast(job_id, None)


def _encrypt_provider_credentials(config: dict) -> dict:
    """Pull AWS keys out of provider block, encrypt as one Fernet token, and
    rewrite the block. Returns a new dict; does not mutate the input snapshot.
    Validates required fields up front so misconfigured jobs fail at create
    time rather than crashing the runner partway through.
    """
    provider = dict(config.get("provider") or {})
    if provider.get("type") != "bedrock":
        return config

    creds_in = {k: provider.pop(k, None) for k in _BEDROCK_CRED_FIELDS}
    missing = [k for k, v in creds_in.items() if not v]
    if missing:
        raise BadRequestError(
            f"Bedrock provider requires {', '.join(missing)}"
        )
    if not provider.get("model"):
        raise BadRequestError("Bedrock provider requires 'model' (model ID)")

    provider["credentials_encrypted"] = encrypt_credentials(creds_in)
    return {**config, "provider": provider}


def _write_output(samples: list[dict], path: str, fmt: str) -> None:
    p = Path(path)
    if fmt == "jsonl":
        # Trailing newline so downstream parsers that require LF-terminated
        # lines (jq -c, some streaming readers) handle the file correctly.
        body = "\n".join(json.dumps(s, ensure_ascii=False) for s in samples)
        if body:
            body += "\n"
        p.write_text(body, encoding="utf-8")
    elif fmt == "json":
        p.write_text(json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")
    elif fmt == "csv":
        if not samples:
            p.write_text("", encoding="utf-8")
            return
        with p.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(samples[0].keys()))
            writer.writeheader()
            writer.writerows(samples)
