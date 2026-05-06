import asyncio
import json
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.dependencies import get_current_user
from ..models.user import User
from ..schemas.job import JobCreate, JobEventOut, JobListOut, JobOut
from ..services.job_service import JobService, runner
from ..utils.errors import NotFoundError
from ..utils.pagination import PageParams, PaginatedData
from ..utils.response import ApiResponse, api_success

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("/", response_model=ApiResponse, status_code=201)
async def create_job(
    body: JobCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = JobService(db)
    job = await svc.create(current_user, body.name, body.output_format, body.config.model_dump(by_alias=True))
    await svc.enqueue(job, current_user)
    return api_success(data=JobOut.model_validate(job), message="Job created and queued")


@router.get("/", response_model=ApiResponse)
async def list_jobs(
    params: PageParams = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = JobService(db)
    jobs, total = await svc.list_jobs(current_user.id, params.limit, params.offset)
    data = PaginatedData.build([JobListOut.model_validate(j) for j in jobs], total, params)
    return api_success(data=data)


@router.get("/{job_id}", response_model=ApiResponse)
async def get_job(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = JobService(db)
    job = await svc.get(job_id, current_user.id)
    return api_success(data=JobOut.model_validate(job))


@router.delete("/{job_id}", response_model=ApiResponse)
async def cancel_job(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = JobService(db)
    job = await svc.cancel(job_id, current_user.id)
    return api_success(data=JobOut.model_validate(job), message="Job cancelled")


@router.get("/{job_id}/events", response_model=ApiResponse)
async def get_events(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Full event replay — use this when reconnecting to a job that already ran."""
    svc = JobService(db)
    events = await svc.get_events(job_id, current_user.id)
    return api_success(data=[JobEventOut.model_validate(e) for e in events])


@router.get("/{job_id}/stream")
async def stream_job(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SSE stream — subscribe to real-time job events."""
    svc = JobService(db)
    await svc.get(job_id, current_user.id)  # ownership check

    async def event_generator() -> AsyncGenerator[str, None]:
        queue: asyncio.Queue = asyncio.Queue()
        runner.subscribe(job_id, queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
                    continue

                if event is None:  # sentinel — job finished
                    yield "event: done\ndata: {}\n\n"
                    break

                # Include `stage` in the wire data — without it the client has
                # no way to tell which pipeline stage emitted the event.
                yield (
                    f"event: {event['type']}\n"
                    f"data: {json.dumps({'stage': event.get('stage'), 'payload': event['payload']})}\n\n"
                )
        finally:
            runner.unsubscribe(job_id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/{job_id}/output")
async def download_output(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = JobService(db)
    job = await svc.get(job_id, current_user.id)
    if not job.output_path:
        raise NotFoundError("Output file")
    return FileResponse(job.output_path, filename=f"job_{job_id}.{job.output_format}")
