"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { adminApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import type { CreditSetting } from "@/types/api";
import { PageShell } from "@/components/app/page-shell";

export default function AdminPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [items, setItems] = useState<CreditSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "admin") return;
    adminApi.listSettings().then((res) => {
      if (res.data) {
        setItems(res.data);
        setDrafts(Object.fromEntries(res.data.map((s) => [s.key, s.value])));
      }
      setLoading(false);
    });
  }, [role]);

  async function save(key: string) {
    setSavingKey(key);
    setSavedKey(null);
    const res = await adminApi.updateSetting(key, drafts[key]);
    if (res.success && res.data) {
      setItems((arr) => arr.map((s) => (s.key === key ? res.data! : s)));
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2000);
    }
    setSavingKey(null);
  }

  if (role !== "admin") {
    return (
      <PageShell>
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertDescription>This page is only available to admins.</AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin · Credit settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tune signup grants and per-sample pricing. Changes apply globally to new jobs.
        </p>
      </header>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-4 py-4">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((s) => (
              <div key={s.key} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-semibold">{s.key}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-32 font-mono text-sm"
                    value={drafts[s.key] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    onClick={() => save(s.key)}
                    disabled={savingKey === s.key || drafts[s.key] === s.value}
                  >
                    {savingKey === s.key && <Loader2 className="size-3.5 animate-spin" />}
                    {savedKey === s.key && <Check className="size-3.5" />}
                    {!savingKey && !savedKey && "Save"}
                    {savedKey === s.key && "Saved"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
}
