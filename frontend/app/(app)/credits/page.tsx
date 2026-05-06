"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Coins, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { creditsApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import type { CreditTransaction } from "@/types/api";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/app/page-shell";

const TYPE_META: Record<string, { label: string; color: string }> = {
  grant:   { label: "Grant",    color: "text-success" },
  reserve: { label: "Reserve",  color: "text-muted-foreground" },
  debit:   { label: "Debit",    color: "text-foreground" },
  refund:  { label: "Refund",   color: "text-info" },
};

export default function CreditsPage() {
  const credits = useAuthStore((s) => s.user?.credits ?? 0);
  const updateBalance = useAuthStore((s) => s.updateBalance);

  const [txns, setTxns] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([creditsApi.balance(), creditsApi.transactions()]).then(([b, t]) => {
      if (!alive) return;
      if (b.data) updateBalance(b.data.credits);
      if (t.data) setTxns(t.data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [updateBalance]);

  return (
    <PageShell className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Credits</h1>
        <p className="text-sm text-muted-foreground mt-1">Your balance and transaction history.</p>
      </header>

      <Card className="p-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Current balance</p>
          <p className="text-4xl font-semibold tabular-nums tracking-tight mt-1">
            {credits.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">credits available</p>
        </div>
        <div className="hidden sm:flex flex-col items-end gap-2">
          <div className="size-12 rounded-md bg-warning/10 flex items-center justify-center">
            <Coins className="size-5 text-warning" />
          </div>
          <Button variant="outline" size="sm" disabled className="cursor-not-allowed">
            <Plus className="size-3.5" />
            Top up (coming soon)
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Transaction history</h2>
        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-8 rounded-md" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          ) : txns.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {txns.map((t) => {
                const meta = TYPE_META[t.type] ?? TYPE_META.debit;
                const positive = t.amount > 0;
                return (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <div
                      className={cn(
                        "size-8 rounded-md flex items-center justify-center shrink-0",
                        positive ? "bg-success/10" : "bg-muted",
                      )}
                    >
                      {positive ? (
                        <ArrowUp className="size-4 text-success" />
                      ) : (
                        <ArrowDown className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{t.description}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className={meta.color}>{meta.label}</span>
                        <span>·</span>
                        <span>
                          {new Date(t.created_at).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          "text-sm font-medium tabular-nums",
                          positive ? "text-success" : "text-foreground",
                        )}
                      >
                        {positive ? "+" : ""}
                        {t.amount}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        bal {t.balance_after.toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>
    </PageShell>
  );
}
