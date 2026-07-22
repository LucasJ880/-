"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Detail = {
  visibility: string;
  accessMode: string;
  basic: {
    runId: string | null;
    traceId: string | null;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    organizationId: string;
    workspaceId: string | null;
    projectId: string | null;
    userId: string | null;
    entry: string | null;
    durationMs: number | null;
    totalCost: number;
    totalTokens: number;
    currency: string;
  };
  timeline: Array<{
    id: string;
    executionType: string;
    status: string;
    title?: string | null;
    eventType?: string | null;
    startedAt?: string | null;
    inputSummary?: string | null;
    outputSummary?: string | null;
  }>;
  modelCalls: Array<{
    id: string;
    provider: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    costAmount: number;
    status: string;
    pricingMode: string;
    retryCount: number;
  }>;
  error: {
    category: string;
    summary: string;
    internalCode: string | null;
    retryable: boolean | null;
    recovered: boolean | null;
  } | null;
};

export default function CapabilityRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const search = useSearchParams();
  const runId = params.runId;
  const traceId = search.get("traceId");

  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = traceId
          ? `?traceId=${encodeURIComponent(traceId)}`
          : "";
        const res = await apiFetch(
          `/api/capabilities/runs/${encodeURIComponent(runId)}${qs}`,
        );
        if (res.status === 403) {
          if (!cancelled) setError("无权限查看该运行");
          return;
        }
        if (res.status === 404) {
          if (!cancelled) setError("运行不存在");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError("加载失败");
          return;
        }
        const data = (await res.json()) as Detail;
        if (!cancelled) setDetail(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, traceId]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3 px-0">
        <Link
          href="/capabilities/runs"
          className="text-sm text-primary hover:underline"
        >
          ← 返回列表
        </Link>
        {detail ? (
          <span className="text-sm text-muted-foreground">
            可见性：{detail.visibility}（{detail.accessMode}）
          </span>
        ) : null}
      </div>
      <PageHeader title="运行详情" description="基于 Trace Read Model 与 AI 使用账本" />

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {detail ? (
        <>
          <section className="rounded-xl border p-4">
            <h2 className="text-sm font-semibold">基本信息</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">runId</dt>
                <dd className="font-mono text-xs">{detail.basic.runId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">traceId</dt>
                <dd className="font-mono text-xs">
                  {detail.basic.traceId ?? "（历史无 trace）"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">状态</dt>
                <dd>{detail.basic.status}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">入口</dt>
                <dd>{detail.basic.entry ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">时间</dt>
                <dd>
                  {detail.basic.startedAt
                    ? new Date(detail.basic.startedAt).toLocaleString()
                    : "—"}
                  {" → "}
                  {detail.basic.finishedAt
                    ? new Date(detail.basic.finishedAt).toLocaleString()
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Workspace / Project</dt>
                <dd>
                  {detail.basic.workspaceId ?? "—"} /{" "}
                  {detail.basic.projectId ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">用户</dt>
                <dd className="font-mono text-xs">
                  {detail.basic.userId ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">总耗时 / Token / 费用</dt>
                <dd>
                  {detail.basic.durationMs ?? "—"}ms ·{" "}
                  {detail.basic.totalTokens} · $
                  {detail.basic.totalCost.toFixed(4)}
                </dd>
              </div>
            </dl>
          </section>

          {detail.error ? (
            <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <h2 className="text-sm font-semibold text-destructive">错误</h2>
              <p className="mt-2 text-sm">{detail.error.summary}</p>
              {detail.error.internalCode ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {detail.error.internalCode}
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-xl border p-4">
            <h2 className="text-sm font-semibold">执行时间线</h2>
            <ol className="mt-3 space-y-3">
              {detail.timeline.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border bg-muted/20 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {item.title ?? item.eventType ?? item.executionType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.executionType} · {item.status}
                    </span>
                    {item.startedAt ? (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.startedAt).toLocaleTimeString()}
                      </span>
                    ) : null}
                  </div>
                  {item.inputSummary ? (
                    <p className="mt-1 text-muted-foreground">
                      {item.inputSummary}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-xl border p-4">
            <h2 className="text-sm font-semibold">模型调用</h2>
            {detail.modelCalls.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                暂无账本记录（历史运行可能无 trace / 未挂钩）
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Provider</th>
                      <th className="py-1 pr-3">Model</th>
                      <th className="py-1 pr-3">Token</th>
                      <th className="py-1 pr-3">延迟</th>
                      <th className="py-1 pr-3">费用</th>
                      <th className="py-1 pr-3">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.modelCalls.map((m) => (
                      <tr key={m.id} className="border-t">
                        <td className="py-2 pr-3">{m.provider}</td>
                        <td className="py-2 pr-3">{m.model ?? "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {m.inputTokens ?? "—"}/{m.outputTokens ?? "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {m.durationMs != null ? `${m.durationMs}ms` : "—"}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          ${m.costAmount.toFixed(4)}
                          {m.pricingMode === "estimated" ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              估
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
