"use client";

/**
 * 组织驾驶舱首页 — 工作量区块（A-4，openspec change org-cockpit-workload）
 *
 * 默认收起；用户点"查看近 14 天工作量"后才请求 GET /api/cockpit/workload（首屏请求数不变）。
 * WorkloadPanel / WorkloadSection 无 hooks，便于服务端静态渲染测试；OrgCockpitWorkload 只管点击加载。
 * 只读：规则命中只标红并给出原因，不提供任何改变数据的操作。
 */

import { useCallback, useState } from "react";
import { AlertTriangle, BarChart3, ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { formatCount } from "@/lib/cockpit/presentation";
import type { WorkloadCounts, WorkloadRow } from "@/lib/cockpit/workload";
import type { WorkloadResponse } from "@/lib/cockpit/workload-read-model";
import { cn } from "@/lib/utils";

const WORKLOAD_URL = "/api/cockpit/workload";
/** 与 src/lib/cockpit/workload.ts 的 TRADE_SHOW_ROW / UNATTRIBUTED_ROW 一致（测试核对）；全为 0 时隐藏 */
const HIDE_WHEN_EMPTY: ReadonlySet<string> = new Set(["inbound_sales_trade_show", "unattributed"]);

export type WorkloadState =
  | { status: "collapsed" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: WorkloadResponse };

// ── 容器 ──────────────────────────────────────────────────────

export function OrgCockpitWorkload() {
  const [state, setState] = useState<WorkloadState>({ status: "collapsed" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await apiFetch(WORKLOAD_URL, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`workload ${res.status}`);
      setState({ status: "ready", data: (await res.json()) as WorkloadResponse });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  return <WorkloadSection state={state} onExpand={() => void load()} onRetry={() => void load()} onCollapse={() => setState({ status: "collapsed" })} />;
}

// ── 区块外框（收起 / 加载中 / 失败 / 就绪） ────────────────────

export function WorkloadSection({
  state,
  onExpand,
  onRetry,
  onCollapse,
}: {
  state: WorkloadState;
  onExpand?: () => void;
  onRetry?: () => void;
  onCollapse?: () => void;
}) {
  return (
    <section aria-labelledby="cockpit-workload-heading" aria-busy={state.status === "loading" ? true : undefined} className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="cockpit-workload-heading" className="text-sm font-semibold text-foreground">
          工作量
        </h2>
        <span className="text-xs text-muted">AI 干了多少活、多少被采纳、哪些疑似白干</span>
      </div>
      <div className="mt-3">
        {state.status === "collapsed" ? (
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-card px-4 text-sm text-muted transition-colors hover:bg-muted/5 hover:text-foreground"
          >
            <BarChart3 size={15} />
            查看近 14 天工作量
            <ChevronDown size={14} />
          </button>
        ) : state.status === "loading" ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-border/60 bg-card text-sm text-muted">
            <Loader2 size={16} className="mr-2 animate-spin" />
            正在汇总近 14 天工作量…
          </div>
        ) : state.status === "error" ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted">
            <span>工作量加载失败</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-muted/5">
                <RefreshCw size={13} />
                重试
              </button>
            ) : null}
          </div>
        ) : (
          <WorkloadPanel data={state.data} onCollapse={onCollapse} />
        )}
      </div>
    </section>
  );
}

// ── 就绪：表格 + 走势 + 规则原因 + 说明 ──────────────────────

function isEmptyRow(row: WorkloadRow): boolean {
  return !row.costRecorded && row.daily.every((d) => Object.values(d).every((v) => v === 0));
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function percentText(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

const COLUMNS: Array<{ key: keyof WorkloadCounts; label: string; title: string }> = [
  { key: "agentRuns", label: "AI 运行", title: "本组织 AI 运行次数" },
  { key: "automationRuns", label: "平台自动化", title: "平台级自动化运行次数（不分组织，不参与判定）" },
  { key: "proposed", label: "提出", title: "新提出的待审批动作" },
  { key: "approved", label: "批准", title: "批准（含批准后执行失败）" },
  { key: "rejected", label: "驳回", title: "人工驳回（不含过期与取消）" },
  { key: "expired", label: "过期", title: "放到过期没人处理" },
  { key: "guardrailBlocked", label: "护栏拦截", title: "首封回复与跟进草稿被护栏拦下" },
];

export function WorkloadPanel({ data, onCollapse }: { data: WorkloadResponse; onCollapse?: () => void }) {
  const rows = data.rows.filter((row) => !(HIDE_WHEN_EMPTY.has(row.key) && isEmptyRow(row)));
  const t = data.thresholds;
  const flagged = rows.filter((r) => r.signals.length > 0).length;
  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <p className="text-xs text-muted">
          近 {data.signalWindowDays} 天合计 · 走势 {data.days.length} 天（{data.days[0]} 至 {data.days[data.days.length - 1]}，{data.timezone}）
          {flagged > 0 ? <span className="ml-2 text-danger">{flagged} 个岗位疑似无用功</span> : <span className="ml-2">暂无疑似无用功</span>}
        </p>
        {onCollapse ? (
          <button type="button" onClick={onCollapse} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-xs text-muted hover:text-foreground">
            收起
            <ChevronUp size={13} />
          </button>
        ) : null}
      </div>

      {data.truncated ? (
        <p className="border-b border-border/60 bg-warning-bg px-4 py-2 text-xs text-warning" role="status">
          数据量超过上限，部分统计不完整
        </p>
      ) : null}

      {/* 区块够宽（≥ 896px）用表格便于横向比较；更窄时每个岗位一张卡片，避免只看得到一两列 */}
      <div className="@container">
        <ul className="divide-y divide-border/60 @4xl:hidden">
          {rows.map((row) => (
            <WorkloadCard key={row.key} row={row} days={data.days} />
          ))}
        </ul>
        <div className="hidden overflow-x-auto @4xl:block">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th scope="col" className="sticky left-0 z-10 bg-card px-4 py-2 font-medium">
                  岗位
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} scope="col" title={c.title} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap">
                  成本
                </th>
                <th scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                  {data.days.length} 天走势
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <WorkloadTableRow key={row.key} row={row} days={data.days} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1 border-t border-border/60 px-4 py-3 text-[11px] leading-relaxed text-muted">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2 w-3 rounded-[1px] bg-muted/60" />
            上：AI 运行
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2 w-3 rounded-[1px] bg-accent" />
            下：提出（各自按本行最大值缩放，悬停看每天的数）
          </span>
        </p>
        <p>
          判定（近 {data.signalWindowDays} 天）：驳回率 &gt; {percentText(t.rejectRate)}、过期率 &gt; {percentText(t.expireRate)}（已决策 ≥ {t.minDecisions} 件才判）；有 AI 运行（≥ {t.idleMinRuns} 次）却没提出任何待审批算空转；每次批准成本 &gt; 各岗位中位数 {t.costMultiple} 倍（至少 {t.minCostPeers} 个岗位有成本才判）。只做提示，不会自动停用任何东西。
        </p>
        <p>改过再批：未接入（{data.availability.edited.reason}）。</p>
        <p>自动执行：不适用（{data.availability.autoExecuted.reason}）。</p>
        <p>平台自动化是平台级运行次数，不分组织，不参与判定。成本只统计已入账的 AI 用量（美元），没有任何记账的岗位显示「未入账」。</p>
      </div>
    </div>
  );
}

function extraOutcomes(c: WorkloadCounts): string[] {
  return [
    c.cancelled ? `取消 ${formatCount(c.cancelled)}` : null,
    c.superseded ? `作废 ${formatCount(c.superseded)}` : null,
    c.systemFailed ? `系统失败 ${formatCount(c.systemFailed)}` : null,
    c.executionFailed ? `执行失败 ${formatCount(c.executionFailed)}` : null,
  ].filter((s): s is string => s !== null);
}

function Signals({ row }: { row: WorkloadRow }) {
  return (
    <>
      {row.signals.map((s) => (
        <span key={s.code} className="mt-1 flex max-w-[260px] items-start gap-1 text-[11px] leading-snug text-danger">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          {s.message}
        </span>
      ))}
    </>
  );
}

function CostValue({ row }: { row: WorkloadRow }) {
  if (!row.costRecorded) return <span className="text-muted">未入账</span>;
  return (
    <>
      <span className="text-foreground">{formatUsd(row.last7.cost)}</span>
      <span className="block text-[11px] text-muted">{formatTokens(row.last7.inputTokens + row.last7.outputTokens)} token</span>
    </>
  );
}

/** 窄区块：每个岗位一张卡片（名称 + 原因 + 走势，下面 4 × 2 个数） */
function WorkloadCard({ row, days }: { row: WorkloadRow; days: readonly string[] }) {
  const flagged = row.signals.length > 0;
  const extra = extraOutcomes(row.last7);
  return (
    <li data-workload-card={row.key} data-flagged={flagged ? "true" : undefined} className={cn("px-4 py-3", flagged && "bg-danger-bg")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={cn("block text-sm font-medium", flagged ? "text-danger" : "text-foreground")}>{row.name}</span>
          {extra.length ? <span className="mt-0.5 block text-[11px] text-muted">{extra.join(" · ")}</span> : null}
          <Signals row={row} />
        </div>
        <div className="shrink-0 pt-0.5">
          <Sparkline row={row} days={days} />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-x-2 gap-y-1.5">
        {COLUMNS.map((col) => (
          <div key={col.key} className="min-w-0">
            <dt className="truncate text-[11px] text-muted" title={col.title}>
              {col.label}
            </dt>
            <dd className={cn("text-sm tabular-nums", col.key === "automationRuns" ? "text-muted" : "text-foreground")}>{formatCount(row.last7[col.key])}</dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="text-[11px] text-muted">成本</dt>
          <dd className="text-sm tabular-nums">
            <CostValue row={row} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

function WorkloadTableRow({ row, days }: { row: WorkloadRow; days: readonly string[] }) {
  const flagged = row.signals.length > 0;
  const c = row.last7;
  const extra = extraOutcomes(c);
  return (
    <tr data-workload-row={row.key} data-flagged={flagged ? "true" : undefined} className={cn("border-t border-border/60 align-top", flagged && "bg-danger-bg")}>
      <th scope="row" className={cn("sticky left-0 z-10 px-4 py-2.5 text-left font-normal", flagged ? "bg-danger-bg" : "bg-card")}>
        <span className={cn("block font-medium", flagged ? "text-danger" : "text-foreground")}>{row.name}</span>
        {extra.length ? <span className="mt-0.5 block text-[11px] text-muted">{extra.join(" · ")}</span> : null}
        <Signals row={row} />
      </th>
      {COLUMNS.map((col) => (
        <td key={col.key} className={cn("px-2 py-2.5 text-right tabular-nums", col.key === "automationRuns" ? "text-muted" : "text-foreground")}>
          {formatCount(c[col.key])}
        </td>
      ))}
      <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
        <CostValue row={row} />
      </td>
      <td className="px-4 py-2.5">
        <Sparkline row={row} days={days} />
      </td>
    </tr>
  );
}

// ── 走势小图：两条独立缩放的柱带（小倍数，不做双轴） ──────────

const BAR_W = 6;
const GAP = 2;
const STRIP_H = 11;
const STRIP_GAP = 3;

export function Sparkline({ row, days }: { row: WorkloadRow; days: readonly string[] }) {
  const width = days.length * (BAR_W + GAP) - GAP;
  const height = STRIP_H * 2 + STRIP_GAP;
  const maxRuns = Math.max(0, ...row.daily.map((d) => d.agentRuns));
  const maxProposed = Math.max(0, ...row.daily.map((d) => d.proposed));
  const totalRuns = row.daily.reduce((s, d) => s + d.agentRuns, 0);
  const totalProposed = row.daily.reduce((s, d) => s + d.proposed, 0);
  const barH = (value: number, max: number) => (max > 0 && value > 0 ? Math.max(1.5, (value / max) * STRIP_H) : 0);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${row.name}近 ${days.length} 天：AI 运行 ${totalRuns} 次，提出 ${totalProposed} 件`}
      className="block"
    >
      {/* 基线 */}
      <line x1={0} x2={width} y1={STRIP_H + 0.5} y2={STRIP_H + 0.5} className="stroke-border" strokeWidth={1} />
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} className="stroke-border" strokeWidth={1} />
      {row.daily.map((d, i) => {
        const x = i * (BAR_W + GAP);
        const hRuns = barH(d.agentRuns, maxRuns);
        const hProposed = barH(d.proposed, maxProposed);
        return (
          <g key={days[i]}>
            {hRuns > 0 ? <rect x={x} y={STRIP_H - hRuns} width={BAR_W} height={hRuns} rx={1} className="fill-muted/60" /> : null}
            {hProposed > 0 ? <rect x={x} y={height - hProposed} width={BAR_W} height={hProposed} rx={1} className="fill-accent" /> : null}
            {/* 悬停目标覆盖整列，比柱子大 */}
            <rect x={x - GAP / 2} y={0} width={BAR_W + GAP} height={height} fill="transparent">
              <title>{`${days[i].slice(5)}：AI 运行 ${d.agentRuns} · 提出 ${d.proposed}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
