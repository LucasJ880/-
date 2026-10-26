"use client";

/**
 * /revenue — 评分校准区块（B-4，openspec change fde-score-calibration）
 *
 * 默认收起；用户点"查看近 90 天校准"后才请求 GET /api/revenue/score-calibration（首屏请求数不变），收起后再展开不重复请求。
 * ScoreCalibrationSection / ScoreCalibrationReportView 无 hooks，便于服务端静态渲染测试；ScoreCalibrationPanel 只管展开、加载与复制状态。
 * 只读：建议权重只能复制为 policy 片段（剪贴板），不发布、不修改任何设置。
 */

import { useCallback, useState } from "react";
import { ChevronDown, ChevronUp, ClipboardCopy, Loader2, RefreshCw, Scale } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  CALIBRATION_BUCKETS,
  calibrationSnippetText,
  type CalibrationTally,
  type DimensionCalibration,
  type ScoreCalibrationReport,
} from "@/lib/revenue-spine/score-calibration";
import { cn } from "@/lib/utils";

const CALIBRATION_URL = "/api/revenue/score-calibration";
const BODY_ID = "revenue-score-calibration-body";

export type CalibrationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: ScoreCalibrationReport };

export type CopyState = "idle" | "copied" | "failed";

// ── 容器 ──────────────────────────────────────────────────────

export function ScoreCalibrationPanel() {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<CalibrationState>({ status: "idle" });
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setCopyState("idle");
    try {
      const res = await apiFetch(CALIBRATION_URL, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`score-calibration ${res.status}`);
      setState({ status: "ready", data: (await res.json()) as ScoreCalibrationReport });
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

  const copy = useCallback(async () => {
    if (state.status !== "ready" || !state.data.policySnippet) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(calibrationSnippetText(state.data.policySnippet));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }, [state]);

  return (
    <ScoreCalibrationSection
      expanded={expanded}
      state={state}
      copyState={copyState}
      onToggle={toggle}
      onRetry={() => void load()}
      onCopy={() => void copy()}
    />
  );
}

// ── 区块外框：标题 + 常驻的展开 / 收起按钮 + 内容 ──────────────

export function ScoreCalibrationSection({
  expanded,
  state,
  copyState = "idle",
  onToggle,
  onRetry,
  onCopy,
}: {
  expanded: boolean;
  state: CalibrationState;
  copyState?: CopyState;
  onToggle?: () => void;
  onRetry?: () => void;
  onCopy?: () => void;
}) {
  return (
    <section
      aria-labelledby="revenue-score-calibration-heading"
      aria-busy={expanded && state.status === "loading" ? true : undefined}
      className="rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="revenue-score-calibration-heading" className="flex items-center gap-2 text-sm font-medium">
            <Scale className="h-4 w-4 text-muted" aria-hidden="true" />
            评分校准（只报不改）
          </h2>
          <span className="text-xs text-muted">首次评分的六个维度 vs 后来赢没赢、报没报价</span>
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
                查看近 90 天校准
                <ChevronDown size={13} />
              </>
            )}
          </button>
        ) : null}
      </header>
      {expanded ? (
        <div id={BODY_ID} className="border-t border-border px-4 py-4">
          {state.status === "ready" ? (
            <ScoreCalibrationReportView data={state.data} copyState={copyState} onCopy={onCopy} />
          ) : state.status === "error" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <span role="status">评分校准加载失败</span>
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
              正在对账近 90 天的评分与结局…
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ── 格式 ──────────────────────────────────────────────────────

/** 0–1 比率 → "37.5%"；空 → "—" */
export function formatShare(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** 区分度 → "+54.9 个百分点" / "−70.6 个百分点"；空 → "无法评估" */
export function formatLift(value: number | null): string {
  if (value === null) return "无法评估";
  const pt = Math.abs(value * 100).toFixed(1);
  if (pt === "0.0") return "0.0 个百分点";
  return `${value > 0 ? "+" : "−"}${pt} 个百分点`;
}

function formatDelta(suggested: number, current: number): string {
  const d = suggested - Math.round(current);
  if (d === 0) return "不变";
  return d > 0 ? `+${d}` : `−${Math.abs(d)}`;
}

function formatWeight(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ── 就绪：状态说明 + 样本计数 + 维度表 + 等级表 + 片段 ────────────

export function ScoreCalibrationReportView({
  data,
  copyState = "idle",
  onCopy,
}: {
  data: ScoreCalibrationReport;
  copyState?: CopyState;
  onCopy?: () => void;
}) {
  const s = data.sample;
  const showSuggestion = data.status === "ok" && data.suggestedWeights !== null;
  return (
    <div className="space-y-4">
      <StatusNote data={data} />

      <dl className="flex flex-wrap gap-2 text-xs">
        <Chip label={`近 ${data.windowDays} 天首次评分`} value={`${s.n} 个`} />
        <Chip label="已定" value={`${s.decided} 个（赢 ${s.won} / 输 ${s.lost}）`} />
        <Chip label="未定" value={`${s.open} 个`} />
        <Chip label="赢单率" value={formatShare(s.winRate)} />
        <Chip label="报价率" value={formatShare(s.quoteRate)} />
        <Chip label="已排除" value={`入驻测试 ${s.excludedOnboardingTest} · 不合格 ${s.excludedDisqualified}`} />
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-xs">
          <caption className="sr-only">各维度分桶赢单率与报价率、命中率、区分度与建议权重</caption>
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium">维度</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">现有权重</th>
              {CALIBRATION_BUCKETS.map((b) => (
                <th key={b.key} scope="col" className="py-2 pr-3 font-medium">{b.label}</th>
              ))}
              <th scope="col" className="py-2 pr-3 text-right font-medium">命中率</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">区分度</th>
              {showSuggestion ? <th scope="col" className="py-2 text-right font-medium">建议权重</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.dimensions.map((d) => (
              <DimensionRow key={d.key} d={d} showSuggestion={showSuggestion} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted">每格：赢单率（已定商机） / 报价率 · 样本数。归一 = 该维得分 ÷ 打分当时的满分。</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left text-xs">
          <caption className="mb-1 text-left text-xs font-medium text-foreground">按首次评分等级</caption>
          <thead className="text-muted">
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pr-3 font-medium">等级</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">样本</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">已定</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">赢单率</th>
              <th scope="col" className="py-2 text-right font-medium">报价率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {data.grades.map((g) => (
              <tr key={g.grade}>
                <th scope="row" className="py-2 pr-3 font-medium">{g.grade}</th>
                <td className="py-2 pr-3 text-right">{g.n}</td>
                <td className="py-2 pr-3 text-right">{g.decided}</td>
                <td className="py-2 pr-3 text-right">{formatShare(g.winRate)}</td>
                <td className="py-2 text-right">{formatShare(g.quoteRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showSuggestion && data.policySnippet ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            {onCopy ? (
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-muted/20"
              >
                <ClipboardCopy size={13} />
                复制为 policy 片段
              </button>
            ) : null}
            <span role="status" className={cn("text-xs", copyState === "failed" ? "text-danger" : "text-muted")}>
              {copyState === "copied" ? "已复制到剪贴板" : copyState === "failed" ? "复制失败，请手动选中下方文本" : ""}
            </span>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/10 p-3 text-[11px] leading-relaxed">
            {calibrationSnippetText(data.policySnippet)}
          </pre>
          <p className="text-[11px] text-muted">
            片段可作为策略发布的 policy 值，由企业负责人或管理员人工判断后发布；本区块不会修改任何设置。
          </p>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-muted">
        命中率：该维拿到一半以上的分且赢单、或不到一半且输单的比例；输单多时命中率天然偏高，请与区分度一起看。
        区分度：拿到一半以上分的商机赢单率 − 不到一半的赢单率。不合格商机由评分本身判定，不参与校准。
      </p>
    </div>
  );
}

function StatusNote({ data }: { data: ScoreCalibrationReport }) {
  const notes: string[] = [];
  if (data.status === "insufficient") notes.push(`样本不足：已定 ${data.sample.decided} / ${data.minDecided}，暂不给建议权重。`);
  else if (data.status === "no_signal") notes.push("无信号：可评估维度的区分度都不为正，暂不给建议权重。");
  else notes.push("建议权重仅供参考：样本小、波动大，请人工判断后再发布。");
  if (data.truncated) notes.push("窗口内评估超过 5000 条，只统计了最早的 5000 条。");
  return (
    <div
      role="status"
      className={cn("rounded-lg px-3 py-2 text-xs", data.status === "ok" && !data.truncated ? "bg-muted/10 text-muted" : "bg-warning-bg text-warning")}
    >
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
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

function BucketCell({ t }: { t: CalibrationTally }) {
  return (
    <td className="py-2 pr-3 align-top tabular-nums">
      <div>{formatShare(t.winRate)}</div>
      <div className="text-[11px] text-muted">
        报价 {formatShare(t.quoteRate)} · {t.n} 个
      </div>
    </td>
  );
}

function DimensionRow({ d, showSuggestion }: { d: DimensionCalibration; showSuggestion: boolean }) {
  return (
    <tr>
      <th scope="row" className="py-2 pr-3 align-top font-medium">
        {d.label}
      </th>
      <td className="py-2 pr-3 text-right align-top tabular-nums">{formatWeight(d.currentWeight)}</td>
      {CALIBRATION_BUCKETS.map((b) => (
        <BucketCell key={b.key} t={d.buckets[b.key]} />
      ))}
      <td className="py-2 pr-3 text-right align-top tabular-nums">
        <div>{formatShare(d.hitRate)}</div>
        <div className="text-[11px] text-muted">
          {d.hits} / {d.decided}
        </div>
      </td>
      <td className={cn("py-2 pr-3 text-right align-top tabular-nums", d.lift === null && "text-muted")}>{formatLift(d.lift)}</td>
      {showSuggestion ? (
        <td className="py-2 text-right align-top tabular-nums">
          {d.suggestedWeight === null ? (
            "—"
          ) : (
            <>
              <div className="font-medium">{d.suggestedWeight}</div>
              <div className="text-[11px] text-muted">{formatDelta(d.suggestedWeight, d.currentWeight)}</div>
            </>
          )}
        </td>
      ) : null}
    </tr>
  );
}
