// Standard API envelope from backend
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  error: { code: string; detail?: unknown } | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ── Auth ─────────────────────────────────────────────────────────
export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
}

export interface AuthData {
  user_id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  credits: number;
  tokens: Tokens;
}

// ── User ─────────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  credits: number;
  is_active: boolean;
  created_at: string;
}

// ── Jobs ─────────────────────────────────────────────────────────
export type JobStatus =
  | "created"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type OutputFormat = "jsonl" | "json" | "csv";

export interface Job {
  id: string;
  name: string;
  status: JobStatus;
  output_format: OutputFormat;
  output_row_count: number | null;
  credits_reserved: number;
  credits_used: number;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  error_message: string | null;
  created_at: string;
}

export interface JobListItem {
  id: string;
  name: string;
  status: JobStatus;
  output_row_count: number | null;
  credits_used: number;
  elapsed_seconds: number | null;
  created_at: string;
}

export interface JobEvent {
  sequence: number;
  event_type: string;
  stage: string;
  payload: Record<string, unknown>;
}

// ── Job config (mirrors backend JobConfig) ───────────────────────
export type SchemaFieldType = "string" | "int" | "float" | "bool" | "enum";

export interface EnumValue {
  name: string;
  description?: string;
}

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  values?: EnumValue[]; // required when type=enum
}

export interface JobProjectConfig {
  name: string;
  domain_brief: string;
}

export interface JobDatasetConfig {
  brief: string;
  target_count: number;
  diversity?: "standard" | "high" | "edge_cases";
  require_balanced?: boolean;
  min_text_chars?: number;
  max_text_chars?: number;
}

export interface JobSchemaConfig {
  fields: SchemaField[];
}

export interface JobProviderConfig {
  type: "ollama" | "bedrock";
  model: string;
  concurrency?: number;
  timeout_seconds?: number;
  // Ollama
  host?: string;
  // Bedrock BYOK
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  aws_region?: string;
}

export interface JobJudgeConfig {
  enabled: boolean;
  min_correctness?: number;
  min_realism?: number;
  min_distinctiveness?: number;
}

export interface JobLogicFilterConfig {
  enabled: boolean;
}

export interface JobConfig {
  project: JobProjectConfig;
  dataset: JobDatasetConfig;
  schema: JobSchemaConfig;
  seeds: Record<string, unknown>[];
  provider: JobProviderConfig;
  judge: JobJudgeConfig;
  logic_filter: JobLogicFilterConfig;
}

export interface CreateJobRequest {
  name: string;
  output_format?: OutputFormat;
  config: JobConfig;
}

// ── Credits ──────────────────────────────────────────────────────
export interface CreditBalance {
  credits: number;
}

export type TransactionType = "grant" | "reserve" | "debit" | "refund";

export interface CreditTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

// ── Admin ────────────────────────────────────────────────────────
export interface CreditSetting {
  key: string;
  value: string;
  description: string;
}
