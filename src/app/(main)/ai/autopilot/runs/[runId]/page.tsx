"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type TraceEvent = {
  id: string;
  eventType: string;
  sequence: number;
  timestamp: string;
  durationMs: number | null;
  payload: Record<string, unknown> | null;
};

type RunDetail = {
  runId: string;
  time: string;
  userId: string | null;
  agent: string | null;
  projectId: string | null;
  outcome: string;
  latencyMs: number | null;
  toolCallCount: number;
  error: string | null;
  status: string;
  intent: string | null;
  failureType: string | null;
  humanOverride: boolean;
  humanEdit: boolean;
  reAskStatus: string;
  events: TraceEvent[];
  pendingActions: Array<{ id: string; type: string; status: string }>;
};

export default function AutopilotRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params?.runId;
  const [data, setData] = useState<RunDetail | null>(null);
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
      setData((await res.json()) as RunDetail);
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
        description="Sanitized trace。不含完整 Prompt / credential。"
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

      {data ? (
        <>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>Outcome: {data.outcome}</div>
            <div>Status: {data.status}</div>
            <div>User: {data.userId ?? "—"}</div>
            <div>Agent: {data.agent ?? "—"}</div>
            <div>Project: {data.projectId ?? "—"}</div>
            <div>Latency: {data.latencyMs == null ? "—" : `${data.latencyMs}ms`}</div>
            <div>Tool Calls: {data.toolCallCount}</div>
            <div>Failure: {data.failureType ?? "—"}</div>
            <div>Human Override: {data.humanOverride ? "true" : "false"}</div>
            <div>Human Edit: {data.humanEdit ? "true" : "false"}</div>
            <div>Re-Ask: {data.reAskStatus}</div>
            <div>Error: {data.error ?? "—"}</div>
          </dl>

          <h2 className="text-sm font-medium">Trace</h2>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted">DATA NOT AVAILABLE YET</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {data.events.map((event) => (
                <li
                  key={event.id}
                  className="rounded border border-border p-2 font-mono text-xs"
                >
                  <div>
                    {event.sequence} · {event.eventType} · {event.timestamp}
                    {event.durationMs != null ? ` · ${event.durationMs}ms` : ""}
                  </div>
                  {event.payload ? (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted">
                      {JSON.stringify(event.payload)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <h2 className="text-sm font-medium">Pending Actions</h2>
          {data.pendingActions.length === 0 ? (
            <p className="text-sm text-muted">无</p>
          ) : (
            <ul className="text-sm">
              {data.pendingActions.map((a) => (
                <li key={a.id}>
                  {a.type} · {a.status}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
