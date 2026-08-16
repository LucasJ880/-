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

export default function AutopilotTelemetryPage() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch("/api/autopilot/telemetry-health");
      if (cancelled) return;
      if (res.status === 403 || res.status === 401) {
        setError("无权访问 Autopilot Telemetry");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("加载 Telemetry Health 失败");
        setLoading(false);
        return;
      }
      setData((await res.json()) as Health);
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
        description="A1-P0 最小耐久性诊断。不是完整 Observe Dashboard。"
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
