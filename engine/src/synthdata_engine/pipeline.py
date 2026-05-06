"""Orchestrates all 6 stages end-to-end."""

from __future__ import annotations

import hashlib
import json
import time
import warnings
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

from .config import JobConfig
from .debug import DebugWriter, make_run_dir
from .providers import BedrockCredentials, BedrockProvider, OllamaProvider
from .providers.base import LLMProvider
from .quality import QualityReport, apply_quality_gate, compute_report
from .stages.compose import build_persona_pool
from .stages.dedup import dedupe, pick_text_fields
from .stages.discover import discover_axes
from .stages.generate import GenStats, flatten_samples, generate_all
from .stages.judge import JudgeStats, judge_samples
from .stages.logic_filter import Combination, cartesian, filter_combinations
from .stages.plan import AllocationPlan, PlanRow, build_plan, SWEET_MIN


@dataclass
class JobResult:
    samples: list[dict]
    axes: dict[str, list[str]]
    combinations_total: int
    combinations_kept: int
    plan: AllocationPlan
    gen_stats: GenStats
    judge_stats: JudgeStats
    duplicates_removed: int
    elapsed_seconds: float
    personas: list[str] = field(default_factory=list)
    backfill_used: bool = False
    backfill_gap: int = 0
    dry_run: bool = False
    quality_report: QualityReport | None = None


StageCb = Callable[[str, dict], Awaitable[None] | None]


async def run_job(
    cfg: JobConfig,
    *,
    on_stage: StageCb | None = None,
    on_progress: Callable | None = None,
    debug_dir: Path | None = None,
    checkpoint_dir: Path | None = None,
    dry_run: bool = False,
    bedrock_creds: BedrockCredentials | None = None,
) -> JobResult:
    """Run the full pipeline.

    `bedrock_creds`, when provided, overrides the env-based BedrockCredentials
    lookup. This is how the backend threads BYOK customer keys into the engine
    without leaking them into process environment.
    """
    provider = _build_provider(cfg, bedrock_creds=bedrock_creds)
    dbg: DebugWriter | None = DebugWriter(debug_dir) if debug_dir else None

    # ── Checkpoint: load prior samples and reduce remaining target ──────────
    prior_samples: list[dict] = []
    checkpoint_file: Path | None = None
    original_target = cfg.dataset.target_count

    if checkpoint_dir:
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        cfg_hash = _content_hash(cfg)
        checkpoint_file = checkpoint_dir / f"{cfg_hash}.jsonl"

        if checkpoint_file.exists():
            for line in checkpoint_file.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    try:
                        prior_samples.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass

        if prior_samples:
            remaining = max(0, original_target - len(prior_samples))
            await _call(on_stage, "checkpoint", {
                "status": "resuming",
                "prior_samples": len(prior_samples),
                "remaining_target": remaining,
            })
            cfg.dataset.target_count = remaining

    # Checkpoint write callback — fires per successful sample during generation.
    # asyncio is single-threaded so file appends are safe without a lock.
    def _checkpoint_cb(sample: dict) -> None:
        if checkpoint_file:
            with checkpoint_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(sample, ensure_ascii=False) + "\n")

    await _call(on_stage, "start", {"target": original_target, "remaining": cfg.dataset.target_count})

    # Skip full run if checkpoint already satisfied the target
    if cfg.dataset.target_count == 0:
        samples = prior_samples[:original_target]
        elapsed = 0.0
        await _call(on_stage, "done", {"samples": len(samples), "elapsed": elapsed, "source": "checkpoint"})
        return JobResult(
            samples=samples, axes={}, combinations_total=0, combinations_kept=0,
            plan=build_plan([{"_": "_"}], 1),
            gen_stats=GenStats(), judge_stats=JudgeStats(),
            duplicates_removed=0, elapsed_seconds=elapsed,
        )

    started = time.monotonic()

    # Warmup
    if hasattr(provider, "warmup"):
        await _call(on_stage, "warmup", {"status": "running"})
        await provider.warmup()  # type: ignore[attr-defined]
        await _call(on_stage, "warmup", {"status": "done"})

    # ── Stage 1 — discover or use pinned axes ───────────────────────────────
    if cfg.dataset.axes:
        axes = cfg.dataset.axes
        await _call(on_stage, "stage1_discover", {"status": "pinned", "axes": axes})
    else:
        await _call(on_stage, "stage1_discover", {"status": "running"})
        axes = await discover_axes(cfg, provider, debug=dbg)
        await _call(on_stage, "stage1_discover", {"status": "done", "axes": axes})

    # Balanced mode: inject enum label fields as axes so every combination
    # explicitly targets a class. This is the only reliable way to guarantee
    # class coverage — emergent label assignment always starves minority classes.
    if cfg.dataset.require_balanced:
        for f in cfg.dataset_schema.fields:
            if f.type == "enum" and f.values and f.name not in axes:
                axes[f.name] = f.value_names()
        await _call(on_stage, "balanced_axes", {"injected": [
            f.name for f in cfg.dataset_schema.fields
            if f.type == "enum" and f.values
        ]})

    # ── Stage 1.5 — logic filter ────────────────────────────────────────────
    all_combos: list[Combination] = cartesian(axes)
    combos_to_use = all_combos
    pre_sampled = 0
    max_useful = max(cfg.dataset.target_count * 3, 100)
    if len(all_combos) > max_useful:
        import random as _r
        combos_to_use = _r.Random(42).sample(all_combos, max_useful)
        pre_sampled = len(all_combos) - len(combos_to_use)

    if cfg.logic_filter.enabled:
        await _call(on_stage, "stage15_logic", {
            "status": "running", "total": len(all_combos),
            "filtering": len(combos_to_use), "pre_sampled_out": pre_sampled,
        })
        valid = await filter_combinations(
            combos_to_use,
            domain_brief=cfg.project.domain_brief,
            dataset_brief=cfg.dataset.brief,
            provider=provider,
            batch_size=cfg.logic_filter.batch_size,
            debug=dbg,
        )
        await _call(on_stage, "stage15_logic", {"status": "done", "total": len(all_combos), "kept": len(valid)})
    else:
        valid = combos_to_use
        await _call(on_stage, "stage15_logic", {"status": "skipped", "total": len(all_combos), "pre_sampled_out": pre_sampled})

    # ── Stage 2 — plan ──────────────────────────────────────────────────────
    await _call(on_stage, "stage2_plan", {"status": "running"})
    balanced_fields = (
        [f.name for f in cfg.dataset_schema.fields if f.type == "enum" and f.values]
        if cfg.dataset.require_balanced else None
    )
    plan = build_plan(valid, cfg.dataset.target_count, balanced_by=balanced_fields, debug=dbg)

    # Guarantee balanced coverage: if any required enum value has no plan row,
    # add a minimal fallback row (only the required field pinned) so the model
    # generates naturally-matching text without axis conflicts that trip the judge.
    # Use 3× SWEET_MIN to absorb judge losses on these small targeted batches.
    if cfg.dataset.require_balanced:
        from uuid import uuid4 as _uuid4
        for f in cfg.dataset_schema.fields:
            if f.type != "enum" or not f.values:
                continue
            covered = {r.combination.get(f.name) for r in plan.rows}
            for ev in f.values:
                if ev.name not in covered:
                    plan.rows.append(PlanRow(
                        combination_id=_uuid4().hex[:12],
                        combination={f.name: ev.name},
                        target=SWEET_MIN * 3,
                    ))

    if plan.undershoot_risk:
        gap = cfg.dataset.target_count - plan.total_target
        warnings.warn(
            f"[SynthData] undershoot risk: only {plan.total_target} samples planned "
            f"for target={cfg.dataset.target_count} ({gap} short). "
            "Pipeline will attempt a backfill round. To prevent this, increase "
            "axis values in your config or lower target_count.",
            stacklevel=2,
        )

    await _call(on_stage, "stage2_plan", {
        "status": "done", "rows": len(plan.rows),
        "total_target": plan.total_target,
        "undershoot_risk": plan.undershoot_risk,
    })

    # ── Dry run — exit after planning ───────────────────────────────────────
    if dry_run:
        filter_batches = (len(combos_to_use) + cfg.logic_filter.batch_size - 1) // cfg.logic_filter.batch_size if cfg.logic_filter.enabled else 0
        estimated_llm_calls = 1 + filter_batches + 1 + plan.total_target + (plan.total_target if cfg.judge.enabled else 0)
        await _call(on_stage, "dry_run", {
            "axes": axes,
            "combinations_total": len(all_combos),
            "combinations_kept": len(valid),
            "plan_rows": len(plan.rows),
            "planned_samples": plan.total_target,
            "estimated_llm_calls": estimated_llm_calls,
            "estimated_tokens_approx": estimated_llm_calls * 800,
        })
        elapsed = time.monotonic() - started
        return JobResult(
            samples=[], axes=axes, combinations_total=len(all_combos),
            combinations_kept=len(valid), plan=plan,
            gen_stats=GenStats(), judge_stats=JudgeStats(),
            duplicates_removed=0, elapsed_seconds=elapsed, dry_run=True,
        )

    # ── Stage 3 — personas ──────────────────────────────────────────────────
    await _call(on_stage, "stage3_personas", {"status": "running"})
    personas = await build_persona_pool(cfg, provider, debug=dbg)
    await _call(on_stage, "stage3_personas", {"status": "done", "count": len(personas)})

    # ── Stage 4 — generate ──────────────────────────────────────────────────
    await _call(on_stage, "stage4_generate", {"status": "running"})
    gen_stats = await generate_all(
        plan, cfg,
        schema=cfg.dataset_schema,
        personas=personas,
        provider=provider,
        on_progress=on_progress,
        on_sample=_checkpoint_cb,
        debug=dbg,
    )
    samples = flatten_samples(plan)
    await _call(on_stage, "stage4_generate", {
        "status": "done",
        "succeeded": gen_stats.succeeded,
        "schema_failed": gen_stats.schema_failed,
        "refusals": gen_stats.refusals,
        "errors": gen_stats.errors,
    })

    # ── Stage 5 — judge (optional) ──────────────────────────────────────────
    await _call(on_stage, "stage5_judge", {"status": "running", "enabled": cfg.judge.enabled})
    judge_provider = _build_judge_provider(cfg, bedrock_creds=bedrock_creds) if cfg.judge.enabled else provider
    samples, judge_stats = await judge_samples(
        samples, cfg,
        provider=judge_provider,
        concurrency=cfg.judge.concurrency,
        debug=dbg,
    )
    await _call(on_stage, "stage5_judge", {
        "status": "done",
        "judged": judge_stats.judged,
        "passed": judge_stats.passed,
        "failed": judge_stats.failed,
    })

    # ── Stage 6 — dedup ─────────────────────────────────────────────────────
    await _call(on_stage, "stage6_dedup", {"status": "running"})
    text_fields = pick_text_fields(cfg.dataset_schema)
    samples, removed = dedupe(
        samples,
        text_fields=text_fields,
        threshold=cfg.dedup.threshold,
        num_perm=cfg.dedup.num_perm,
        debug=dbg,
    )
    await _call(on_stage, "stage6_dedup", {"status": "done", "removed": removed, "kept": len(samples)})

    if len(samples) > cfg.dataset.target_count:
        samples = samples[: cfg.dataset.target_count]

    # ── Backfill — loop until target met or max passes exhausted ────────────
    # Each pass overshoots more aggressively (1.4×, 1.7×, 2.0×, 2.3×, 2.6×) so
    # a strict judge or high-dedup domain converges in at most 5 rounds.
    _MAX_BACKFILL_PASSES = 5
    backfill_used = False
    backfill_gap = 0

    for _pass in range(1, _MAX_BACKFILL_PASSES + 1):
        if len(samples) >= cfg.dataset.target_count:
            break

        gap = cfg.dataset.target_count - len(samples)
        if not backfill_used:
            backfill_gap = gap

        overshoot_factor = 1.4 + (_pass - 1) * 0.3
        backfill_used = True

        await _call(on_stage, "backfill", {
            "status": "running", "gap": gap, "have": len(samples),
            "pass": _pass, "overshoot": overshoot_factor,
        })

        backfill_target = int(gap * overshoot_factor)
        backfill_plan = build_plan(valid, backfill_target, overshoot=1.0)

        backfill_gen = await generate_all(
            backfill_plan, cfg,
            schema=cfg.dataset_schema,
            personas=personas,
            provider=provider,
            on_progress=on_progress,
            on_sample=_checkpoint_cb,
            debug=None,
        )
        gen_stats.attempted += backfill_gen.attempted
        gen_stats.succeeded += backfill_gen.succeeded
        gen_stats.schema_failed += backfill_gen.schema_failed
        gen_stats.refusals += backfill_gen.refusals
        gen_stats.errors += backfill_gen.errors
        gen_stats.retries += backfill_gen.retries

        new_samples = flatten_samples(backfill_plan)
        if cfg.judge.enabled:
            new_samples, _ = await judge_samples(
                new_samples, cfg,
                provider=judge_provider,
                concurrency=cfg.judge.concurrency,
                debug=None,
            )

        combined = samples + new_samples
        combined, extra_removed = dedupe(
            combined,
            text_fields=text_fields,
            threshold=cfg.dedup.threshold,
            num_perm=cfg.dedup.num_perm,
        )
        removed += extra_removed
        samples = combined[: cfg.dataset.target_count]

        await _call(on_stage, "backfill", {
            "status": "done", "pass": _pass,
            "gap": gap, "new_generated": backfill_gen.succeeded,
            "final": len(samples),
        })

    # ── Merge checkpoint prior samples ──────────────────────────────────────
    if prior_samples:
        all_merged = prior_samples + samples
        all_merged, prior_dedup = dedupe(
            all_merged,
            text_fields=text_fields,
            threshold=cfg.dedup.threshold,
            num_perm=cfg.dedup.num_perm,
        )
        removed += prior_dedup
        samples = all_merged[:original_target]

    # ── Quality gate: text length filter ────────────────────────────────────
    samples, length_filtered = apply_quality_gate(samples, cfg.dataset, cfg.dataset_schema)
    if length_filtered:
        await _call(on_stage, "quality_gate", {"filtered_by_length": length_filtered, "kept": len(samples)})

    # ── Quality report: distribution analytics + imbalance warnings ─────────
    quality_report = compute_report(samples, cfg.dataset_schema, length_filtered=length_filtered)
    if quality_report.imbalance_warnings:
        for w in quality_report.imbalance_warnings:
            warnings.warn(f"[SynthData] {w}", stacklevel=2)
    await _call(on_stage, "quality_report", quality_report.as_dict())

    elapsed = time.monotonic() - started
    await _call(on_stage, "done", {"samples": len(samples), "elapsed": elapsed})

    return JobResult(
        samples=samples,
        axes=axes,
        combinations_total=len(all_combos),
        combinations_kept=len(valid),
        plan=plan,
        gen_stats=gen_stats,
        judge_stats=judge_stats,
        duplicates_removed=removed,
        elapsed_seconds=elapsed,
        personas=personas,
        backfill_used=backfill_used,
        backfill_gap=backfill_gap,
        quality_report=quality_report,
    )


def _build_provider(cfg: JobConfig, *, bedrock_creds: BedrockCredentials | None = None) -> LLMProvider:
    if cfg.provider.type == "ollama":
        if not cfg.provider.model:
            raise ValueError("provider.model is required for ollama")
        return OllamaProvider(
            model=cfg.provider.model,
            host=cfg.provider.host,
            timeout_seconds=cfg.provider.timeout_seconds,
        )
    if cfg.provider.type == "bedrock":
        creds = bedrock_creds or BedrockCredentials.from_env()
        if cfg.provider.model:
            creds.model_id = cfg.provider.model
        return BedrockProvider(creds=creds, timeout_seconds=cfg.provider.timeout_seconds)
    raise ValueError(f"unsupported provider: {cfg.provider.type}")


def _build_judge_provider(cfg: JobConfig, *, bedrock_creds: BedrockCredentials | None = None) -> LLMProvider:
    if cfg.provider.type == "ollama":
        return OllamaProvider(
            model=cfg.provider.judge_model or cfg.provider.model or "",
            host=cfg.provider.host,
            timeout_seconds=cfg.provider.timeout_seconds,
        )
    if cfg.provider.type == "bedrock":
        # Don't share the same dataclass instance with the main provider —
        # judge_model would mutate the caller's creds.model_id.
        if bedrock_creds is not None:
            from dataclasses import replace
            creds = replace(bedrock_creds)
        else:
            creds = BedrockCredentials.from_env()
        if cfg.provider.judge_model:
            creds.model_id = cfg.provider.judge_model
        elif cfg.provider.model:
            creds.model_id = cfg.provider.model
        return BedrockProvider(creds=creds, timeout_seconds=cfg.provider.timeout_seconds)
    raise ValueError(f"unsupported provider: {cfg.provider.type}")


def _content_hash(cfg: JobConfig) -> str:
    """Hash only fields that determine dataset content, not run parameters.

    Excludes target_count, concurrency, judge thresholds, dedup params — changes
    to those should NOT break checkpoint continuity for the same dataset type.
    """
    stable = {
        "project": cfg.project.model_dump(),
        "dataset_brief": cfg.dataset.brief,
        "diversity": cfg.dataset.diversity,
        "schema": cfg.dataset_schema.model_dump(),
        "seeds": cfg.seeds,
        "anti_seeds": [a.model_dump() for a in cfg.anti_seeds],
        "provider_type": cfg.provider.type,
        "provider_model": cfg.provider.model,
    }
    raw = json.dumps(stable, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


async def _call(cb: StageCb | None, stage: str, payload: dict) -> None:
    if cb is None:
        return
    res = cb(stage, payload)
    if hasattr(res, "__await__"):
        await res  # type: ignore[func-returns-value]
