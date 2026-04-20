"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

interface CellStats {
  total: number;
  quoted: number;
  signed: number;
  lost: number;
  new: number;
}

interface PeriodMeta {
  key: string;
  label: string;
  start: string;
  end: string;
}

interface RepRow {
  id: string;
  name: string;
  email: string;
  cells: Record<string, CellStats>;
  rowTotal: CellStats;
}

interface MatrixResponse {
  viewType: ViewType;
  granularity: "week" | "month" | "quarter";
  periods: PeriodMeta[];
  reps: RepRow[];
  colTotals: Record<string, CellStats>;
  grandTotal: CellStats;
}

type ViewType = "customer" | "activity";

interface SalesRep {
  id: string;
  name: string;
  email: string;
  customerCount: number;
}

type Granularity = "week" | "month" | "quarter";

function defaultDateRange(): { start: string; end: string } {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const GRANULARITY_LABELS: Record<Granularity, string> = {
  week: "按周",
  month: "按月",
  quarter: "按季",
};

export default function SalesAnalyticsPage() {
  const { user, loading: userLoading, isSuperAdmin } = useCurrentUser();

  const defaults = useMemo(() => defaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [viewType, setViewType] = useState<ViewType>("customer");
  const [selectedReps, setSelectedReps] = useState<string[]>([]);

  const [reps, setReps] = useState<SalesRep[]>([]);
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 拉销售列表（只拉一次）
  useEffect(() => {
    if (!isSuperAdmin) return;
    apiFetch("/api/sales/reps")
      .then((r) => (r.ok ? r.json() : { reps: [] }))
      .then((d: { reps: SalesRep[] }) => setReps(d.reps || []))
      .catch(() => setReps([]));
  }, [isSuperAdmin]);

  const loadMatrix = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        granularity,
        viewType,
      });
      if (selectedReps.length > 0) {
        params.set("salesRepIds", selectedReps.join(","));
      }
      const res = await apiFetch(`/api/sales/analytics/customer-matrix?${params}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `加载失败 (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin, startDate, endDate, granularity, selectedReps, viewType]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  if (userLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }
  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] py-12">
          <Shield className="h-10 w-10 text-[#a63d3d]" />
          <p className="text-sm font-medium text-[#a63d3d]">无权限访问</p>
          <p className="text-xs text-[#a63d3d]">销售复盘页仅管理员可查看</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/sales"
          className="rounded-lg border border-border bg-white/80 p-1.5 text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <PageHeader
            title="销售复盘 · 交叉表"
            description={
              viewType === "customer"
                ? "按销售 × 时段查看客户数与漏斗状态。数据按『客户创建时间』切段，状态取客户当前状态。"
                : "按销售 × 时段查看业务活动。数据按『事件发生时间』切段：新客户按创建时间、报价/签单按发生时间分别计入。"
            }
          />
        </div>
      </div>

      {/* ── 视角切换 ── */}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-white/70 p-2">
        <span className="pl-2 text-xs text-muted">视角：</span>
        <button
          type="button"
          onClick={() => setViewType("customer")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            viewType === "customer"
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          客户时间（建档期）
        </button>
        <button
          type="button"
          onClick={() => setViewType("activity")}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            viewType === "activity"
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground"
          }`}
        >
          业务活动时间（发生期）
        </button>
        <span className="ml-auto pr-2 text-[10px] text-muted">
          {viewType === "customer"
            ? "看这批新客户后来转化得怎么样"
            : "看销售在这个时段实际做成了多少事"}
        </span>
      </div>

      {/* ── 筛选器 ── */}
      <div className="rounded-xl border border-border bg-white/70 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="block rounded-lg border border-border bg-white/80 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="block rounded-lg border border-border bg-white/80 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">粒度</label>
            <div className="inline-flex rounded-lg border border-border bg-white/80 p-0.5">
              {(["week", "month", "quarter"] as Granularity[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    granularity === g
                      ? "bg-accent text-white"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {GRANULARITY_LABELS[g]}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1 min-w-[240px]">
            <label className="text-xs text-muted">
              销售筛选（不选＝全部）
            </label>
            <select
              multiple
              value={selectedReps}
              onChange={(e) =>
                setSelectedReps(
                  Array.from(e.target.selectedOptions, (o) => o.value),
                )
              }
              className="w-full rounded-lg border border-border bg-white/80 px-2 py-1.5 text-sm"
              size={Math.min(4, Math.max(2, reps.length))}
            >
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.customerCount})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted">
              按住 Cmd/Ctrl 可多选
            </p>
          </div>
          <button
            type="button"
            onClick={loadMatrix}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "刷新"
            )}
          </button>
        </div>
      </div>

      {/* ── 总计卡片 ── */}
      {data && (
        <div
          className={`grid grid-cols-2 gap-3 md:grid-cols-${
            viewType === "customer" ? 5 : 4
          }`}
        >
          {viewType === "customer" ? (
            <>
              <StatTile label="总客户" value={data.grandTotal.total} tone="default" />
              <StatTile label="新线索" value={data.grandTotal.new} tone="blue" />
              <StatTile label="已报价" value={data.grandTotal.quoted} tone="orange" />
              <StatTile label="已成单" value={data.grandTotal.signed} tone="emerald" />
              <StatTile label="流失" value={data.grandTotal.lost} tone="red" />
            </>
          ) : (
            <>
              <StatTile label="总活动数" value={data.grandTotal.total} tone="default" />
              <StatTile label="新客户" value={data.grandTotal.new} tone="blue" />
              <StatTile label="创建报价" value={data.grandTotal.quoted} tone="orange" />
              <StatTile label="签单数" value={data.grandTotal.signed} tone="emerald" />
            </>
          )}
        </div>
      )}

      {/* ── 交叉表 ── */}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50/40 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : data ? (
        <MatrixTable data={data} dateRange={{ start: startDate, end: endDate }} />
      ) : null}
    </div>
  );
}

// ── 统计方块 ───────────────────────────────────────────────
function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "blue" | "orange" | "emerald" | "red";
}) {
  const toneClass: Record<typeof tone, string> = {
    default: "bg-white/70 text-foreground",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    red: "bg-red-50 text-red-700 border-red-100",
  } as const;
  return (
    <div
      className={`rounded-xl border border-border ${toneClass[tone]} px-4 py-3`}
    >
      <p className="text-xs opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// ── 交叉表 ─────────────────────────────────────────────────
function MatrixTable({
  data,
  dateRange,
}: {
  data: MatrixResponse;
  dateRange: { start: string; end: string };
}) {
  const metricRows: Array<{
    key: keyof CellStats;
    label: string;
    className: string;
  }> =
    data.viewType === "customer"
      ? [
          { key: "total", label: "总数", className: "text-foreground font-medium" },
          { key: "quoted", label: "已报价", className: "text-orange-600" },
          { key: "signed", label: "已成单", className: "text-emerald-600" },
        ]
      : [
          { key: "new", label: "新客户", className: "text-blue-600" },
          { key: "quoted", label: "报价", className: "text-orange-600" },
          { key: "signed", label: "签单", className: "text-emerald-600 font-medium" },
        ];

  if (data.reps.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-white/40 py-12 text-center text-sm text-muted">
        所选时间区间 / 销售范围内没有客户记录
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white/70">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-white/50 text-xs text-muted">
            <th className="sticky left-0 z-10 bg-white/80 px-4 py-2.5 text-left font-medium">
              销售 / 指标
            </th>
            {data.periods.map((p) => (
              <th
                key={p.key}
                className="px-3 py-2.5 text-right font-medium whitespace-nowrap"
              >
                {p.label}
              </th>
            ))}
            <th className="px-3 py-2.5 text-right font-medium bg-muted/10">
              合计
            </th>
          </tr>
        </thead>
        <tbody>
          {data.reps.map((rep) => (
            <RepBlock
              key={rep.id}
              rep={rep}
              periods={data.periods}
              metricRows={metricRows}
              dateRange={dateRange}
              drillEnabled={data.viewType === "customer"}
            />
          ))}

          {/* 列合计 */}
          {metricRows.map((m, idx) => (
            <tr
              key={`total-${m.key}`}
              className={`bg-muted/10 ${idx === 0 ? "border-t-2 border-border" : ""} ${
                idx === metricRows.length - 1 ? "border-b-0" : ""
              }`}
            >
              {idx === 0 && (
                <td
                  className="sticky left-0 bg-muted/10 px-4 py-2 text-xs font-semibold text-foreground"
                  rowSpan={metricRows.length}
                >
                  全体合计
                </td>
              )}
              {data.periods.map((p) => (
                <td
                  key={p.key}
                  className={`px-3 py-1.5 text-right tabular-nums ${m.className}`}
                >
                  {data.colTotals[p.key]?.[m.key] || "–"}
                </td>
              ))}
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${m.className} bg-muted/20`}
              >
                <span className="font-semibold">
                  {data.grandTotal[m.key] || "–"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// total → 不带 funnelStatus；quoted/signed → 对应 funnel 过滤
function buildDrillUrl(params: {
  repId: string;
  periodStart?: string; // ISO
  periodEnd?: string;
  overallStart?: string; // YYYY-MM-DD fallback（合计列用）
  overallEnd?: string;
  metric: keyof CellStats;
}): string {
  const sp = new URLSearchParams();
  sp.set("view", "customers");
  sp.set("createdById", params.repId);

  let sd: string | undefined;
  let ed: string | undefined;
  if (params.periodStart && params.periodEnd) {
    sd = params.periodStart.slice(0, 10);
    // period.end 是 exclusive 的次段开始，-1 天作为 inclusive 结束
    const endD = new Date(params.periodEnd);
    endD.setDate(endD.getDate() - 1);
    ed = endD.toISOString().slice(0, 10);
  } else if (params.overallStart && params.overallEnd) {
    sd = params.overallStart;
    ed = params.overallEnd;
  }
  if (sd) sp.set("startDate", sd);
  if (ed) sp.set("endDate", ed);

  if (params.metric === "quoted" || params.metric === "signed") {
    sp.set("funnelStatus", params.metric);
  }
  return `/sales?${sp.toString()}`;
}

function RepBlock({
  rep,
  periods,
  metricRows,
  dateRange,
  drillEnabled,
}: {
  rep: RepRow;
  periods: PeriodMeta[];
  metricRows: Array<{
    key: keyof CellStats;
    label: string;
    className: string;
  }>;
  dateRange: { start: string; end: string };
  drillEnabled: boolean;
}) {
  return (
    <>
      {metricRows.map((m, idx) => (
        <tr
          key={m.key}
          className={
            idx === 0
              ? "border-t border-border"
              : idx === metricRows.length - 1
              ? "border-b-0"
              : ""
          }
        >
          {idx === 0 && (
            <td
              rowSpan={metricRows.length}
              className="sticky left-0 z-10 bg-white/80 px-4 py-2 align-top"
            >
              <p className="text-sm font-medium">{rep.name}</p>
              <p className="mt-0.5 text-[10px] text-muted">{rep.email}</p>
            </td>
          )}
          {periods.map((p) => {
            const cell = rep.cells[p.key];
            const value = cell ? cell[m.key] : 0;
            if (!value) {
              return (
                <td
                  key={p.key}
                  className={`px-3 py-1.5 text-right tabular-nums ${m.className}`}
                >
                  –
                </td>
              );
            }
            if (!drillEnabled) {
              return (
                <td
                  key={p.key}
                  className={`px-3 py-1.5 text-right tabular-nums ${m.className}`}
                >
                  {value}
                </td>
              );
            }
            const href = buildDrillUrl({
              repId: rep.id,
              periodStart: p.start,
              periodEnd: p.end,
              metric: m.key,
            });
            return (
              <td
                key={p.key}
                className={`px-0 py-0 text-right tabular-nums ${m.className}`}
              >
                <Link
                  href={href}
                  className="block px-3 py-1.5 hover:bg-accent/10 hover:underline"
                  title={`查看该销售在 ${p.label} 内的客户`}
                >
                  {value}
                </Link>
              </td>
            );
          })}
          {/* 合计列：钻取"整个时间区间"的该销售该状态（仅 customer 视角） */}
          <td
            className={`px-0 py-0 text-right tabular-nums ${m.className} bg-muted/10`}
          >
            {rep.rowTotal[m.key] ? (
              drillEnabled ? (
                <Link
                  href={buildDrillUrl({
                    repId: rep.id,
                    overallStart: dateRange.start,
                    overallEnd: dateRange.end,
                    metric: m.key,
                  })}
                  className="block px-3 py-1.5 font-semibold hover:bg-accent/10 hover:underline"
                  title="查看整个区间的该销售客户"
                >
                  {rep.rowTotal[m.key]}
                </Link>
              ) : (
                <span className="block px-3 py-1.5 font-semibold">
                  {rep.rowTotal[m.key]}
                </span>
              )
            ) : (
              <span className="block px-3 py-1.5 font-semibold">–</span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
