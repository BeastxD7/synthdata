import { cn } from "@/lib/utils";
import type { JobStatus } from "@/types/api";

const config: Record<JobStatus, { label: string; dot: string; bg: string; text: string }> = {
  created:   { label: "Created",   dot: "bg-muted-foreground", bg: "bg-muted",                       text: "text-muted-foreground" },
  queued:    { label: "Queued",    dot: "bg-muted-foreground", bg: "bg-muted",                       text: "text-muted-foreground" },
  running:   { label: "Running",   dot: "bg-info animate-pulse", bg: "bg-info/10",                   text: "text-info" },
  completed: { label: "Completed", dot: "bg-success",          bg: "bg-success/10",                  text: "text-success" },
  failed:    { label: "Failed",    dot: "bg-destructive",      bg: "bg-destructive/10",              text: "text-destructive" },
  cancelled: { label: "Cancelled", dot: "bg-muted-foreground", bg: "bg-muted",                       text: "text-muted-foreground" },
};

export function StatusPill({ status, className }: { status: JobStatus; className?: string }) {
  const c = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        c.bg,
        c.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}
