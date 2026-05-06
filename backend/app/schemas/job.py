import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..models.job import JobStatus


# ---------------------------------------------------------------------------
# Job config schema — mirrors engine's JobConfig so Swagger shows full docs
# ---------------------------------------------------------------------------

class JobProjectConfig(BaseModel):
    name: str = Field(description="Short project name")
    domain_brief: str = Field(description="One-sentence description of the domain")


class JobDatasetConfig(BaseModel):
    brief: str = Field(description="What the dataset is for")
    target_count: int = Field(ge=1, le=100_000, description="Number of samples to generate")
    diversity: Literal["standard", "high", "edge_cases"] = Field(default="standard")
    require_balanced: bool = Field(default=False, description="Guarantee equal samples per enum class")
    min_text_chars: int = Field(default=10, ge=1)
    max_text_chars: int = Field(default=2000, ge=10)


class EnumValue(BaseModel):
    name: str
    description: str = ""


class SchemaField(BaseModel):
    name: str
    type: Literal["string", "int", "float", "bool", "enum"]
    description: str = ""
    values: list[EnumValue] | None = Field(default=None, description="Required when type=enum")


class JobSchemaConfig(BaseModel):
    fields: list[SchemaField] = Field(min_length=1)


class JobProviderConfig(BaseModel):
    type: Literal["ollama", "bedrock"] = Field(default="ollama")
    model: str | None = Field(default=None, description="Model ID — required for bedrock")
    concurrency: int = Field(default=5, ge=1, le=50)
    timeout_seconds: int = Field(default=300, ge=5, le=900)
    host: str = Field(default="http://localhost:11434", description="Ollama host URL — ignored for bedrock")

    # BYOK — Bedrock only. Required when type=bedrock. Encrypted at rest before
    # persistence; never returned in API responses.
    aws_access_key_id: str | None = Field(default=None, description="AWS access key ID (Bedrock BYOK)")
    aws_secret_access_key: str | None = Field(default=None, description="AWS secret access key (Bedrock BYOK)")
    aws_region: str | None = Field(default=None, description="AWS region (Bedrock BYOK)")


class JobJudgeConfig(BaseModel):
    enabled: bool = False
    min_correctness: int = Field(default=7, ge=1, le=10)
    min_realism: int = Field(default=7, ge=1, le=10)
    min_distinctiveness: int = Field(default=7, ge=1, le=10)
    concurrency: int = Field(default=8, ge=1, le=50)


class JobLogicFilterConfig(BaseModel):
    enabled: bool = Field(default=True)
    batch_size: int = Field(default=25, ge=5, le=100)


class JobConfig(BaseModel):
    project: JobProjectConfig
    dataset: JobDatasetConfig
    schema_: JobSchemaConfig = Field(alias="schema")
    seeds: list[dict[str, Any]] = Field(min_length=1, max_length=10, description="1–10 example rows matching your schema")
    provider: JobProviderConfig
    judge: JobJudgeConfig = Field(default_factory=JobJudgeConfig)
    logic_filter: JobLogicFilterConfig = Field(default_factory=JobLogicFilterConfig)

    model_config = {"populate_by_name": True}


class JobCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    output_format: Literal["jsonl", "json", "csv"] = "jsonl"
    config: JobConfig


class JobOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    status: JobStatus
    output_format: str
    output_row_count: int | None
    credits_reserved: int
    credits_used: int
    started_at: datetime | None
    completed_at: datetime | None
    elapsed_seconds: float | None
    error_message: str | None
    created_at: datetime


class JobListOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    status: JobStatus
    output_row_count: int | None
    credits_used: int
    elapsed_seconds: float | None
    created_at: datetime


class JobEventOut(BaseModel):
    model_config = {"from_attributes": True}

    sequence: int
    event_type: str
    stage: str
    payload: dict[str, Any]
