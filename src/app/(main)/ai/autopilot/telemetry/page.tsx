"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Health = {
  observeReadEnabled?: boolean;
  captureEnabled: boolean;
  processorEnabled: boolean;
  schemaAvailable: boolean;
  pendingCount: number | null;
  processingCount: number | null;
  processedCount: number | null;
  deadCount: number | null;
  retryCount: number | null;
  oldestPendingAgeMs: number | null;
  canonicalEventCount: number | null;
  outboxEventCount: number | null;
  projectedEventCount: number | null;
  captureGap: number | null;
  captureGapNote: string;
};

type Coverage = {
  observeReadEnabled?: boolean;
  runsObserved: number;
  canonicalEvents: number;
  outboxEvents: number;
  projectedEvents: number;
  durableCaptureGap: number | null;
  projectionGap: number;
  toolOrphans: number;
  modelOrphans: number;
  retrievalOrphans: number;
  runtimeCoverageGap: number | null;
  runtimeCoverageGapNote?: string;
  humanEditCount?: number;
  humanOverrideCount?: number;
  reAskCount?: number;
  humanSignalProjectionGap?: number | null;
  unlinkedHumanSignalCount?: number;
  duplicateHumanSignalCount?: number;
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
        description="Lucas-only internal diagnostics. Operator view lives on Overview. Not employee scoring."
        breadcrumbs={
          <Link href="/ai/autopilot" className="hover:underline">
            Autopilot
          </Link>
        }
      />

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data && data.observeReadEnabled === false ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">
          Autopilot Observe is not active in this environment. Production
          telemetry is not active. Counts below are n/a, not zero activity.
        </p>
      ) : null}

      {data ? (
        <section className="rounded-lg border border-border bg-background p-4 text-sm">
          <dl className="space-y-2">
            <Row label="Capture" value={data.captureEnabled ? "ON" : "OFF"} />
            <Row label="Processor" value={data.processorEnabled ? "ON" : "OFF"} />
            <Row
              label="Outbox schema"
              value={data.schemaAvailable ? "available" : "n/a"}
            />
            <Row label="Pending" value={na(data.pendingCount)} />
            <Row label="Processing" value={na(data.processingCount)} />
            <Row label="Processed" value={na(data.processedCount)} />
            <Row label="Dead" value={na(data.deadCount)} />
            <Row label="Retrying" value={na(data.retryCount)} />
            <Row
              label="Oldest pending age (ms)"
              value={na(data.oldestPendingAgeMs)}
            />
            <Row label="CAPTURE_GAP" value={na(data.captureGap)} />
          </dl>
          <p className="mt-3 text-xs text-muted">{data.captureGapNote}</p>
        </section>
      ) : null}

      {coverage ? (
        <section className="rounded-lg border border-border bg-background p-4 text-sm">
          <h2 className="mb-3 font-medium">Runtime Event Coverage</h2>
          <dl className="space-y-2">
            <Row
              label="Runs observed"
              value={coverageNa(coverage.observeReadEnabled, coverage.runsObserved)}
            />
            <Row
              label="Canonical events"
              value={coverageNa(coverage.observeReadEnabled, coverage.canonicalEvents)}
            />
            <Row
              label="Outbox events"
              value={coverageNa(coverage.observeReadEnabled, coverage.outboxEvents)}
            />
            <Row
              label="Projected events"
              value={coverageNa(coverage.observeReadEnabled, coverage.projectedEvents)}
            />
            <Row
              label="DURABLE_CAPTURE_GAP"
              value={
                coverage.durableCaptureGap == null
                  ? "n/a"
                  : String(coverage.durableCaptureGap)
              }
            />
            <Row
              label="PROJECTION_GAP"
              value={coverageNa(coverage.observeReadEnabled, coverage.projectionGap)}
            />
            <Row
              label="RUNTIME_COVERAGE_GAP"
              value={
                coverage.runtimeCoverageGap == null
                  ? "n/a — scenario/contract-only"
                  : String(coverage.runtimeCoverageGap)
              }
            />
            <Row
              label="Tool orphans"
              value={coverageNa(coverage.observeReadEnabled, coverage.toolOrphans)}
            />
            <Row
              label="Model orphans"
              value={coverageNa(coverage.observeReadEnabled, coverage.modelOrphans)}
            />
            <Row
              label="Retrieval orphans"
              value={coverageNa(coverage.observeReadEnabled, coverage.retrievalOrphans)}
            />
            <Row
              label="Human Edit"
              value={coverageNa(coverage.observeReadEnabled, coverage.humanEditCount)}
            />
            <Row
              label="Human Override"
              value={coverageNa(
                coverage.observeReadEnabled,
                coverage.humanOverrideCount,
              )}
            />
            <Row
              label="Re-Ask"
              value={coverageNa(coverage.observeReadEnabled, coverage.reAskCount)}
            />
            <Row
              label="HUMAN_SIGNAL_PROJECTION_GAP"
              value={coverageNa(
                coverage.observeReadEnabled,
                coverage.humanSignalProjectionGap,
              )}
            />
            <Row
              label="Unlinked human signals"
              value={coverageNa(
                coverage.observeReadEnabled,
                coverage.unlinkedHumanSignalCount,
              )}
            />
            <Row
              label="Duplicate signals suppressed"
              value={coverageNa(
                coverage.observeReadEnabled,
                coverage.duplicateHumanSignalCount,
              )}
            />
            <Row
              label="Unknown event types"
              value={coverageNa(
                coverage.observeReadEnabled,
                coverage.unknownEventTypeCount,
              )}
            />
          </dl>
          {coverage.unknownEventTypes.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              {coverage.unknownEventTypes.join(", ")}
            </p>
          ) : null}
          {coverage.runtimeCoverageGapNote ? (
            <p className="mt-3 text-xs text-muted">
              {coverage.runtimeCoverageGapNote}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">{coverage.note}</p>
        </section>
      ) : null}
    </div>
  );
}

function na(value: number | null | undefined): string {
  return value == null ? "n/a" : String(value);
}

function coverageNa(active: boolean | undefined, value: number | null | undefined): string {
  if (active === false) return "n/a";
  return na(value);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
