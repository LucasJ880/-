"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EventTimeline } from "@/components/autopilot/event-timeline";
import { ObserveEmpty } from "@/components/autopilot/observe-empty";
import { StatusPill } from "@/components/autopilot/status-pill";
import { apiFetch } from "@/lib/api-fetch";
import { formatDateTimeToronto } from "@/lib/time";

type DetailResponse = {
  active?: boolean;
  observeState?: string;
  message?: string;
  runId?: string;
  agent?: string | null;
  domain?: string | null;
  runType?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  status?: string;
  durationMs?: number | null;
  eventCount?: number;
  toolCalls?: number;
  modelCalls?: number;
  retrievals?: number;
  humanEditCount?: number;
  humanOverrideCount?: number;
  reAskCount?: number;
  errorCode?: string | null;
  errorSummary?: string | null;
  events?: Array<{
    id: string;
    sequence: number;
    eventType: string;
    category: "Input" | "Context" | "Retrieval" | "Model" | "Tool" | "Output" | "Human" | "Terminal" | "System";
    timestamp: string;
    durationMs: number | null;
    status: string | null;
    summary: Record<string, unknown> | null;
  }>;
  diagnostics?: {
    extraTerminal: boolean;
    terminalCount: number;
    postTerminalHumanSignals: number;
  };
  note?: string;
};

export default function AutopilotRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params?.runId;
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      const res = await apiFetch(`/api/autopilot/runs/${runId}`);
      if (cancelled) return;
      if (res.status === 404) {
        setError("Run 不存在");
        setLoading(false);
        return;
      }
      if (res.status === 403 || res.status === 401) {
        setError("无权访问");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("加载失败");
        setLoading(false);
        return;
      }
      setData((await res.json()) as DetailResponse);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title={runId ?? "Run"}
        description="Sanitized event timeline. Human signals after a terminal event are legal."
        breadcrumbs={
          <>
            <Link href="/ai/autopilot" className="hover:underline">
              Autopilot
            </Link>
            <span>/</span>
            <Link href="/ai/autopilot/runs" className="hover:underline">
              Runs
            </Link>
          </>
        }
      />

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {data?.observeState === "NOT_ACTIVE" ? (
        <ObserveEmpty
          title="Autopilot Observe is not active in this environment."
          body="Production telemetry is not active. Run detail is not queried."
        />
      ) : null}

      {data?.active ? (
        <>
          <dl className="grid gap-2 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
            <div>Run ID: {data.runId}</div>
            <div>Status: {data.status}</div>
            <div>Agent / Domain: {data.agent ?? "—"} / {data.domain ?? "—"}</div>
            <div>Run type: {data.runType}</div>
            <div>
              Started: {data.startedAt ? formatDateTimeToronto(data.startedAt) : "n/a"}
            </div>
            <div>
              Ended: {data.endedAt ? formatDateTimeToronto(data.endedAt) : "n/a"}
            </div>
            <div>
              Duration: {data.durationMs == null ? "n/a" : `${data.durationMs}ms`}
            </div>
            <div>Events: {data.eventCount}</div>
            <div>
              Tool / Model / Retrieval: {data.toolCalls} / {data.modelCalls} /{" "}
              {data.retrievals}
            </div>
            <div className="flex flex-wrap gap-1">
              <StatusPill label={`EDIT ${data.humanEditCount ?? 0}`} tone="neutral" />
              <StatusPill
                label={`OVERRIDE ${data.humanOverrideCount ?? 0}`}
                tone="neutral"
              />
              <StatusPill label={`RE-ASK ${data.reAskCount ?? 0}`} tone="neutral" />
            </div>
            {data.errorCode ? <div>Error code: {data.errorCode}</div> : null}
            {data.errorSummary ? <div>Error: {data.errorSummary}</div> : null}
          </dl>

          <h2 className="text-sm font-medium">Event timeline</h2>
          <p className="text-[11px] text-muted">
            {data.note} Post-terminal human signals:{" "}
            {data.diagnostics?.postTerminalHumanSignals ?? 0}.
          </p>
          <EventTimeline
            events={data.events ?? []}
            extraTerminal={data.diagnostics?.extraTerminal}
          />
        </>
      ) : null}
    </div>
  );
}
