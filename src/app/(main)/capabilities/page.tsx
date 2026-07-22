"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type Overview = {
  orgId: string;
  orgName: string;
  metrics: {
    todayRuns: number | null;
    successRateToday: number | null;
    pendingApprovals: number | null;
    monthCost: number | null;
    currency: string;
    quotaLevel: string | null;
    configOverall: string | null;
  };
  metricsError?: string;
  actions: Array<{
    code: string;
    severity: string;
    title: string;
    count?: number;
    href: string;
  }>;
  recentRuns: Array<{
    runId: string;
    label: string;
    status: string;
    workspaceId: string | null;
    durationMs: number | null;
    totalCost: number | null;
    startedAt: string | null;
  }>;
  capabilityCounts: {
    agents: number;
    skills: number;
    tools: number;
    workflows: number;
    knowledgeBases: number;
    industryPacks: number;
    workspaces: number;
  } | null;
};

function fmtMetric(v: number | null | undefined, suffix = ""): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v}${suffix}`;
}

function fmtCost(v: number | null | undefined, currency: string): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${currency} ${v.toFixed(4)}`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function CapabilitiesOverviewPage() {
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setError(null);
    try {
      const res = await apiFetch("/api/capabilities/overview");
      if (res.status === 403) {
        setForbidden(true);
        setData(null);
        return;
      }
      if (!res.ok) {
        setError("加载中台总览失败（不展示伪造指标）");
        setData(null);
        return;
      }
      setData((await res.json()) as Overview);
    } catch {
      setError("加载中台总览失败（不展示伪造指标）");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="企业能力中台"
          description="需要企业成员身份才能访问"
        />
        <p className="text-sm text-muted-foreground">
          当前账号无企业 membership，或平台管理员未加入任何企业。请先加入企业后再进入中台。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">
            {data?.orgName ? `${data.orgName} · 企业能力中台` : "企业能力中台"}
          </p>
          <PageHeader
            title="企业能力中台"
            description="统一管理企业的 AI 能力、运行、审批、成本与治理"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/capabilities/runs"
            className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white"
          >
            查看运行中心
          </Link>
          <Link
            href="/capabilities/approvals"
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            处理待审批
          </Link>
          <Link
            href="/capabilities/config-health"
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
          >
            查看配置健康
          </Link>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">加载中…</p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {data?.metricsError && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          部分指标加载失败：{data.metricsError}
        </p>
      )}

      {data && !loading && (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <StatCard
              label="今日运行数"
              value={fmtMetric(data.metrics.todayRuns)}
            />
            <StatCard
              label="运行成功率"
              value={fmtMetric(data.metrics.successRateToday, "%")}
            />
            <StatCard
              label="待审批"
              value={fmtMetric(data.metrics.pendingApprovals)}
            />
            <StatCard
              label="本月 AI 成本"
              value={fmtCost(data.metrics.monthCost, data.metrics.currency)}
            />
            <StatCard
              label="配额状态"
              value={data.metrics.quotaLevel ?? "—"}
            />
            <StatCard
              label="配置健康"
              value={data.metrics.configOverall ?? "—"}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">需要处理</h2>
            {data.actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无待处理事项</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.actions.map((a) => (
                  <li key={`${a.code}-${a.title}`}>
                    <Link
                      href={a.href}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/40"
                    >
                      <span>
                        <span className="mr-2 text-[10px] font-semibold text-muted-foreground">
                          {a.severity}
                        </span>
                        {a.title}
                      </span>
                      <span className="text-muted-foreground">
                        {a.count != null ? a.count : "查看"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">最近运行</h2>
              <Link
                href="/capabilities/runs"
                className="text-xs text-[var(--accent)]"
              >
                全部 →
              </Link>
            </div>
            {data.recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无运行记录</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {data.recentRuns.map((r) => (
                  <li key={r.runId}>
                    <Link
                      href={`/capabilities/runs/${r.runId}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-muted/40"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {r.label}
                      </span>
                      <span className="flex shrink-0 gap-3 text-xs text-muted-foreground">
                        <span>{r.status}</span>
                        <span>{fmtDuration(r.durationMs)}</span>
                        <span>
                          {r.totalCost != null
                            ? `$${r.totalCost.toFixed(4)}`
                            : "—"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">能力状态</h2>
              <Link
                href="/capabilities/catalog"
                className="text-xs text-[var(--accent)]"
              >
                打开能力目录 →
              </Link>
            </div>
            {!data.capabilityCounts ? (
              <p className="text-sm text-muted-foreground">
                能力计数暂不可用（不展示伪造 0）
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["Agent", data.capabilityCounts.agents],
                    ["Skill", data.capabilityCounts.skills],
                    ["Tool", data.capabilityCounts.tools],
                    ["Workflow", data.capabilityCounts.workflows],
                    ["Knowledge", data.capabilityCounts.knowledgeBases],
                    ["Industry Pack", data.capabilityCounts.industryPacks],
                    ["Workspace", data.capabilityCounts.workspaces],
                  ] as const
                ).map(([label, n]) => (
                  <Link
                    key={label}
                    href="/capabilities/catalog"
                    className="rounded-md border border-border px-3 py-2 hover:bg-muted/30"
                  >
                    <div className="text-[11px] text-muted-foreground">
                      {label}
                    </div>
                    <div className="text-lg font-semibold">{n}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-white/50 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
