"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Coins,
  Loader2,
  Plus,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { creditsApi, jobsApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import type { JobListItem } from "@/types/api";
import { PageShell } from "@/components/app/page-shell";

// ── Gradient definitions for stat cards ──────────────────────────
const STAT_GRADIENTS = {
  credits:   "linear-gradient(135deg, oklch(0.78 0.18 70), oklch(0.62 0.22 45))",
  completed: "linear-gradient(135deg, oklch(0.72 0.16 165), oklch(0.55 0.18 180))",
  running:   "linear-gradient(135deg, oklch(0.70 0.18 250), oklch(0.50 0.24 275))",
  total:     "linear-gradient(135deg, oklch(0.72 0.18 330), oklch(0.55 0.22 350))",
};

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const updateBalance = useAuthStore((s) => s.updateBalance);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [j, b] = await Promise.all([jobsApi.list(1, 10), creditsApi.balance()]);
      if (!alive) return;
      if (j.data) {
        setJobs(j.data.items);
        setTotal(j.data.total);
      }
      if (b.data) updateBalance(b.data.credits);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [updateBalance]);

  const stats = useMemo(() => {
    const completed = jobs.filter((j) => j.status === "completed").length;
    const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    return { completed, running };
  }, [jobs]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);
  const firstName = (user?.name ?? "there").split(/\s+/)[0];

  return (
    <PageShell className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {greeting}, {firstName}. Here&apos;s your platform overview.
          </p>
        </div>
        <Button asChild className="self-start sm:self-auto">
          <Link href="/jobs/new">
            <Plus className="size-4" />
            Create job
          </Link>
        </Button>
      </header>

      {/* Gradient stat row */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GradientStat
          label="Credits"
          value={user?.credits ?? 0}
          subLabel="available to spend"
          icon={Coins}
          gradient={STAT_GRADIENTS.credits}
          loading={loading}
          href="/credits"
        />
        <GradientStat
          label="Completed"
          value={stats.completed}
          subLabel={total > 0 ? `of ${total} total` : "all time"}
          icon={CheckCircle2}
          gradient={STAT_GRADIENTS.completed}
          loading={loading}
        />
        <GradientStat
          label="Running"
          value={stats.running}
          subLabel={stats.running > 0 ? "live now" : "active jobs"}
          icon={Loader2}
          gradient={STAT_GRADIENTS.running}
          loading={loading}
        />
        <GradientStat
          label="Total Jobs"
          value={total}
          subLabel="created"
          icon={Boxes}
          gradient={STAT_GRADIENTS.total}
          loading={loading}
          href="/jobs"
        />
      </section>

      {/* Quick action cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ActionCard
          icon={Wand2}
          iconBg="oklch(0.70 0.18 270)"
          title="Generate dataset"
          description="Run the 6-stage pipeline"
          href="/jobs/new"
        />
        <ActionCard
          icon={Activity}
          iconBg="oklch(0.65 0.18 155)"
          title="Browse jobs"
          description="Review past runs"
          href="/jobs"
        />
        <ActionCard
          icon={Coins}
          iconBg="oklch(0.70 0.18 60)"
          title="Manage credits"
          description="Balance & transactions"
          href="/credits"
        />
      </section>

      {/* Recent jobs */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Recent jobs</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Last 6 generation runs</p>
          </div>
          {jobs.length > 0 && (
            <Link
              href="/jobs"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              View all <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>

        {loading ? (
          <Card className="p-0 divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20 ml-auto" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </Card>
        ) : jobs.length === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <div className="mx-auto size-12 rounded-xl bg-gradient-primary flex items-center justify-center mb-4 shadow-card">
              <Sparkles className="size-5 text-primary-foreground" />
            </div>
            <h3 className="text-base font-semibold">Generate your first dataset</h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
              Define a schema, bring your provider keys, and we&apos;ll handle the rest.
            </p>
            <Button asChild className="mt-5">
              <Link href="/jobs/new">
                <Plus className="size-4" />
                Create a job
              </Link>
            </Button>
          </Card>
        ) : (
          <Card className="p-0 divide-y divide-border overflow-hidden">
            {jobs.slice(0, 6).map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-muted/40 transition-colors group"
              >
                <div className="size-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Boxes className="size-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{job.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground hidden sm:inline">
                  {job.credits_used} credits
                </span>
                <StatusPill status={job.status} />
                <ArrowUpRight className="size-3.5 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
              </Link>
            ))}
          </Card>
        )}
      </section>
    </PageShell>
  );
}

// ── Components ────────────────────────────────────────────────────

function GradientStat({
  label,
  value,
  subLabel,
  icon: Icon,
  gradient,
  loading,
  href,
}: {
  label: string;
  value: number;
  subLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  gradient: string;
  loading: boolean;
  href?: string;
}) {
  const inner = (
    <div
      className="relative overflow-hidden rounded-xl p-5 text-white shadow-elevated transition-transform duration-200 hover:-translate-y-0.5"
      style={{ backgroundImage: gradient }}
    >
      {/* Gloss highlight */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.25) 0%, transparent 50%)",
        }}
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <p className="text-sm font-medium text-white/85">{label}</p>
          <div className="size-8 rounded-md bg-white/15 backdrop-blur flex items-center justify-center">
            <Icon className="size-4 text-white" />
          </div>
        </div>
        {loading ? (
          <div className="h-9 w-16 mt-3 rounded-md bg-white/15 animate-pulse" />
        ) : (
          <p className="text-4xl font-semibold tracking-tight tabular-nums mt-3 text-white">
            {value.toLocaleString()}
          </p>
        )}
        <p className="text-xs text-white/75 mt-1">{subLabel}</p>
      </div>
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

function ActionCard({
  icon: Icon,
  iconBg,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-card hover:shadow-elevated transition-shadow"
    >
      <div className="absolute inset-0 bg-card-overlay opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <div className="relative flex items-center gap-3">
        <div
          className="size-10 rounded-lg flex items-center justify-center shrink-0 shadow-card"
          style={{ backgroundColor: iconBg }}
        >
          <Icon className="size-4.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}
