"use client";

/**
 * /revenue — FDE V2 启动条件区块（B-6，openspec change fde-v2-readiness）
 *
 * 默认收起；用户点"查看启动条件"后才请求 GET /api/revenue/v2-readiness（首屏请求数不变），收起后再展开不重复请求。
 * V2ReadinessSection / V2ReadinessReportView 无 hooks，便于服务端静态渲染测试；V2ReadinessPanel 只管展开与加载。
 * 只读：只展示条件状态与依据计数，不写任何数据；状态用图标 + 文字，不只靠颜色。
 */

import { useCallback, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleSlash, Gauge, Loader2, RefreshCw, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  CONDITION_STATUS_LABELS,
  V2_READINESS_WINDOW_DAYS,
  type ConditionStatus,
  type FactProvenance,
  type ReadinessCondition,
  type V2ReadinessReport,
} from "@/lib/revenue-spine/v2-readiness";
import { cn } from "@/lib/utils";

const READINESS_URL = "/api/revenue/v2-readiness";
const BODY_ID = "revenue-v2-readiness-body";

export type ReadinessState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: V2ReadinessReport };

// ── 容器 ──────────────────────────────────────────────────────

export function V2ReadinessPanel() {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<ReadinessState>({ status: "idle" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await apiFetch(READINESS_URL, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`v2-readiness ${res.status}`);
      setState({ status: "ready", data: (await res.json()) as V2ReadinessReport });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  // 收起只隐藏，不丢已加载的数据；再展开不重复请求（没加载过或上次失败才请求）
  const toggle = useCallback(() => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (state.status === "idle" || state.status === "error") void load();
  }, [expanded, state.status, load]);

  return <V2ReadinessSection expanded={expanded} state={state} onToggle={toggle} onRetry={() => void load()} />;
}

// ── 区块外框：标题 + 常驻的展开 / 收起按钮 + 内容 ──────────────

export function V2ReadinessSection({
  expanded,
  state,
  onToggle,
  onRetry,
}: {
  expanded: boolean;
  state: ReadinessState;
  onToggle?: () => void;
  onRetry?: () => void;
}) {
  return (
    <section
      aria-labelledby="revenue-v2-readiness-heading"
      aria-busy={expanded && state.status === "loading" ? true : undefined}
      className="rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="revenue-v2-readiness-heading" className="flex items-center gap-2 text-sm font-medium">
            <Gauge className="h-4 w-4 text-muted" aria-hidden="true" />
            FDE V2 启动条件（只读）
          </h2>
          <span className="text-xs text-muted">报价工程师（V2）启动前，商务事实是否已经沉淀够</span>
        </div>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={BODY_ID}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted transition-colors hover:bg-muted/20 hover:text-foreground"
          >
            {expanded ? (
              <>
                收起
                <ChevronUp size={13} />
              </>
            ) : (
              <>
                查看启动条件
                <ChevronDown size={13} />
              </>
            )}
          </button>
        ) : null}
      </header>
      {expanded ? (
        <div id={BODY_ID} className="border-t border-border px-4 py-4">
          {state.status === "ready" ? (
            <V2ReadinessReportView data={state.data} />
          ) : state.status === "error" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span role="status">启动条件加载失败</span>
              {onRetry ? (
                <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-muted/20">
                  <RefreshCw size={13} />
                  重试
                </button>
              ) : null}
            </div>
          ) : (
            <div role="status" className="flex min-h-[120px] items-center justify-center text-sm text-muted">
              <Loader2 size={16} className="mr-2 animate-spin" aria-hidden="true" />
              正在核对启动条件…
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ── 格式 ──────────────────────────────────────────────────────

/** 0–1 比率 → "75.0%"；空 → "—" */
export function formatReadinessShare(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function sourceText(p: FactProvenance): string {
  if (p.source === "proposal") return `经提案写入过 ${p.appliedViaProposal} 次`;
  if (p.source === "manual") return "手工配置";
  return "未配置";
}

const yesNo = (v: boolean, yes: string, no: string) => (v ? yes : no);

// ── 就绪：结论 + 四条条件 + 依据 ──────────────────────────────

export function V2ReadinessReportView({ data }: { data: V2ReadinessReport }) {
  const p = data.proposals;
  const d = data.drafts;
  const o = data.otherSources;
  const notes: string[] = [];
  if (p.truncated) notes.push("近 30 天事实提案超过读取上限，只统计了最近的一部分。");
  if (p.appliedAuditTruncated) notes.push("写入记录超过读取上限，「经提案写入」次数只统计了最近的一部分。");
  if (d.sampled) notes.push(`近 30 天草稿超过 ${d.sampleLimit} 封，首封统计只看最近 ${d.sampleLimit} 封草稿。`);

  return (
    <div className="space-y-4">
      <div
        role="status"
        className={cn("rounded-lg px-3 py-2 text-xs", data.verdict.meetsSuggestedConditions ? "bg-success-bg text-success-text" : "bg-warning-bg text-warning-text")}
      >
        <p className="font-medium">{data.verdict.meetsSuggestedConditions ? "已达到" : "未达到"}</p>
        <p>{data.verdict.summary}</p>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border" aria-label="启动条件">
        {data.conditions.map((c) => (
          <ConditionRow key={c.key} c={c} />
        ))}
      </ul>

      <div className="space-y-2">
        <h3 className="text-xs font-medium">事实提案（近 {data.windowDays} 天）</h3>
        <dl className="flex flex-wrap gap-2 text-xs">
          <Chip label="首张提案" value={p.runningDays === null ? "尚无" : `${p.runningDays} 天前`} />
          <Chip label="新建" value={`${p.window.created} 张`} />
          <Chip label="已写入" value={`${p.window.applied}`} />
          <Chip label="已驳回" value={`${p.window.rejected}`} />
          <Chip label="待审批" value={`${p.window.pending}`} />
          <Chip label="已过期" value={`${p.window.expired}`} />
          {p.window.other ? <Chip label="其他" value={`${p.window.other}`} /> : null}
        </dl>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] border-collapse text-left text-xs">
            <caption className="sr-only">各字段的事实提案新建、已写入、已驳回张数</caption>
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-3 font-medium">字段</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">新建</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">已写入</th>
                <th scope="col" className="py-2 text-right font-medium">已驳回</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {p.byField.map((f) => (
                <tr key={f.field}>
                  <th scope="row" className="py-2 pr-3 font-medium">{f.label}</th>
                  <td className="py-2 pr-3 text-right">{f.created}</td>
                  <td className="py-2 pr-3 text-right">{f.applied}</td>
                  <td className="py-2 text-right">{f.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="flex flex-wrap gap-2 text-xs">
          <Chip label="MOQ 来源" value={sourceText(data.facts.moq)} />
          <Chip label="大货周期来源" value={sourceText(data.facts.productionLeadTime)} />
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium">首封回复草稿（近 {data.windowDays} 天）</h3>
        <dl className="flex flex-wrap gap-2 text-xs">
          <Chip label="首封草稿" value={`${d.firstReplies} 封`} />
          <Chip label="仍写「需内部确认 MOQ」" value={`${d.pendingMoq} 封 · ${formatReadinessShare(d.pendingMoqShare)}`} />
          <Chip label="仍写「需内部确认生产周期」" value={`${d.pendingLeadTime} 封 · ${formatReadinessShare(d.pendingLeadTimeShare)}`} />
        </dl>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium">V2 其余数据源</h3>
        <dl className="flex flex-wrap gap-2 text-xs">
          <Chip label="认证清单" value={yesNo(o.certificationAvailable, "可用", "未接入")} />
          <Chip label="成本基础" value={yesNo(o.costBasisAvailable, "可用", "未接入")} />
          <Chip label="样品政策" value={yesNo(o.samplePolicyConfigured, "已配置", "未配置")} />
          <Chip label="最低毛利" value={yesNo(o.minimumMarginConfigured, "已配置", "未配置")} />
          <Chip label="历史报价" value={`${o.historicalQuotes} 条`} />
          <Chip label="产品类目" value={`${o.productCategories} 个`} />
        </dl>
      </div>

      {notes.length ? (
        <div className="rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning-text">
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-muted">
        口径：「可引用」与回复草稿相同（企业确认过的商务事实）；条件按组织计算，不显示任何具体数值。是否启动 V2 由负责人按这些条件决定，本区块不会修改任何设置。
        生成于 {new Date(data.generatedAt).toLocaleString()}，统计窗口 {V2_READINESS_WINDOW_DAYS} 天。
      </p>
    </div>
  );
}

const STATUS_ICON: Record<ConditionStatus, { Icon: typeof CheckCircle2; className: string }> = {
  met: { Icon: CheckCircle2, className: "text-success" },
  not_met: { Icon: XCircle, className: "text-danger" },
  not_measurable: { Icon: CircleSlash, className: "text-muted" },
};

function ConditionRow({ c }: { c: ReadinessCondition }) {
  const { Icon, className } = STATUS_ICON[c.status];
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 text-xs" data-condition={c.key} data-status={c.status}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{c.label}</span>
          <span className={cn("font-medium", className)}>{CONDITION_STATUS_LABELS[c.status]}</span>
        </div>
        <p className="mt-0.5 text-muted">{c.detail}</p>
      </div>
    </li>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-full border border-border px-3 py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
