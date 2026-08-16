"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/autopilot/metric-card";
import { ObserveEmpty } from "@/components/autopilot/observe-empty";
import { StatusPill, type ObservePillTone } from "@/components/autopilot/status-pill";
import { TrendBars } from "@/components/autopilot/trend-bars";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTimeToronto } from "@/lib/time";

type ObserveState = "NOT_ACTIVE" | "HEALTHY" | "DEGRADED" | "UNKNOWN";

type OverviewResponse = {
  observeState: ObserveState;
  mode: "OBSERVE" | "DARK";
  capture: "ON" | "OFF";
  processor: "ON" | "OFF";
  productionActivation: "OFF";
  productionTelemetryActive?: boolean;
  message?: string;
  range?: string;
  runsObserved?: number;
  activeRuns?: number;
  completedRuns?: number;
  failedRuns?: number;
  cancelledRuns?: number;
  awaitingHumanRuns?: number;
  avgLatencyMs?: number | null;
  toolCallCount?: number;
  modelCallCount?: number;
  retrievalCount?: number;
  toolFailureCount?: number;
  modelFailureCount?: number;
  retrievalFailureCount?: number;
  humanEditCount?: number;
  humanOverrideCount?: number;
  reAskCount?: number;
  durableCaptureGap?: number | null;
  projectionGap?: number | null;
  humanSignalProjectionGap?: number | null;
  toolOrphans?: number | null;
  modelOrphans?: number | null;
  retrievalOrphans?: number | null;
  unknownEventTypeCount?: number | null;
  unlinkedHumanSignalCount?: number | null;
  deadLetterCount?: number | null;
  outboxPending?: number | null;
  oldestPendingAgeMs?: number | null;
  lastObservedEventAt?: string | null;
  lastProjectedEventAt?: string | null;
  processorLastActivityAt?: string | null;
  coverageUnavailable?: boolean;
  projectionBehind?: boolean;
  trend?: Array<{
    bucket: string;
    runs: number;
    completed: number;
    failed: number;
    cancelled: number;
    humanEdit: number;
    humanOverride: number;
    reAsk: number;
  }>;
  reconciler?: string;
  activationWatermark?: string;
  autoOptimization?: string;
  aiEvaluator?: string;
  monitorAgent?: string;
};

function healthTone(state: ObserveState): ObservePillTone {
  if (state === "HEALTHY") return "ok";
  if (state === "DEGRADED") return "warn";
  if (state === "UNKNOWN") return "unknown";
  return "neutral";
}

function healthLabel(state: ObserveState): string {
  if (state === "NOT_ACTIVE") return "Not Active";
  if (state === "HEALTHY") return "Healthy";
  if (state === "DEGRADED") return "Degraded";
  return "Unknown";
}

function gapTone(value: number | null | undefined): ObservePillTone {
  if (value == null) return "unknown";
  return value > 0 ? "warn" : "ok";
}

function gapLabel(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return value > 0 ? `Gap ${value}` : "Healthy";
}

function fmt(value: string | null | undefined): string {
  if (!value) return "n/a";
  return formatDateTimeToronto(value);
}

export default function AutopilotOverviewPage() {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/autopilot/overview?range=${range}`);
      if (cancelled) return;
      if (res.status === 403 || res.status === 401) {
        setError("无权访问 Autopilot");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("加载失败");
        setLoading(false);
        return;
      }
      setData((await res.json()) as OverviewResponse);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const trend = data?.trend ?? [];
  const runSummary = useMemo(() => {
    const total = trend.reduce((n, p) => n + p.runs, 0);
    return `${total} runs observed across ${trend.length} buckets. Runtime state, not AI quality.`;
  }, [trend]);
  const terminalSummary = useMemo(() => {
    const completed = trend.reduce((n, p) => n + p.completed, 0);
    const failed = trend.reduce((n, p) => n + p.failed, 0);
    const cancelled = trend.reduce((n, p) => n + p.cancelled, 0);
    return `Completed ${completed}, failed ${failed}, cancelled ${cancelled}. This is runtime state, not AI quality.`;
  }, [trend]);
  const humanSummary = useMemo(() => {
    const edit = trend.reduce((n, p) => n + p.humanEdit, 0);
    const override = trend.reduce((n, p) => n + p.humanOverride, 0);
    const reask = trend.reduce((n, p) => n + p.reAsk, 0);
    return `Human Edit ${edit}, Override ${override}, Re-Ask ${reask}. Counts only, not quality.`;
  }, [trend]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Qingyan Autopilot"
        description="观察青砚 AI 最近发生了什么。本页只回答 What happened，不评分、不诊断根因。"
        meta={
          <div className="flex flex-wrap gap-2">
            {(["24h", "7d", "30d"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  range === item
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        }
      />

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data ? (
        <>
          <section className="rounded-lg border border-border bg-background p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">Autopilot Mode</h2>
              <StatusPill
                label={data.mode === "DARK" ? "Observe / Dark" : "Observe"}
                tone={data.mode === "DARK" ? "neutral" : "info"}
              />
              <StatusPill
                label={healthLabel(data.observeState)}
                tone={healthTone(data.observeState)}
              />
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Capture</dt>
                <dd>{data.capture}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Processor</dt>
                <dd>{data.processor}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Production Activation</dt>
                <dd>{data.productionActivation}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Human Signal Reconciler</dt>
                <dd className="text-right text-xs">
                  {data.reconciler ?? "Required before Production Activation"}
                </dd>
              </div>
            </dl>
            {data.mode === "DARK" || data.productionTelemetryActive === false ? (
              <p className="mt-3 text-sm text-muted">
                Production telemetry is not active.
              </p>
            ) : null}
          </section>

          {data.observeState === "NOT_ACTIVE" ? (
            <ObserveEmpty
              title="Autopilot Observe is not active in this environment."
              body="This empty state does not mean Qingyan AI had no runs today. Capture and Processor are off, so this dashboard does not query Autopilot telemetry tables."
            />
          ) : null}

          {data.observeState !== "NOT_ACTIVE" && data.runsObserved === 0 ? (
            <ObserveEmpty
              title="No observed runs in this time range."
              body="Capture is enabled for this environment, but no Agent Runs were observed in the selected window."
            />
          ) : null}

          {data.projectionBehind ? (
            <p className="text-sm text-muted">Projection is behind.</p>
          ) : null}
          {data.coverageUnavailable ? (
            <p className="text-sm text-muted">
              Coverage data unavailable — observability metrics shown as n/a.
            </p>
          ) : null}

          {data.observeState !== "NOT_ACTIVE" ? (
            <>
              <section>
                <h2 className="mb-2 text-sm font-medium">Runtime activity</h2>
                <p className="mb-3 text-[11px] text-muted">
                  Completed is runtime state, not success. Failed runs do not
                  mean telemetry is unhealthy.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <MetricCard label="Runs observed" value={data.runsObserved ?? 0} />
                  <MetricCard label="Active runs" value={data.activeRuns ?? 0} />
                  <MetricCard label="Completed runs" value={data.completedRuns ?? 0} />
                  <MetricCard label="Failed runs" value={data.failedRuns ?? 0} />
                  <MetricCard label="Cancelled runs" value={data.cancelledRuns ?? 0} />
                  <MetricCard
                    label="Awaiting human / approval"
                    value={data.awaitingHumanRuns ?? 0}
                  />
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-sm font-medium">Human signals</h2>
                <p className="mb-3 text-[11px] text-muted">
                  Counts of observed human actions. Not AI-wrong, not dissatisfaction.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MetricCard label="Human Edit" value={data.humanEditCount ?? 0} />
                  <MetricCard
                    label="Human Override"
                    value={data.humanOverrideCount ?? 0}
                  />
                  <MetricCard label="Re-Ask" value={data.reAskCount ?? 0} />
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-sm font-medium">Observability health</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(
                    [
                      ["DURABLE_CAPTURE_GAP", data.durableCaptureGap],
                      ["PROJECTION_GAP", data.projectionGap],
                      ["HUMAN_SIGNAL_PROJECTION_GAP", data.humanSignalProjectionGap],
                      ["TOOL_ORPHANS", data.toolOrphans],
                      ["MODEL_ORPHANS", data.modelOrphans],
                      ["RETRIEVAL_ORPHANS", data.retrievalOrphans],
                      ["UNKNOWN_EVENT_TYPES", data.unknownEventTypeCount],
                      ["UNLINKED_HUMAN_SIGNALS", data.unlinkedHumanSignalCount],
                      ["OUTBOX_PENDING", data.outboxPending],
                      ["DEAD_LETTER_COUNT", data.deadLetterCount],
                    ] as Array<[string, number | null | undefined]>
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="text-muted">{label}</span>
                      <StatusPill
                        label={gapLabel(value)}
                        tone={gapTone(value)}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border p-4 text-sm">
                <h2 className="mb-2 font-medium">Data freshness</h2>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Last observed event</dt>
                    <dd>{fmt(data.lastObservedEventAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Last projected event</dt>
                    <dd>{fmt(data.lastProjectedEventAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Oldest pending outbox age</dt>
                    <dd>
                      {data.oldestPendingAgeMs == null
                        ? "n/a"
                        : `${Math.round(data.oldestPendingAgeMs / 1000)}s`}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Processor last activity</dt>
                    <dd>{fmt(data.processorLastActivityAt)}</dd>
                  </div>
                </dl>
              </section>

              <div className="grid gap-3 lg:grid-cols-3">
                <TrendBars
                  title="Runs over time"
                  series={trend.map((p) => ({ label: p.bucket, value: p.runs }))}
                  ariaSummary={runSummary}
                />
                <TrendBars
                  title="Terminal status over time"
                  series={trend.map((p) => ({
                    label: p.bucket,
                    value: p.completed + p.failed + p.cancelled,
                  }))}
                  ariaSummary={terminalSummary}
                />
                <TrendBars
                  title="Human signals over time"
                  series={trend.map((p) => ({
                    label: p.bucket,
                    value: p.humanEdit + p.humanOverride + p.reAsk,
                  }))}
                  ariaSummary={humanSummary}
                />
              </div>

              <section className="rounded-lg border border-border p-4 text-sm">
                <h2 className="mb-2 font-medium">Runtime volume</h2>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="flex justify-between">
                    <dt className="text-muted">Avg latency</dt>
                    <dd>
                      {data.avgLatencyMs == null ? "n/a" : `${data.avgLatencyMs}ms`}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Tool calls</dt>
                    <dd>{data.toolCallCount ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Model calls</dt>
                    <dd>{data.modelCallCount ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Retrievals</dt>
                    <dd>{data.retrievalCount ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Tool failures</dt>
                    <dd>{data.toolFailureCount ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Model failures</dt>
                    <dd>{data.modelFailureCount ?? 0}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[11px] text-muted">
                  AI Evaluator {data.aiEvaluator ?? "DISABLED"} · Monitor Agent{" "}
                  {data.monitorAgent ?? "DISABLED"} · Auto Optimization{" "}
                  {data.autoOptimization ?? "DISABLED"}
                </p>
              </section>
            </>
          ) : null}
        </>
      ) : null}

      <p className="text-sm">
        <Link className="text-primary underline" href="/ai/autopilot/runs">
          查看 Runs
        </Link>
        <span className="px-2 text-muted">·</span>
        <Link className="text-primary underline" href="/ai/autopilot/telemetry">
          Internal diagnostics
        </Link>
      </p>
    </div>
  );
}
