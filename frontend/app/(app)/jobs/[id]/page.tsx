"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { jobsApi } from "@/lib/api";
import { subscribeToJobEvents, type SSEEvent } from "@/lib/sse";
import { useAuthStore } from "@/store/auth";
import { cn } from "@/lib/utils";
import type { Job, JobEvent } from "@/types/api";
import { PageShell } from "@/components/app/page-shell";

interface UIStage {
  key: string;
  label: string;
  description: string;
  // Engine stage names this UI stage reacts to
  engineStages: string[];
}

const STAGES: UIStage[] = [
  { key: "discover", label: "Discover",   description: "Mining axes from your domain",
    engineStages: ["stage1_discover", "balanced_axes", "stage15_logic"] },
  { key: "plan",     label: "Plan",       description: "Allocating samples and building personas",
    engineStages: ["stage2_plan", "stage3_personas"] },
  { key: "generate", label: "Generate",   description: "Calling the LLM for each combination",
    engineStages: ["stage4_generate"] },
  { key: "judge",    label: "Judge",      description: "Scoring quality of each sample",
    engineStages: ["stage5_judge"] },
  { key: "refine",   label: "Refine",     description: "Dedup, length gate, backfill",
    engineStages: ["stage6_dedup", "backfill", "quality_gate", "quality_report"] },
  { key: "done",     label: "Done",       description: "Output written and ready to download",
    engineStages: ["done"] },
];

const ENGINE_TO_UI: Record<string, string> = {};
for (const s of STAGES) for (const eng of s.engineStages) ENGINE_TO_UI[eng] = s.key;

type StageStatus = "pending" | "active" | "completed" | "error";

interface StageState {
  status: StageStatus;
  message?: string;
}

function buildInitialState(): Record<string, StageState> {
  return Object.fromEntries(STAGES.map((s) => [s.key, { status: "pending" as StageStatus }]));
}

interface LogEntry {
  id: number;
  ts: Date;
  type: string;
  stage?: string;
  text: string;
}

function describePayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "stage" || k === "payload") continue;
    if (typeof v === "object") continue;
    parts.push(`${k}=${v}`);
  }
  return parts.join(" ");
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const accessToken = useAuthStore((s) => s.accessToken);
  const updateBalance = useAuthStore((s) => s.updateBalance);

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<Record<string, StageState>>(buildInitialState);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ count: 0, target: 0 });
  const [cancelling, setCancelling] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "ts">) => {
    setLogs((arr) => [...arr, { ...entry, id: ++seqRef.current, ts: new Date() }]);
  }, []);

  const applyEvent = useCallback(
    (event: SSEEvent | JobEvent, source: "live" | "replay") => {
      // Normalize between SSE event and DB event shape
      const evtType = "type" in event ? event.type : event.event_type;
      const stageName = event.stage;
      const payload = (event.payload ?? {}) as Record<string, unknown>;

      if (evtType !== "ping") {
        addLog({ type: evtType, stage: stageName, text: describePayload(payload) });
      }

      if (evtType === "stage" && stageName) {
        const uiKey = ENGINE_TO_UI[stageName];
        if (uiKey) {
          setStages((prev) => {
            const next = { ...prev };
            // Walk up: any earlier UI stage still active should be closed.
            const idxNew = STAGES.findIndex((s) => s.key === uiKey);
            for (let i = 0; i < idxNew; i++) {
              if (next[STAGES[i].key].status !== "completed") {
                next[STAGES[i].key] = { status: "completed" };
              }
            }
            const status = (payload.status as string | undefined) === "done" ? "completed" : "active";
            next[uiKey] = { status, message: payload.status as string | undefined };
            return next;
          });
        }
      }

      if (evtType === "progress" && stageName === "generate") {
        const count = (payload.total_succeeded as number | undefined) ?? undefined;
        if (typeof count === "number") setProgress((p) => ({ ...p, count }));
      }

      if (evtType === "done") {
        setStages((prev) => {
          const next = { ...prev };
          for (const s of STAGES) {
            if (s.key === "done") next[s.key] = { status: "completed" };
            else if (next[s.key].status !== "completed") next[s.key] = { status: "completed" };
          }
          return next;
        });
        if (source === "live") {
          // Reload final state (rows, elapsed, credits)
          setTimeout(() => {
            jobsApi.get(id).then((res) => {
              if (res.data) setJob(res.data);
            });
          }, 400);
        }
      }

      if (evtType === "error" || evtType === "cancelled") {
        setStages((prev) => {
          const next = { ...prev };
          for (const s of STAGES) {
            if (next[s.key].status === "active") {
              next[s.key] = { status: evtType === "error" ? "error" : "pending" };
            }
          }
          return next;
        });
      }
    },
    [addLog, id],
  );

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await jobsApi.get(id);
      if (cancelled) return;
      if (!res.data) {
        setLoading(false);
        return;
      }
      const j = res.data;
      setJob(j);
      setProgress({ count: j.output_row_count ?? 0, target: 0 });
      setLoading(false);

      const isLive = j.status === "running" || j.status === "queued";
      if (isLive && accessToken) {
        // Replay any earlier events first so the user doesn't see a blank pipeline mid-run
        try {
          const er = await jobsApi.events(id);
          if (er.data) er.data.forEach((e) => applyEvent(e, "replay"));
        } catch {}
        const handle = subscribeToJobEvents(id, accessToken, (ev) => applyEvent(ev, "live"));
        return () => handle.close();
      }
      // Terminal job → replay events for the visualizer
      try {
        const er = await jobsApi.events(id);
        if (er.data) er.data.forEach((e) => applyEvent(e, "replay"));
      } catch {}

      if (j.status === "completed" || j.status === "failed" || j.status === "cancelled") {
        setStages((prev) => {
          const next = { ...prev };
          for (const s of STAGES) {
            if (j.status === "completed") next[s.key] = { status: "completed" };
            else if (next[s.key].status === "active") {
              next[s.key] = { status: j.status === "failed" ? "error" : "pending" };
            }
          }
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accessToken]);

  async function handleCancel() {
    if (!job) return;
    setCancelling(true);
    const res = await jobsApi.cancel(job.id);
    if (res.data) setJob(res.data);
    setCancelling(false);
  }

  async function handleDownload() {
    if (!job) return;
    try {
      await jobsApi.download(job.id, `${job.name}.${job.output_format}`);
    } catch {
      // surface a quiet inline error instead of alert
    }
  }

  async function handleRefresh() {
    const res = await jobsApi.get(id);
    if (res.data) {
      setJob(res.data);
      updateBalance((useAuthStore.getState().user?.credits ?? 0));
    }
  }

  const isLive = job?.status === "running" || job?.status === "queued";
  const totalRows = job?.output_row_count ?? progress.count;

  return (
    <PageShell className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild className="shrink-0 -ml-1">
            <Link href="/jobs"><ArrowLeft className="size-4" /></Link>
          </Button>
          <div className="min-w-0">
            {loading ? (
              <Skeleton className="h-7 w-64 mb-1" />
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold tracking-tight truncate">
                  {job?.name ?? "Job"}
                </h1>
                {job && <StatusPill status={job.status} />}
                {isLive && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-info">
                    <span className="size-1.5 rounded-full bg-info animate-pulse" />
                    Live
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
              {id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {job?.status === "completed" && (
            <Button onClick={handleDownload}>
              <Download className="size-4" />
              Download
            </Button>
          )}
          {isLive && (
            <Button variant="outline" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancel
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={handleRefresh} aria-label="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      {/* Summary strip */}
      {!loading && job && (
        <Card className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          <SummaryItem label="Rows" value={totalRows.toLocaleString()} />
          <SummaryItem label="Format" value={job.output_format.toUpperCase()} mono />
          <SummaryItem label="Credits" value={job.credits_used.toLocaleString()} />
          <SummaryItem
            label="Elapsed"
            value={job.elapsed_seconds ? `${Math.round(job.elapsed_seconds)}s` : "—"}
          />
        </Card>
      )}

      {/* Error */}
      {job?.error_message && (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertDescription>
            <span className="font-medium block mb-0.5">Job failed</span>
            <span className="text-xs">{job.error_message}</span>
          </AlertDescription>
        </Alert>
      )}

      {/* Pipeline + log */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3 p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold">Pipeline</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              discover → plan → generate → judge → refine → done
            </p>
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-9 rounded-md" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {STAGES.map((s, i) => (
                <StageRow
                  key={s.key}
                  stage={s}
                  state={stages[s.key]}
                  isLast={i === STAGES.length - 1}
                  generateProgress={s.key === "generate" ? progress.count : undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2 p-0 flex flex-col h-[480px]">
          <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border">
            <h2 className="text-sm font-semibold">Event log</h2>
            {isLive && (
              <span className="inline-flex items-center gap-1 text-[10px] text-success">
                <span className="size-1.5 rounded-full bg-success animate-pulse" />
                streaming
              </span>
            )}
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto px-5 py-3 font-mono text-[11px] space-y-1">
            {logs.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center">
                {isLive ? "Waiting for events…" : "No events recorded"}
              </p>
            ) : (
              logs.map((entry) => (
                <div key={entry.id} className="flex gap-2 leading-relaxed">
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {entry.ts.toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span
                    className={cn(
                      "uppercase shrink-0 font-semibold",
                      entry.type === "stage" && "text-info",
                      entry.type === "progress" && "text-warning",
                      entry.type === "done" && "text-success",
                      entry.type === "error" && "text-destructive",
                    )}
                  >
                    {entry.type}
                  </span>
                  {entry.stage && <span className="text-muted-foreground shrink-0">[{entry.stage}]</span>}
                  <span className="text-foreground break-all">{entry.text}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}

function StageRow({
  stage,
  state,
  isLast,
  generateProgress,
}: {
  stage: UIStage;
  state: StageState;
  isLast: boolean;
  generateProgress?: number;
}) {
  const { status } = state;
  const isActive = status === "active";
  const isDone = status === "completed";
  const isError = status === "error";

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div
          className={cn(
            "size-9 rounded-md border flex items-center justify-center transition-colors",
            isDone && "bg-success/10 border-success/30 text-success",
            isError && "bg-destructive/10 border-destructive/30 text-destructive",
            isActive && "bg-info/10 border-info/30 text-info",
            !isDone && !isActive && !isError && "bg-muted/40 border-border text-muted-foreground",
          )}
        >
          {isDone && <CheckCircle2 className="size-4" />}
          {isError && <XCircle className="size-4" />}
          {isActive && <Loader2 className="size-4 animate-spin" />}
          {!isDone && !isActive && !isError && (
            <span className="text-xs font-mono">{STAGES.findIndex((s) => s.key === stage.key) + 1}</span>
          )}
        </div>
        {!isLast && (
          <div
            className={cn(
              "w-px flex-1 min-h-[24px] mt-1 transition-colors",
              isDone ? "bg-success/30" : "bg-border",
            )}
          />
        )}
      </div>

      <div className={cn("flex-1 min-w-0", !isLast && "pb-5")}>
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={cn(
              "text-sm font-medium",
              !isDone && !isActive && !isError && "text-muted-foreground/70",
            )}
          >
            {stage.label}
          </p>
          {stage.key === "generate" && generateProgress !== undefined && generateProgress > 0 && (
            <span className="text-xs font-mono text-info tabular-nums">
              {generateProgress.toLocaleString()} samples
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-base font-semibold mt-0.5 tabular-nums", mono && "font-mono")}>{value}</p>
    </div>
  );
}
