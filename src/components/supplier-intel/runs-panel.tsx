"use client";

/**
 * S3-A「搜索记录」——每次搜索的真实状态。
 *
 * 诚实纪律：
 *   - COMPLETED 只说「搜索已结束」；有失败来源时明确说「部分来源失败」；
 *   - SUCCESS / EMPTY / DISABLED / FAILED / 未执行 五态可区分，不合并；
 *   - 历史 Run 只渲染它**自带的快照**（需求版本、brief、实发搜索词），
 *     绝不混入当前最新需求；当前分析已更新时提示「基于旧版需求」，只能新建 Run；
 *   - 内部来源与外部来源分开列出；外部未启用时如实说明。
 */

import { useMemo } from "react";
import { AlertTriangle, History } from "lucide-react";
import {
  runOutcomeSummary,
  runStatusDisplay,
  sourceStatusDisplay,
} from "@/lib/supplier-intel/workspace-labels";
import type { SearchRunRow } from "./types";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-[var(--background)] text-[var(--muted)] border-[var(--border)]",
  info: "bg-[var(--info-bg)] text-[var(--info)] border-transparent",
  success: "bg-[var(--success-bg)] text-[var(--success)] border-transparent",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)] border-transparent",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] border-transparent",
};

const INTERNAL_SOURCE_LABELS: Record<string, string> = {
  memory: "企业记忆",
  historical: "历史合作",
  saved: "已存供应商",
};

type SourceEntry = { status: string; count?: number; reason?: string | null; queries?: number };

function readSources(statusDetail: unknown): Record<string, SourceEntry> {
  if (typeof statusDetail !== "object" || statusDetail === null || Array.isArray(statusDetail)) return {};
  const per = (statusDetail as { perSource?: unknown; sources?: unknown }).perSource ??
    (statusDetail as { sources?: unknown }).sources;
  if (typeof per !== "object" || per === null || Array.isArray(per)) return {};
  return per as Record<string, SourceEntry>;
}

function readQueries(queriesJson: unknown): Array<{ source: string; query: string }> {
  if (!Array.isArray(queriesJson)) return [];
  return queriesJson
    .map((q) => {
      if (typeof q !== "object" || q === null) return null;
      const o = q as { source?: unknown; query?: unknown };
      if (typeof o.query !== "string") return null;
      return { source: typeof o.source === "string" ? o.source : "—", query: o.query };
    })
    .filter((v): v is { source: string; query: string } => v !== null);
}

function readRequirementCount(snapshot: unknown): number | null {
  return Array.isArray(snapshot) ? snapshot.length : null;
}

export function RunsPanel({
  runs,
  currentAnalysisRunId,
  selectedRunId,
  onSelectRun,
}: {
  runs: SearchRunRow[];
  currentAnalysisRunId: string | null;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
        还没有搜索记录。点击上方「开始找供应商」发起第一次搜索。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          currentAnalysisRunId={currentAnalysisRunId}
          selected={selectedRunId === run.id}
          onSelect={() => onSelectRun(run.id)}
        />
      ))}
    </div>
  );
}

function RunCard({
  run,
  currentAnalysisRunId,
  selected,
  onSelect,
}: {
  run: SearchRunRow;
  currentAnalysisRunId: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const sources = useMemo(() => readSources(run.statusDetailJson), [run.statusDetailJson]);
  const queries = useMemo(() => readQueries(run.queriesJson), [run.queriesJson]);
  const outcome = runOutcomeSummary(run.status, sources);
  const status = runStatusDisplay(run.status);
  const reqCount = readRequirementCount(run.requirementSnapshotJson);

  const cfg =
    typeof run.sourceConfigJson === "object" && run.sourceConfigJson !== null
      ? (run.sourceConfigJson as Record<string, unknown>)
      : {};
  const runAnalysisId = typeof cfg.canonicalAnalysisRunId === "string" ? cfg.canonicalAnalysisRunId : null;
  const stale = Boolean(runAnalysisId && currentAnalysisRunId && runAnalysisId !== currentAnalysisRunId);

  const internal = Object.entries(sources).filter(([k]) => k in INTERNAL_SOURCE_LABELS);
  const external = Object.entries(sources).filter(([k]) => !(k in INTERNAL_SOURCE_LABELS));

  return (
    <div
      className={`rounded-xl border bg-[var(--card-bg)] p-3 space-y-3 ${
        selected ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs ${TONE_CLASS[status.tone]}`}>{status.label}</span>
        <span className="text-xs text-[var(--muted)]">
          {new Date(run.createdAt).toLocaleString("zh-CN")}
        </span>
        {reqCount != null ? (
          <span className="text-xs text-[var(--muted)]">需求 {reqCount} 条</span>
        ) : null}
        <button
          type="button"
          onClick={onSelect}
          className="ml-auto rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--background)]"
        >
          {selected ? "正在查看这次搜索的线索" : "查看这次搜索的线索"}
        </button>
      </div>

      <p className={`rounded-lg px-2 py-1.5 text-xs ${TONE_CLASS[outcome.tone]}`}>
        {outcome.label}
        {outcome.hint ? <span className="block opacity-80">{outcome.hint}</span> : null}
      </p>

      {stale ? (
        <p className="flex items-start gap-1 rounded-lg bg-[var(--warning-bg)] px-2 py-1.5 text-xs text-[var(--warning)]">
          <History size={12} className="mt-0.5 shrink-0" />
          这次搜索基于旧版需求（分析版本已更新）。历史结果保持原样不重算；如需按最新需求搜索，请重新点击「开始找供应商」。
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-medium text-[var(--muted)]">内部来源（优先）</p>
          {internal.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">未记录</p>
          ) : (
            <ul className="space-y-1">
              {internal.map(([k, v]) => {
                const d = sourceStatusDisplay(v.status);
                return (
                  <li key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-[var(--muted)]">
                      {INTERNAL_SOURCE_LABELS[k] ?? k}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 ${TONE_CLASS[d.tone]}`}>{d.label}</span>
                    {typeof v.count === "number" ? (
                      <span className="text-[var(--muted)]">{v.count} 条</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-medium text-[var(--muted)]">外部来源</p>
          {external.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">未记录</p>
          ) : (
            <ul className="space-y-1">
              {external.map(([k, v]) => {
                const d = sourceStatusDisplay(v.status);
                return (
                  <li key={k} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-[var(--muted)]">{k}</span>
                    <span className={`rounded border px-1.5 py-0.5 ${TONE_CLASS[d.tone]}`}>{d.label}</span>
                    {typeof v.count === "number" ? (
                      <span className="text-[var(--muted)]">{v.count} 条</span>
                    ) : null}
                    {v.reason ? (
                      <span className="w-full text-[11px] text-[var(--muted)]">原因：{v.reason}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {queries.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--accent)]">
            本次实际使用的搜索词（{queries.length}）
          </summary>
          <ul className="mt-2 space-y-1">
            {queries.map((q, i) => (
              <li key={`${q.source}-${i}`} className="flex gap-2">
                <span className="w-24 shrink-0 text-[var(--muted)]">{q.source}</span>
                <span className="break-all">{q.query}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
          <AlertTriangle size={11} /> 本次没有记录到实际发出的搜索词
        </p>
      )}
    </div>
  );
}
