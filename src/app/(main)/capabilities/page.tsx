"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

type RunsSummary = {
  total?: number;
  items?: Array<{
    id: string;
    status?: string;
    capabilityKey?: string | null;
    startedAt?: string | null;
    executionType?: string;
  }>;
};

type ApprovalsSummary = {
  total?: number;
};

export default function CapabilitiesOverviewPage() {
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runsTotal, setRunsTotal] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [failedRuns, setFailedRuns] = useState(0);
  const [recent, setRecent] = useState<RunsSummary["items"]>([]);
  const [monthCost, setMonthCost] = useState<string>("—");

  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    try {
      const [runsRes, apprRes, usageRes] = await Promise.all([
        apiFetch("/api/capabilities/runs?pageSize=8"),
        apiFetch("/api/capabilities/approvals?tab=pending_mine&pageSize=1"),
        apiFetch("/api/capabilities/usage/summary").catch(() => null),
      ]);

      if (runsRes.status === 403 || apprRes.status === 403) {
        setForbidden(true);
        return;
      }

      if (runsRes.ok) {
        const data = (await runsRes.json()) as RunsSummary & {
          aggregate?: { failed?: number; succeeded?: number };
        };
        setRunsTotal(data.total ?? data.items?.length ?? 0);
        setRecent(data.items ?? []);
        const failed =
          data.aggregate?.failed ??
          (data.items ?? []).filter((i) =>
            String(i.status).toUpperCase().includes("FAIL"),
          ).length;
        setFailedRuns(failed);
      }
      if (apprRes.ok) {
        const data = (await apprRes.json()) as ApprovalsSummary;
        setPendingApprovals(data.total ?? 0);
      }
      if (usageRes && usageRes.ok) {
        const data = (await usageRes.json()) as { monthTotal?: number | string };
        if (data.monthTotal != null) setMonthCost(String(data.monthTotal));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <div className="space-y-4 p-6">
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
    <div className="space-y-8 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          title="企业能力中台"
          description="统一管理企业的 AI 能力、运行、审批、成本与治理"
        />
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
            查看待审批
          </Link>
          <Link
            href="/capabilities/config-health"
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
          >
            配置健康
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <StatCard label="今日/近期运行" value={String(runsTotal)} />
            <StatCard label="待审批" value={String(pendingApprovals)} />
            <StatCard label="运行失败" value={String(failedRuns)} />
            <StatCard label="本月 AI 成本" value={monthCost} />
            <StatCard label="配额状态" value="见治理中心" />
            <StatCard label="配置健康" value="查看详情" />
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">需要处理</h2>
            <ul className="space-y-2 text-sm">
              <ActionRow
                label="等待审批"
                value={String(pendingApprovals)}
                href="/capabilities/approvals"
              />
              <ActionRow
                label="运行失败"
                value={String(failedRuns)}
                href="/capabilities/runs"
              />
              <ActionRow
                label="配置异常"
                value="查看"
                href="/capabilities/config-health"
              />
              <ActionRow
                label="接近配额"
                value="治理中心"
                href="/capabilities/governance"
              />
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">最近运行</h2>
            {(recent ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无运行记录</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {(recent ?? []).map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/capabilities/runs/${r.id}`}
                      className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/40"
                    >
                      <span className="truncate">
                        {r.capabilityKey || r.executionType || r.id}
                      </span>
                      <span className="ml-3 shrink-0 text-muted-foreground">
                        {r.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">能力状态</h2>
            <p className="text-sm text-muted-foreground">
              已启用 Agent / Skill / Tool 与 Workspace 覆盖详见
              <Link
                href="/capabilities/catalog"
                className="mx-1 text-[var(--accent)] underline-offset-2 hover:underline"
              >
                能力目录
              </Link>
              。
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function ActionRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/40"
      >
        <span>{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </Link>
    </li>
  );
}
