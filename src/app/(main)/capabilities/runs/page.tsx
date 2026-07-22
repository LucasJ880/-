"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type RunItem = {
  runId: string;
  traceId: string | null;
  startedAt: string | null;
  status: string;
  executionType: string;
  agentOrSkill: string | null;
  workspaceId: string | null;
  projectId: string | null;
  userId: string | null;
  model: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  currency: string | null;
  toolCallCount: number;
  waitingApproval: boolean;
  hasError: boolean;
};

type UsageSummary = {
  monthTotal: number;
  last24hTotal: number;
  currency: string;
  byModel: Array<{ key: string; costAmount: number; callCount: number }>;
};

export default function CapabilitiesRunsPage() {
  const [items, setItems] = useState<RunItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [hasErrorOnly, setHasErrorOnly] = useState(false);
  const [waitingOnly, setWaitingOnly] = useState(false);
  const [summary, setSummary] = useState<UsageSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (status) qs.set("status", status);
      if (hasErrorOnly) qs.set("hasError", "true");
      if (waitingOnly) qs.set("waitingApproval", "true");

      const [runsRes, sumRes] = await Promise.all([
        apiFetch(`/api/capabilities/runs?${qs}`),
        apiFetch("/api/capabilities/usage/summary"),
      ]);

      if (runsRes.status === 403) {
        setError("无企业成员身份，无法访问运行中心");
        setItems([]);
        return;
      }
      if (!runsRes.ok) {
        setError("加载运行列表失败");
        return;
      }
      const data = (await runsRes.json()) as {
        items: RunItem[];
        total: number;
      };
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);

      if (sumRes.ok) {
        setSummary((await sumRes.json()) as UsageSummary);
      }
    } finally {
      setLoading(false);
    }
  }, [page, status, hasErrorOnly, waitingOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="运行中心"
        description="查看 Agent 执行记录、Trace 与 AI 使用成本（当前企业）"
      />

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">本月费用</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              ${summary.monthTotal.toFixed(4)}
            </p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">近 24 小时</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              ${summary.last24hTotal.toFixed(4)}
            </p>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">Top 模型</p>
            <p className="mt-1 text-sm">
              {summary.byModel[0]
                ? `${summary.byModel[0].key} · $${summary.byModel[0].costAmount.toFixed(4)}`
                : "暂无"}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">全部状态</option>
          <option value="SUCCEEDED">成功</option>
          <option value="FAILED">失败</option>
          <option value="RUNNING">运行中</option>
          <option value="WAITING_APPROVAL">待审批</option>
          <option value="QUEUED">排队</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasErrorOnly}
            onChange={(e) => {
              setPage(1);
              setHasErrorOnly(e.target.checked);
            }}
          />
          仅错误
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={waitingOnly}
            onChange={(e) => {
              setPage(1);
              setWaitingOnly(e.target.checked);
            }}
          />
          待审批
        </label>
        <span className="text-sm text-muted-foreground">共 {total} 条</span>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">开始时间</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">类型</th>
              <th className="px-3 py-2 font-medium">Agent/Skill</th>
              <th className="px-3 py-2 font-medium">模型</th>
              <th className="px-3 py-2 font-medium">耗时</th>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">费用</th>
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium">标记</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-3 py-6 text-muted-foreground" colSpan={10}>
                  加载中…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted-foreground" colSpan={10}>
                  暂无运行记录
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.runId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/capabilities/runs/${r.runId}${r.traceId ? `?traceId=${encodeURIComponent(r.traceId)}` : ""}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {r.startedAt
                        ? new Date(r.startedAt).toLocaleString()
                        : "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">{r.executionType}</td>
                  <td className="px-3 py-2">{r.agentOrSkill ?? "—"}</td>
                  <td className="px-3 py-2">{r.model ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.durationMs != null ? `${r.durationMs}ms` : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.totalTokens ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.totalCost != null
                      ? `$${r.totalCost.toFixed(4)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.toolCallCount}</td>
                  <td className="px-3 py-2">
                    {r.hasError ? (
                      <span className="text-destructive">错误</span>
                    ) : null}
                    {r.waitingApproval ? (
                      <span className="ml-1 text-amber-700">待审批</span>
                    ) : null}
                    {!r.hasError && !r.waitingApproval ? "—" : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          上一页
        </button>
        <span className="text-sm text-muted-foreground">第 {page} 页</span>
        <button
          type="button"
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40"
          disabled={loading || page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
