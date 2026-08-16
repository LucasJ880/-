"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Health = {
  captureEnabled: boolean;
  processorEnabled: boolean;
  schemaAvailable: boolean;
  pendingCount: number;
  processingCount: number;
  processedCount: number;
  deadCount: number;
  retryCount: number;
  oldestPendingAgeMs: number | null;
  canonicalEventCount: number;
  outboxEventCount: number;
  projectedEventCount: number;
  captureGap: number | null;
  captureGapNote: string;
};

type Coverage = {
  runsObserved: number;
  canonicalEvents: number;
  outboxEvents: number;
  projectedEvents: number;
  durableCaptureGap: number | null;
  projectionGap: number;
  toolOrphans: number;
  modelOrphans: number;
  retrievalOrphans: number;
  unknownEventTypeCount: number;
  unknownEventTypes: string[];
  note: string;
};

export default function AutopilotTelemetryPage() {
  const [data, setData] = useState<Health | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [healthRes, coverageRes] = await Promise.all([
        apiFetch("/api/autopilot/telemetry-health"),
        apiFetch("/api/autopilot/event-coverage"),
      ]);
      if (cancelled) return;
      if (healthRes.status === 403 || healthRes.status === 401) {
        setError("无权访问 Autopilot Telemetry");
        setLoading(false);
        return;
      }
      if (!healthRes.ok) {
        setError("加载 Telemetry Health 失败");
        setLoading(false);
        return;
      }
      setData((await healthRes.json()) as Health);
      if (coverageRes.ok) {
        setCoverage((await coverageRes.json()) as Coverage);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Telemetry Health"
        description="A1-P0 耐久性 + A1-P1 Runtime Event Coverage 最小诊断。不是 Observe Dashboard，不是员工排行榜。"
        breadcrumbs={
          <Link href="/ai/autopilot" className="hover:underline">
            Autopilot
          </Link>
        }
      />

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data ? (
        <section className="rounded-lg border border-border bg-background p-4 text-sm">
          <dl className="space-y-2">
            <Row label="Capture" value={data.captureEnabled ? "ON" : "OFF"} />
            <Row label="Processor" value={data.processorEnabled ? "ON" : "OFF"} />
            <Row
              label="Outbox schema"
              value={data.schemaAvailable ? "available" : "missing"}
            />
            <Row label="Pending" value={String(data.pendingCount)} />
            <Row label="Processing" value={String(data.processingCount)} />
            <Row label="Processed" value={String(data.processedCount)} />
            <Row label="Dead" value={String(data.deadCount)} />
            <Row label="Retrying" value={String(data.retryCount)} />
            <Row
              label="Oldest pending age (ms)"
              value={
                data.oldestPendingAgeMs == null
                  ? "—"
                  : String(data.oldestPendingAgeMs)
              }
            />
            <Row
              label="CAPTURE_GAP"
              value={
                data.captureGap == null ? "n/a" : String(data.captureGap)
              }
            />
          </dl>
          <p className="mt-3 text-xs text-muted">{data.captureGapNote}</p>
        </section>
      ) : null}

      {coverage ? (
        <section className="rounded-lg border border-border bg-background p-4 text-sm">
          <h2 className="mb-3 font-medium">Runtime Event Coverage</h2>
          <dl className="space-y-2">
            <Row label="Runs observed" value={String(coverage.runsObserved)} />
            <Row
              label="Canonical events"
              value={String(coverage.canonicalEvents)}
            />
            <Row label="Outbox events" value={String(coverage.outboxEvents)} />
            <Row
              label="Projected events"
              value={String(coverage.projectedEvents)}
            />
            <Row
              label="DURABLE_CAPTURE_GAP"
              value={
                coverage.durableCaptureGap == null
                  ? "n/a"
                  : String(coverage.durableCaptureGap)
              }
            />
            <Row label="PROJECTION_GAP" value={String(coverage.projectionGap)} />
            <Row label="Tool orphans" value={String(coverage.toolOrphans)} />
            <Row label="Model orphans" value={String(coverage.modelOrphans)} />
            <Row
              label="Retrieval orphans"
              value={String(coverage.retrievalOrphans)}
            />
            <Row
              label="Unknown event types"
              value={String(coverage.unknownEventTypeCount)}
            />
          </dl>
          {coverage.unknownEventTypes.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              {coverage.unknownEventTypes.join(", ")}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">{coverage.note}</p>
        </section>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
