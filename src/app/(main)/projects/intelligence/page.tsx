"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  GitCompare,
  Lightbulb,
  Loader2,
  Package2,
  RefreshCw,
  Network,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiJson } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";

type Rule = {
  id: string;
  title: string;
  content: string;
  category: string;
  status: string;
  sourceProjectId: string | null;
};

type IntelPayload = {
  orgId: string;
  rules: Rule[];
  suppliers: Array<{
    supplierId: string;
    name: string;
    inquiryCount: number;
    repliedCount: number;
    selectedCount: number;
    replyRate: number;
    selectRate: number;
    avgDeliveryDays: number | null;
    avgUnitPrice: number | null;
    currency: string | null;
  }>;
  prices: {
    points: Array<{
      projectId: string;
      name: string;
      date: string;
      ourBidPrice: number | null;
      winningBidPrice: number | null;
      winningAsPctOfOurs: number | null;
      oursPremiumPctVsWinning: number | null;
      tenderStatus: string | null;
    }>;
    avgWinningAsPctOfOurs: number | null;
    avgOursPremiumPct: number | null;
  };
  patterns: {
    clients: Array<{
      client: string;
      total: number;
      won: number;
      lost: number;
      winRate: number;
      topReasons: Array<{ reason: string; count: number }>;
    }>;
    competitionReasonTags: Array<{ reason: string; count: number }>;
    marketCompetitors: Array<{
      id: string;
      name: string;
      primaryProduct: string | null;
    }>;
  };
  graph: {
    nodes: {
      projects: number;
      activeRules: number;
      confirmedReviews: number;
      suppliers: number;
    };
    note: string;
  };
};

type CompareRow = {
  id: string;
  name: string;
  tenderStatus: string | null;
  ourBidPrice: number | null;
  winningBidPrice: number | null;
  riskLevel: string | null;
  reviewOutcome: string | null;
  reasonTags: string[];
  intelligenceSummary: string | null;
};

export default function ProjectIntelligencePage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [data, setData] = useState<IntelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<
    "rules" | "suppliers" | "prices" | "patterns" | "compare"
  >("rules");
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState("");
  const [compareRows, setCompareRows] = useState<CompareRow[]>([]);
  const [compareError, setCompareError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiJson<IntelPayload>(
        `/api/org/project-intelligence?orgId=${encodeURIComponent(orgId)}`,
      );
      setData(res);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (!orgLoading) void load();
  }, [orgLoading, load]);

  const proposed = useMemo(
    () => data?.rules.filter((r) => r.status === "proposed") ?? [],
    [data],
  );
  const active = useMemo(
    () => data?.rules.filter((r) => r.status === "active") ?? [],
    [data],
  );

  const decideRule = async (
    ruleId: string,
    decision: "activate" | "reject" | "archive",
  ) => {
    if (!orgId) return;
    setBusyRule(ruleId);
    try {
      await apiJson(`/api/org/project-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, action: "decide", ruleId, decision }),
      });
      await load();
    } catch {
      /* ignore */
    }
    setBusyRule(null);
  };

  const runCompare = async () => {
    setCompareError(null);
    const projectIds = compareIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await apiJson<{ projects: CompareRow[] }>(
        `/api/projects/compare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectIds }),
        },
      );
      setCompareRows(res.projects ?? []);
    } catch (e) {
      setCompareRows([]);
      setCompareError(e instanceof Error ? e.message : "对比失败");
    }
  };

  if (ambiguous) {
    return (
      <div className="p-6">
        <PageHeader
          title="项目智能中心"
          description="请先在左上角选择组织。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <PageHeader
        title="项目智能中心"
        description="Phase 2：企业规则、供应商表现、价格趋势、客户/竞争规律与批量对比。规则须人工确认后生效。"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/30"
          >
            <RefreshCw size={13} />
            刷新
          </button>
        }
      />

      {data?.graph ? (
        <div className="flex flex-wrap gap-3 text-[12px]">
          <span className="rounded-lg border border-border px-3 py-1.5">
            <Network size={12} className="mr-1 inline" />
            项目 {data.graph.nodes.projects}
          </span>
          <span className="rounded-lg border border-border px-3 py-1.5">
            生效规则 {data.graph.nodes.activeRules}
          </span>
          <span className="rounded-lg border border-border px-3 py-1.5">
            已确认复盘 {data.graph.nodes.confirmedReviews}
          </span>
          <span className="rounded-lg border border-border px-3 py-1.5">
            供应商 {data.graph.nodes.suppliers}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {(
          [
            ["rules", "企业规则", Lightbulb],
            ["suppliers", "供应商表现", Package2],
            ["prices", "价格趋势", BarChart3],
            ["patterns", "客户/竞争", Network],
            ["compare", "批量对比", GitCompare],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs",
              tab === key
                ? "bg-accent text-white"
                : "border border-border hover:bg-muted/20",
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {loading || orgLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> 加载中
        </div>
      ) : !data ? (
        <p className="text-sm text-muted">加载失败或暂无数据</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "rules" ? (
            <div className="space-y-4">
              <section>
                <h3 className="text-sm font-semibold">
                  待确认草案（{proposed.length}）
                </h3>
                {proposed.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">
                    确认项目复盘后，系统会按失败/经验标签提出规则草案。
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {proposed.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-lg border border-border px-3 py-2 text-[12px]"
                      >
                        <div className="font-medium">
                          [{r.category}] {r.title}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-muted">
                          {r.content.slice(0, 400)}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={busyRule === r.id}
                            onClick={() => void decideRule(r.id, "activate")}
                            className="rounded-md bg-accent px-2.5 py-1 text-[11px] text-white"
                          >
                            确认为生效规则
                          </button>
                          <button
                            type="button"
                            disabled={busyRule === r.id}
                            onClick={() => void decideRule(r.id, "reject")}
                            className="rounded-md border border-border px-2.5 py-1 text-[11px]"
                          >
                            拒绝
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h3 className="text-sm font-semibold">
                  已生效（{active.length}）
                </h3>
                <ul className="mt-2 space-y-1.5 text-[12px]">
                  {active.map((r) => (
                    <li key={r.id} className="rounded border border-border/60 px-2 py-1.5">
                      <span className="text-muted">[{r.category}]</span> {r.title}
                      {r.sourceProjectId ? (
                        <Link
                          href={`/projects/${r.sourceProjectId}`}
                          className="ml-2 text-accent hover:underline"
                        >
                          来源项目
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {tab === "suppliers" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-muted">
                  <tr>
                    <th className="py-2 pr-3">供应商</th>
                    <th className="py-2 pr-3">询价</th>
                    <th className="py-2 pr-3">回复率</th>
                    <th className="py-2 pr-3">选中率</th>
                    <th className="py-2 pr-3">均交期</th>
                    <th className="py-2">均单价</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suppliers.map((s) => (
                    <tr key={s.supplierId} className="border-t border-border/50">
                      <td className="py-2 pr-3 font-medium">{s.name}</td>
                      <td className="py-2 pr-3">{s.inquiryCount}</td>
                      <td className="py-2 pr-3">{s.replyRate}%</td>
                      <td className="py-2 pr-3">{s.selectRate}%</td>
                      <td className="py-2 pr-3">
                        {s.avgDeliveryDays != null ? `${s.avgDeliveryDays}d` : "—"}
                      </td>
                      <td className="py-2">
                        {s.avgUnitPrice != null
                          ? `${s.avgUnitPrice} ${s.currency || ""}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.suppliers.length === 0 ? (
                <p className="text-xs text-muted">暂无询价数据</p>
              ) : null}
            </div>
          ) : null}

          {tab === "prices" ? (
            <div className="space-y-3">
              <p className="text-[12px]">
                平均中标价为我方报价的{" "}
                <strong>{data.prices.avgWinningAsPctOfOurs ?? "—"}%</strong>
                ；平均溢价{" "}
                <strong>{data.prices.avgOursPremiumPct ?? "—"}%</strong>
              </p>
              <ul className="space-y-2 text-[12px]">
                {data.prices.points.map((p) => (
                  <li
                    key={p.projectId}
                    className="rounded border border-border/60 px-3 py-2"
                  >
                    <Link
                      href={`/projects/${p.projectId}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="ml-2 text-muted">
                      {p.date.slice(0, 10)} · {p.tenderStatus || "—"}
                    </span>
                    <div className="mt-1 text-muted">
                      我方 {p.ourBidPrice ?? "—"} / 中标 {p.winningBidPrice ?? "—"}
                      {p.winningAsPctOfOurs != null
                        ? ` · 中标为我方 ${p.winningAsPctOfOurs}%`
                        : ""}
                      {p.oursPremiumPctVsWinning != null
                        ? ` · 溢价 ${p.oursPremiumPctVsWinning}%`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "patterns" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold">客户规律</h3>
                <ul className="mt-2 space-y-2 text-[12px]">
                  {data.patterns.clients.map((c) => (
                    <li
                      key={c.client}
                      className="rounded border border-border/60 px-3 py-2"
                    >
                      <div className="font-medium">{c.client}</div>
                      <div className="text-muted">
                        {c.total} 个项目 · 胜率 {c.winRate}%（胜 {c.won} / 负{" "}
                        {c.lost}）
                      </div>
                      {c.topReasons.length ? (
                        <div className="mt-1 text-muted">
                          常见原因：
                          {c.topReasons.map((r) => r.reason).join("、")}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="text-sm font-semibold">竞争规律</h3>
                <ul className="mt-2 space-y-1 text-[12px]">
                  {data.patterns.competitionReasonTags.map((r) => (
                    <li key={r.reason}>
                      {r.reason} · {r.count}
                    </li>
                  ))}
                </ul>
                <h4 className="mt-4 text-xs font-semibold text-muted">
                  市场竞品库
                </h4>
                <ul className="mt-1 space-y-1 text-[12px]">
                  {data.patterns.marketCompetitors.map((c) => (
                    <li key={c.id}>
                      {c.name}
                      {c.primaryProduct ? ` · ${c.primaryProduct}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {tab === "compare" ? (
            <div className="space-y-3">
              <p className="text-[12px] text-muted">
                输入 2–8 个项目 ID（逗号或空格分隔）。可从项目详情 URL 复制。
              </p>
              <textarea
                value={compareIds}
                onChange={(e) => setCompareIds(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
                placeholder="projectId1, projectId2"
              />
              <button
                type="button"
                onClick={() => void runCompare()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white"
              >
                开始对比
              </button>
              {compareError ? (
                <p className="text-[11px] text-red-500">{compareError}</p>
              ) : null}
              {compareRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="py-1 pr-2">项目</th>
                        <th className="py-1 pr-2">状态</th>
                        <th className="py-1 pr-2">风险</th>
                        <th className="py-1 pr-2">我方/中标</th>
                        <th className="py-1">复盘标签</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((r) => (
                        <tr key={r.id} className="border-t border-border/50 align-top">
                          <td className="py-2 pr-2">
                            <Link
                              href={`/projects/${r.id}`}
                              className="text-accent hover:underline"
                            >
                              {r.name}
                            </Link>
                            <div className="text-muted">
                              {r.intelligenceSummary?.slice(0, 80)}
                            </div>
                          </td>
                          <td className="py-2 pr-2">
                            {r.tenderStatus || r.reviewOutcome || "—"}
                          </td>
                          <td className="py-2 pr-2">{r.riskLevel || "—"}</td>
                          <td className="py-2 pr-2">
                            {r.ourBidPrice ?? "—"} / {r.winningBidPrice ?? "—"}
                          </td>
                          <td className="py-2">
                            {r.reasonTags.join("、") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
