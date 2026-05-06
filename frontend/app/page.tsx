"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  Database,
  Lock,
  Moon,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Sun,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { cn } from "@/lib/utils";

const STAGES = [
  { name: "Discover",  description: "Mine axes from your domain" },
  { name: "Plan",      description: "Allocate samples + personas" },
  { name: "Generate",  description: "Parallel LLM calls" },
  { name: "Judge",     description: "Quality scoring" },
  { name: "Refine",    description: "Dedup + length gate" },
  { name: "Export",    description: "JSONL · JSON · CSV" },
];

const FEATURES = [
  { icon: Lock,        title: "BYOK encryption",  description: "Bring your own provider keys. Encrypted with Fernet at rest, decrypted only in-process for the duration of the run." },
  { icon: ScanSearch,  title: "Schema-driven",    description: "Strings, enums, nested objects, arrays. Validation runs on every generated row." },
  { icon: ShieldCheck, title: "Balanced classes", description: "require_balanced guarantees every label gets coverage — no minority class starvation." },
  { icon: Sparkles,    title: "CoT quality judge", description: "Each sample is scored on correctness, realism, distinctiveness. Below threshold, drop and regenerate." },
  { icon: Database,    title: "MinHash dedup",    description: "Near-duplicate removal preserves paraphrases while removing surface-only variants." },
  { icon: Zap,         title: "Up to 100K rows",  description: "Backfills until target met. Checkpoint and resume long runs without losing progress." },
];

const STATS = [
  { value: "100K",   label: "rows per job" },
  { value: "6",      label: "pipeline stages" },
  { value: "2+",     label: "LLM providers" },
  { value: "92",     label: "tests passing" },
];

const SAMPLE_YAML = `project:
  name: Sentiment Classifier
  domain_brief: Product reviews from e-commerce customers.

dataset:
  brief: Training data for a 3-class sentiment classifier.
  target_count: 1000
  require_balanced: true

schema:
  fields:
    - name: text
      type: string
      description: The customer review text.
    - name: label
      type: enum
      values:
        - { name: positive }
        - { name: negative }
        - { name: neutral }

provider:
  type: bedrock
  model: google.gemma-3-27b-it
  concurrency: 8`;

export default function LandingPage() {
  const router = useRouter();
  const { isAuthenticated, _hasHydrated } = useAuthStore();

  // Logged-in visitors go straight to the dashboard.
  useEffect(() => {
    if (_hasHydrated && isAuthenticated) router.replace("/dashboard");
  }, [_hasHydrated, isAuthenticated, router]);

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-x-hidden">
      {/* Page-level aurora — covers the area behind the floating nav pill too */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[110vh] pointer-events-none -z-0"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 55% at 50% 0%, oklch(0.55 0.22 265 / 0.28), transparent 70%)",
        }}
      />
      {/* Faint masked grid */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[110vh] pointer-events-none opacity-[0.03] dark:opacity-[0.05] -z-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent)",
        }}
      />

      <Nav />
      <main className="flex-1 relative">
        <Hero />
        <Stats />
        <CodePreview />
        <Pipeline />
        <Features />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────
const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Features",     href: "#features" },
  { label: "Pipeline",     href: "#pipeline" },
];

function Nav() {
  return (
    <div className="sticky top-3 sm:top-4 z-50 flex justify-center px-3 sm:px-4">
      <header
        className="w-full max-w-5xl rounded-full border border-border/60 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/55 shadow-elevated"
      >
        <div className="flex items-center justify-between gap-2 h-12 pl-2 pr-1.5">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 pl-2 group">
            <div className="size-7 rounded-lg bg-gradient-primary flex items-center justify-center shadow-[var(--shadow-button)] transition-transform group-hover:scale-[1.05]">
              <span className="text-primary-foreground text-[13px] font-bold tracking-tight">S</span>
            </div>
            <span className="font-semibold tracking-tight text-[14px]">SynthData</span>
          </Link>

          {/* Center nav links — desktop only */}
          <nav className="hidden md:flex items-center gap-0.5 mx-2">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground rounded-full hover:bg-muted/60 transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>

          {/* Right cluster */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground rounded-full hover:bg-muted/60 transition-colors"
            >
              Sign in
            </Link>
            <Button size="sm" asChild className="rounded-full font-medium h-8 px-3.5">
              <Link href="/register">
                Get started <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="size-8" />;
  const dark = resolvedTheme === "dark";
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

// ── Hero ──────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative flex items-center min-h-[calc(100vh-3.5rem)]">
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 backdrop-blur px-3 py-1 text-xs text-muted-foreground mb-6">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          Public beta · BYOK Bedrock + Ollama
        </div>

        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight text-balance max-w-3xl mx-auto leading-[1.05]">
          Generate <span className="bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">labeled NLP datasets</span> in plain English
        </h1>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto text-pretty">
          Describe your domain, define a schema, bring your own LLM keys.
          A 6-stage pipeline turns it into production-ready training data.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button size="lg" asChild className="h-10 px-5">
            <Link href="/register">
              Start free with 100 credits <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild className="h-10 px-5">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>

        <p className="mt-5 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-success" />
          No credit card · No data leaves your provider
        </p>
      </div>
    </section>
  );
}

// ── Stats ─────────────────────────────────────────────────────
function Stats() {
  return (
    <section className="border-y border-border bg-card/30">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
        {STATS.map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-3xl sm:text-4xl font-semibold tracking-tight tabular-nums">{s.value}</p>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Code preview ──────────────────────────────────────────────
function CodePreview() {
  return (
    <section id="pipeline" className="relative scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-20 sm:py-24">
        <div className="text-center mb-10">
          <p className="text-xs font-medium text-primary tracking-wider uppercase mb-3">Configuration</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance max-w-2xl mx-auto">
            One YAML file. Production-ready training data.
          </h2>
          <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
            Describe your domain and labels in plain English. The engine handles axis discovery, allocation, generation, and quality.
          </p>
        </div>

        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-elevated">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive/40" />
                <span className="size-2.5 rounded-full bg-warning/40" />
                <span className="size-2.5 rounded-full bg-success/40" />
              </div>
              <span className="ml-2 text-xs font-mono text-muted-foreground flex items-center gap-1.5">
                <Code2 className="size-3.5" />
                sentiment.yaml
              </span>
            </div>
            <pre className="p-5 sm:p-6 text-xs sm:text-[13px] leading-relaxed font-mono overflow-x-auto">
              <code>{colorize(SAMPLE_YAML)}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

// Naive YAML colorizer — keys, strings, comments, values.
function colorize(yaml: string) {
  const lines = yaml.split("\n");
  return lines.map((line, i) => (
    <div key={i}>
      {line.split(/(\s*#.*)/).map((part, j) => {
        if (part.startsWith("#")) return <span key={j} className="text-muted-foreground">{part}</span>;
        return part.split(/(:\s*)/).map((seg, k) => {
          if (k === 0 && seg.match(/^\s*-?\s*\w/)) {
            const m = seg.match(/^(\s*-?\s*)(\w[\w_]*)$/);
            if (m) return <span key={k}><span>{m[1]}</span><span className="text-info">{m[2]}</span></span>;
          }
          if (seg.match(/^['"]/)) return <span key={k} className="text-success">{seg}</span>;
          return <span key={k}>{seg}</span>;
        });
      })}
    </div>
  ));
}

// ── Pipeline visualization ────────────────────────────────────
function Pipeline() {
  return (
    <section id="how-it-works" className="relative border-y border-border bg-card/30 scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-20 sm:py-24">
        <div className="text-center mb-12">
          <p className="text-xs font-medium text-primary tracking-wider uppercase mb-3">How it works</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance max-w-2xl mx-auto">
            Six stages from prompt to dataset
          </h2>
        </div>

        <div className="relative grid grid-cols-2 md:grid-cols-6 gap-4">
          {/* Connecting line */}
          <div className="hidden md:block absolute top-6 left-[8.33%] right-[8.33%] h-px bg-gradient-to-r from-transparent via-border to-transparent" />

          {STAGES.map((s, i) => (
            <div key={s.name} className="relative flex flex-col items-center text-center">
              <div className="size-12 rounded-full border border-border bg-card flex items-center justify-center text-sm font-mono font-semibold relative z-10 shadow-card">
                {i + 1}
              </div>
              <p className="mt-3 text-sm font-semibold">{s.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Features ──────────────────────────────────────────────────
function Features() {
  return (
    <section id="features" className="relative scroll-mt-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-20 sm:py-24">
        <div className="text-center mb-12">
          <p className="text-xs font-medium text-primary tracking-wider uppercase mb-3">Built for ML engineers</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance max-w-2xl mx-auto">
            Quality controls baked into every stage
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="group relative rounded-xl border border-border bg-card p-6 shadow-card hover:shadow-elevated transition-shadow overflow-hidden"
              >
                <div className="absolute inset-0 bg-card-overlay opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                <div className="relative">
                  <div className="size-9 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
                    <Icon className="size-4" />
                  </div>
                  <h3 className="text-sm font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{f.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Final CTA ─────────────────────────────────────────────────
function FinalCta() {
  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-20 sm:py-24">
        <div className="relative rounded-2xl border border-border bg-card overflow-hidden shadow-elevated">
          {/* Single soft backdrop gradient */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 70% 60% at 50% 50%, oklch(0.55 0.22 270 / 0.18), transparent 70%)",
            }}
          />
          <div className="relative px-6 sm:px-12 py-12 sm:py-16 text-center">
            <Wand2 className="size-7 mx-auto mb-4 text-primary" />
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance max-w-xl mx-auto">
              Generate your first dataset today
            </h2>
            <p className="mt-3 text-muted-foreground max-w-md mx-auto">
              100 credits free on signup. No card required. Bring any Bedrock or Ollama model.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button size="lg" asChild className="h-10 px-5">
                <Link href="/register">
                  Create your account <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button variant="ghost" size="lg" asChild className="h-10 px-5">
                <Link href="/login">I already have one</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────
const FOOTER_COLUMNS: { heading: string; items: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: "Product",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Create job", href: "/jobs/new" },
      { label: "Credits",   href: "/credits" },
      { label: "Changelog", href: "#" },
    ],
  },
  {
    heading: "Company & Legal",
    items: [
      { label: "About",            href: "#" },
      { label: "Privacy Policy",   href: "#" },
      { label: "Terms & Conditions", href: "#" },
      { label: "Security",         href: "#" },
    ],
  },
  {
    heading: "Social",
    items: [
      { label: "GitHub",   href: "https://github.com",   external: true },
      { label: "X",        href: "https://x.com",        external: true },
      { label: "LinkedIn", href: "https://linkedin.com", external: true },
    ],
  },
];

function Footer() {
  return (
    <footer className="border-t border-border bg-background overflow-hidden">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 pt-16">
        {/* Link grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-10 pb-12">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.items.map((item) => {
                  const C = item.external ? "a" : Link;
                  const props = item.external
                    ? { href: item.href, target: "_blank", rel: "noopener noreferrer" }
                    : { href: item.href };
                  return (
                    <li key={item.label}>
                      <C
                        {...(props as any)}
                        className="text-sm text-foreground hover:text-primary transition-colors"
                      >
                        {item.label}
                      </C>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {/* Contact column */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contact
            </p>
            <p className="mt-4 text-sm">Remote · Worldwide</p>
            <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Email
            </p>
            <a
              href="mailto:hello@synthdata.dev"
              className="mt-4 text-sm hover:text-primary transition-colors block"
            >
              hello@synthdata.dev
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-border" />
      </div>

      {/* Edge-to-edge wordmark — leading 0.95 ensures the "y" descender
          shows fully without being clipped by the footer's overflow-hidden. */}
      <div
        aria-hidden
        className="relative w-full select-none leading-[0.95] tracking-[-0.04em] font-bold text-gradient-wordmark mt-8"
        style={{ fontSize: "clamp(96px, 22.5vw, 360px)" }}
      >
        SynthData
      </div>

      {/* Copyright — centered, after the wordmark */}
      <p className="text-xs text-muted-foreground py-6 text-center">
        © {new Date().getFullYear()} SynthData · All rights reserved
      </p>
    </footer>
  );
}
