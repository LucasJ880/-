"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type RunItem = {
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
};

export default function AutopilotRunsPage() {
  const [items, setItems] = useState<RunItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiFetch("/api/autopilot/runs?page=1&pageSize=50");
    if (res.status === 403 || res.status === 401) {
      setError("无权访问 Autopilot Runs");
      setItems([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("加载 Runs 失败");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { items: RunItem[]; total: number };
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PageHeader
        title="Autopilot Runs"
        description="观察真实 Agent Runtime 数据。本页重点是可观测性，不是视觉。"
        breadcrumbs={
          <Link href="/ai/autopilot" className="hover:underline">
            Autopilot
          </Link>
        }
      />

      {loading ? <p className="text-sm text-muted">加载中…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <p className="text-xs text-muted">共 {total} 条</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Run ID</th>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium">Latency</th>
              <th className="px-3 py-2 font-medium">Tool Calls</th>
              <th className="px-3 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td className="px-3 py-6 text-muted" colSpan={9}>
                  DATA NOT AVAILABLE YET
                </td>
              </tr>
            ) : null}
            {items.map((row) => (
              <tr key={row.runId} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link
                    className="text-primary underline"
                    href={`/ai/autopilot/runs/${row.runId}`}
                  >
                    {row.runId}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{row.time}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.userId ?? "—"}</td>
                <td className="px-3 py-2">{row.agent ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.projectId ?? "—"}
                </td>
                <td className="px-3 py-2">{row.outcome}</td>
                <td className="px-3 py-2">
                  {row.latencyMs == null ? "—" : `${row.latencyMs}ms`}
                </td>
                <td className="px-3 py-2">{row.toolCallCount}</td>
                <td className="px-3 py-2">{row.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
