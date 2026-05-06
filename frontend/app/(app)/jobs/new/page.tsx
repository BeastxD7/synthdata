"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Coins,
  Loader2,
  Lock,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { jobsApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import type {
  CreateJobRequest,
  EnumValue,
  JobProviderConfig,
  OutputFormat,
  SchemaField,
  SchemaFieldType,
} from "@/types/api";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/app/page-shell";

// ── Types ──────────────────────────────────────────────────────
interface State {
  // Basics
  name: string;
  outputFormat: OutputFormat;

  // Domain
  domainBrief: string;
  datasetBrief: string;
  targetCount: number;
  diversity: "standard" | "high" | "edge_cases";
  requireBalanced: boolean;

  // Schema
  fields: SchemaField[];
  seeds: Record<string, string>[];

  // Provider
  providerType: "bedrock" | "ollama";
  model: string;
  region: string;
  awsKey: string;
  awsSecret: string;
  host: string;
  saveCreds: boolean;

  // Pipeline (advanced)
  judgeEnabled: boolean;
  logicFilterEnabled: boolean;
}

const STORAGE_KEY = "synthdata-provider";
const FIELD_TYPES: { value: SchemaFieldType; label: string }[] = [
  { value: "string", label: "string" },
  { value: "enum",   label: "enum" },
  { value: "int",    label: "int" },
  { value: "float",  label: "float" },
  { value: "bool",   label: "bool" },
];
const OUTPUT_FORMATS: { value: OutputFormat; label: string; help: string }[] = [
  { value: "jsonl", label: "JSONL", help: "One JSON per line" },
  { value: "json",  label: "JSON",  help: "Single JSON array" },
  { value: "csv",   label: "CSV",   help: "Comma-separated" },
];

const STEPS = [
  { key: "basics",   label: "Basics",   description: "Name and output" },
  { key: "domain",   label: "Domain",   description: "What you're generating" },
  { key: "schema",   label: "Schema",   description: "Fields and examples" },
  { key: "provider", label: "Provider", description: "Your LLM keys" },
  { key: "review",   label: "Review",   description: "Confirm and launch" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

// ── Page ───────────────────────────────────────────────────────
export default function NewJobPage() {
  const router = useRouter();
  const credits = useAuthStore((s) => s.user?.credits ?? 0);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [s, setS] = useState<State>({
    name: "",
    outputFormat: "jsonl",
    domainBrief: "",
    datasetBrief: "",
    targetCount: 50,
    diversity: "standard",
    requireBalanced: false,
    fields: [
      { name: "text",  type: "string", description: "" },
      { name: "label", type: "enum",   description: "", values: [{ name: "positive" }, { name: "negative" }] },
    ],
    seeds: [{}, {}],
    providerType: "bedrock",
    model: "",
    region: "us-east-1",
    awsKey: "",
    awsSecret: "",
    host: "http://localhost:11434",
    saveCreds: false,
    judgeEnabled: true,
    logicFilterEnabled: false,
  });
  const update = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));

  // Load saved provider on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      setS((p) => ({
        ...p,
        providerType: saved.type ?? p.providerType,
        model: saved.model ?? p.model,
        region: saved.region ?? p.region,
        host: saved.host ?? p.host,
        saveCreds: !!saved.saveCreds,
        awsKey: saved.saveCreds ? saved.aws_access_key_id ?? "" : "",
        awsSecret: saved.saveCreds ? saved.aws_secret_access_key ?? "" : "",
      }));
    } catch {}
  }, []);

  const cost = Math.max(s.targetCount, 1); // 1 credit per row (admin-tunable)
  const sufficient = cost <= credits;

  // Per-step validation
  const stepError = useMemo<Partial<Record<StepKey, string>>>(() => {
    const e: Partial<Record<StepKey, string>> = {};
    if (!s.name.trim()) e.basics = "Job name is required";
    if (!s.domainBrief.trim() || !s.datasetBrief.trim()) e.domain = "Both domain and dataset briefs are required";
    if (s.targetCount < 1 || s.targetCount > 100_000) e.domain = "Target rows must be 1–100,000";
    for (const f of s.fields) {
      if (!f.name.trim()) e.schema = "Every field needs a name";
      if (f.type === "enum" && (!f.values || f.values.length === 0)) e.schema = `Enum field "${f.name || "—"}" needs values`;
    }
    if (s.seeds.every((row) => Object.keys(row).filter((k) => row[k]?.trim()).length === 0))
      e.schema = e.schema ?? "Provide at least one seed example";
    if (!s.model.trim()) e.provider = "Model ID is required";
    if (s.providerType === "bedrock" && (!s.awsKey.trim() || !s.awsSecret.trim() || !s.region.trim()))
      e.provider = e.provider ?? "AWS access key, secret, and region are required";
    if (!sufficient) e.review = "Insufficient credits for this job";
    return e;
  }, [s, sufficient]);

  function gotoStep(i: number) {
    setStep(Math.max(0, Math.min(STEPS.length - 1, i)));
    setError(null);
  }

  function next() {
    const k = STEPS[step].key;
    if (stepError[k]) {
      setError(stepError[k]!);
      return;
    }
    setError(null);
    gotoStep(step + 1);
  }

  function buildPayload(): CreateJobRequest {
    const cleanSeeds = s.seeds
      .map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (v == null || v === "") continue;
          out[k] = v;
        }
        return out;
      })
      .filter((row) => Object.keys(row).length > 0);

    const provider: JobProviderConfig = {
      type: s.providerType,
      model: s.model.trim(),
      ...(s.providerType === "bedrock"
        ? {
            aws_access_key_id: s.awsKey.trim(),
            aws_secret_access_key: s.awsSecret.trim(),
            aws_region: s.region.trim(),
          }
        : { host: s.host.trim() }),
    };

    return {
      name: s.name.trim(),
      output_format: s.outputFormat,
      config: {
        project: { name: s.name.trim(), domain_brief: s.domainBrief.trim() },
        dataset: {
          brief: s.datasetBrief.trim(),
          target_count: s.targetCount,
          diversity: s.diversity,
          require_balanced: s.requireBalanced,
        },
        schema: {
          fields: s.fields.map((f) => ({
            name: f.name.trim(),
            type: f.type,
            ...(f.description ? { description: f.description } : {}),
            ...(f.type === "enum" && f.values ? { values: f.values } : {}),
          })),
        },
        seeds: cleanSeeds,
        provider,
        judge: { enabled: s.judgeEnabled },
        logic_filter: { enabled: s.logicFilterEnabled },
      },
    };
  }

  async function submit() {
    // Final validate
    for (const k of Object.keys(stepError) as StepKey[]) {
      if (stepError[k]) {
        setError(stepError[k]!);
        const idx = STEPS.findIndex((x) => x.key === k);
        if (idx >= 0) gotoStep(idx);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    // Persist provider preferences
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          type: s.providerType,
          model: s.model,
          region: s.region,
          host: s.host,
          saveCreds: s.saveCreds,
          ...(s.saveCreds ? { aws_access_key_id: s.awsKey, aws_secret_access_key: s.awsSecret } : {}),
        }),
      );
    } catch {}
    const res = await jobsApi.create(buildPayload());
    if (res.success && res.data) {
      router.replace(`/jobs/${res.data.id}`);
      return;
    }
    setError(res.message || "Failed to create job");
    setSubmitting(false);
  }

  return (
    <PageShell className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Create a job</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Five quick steps. Your provider keys never leave the database in plaintext.
        </p>
      </header>

      <Stepper current={step} onJump={gotoStep} hasErrorOn={(k) => !!stepError[k]} />

      <Card className="p-6 sm:p-8">
        {step === 0 && <BasicsStep s={s} update={update} />}
        {step === 1 && <DomainStep s={s} update={update} />}
        {step === 2 && <SchemaStep s={s} setS={setS} />}
        {step === 3 && <ProviderStep s={s} update={update} />}
        {step === 4 && (
          <ReviewStep
            s={s}
            cost={cost}
            credits={credits}
            sufficient={sufficient}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
            update={update}
          />
        )}

        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertTriangle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between pt-6 mt-8 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            onClick={() => gotoStep(step - 1)}
            disabled={step === 0 || submitting}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            Step {step + 1} of {STEPS.length}
          </span>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={next}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={submitting || !sufficient}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {submitting ? "Launching…" : "Launch job"}
            </Button>
          )}
        </div>
      </Card>
    </PageShell>
  );
}

// ── Stepper ────────────────────────────────────────────────────
function Stepper({
  current,
  onJump,
  hasErrorOn,
}: {
  current: number;
  onJump: (i: number) => void;
  hasErrorOn: (k: StepKey) => boolean;
}) {
  return (
    <ol className="flex items-start gap-1.5 sm:gap-3 overflow-x-auto -mx-1 px-1 pb-1">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const error = hasErrorOn(s.key);
        return (
          <li key={s.key} className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onJump(i)}
              className="flex flex-col items-start gap-1 group min-w-0"
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "size-7 rounded-full flex items-center justify-center text-xs font-semibold border transition-colors",
                  done && "bg-primary border-primary text-primary-foreground",
                  active && !done && "border-primary text-primary bg-primary/10",
                  !active && !done && "border-border text-muted-foreground",
                  error && active && "border-destructive text-destructive bg-destructive/10",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium hidden sm:block whitespace-nowrap",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-px w-6 sm:w-12 transition-colors mt-3.5",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: Basics ─────────────────────────────────────────────
function BasicsStep({ s, update }: { s: State; update: <K extends keyof State>(k: K, v: State[K]) => void }) {
  return (
    <StepShell title="Basics" description="Name your job and pick the output format you'd like to download.">
      <Field label="Job name" required>
        <Input value={s.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Customer Support Intent v1" maxLength={100} autoFocus />
      </Field>
      <Field label="Output format">
        <div className="grid grid-cols-3 gap-2">
          {OUTPUT_FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => update("outputFormat", f.value)}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                s.outputFormat === f.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50",
              )}
            >
              <p className="font-mono text-xs font-semibold">{f.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{f.help}</p>
            </button>
          ))}
        </div>
      </Field>
    </StepShell>
  );
}

// ── Step 2: Domain ─────────────────────────────────────────────
function DomainStep({ s, update }: { s: State; update: <K extends keyof State>(k: K, v: State[K]) => void }) {
  return (
    <StepShell title="Domain" description="Describe what you're generating. This grounds every stage of the pipeline.">
      <Field
        label="Domain"
        required
        hint="One paragraph: who the speakers are, what they're doing, in what context."
      >
        <Textarea
          value={s.domainBrief}
          onChange={(e) => update("domainBrief", e.target.value)}
          rows={3}
          placeholder="An e-commerce platform where customers leave product reviews after purchase. Reviews can be positive, negative, or neutral and are written in casual English."
        />
      </Field>

      <Field
        label="Dataset brief"
        required
        hint="What model is this data for? What labels or signals matter?"
      >
        <Textarea
          value={s.datasetBrief}
          onChange={(e) => update("datasetBrief", e.target.value)}
          rows={2}
          placeholder="Training data for a 3-class sentiment classifier."
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Target rows" required>
          <Input
            type="number"
            min={1}
            max={100_000}
            value={s.targetCount}
            onChange={(e) => update("targetCount", Math.max(1, Number(e.target.value) || 0))}
          />
        </Field>
        <Field label="Diversity">
          <Select value={s.diversity} onValueChange={(v: State["diversity"]) => update("diversity", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard — representative</SelectItem>
              <SelectItem value="high">High — unusual phrasing</SelectItem>
              <SelectItem value="edge_cases">Edge cases — borderline</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Toggle
        checked={s.requireBalanced}
        onChange={(v) => update("requireBalanced", v)}
        label="Require balanced classes"
        hint="Guarantees every enum label appears in output. Recommended for classifiers."
      />
    </StepShell>
  );
}

// ── Step 3: Schema ─────────────────────────────────────────────
function SchemaStep({ s, setS }: { s: State; setS: React.Dispatch<React.SetStateAction<State>> }) {
  function updateField(i: number, patch: Partial<SchemaField>) {
    setS((p) => ({ ...p, fields: p.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) }));
  }
  function updateEnumValues(i: number, raw: string) {
    const values: EnumValue[] = raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => ({ name: v }));
    updateField(i, { values });
  }
  function removeField(i: number) {
    setS((p) => ({ ...p, fields: p.fields.filter((_, idx) => idx !== i) }));
  }
  function addField() {
    setS((p) => ({ ...p, fields: [...p.fields, { name: "", type: "string", description: "" }] }));
  }
  function updateSeed(i: number, name: string, val: string) {
    setS((p) => {
      const seeds = [...p.seeds];
      seeds[i] = { ...seeds[i], [name]: val };
      return { ...p, seeds };
    });
  }
  function addSeed() {
    setS((p) => (p.seeds.length >= 10 ? p : { ...p, seeds: [...p.seeds, {}] }));
  }
  function removeSeed(i: number) {
    setS((p) => (p.seeds.length <= 1 ? p : { ...p, seeds: p.seeds.filter((_, idx) => idx !== i) }));
  }

  return (
    <StepShell title="Schema & seeds" description="Define the row shape and provide 1–10 examples to ground the LLM.">
      <div className="space-y-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Fields</Label>
        {s.fields.map((f, i) => (
          <div key={i} className="rounded-md border border-border p-3 space-y-2.5 bg-muted/30">
            <div className="flex items-start gap-2">
              <Input
                value={f.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder="field_name"
                className="font-mono flex-1"
              />
              <Select
                value={f.type}
                onValueChange={(v: SchemaFieldType) =>
                  updateField(i, { type: v, values: v === "enum" ? f.values ?? [] : undefined })
                }
              >
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {s.fields.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removeField(i)} aria-label="Remove field">
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            <Input
              value={f.description ?? ""}
              onChange={(e) => updateField(i, { description: e.target.value })}
              placeholder="What this field represents (optional)"
            />
            {f.type === "enum" && (
              <Input
                value={(f.values ?? []).map((v) => v.name).join(", ")}
                onChange={(e) => updateEnumValues(i, e.target.value)}
                placeholder="positive, negative, neutral"
                className="font-mono"
              />
            )}
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addField} className="w-full border-dashed">
          <Plus className="size-3.5" />
          Add field
        </Button>
      </div>

      <Separator className="my-2" />

      <div className="space-y-3">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Seed examples</Label>
        {s.seeds.map((seed, i) => (
          <div key={i} className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Example {i + 1}</span>
              {s.seeds.length > 1 && (
                <Button type="button" variant="ghost" size="icon" onClick={() => removeSeed(i)} aria-label="Remove seed">
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            {s.fields.map((f) =>
              f.name ? (
                <div key={f.name} className="grid grid-cols-[100px_1fr] items-start gap-2">
                  <Label className="font-mono text-xs text-muted-foreground pt-2">{f.name}</Label>
                  <Input
                    value={seed[f.name] ?? ""}
                    onChange={(e) => updateSeed(i, f.name, e.target.value)}
                    placeholder={f.type === "enum" && f.values ? f.values[0]?.name ?? "" : `${f.type} value`}
                  />
                </div>
              ) : null,
            )}
          </div>
        ))}
        {s.seeds.length < 10 && (
          <Button type="button" variant="outline" size="sm" onClick={addSeed} className="w-full border-dashed">
            <Plus className="size-3.5" />
            Add seed
          </Button>
        )}
      </div>
    </StepShell>
  );
}

// ── Step 4: Provider ───────────────────────────────────────────
function ProviderStep({ s, update }: { s: State; update: <K extends keyof State>(k: K, v: State[K]) => void }) {
  return (
    <StepShell title="Provider" description="Bring your own LLM keys. They're encrypted at rest before persistence.">
      <Field label="Provider">
        <div className="grid grid-cols-2 gap-2">
          {(["bedrock", "ollama"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => update("providerType", t)}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                s.providerType === t
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50",
              )}
            >
              <p className="text-sm font-medium">{t === "bedrock" ? "AWS Bedrock" : "Ollama"}</p>
              <p className="text-xs text-muted-foreground">
                {t === "bedrock" ? "Cloud, fast, scalable" : "Local, private, free"}
              </p>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Model ID" required>
        <Input
          value={s.model}
          onChange={(e) => update("model", e.target.value)}
          placeholder={s.providerType === "bedrock" ? "google.gemma-3-27b-it-qat-q8-0:2:2" : "gemma3:4b"}
          className="font-mono"
        />
      </Field>

      {s.providerType === "bedrock" ? (
        <>
          <Field label="AWS Region" required>
            <Input value={s.region} onChange={(e) => update("region", e.target.value)} placeholder="us-east-1" className="font-mono" />
          </Field>
          <Field label="AWS Access Key ID" required>
            <Input
              type="password"
              value={s.awsKey}
              onChange={(e) => update("awsKey", e.target.value)}
              placeholder="AKIA…"
              className="font-mono"
              autoComplete="off"
            />
          </Field>
          <Field label="AWS Secret Access Key" required>
            <Input
              type="password"
              value={s.awsSecret}
              onChange={(e) => update("awsSecret", e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </Field>
          <Toggle
            checked={s.saveCreds}
            onChange={(v) => update("saveCreds", v)}
            label="Remember credentials on this device"
            hint="Stored only in this browser's localStorage. Don't enable on shared computers."
          />
        </>
      ) : (
        <Field label="Ollama host">
          <Input value={s.host} onChange={(e) => update("host", e.target.value)} placeholder="http://localhost:11434" className="font-mono" />
        </Field>
      )}

      <div className="rounded-md bg-muted/40 border border-border p-3 text-xs text-muted-foreground flex gap-2">
        <Lock className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Provider credentials are encrypted with Fernet (AES-128) before being written to the database.
          Only the runner decrypts them in-process for the duration of the job.
        </span>
      </div>
    </StepShell>
  );
}

// ── Step 5: Review ─────────────────────────────────────────────
function ReviewStep({
  s,
  cost,
  credits,
  sufficient,
  advancedOpen,
  setAdvancedOpen,
  update,
}: {
  s: State;
  cost: number;
  credits: number;
  sufficient: boolean;
  advancedOpen: boolean;
  setAdvancedOpen: (v: boolean) => void;
  update: <K extends keyof State>(k: K, v: State[K]) => void;
}) {
  const sections: { title: string; rows: { label: string; value: React.ReactNode }[] }[] = [
    {
      title: "Basics",
      rows: [
        { label: "Name",   value: s.name || <Muted /> },
        { label: "Format", value: <span className="font-mono">{s.outputFormat.toUpperCase()}</span> },
      ],
    },
    {
      title: "Dataset",
      rows: [
        { label: "Target rows", value: s.targetCount.toLocaleString() },
        { label: "Diversity",   value: s.diversity },
        { label: "Balanced",    value: s.requireBalanced ? "Yes" : "No" },
      ],
    },
    {
      title: "Schema",
      rows: s.fields.map((f, i) => ({
        label: `Field ${i + 1}`,
        value: <span className="font-mono">{f.name} <span className="text-muted-foreground">({f.type})</span></span>,
      })),
    },
    {
      title: "Provider",
      rows: [
        { label: "Type",  value: s.providerType === "bedrock" ? "AWS Bedrock" : "Ollama" },
        { label: "Model", value: <span className="font-mono text-xs">{s.model || <Muted />}</span> },
        ...(s.providerType === "bedrock"
          ? [{ label: "Region", value: <span className="font-mono">{s.region}</span> }]
          : [{ label: "Host", value: <span className="font-mono text-xs">{s.host}</span> }]),
      ],
    },
  ];

  return (
    <StepShell title="Review" description="One last look before we kick off the pipeline.">
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-md border border-border overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 border-b border-border">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
            </div>
            <div className="divide-y divide-border">
              {section.rows.map((row, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-muted-foreground shrink-0">{row.label}</span>
                  <span className="text-right truncate">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
        Advanced pipeline options
      </button>

      {advancedOpen && (
        <div className="space-y-3 rounded-md border border-border p-4 bg-muted/30">
          <Toggle
            checked={s.judgeEnabled}
            onChange={(v) => update("judgeEnabled", v)}
            label="Quality judge"
            hint="Re-evaluate each sample for correctness, realism, distinctiveness."
          />
          <Toggle
            checked={s.logicFilterEnabled}
            onChange={(v) => update("logicFilterEnabled", v)}
            label="Logic filter"
            hint="Remove implausible axis combinations before generation."
          />
        </div>
      )}

      {/* Cost summary */}
      <div className="rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Estimated cost</p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight mt-0.5">
              {cost.toLocaleString()}
              <span className="text-sm text-muted-foreground font-normal ml-1.5">credits</span>
            </p>
          </div>
          <Coins className="size-6 text-warning" />
        </div>
        <Separator className="my-3" />
        <div className="space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Your balance</span>
            <span className="tabular-nums">{credits.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">After this job</span>
            <span className={cn("tabular-nums", !sufficient && "text-destructive font-medium")}>
              {(credits - cost).toLocaleString()}
            </span>
          </div>
        </div>
        {!sufficient && (
          <Alert variant="destructive" className="mt-3 py-2">
            <AlertTriangle className="size-3.5" />
            <AlertDescription className="text-xs">
              Insufficient credits. Reduce target rows or top up.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </StepShell>
  );
}

// ── Primitives ─────────────────────────────────────────────────
function StepShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
        checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-muted-foreground/50",
      )}
    >
      <div
        className={cn(
          "mt-0.5 size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
          checked ? "bg-primary border-primary" : "border-input",
        )}
      >
        {checked && <Check className="size-3 text-primary-foreground" />}
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
    </button>
  );
}

function Muted() {
  return <span className="text-muted-foreground italic">not set</span>;
}
