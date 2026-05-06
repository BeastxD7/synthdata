"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Boxes, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { jobsApi } from "@/lib/api";
import type { JobListItem, JobStatus } from "@/types/api";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/app/page-shell";

type FilterValue = "all" | JobStatus;

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "running",   label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed",    label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 15;

export default function JobsPage() {
  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<JobListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    jobsApi.list(page, PAGE_SIZE, filter === "all" ? undefined : filter).then((res) => {
      if (!alive) return;
      if (res.data) {
        setItems(res.data.items);
        setTotal(res.data.total);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [filter, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">All your dataset generation jobs.</p>
        </div>
        <Button asChild>
          <Link href="/jobs/new">
            <Plus className="size-4" />
            New job
          </Link>
        </Button>
      </header>

      <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setFilter(f.value);
              setPage(1);
            }}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap",
              filter === f.value
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-4 flex items-center gap-4">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-20 ml-auto" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto size-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <Boxes className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No jobs match this filter</p>
            <p className="text-xs text-muted-foreground mt-1">
              {filter === "all" ? "Create your first job to see it here." : `Switch filter to see other jobs.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-4 py-2.5">Name</th>
                  <th className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Created</th>
                  <th className="text-right font-medium px-4 py-2.5 hidden sm:table-cell">Rows</th>
                  <th className="text-right font-medium px-4 py-2.5">Credits</th>
                  <th className="text-left font-medium px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((job) => (
                  <tr key={job.id} className="hover:bg-muted/40 transition-colors group">
                    <td className="px-4 py-3 max-w-0">
                      <Link href={`/jobs/${job.id}`} className="font-medium truncate block">
                        {job.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {new Date(job.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                      {job.output_row_count?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {job.credits_used.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={job.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/jobs/${job.id}`}>
                        <ArrowUpRight className="size-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="size-3.5" />
              Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
