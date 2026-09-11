"use client";

/**
 * S3-A「搜索记录」——每次搜索的真实状态。
 *
 * 诚实纪律：
 *   - COMPLETED 只说「搜索已结束」；有失败来源时明确说「部分来源失败」；
 *   - SUCCESS / EMPTY / DISABLED / FAILED / 未执行 五态可区分，不合并；
 *   - 历史 Run 只渲染它**自带的快照**（需求版本、brief、搜索词），
 *     绝不混入当前最新需求；当前分析已更新时提示「基于旧版需求」，只能新建 Run；
 *   - 内部来源与外部来源分开列出；外部未启用时如实说明；
 *   - FR3-E：queriesJson 是**计划**阶段写入的，所以标题就叫「计划搜索词」。
 *     外部来源 DISABLED 时这些词一条都没发出去，界面必须说清楚，不能叫「实际使用的搜索词」；
 *   - FR3-A：内部来源命中的是 SupplierCandidate（不是 Signal）。这里按需拉取并列出，
 *     语义是「内部候选」——来自本组织已有供应商库，不是推荐、不是合格、不是首选。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, History, Loader2 } from "lucide-react";
import { classifyRunExecutionState } from "@/lib/supplier-intel/run-execution-state";
import {
  runOutcomeSummary,
  runStatusDisplay,
  sourceStatusDisplay,
} from "@/lib/supplier-intel/workspace-labels";
import { ScopeGuard } from "./scope-guard";
import { workspaceFetch, type RunDetailPayload, type SearchRunRow } from "./types";

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

const ORIGIN_SOURCE_LABELS: Record<string, string> = {
  MEMORY: "企业记忆",
  HISTORICAL_SUCCESS: "历史合作",
  SAVED: "已存供应商",
  EXTERNAL_SEARCH: "外部搜索",
  NEW_DISCOVERY: "新发现",
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

/** 历史快照里的需求条目——只读它自己带的字段，绝不回查当前 canonical */
function readRequirementSnapshot(
  snapshot: unknown,
): Array<{ key: string; textZh: string | null; textEn: string | null; mandatory: unknown }> {
  if (!Array.isArray(snapshot)) return [];
  return snapshot
    .map((r) => {
      if (typeof r !== "object" || r === null) return null;
      const o = r as Record<string, unknown>;
      const key =
        typeof o.requirementKey === "string"
          ? o.requirementKey
          : typeof o.key === "string"
            ? o.key
            : typeof o.code === "string"
              ? o.code
              : "";
      const textZh =
        typeof o.textZh === "string" ? o.textZh : typeof o.zh === "string" ? o.zh : null;
      const textEn =
        typeof o.text === "string"
          ? o.text
          : typeof o.textEn === "string"
            ? o.textEn
            : typeof o.description === "string"
              ? o.description
              : null;
      if (!key && !textZh && !textEn) return null;
      return { key, textZh, textEn, mandatory: o.mandatory };
    })
    .filter((v): v is { key: string; textZh: string | null; textEn: string | null; mandatory: unknown } => v !== null);
}

function snapshotMandatoryLabel(v: unknown): string {
  if (v === true) return "强制";
  if (v === false) return "非强制";
  if (v === "uncertain") return "强制性待确认";
  return "未记录";
}

export function RunsPanel({
  orgId,
  runs,
  currentAnalysisRunId,
  selectedRunId,
  canWrite,
  busyAction,
  onSelectRun,
  onResumeRun,
  onCancelRun,
}: {
  orgId: string;
  runs: SearchRunRow[];
  currentAnalysisRunId: string | null;
  selectedRunId: string | null;
  canWrite: boolean;
  busyAction: string | null;
  onSelectRun: (id: string) => void;
  onResumeRun: (id: string) => void;
  onCancelRun: (id: string) => void;
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
          orgId={orgId}
          run={run}
          currentAnalysisRunId={currentAnalysisRunId}
          selected={selectedRunId === run.id}
          canWrite={canWrite}
          busyAction={busyAction}
          onSelect={() => onSelectRun(run.id)}
          onResume={() => onResumeRun(run.id)}
          onCancel={() => onCancelRun(run.id)}
        />
      ))}
    </div>
  );
}

function RunCard({
  orgId,
  run,
  currentAnalysisRunId,
  selected,
  canWrite,
  busyAction,
  onSelect,
  onResume,
  onCancel,
}: {
  orgId: string;
  run: SearchRunRow;
  currentAnalysisRunId: string | null;
  selected: boolean;
  canWrite: boolean;
  busyAction: string | null;
  onSelect: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const sources = useMemo(() => readSources(run.statusDetailJson), [run.statusDetailJson]);
  const queries = useMemo(() => readQueries(run.queriesJson), [run.queriesJson]);
  const outcome = runOutcomeSummary(run.status, sources);
  const status = runStatusDisplay(run.status);
  const requirements = useMemo(
    () => readRequirementSnapshot(run.requirementSnapshotJson),
    [run.requirementSnapshotJson],
  );
  const execState = classifyRunExecutionState(run, new Date());

  const cfg =
    typeof run.sourceConfigJson === "object" && run.sourceConfigJson !== null
      ? (run.sourceConfigJson as Record<string, unknown>)
      : {};
  const runAnalysisId = typeof cfg.canonicalAnalysisRunId === "string" ? cfg.canonicalAnalysisRunId : null;
  const stale = Boolean(runAnalysisId && currentAnalysisRunId && runAnalysisId !== currentAnalysisRunId);

  const internal = Object.entries(sources).filter(([k]) => k in INTERNAL_SOURCE_LABELS);
  const external = Object.entries(sources).filter(([k]) => !(k in INTERNAL_SOURCE_LABELS));

  // FR3-E：外部来源全部未启用/未执行时，计划搜索词一条都没有真的发出去
  const externalExecuted = external.filter(([, v]) => v.status === "SUCCESS" || v.status === "EMPTY");
  const externalPlannedOnly = queries.length > 0 && externalExecuted.length === 0;

  /* FR3-A：内部候选按需拉取（点开才请求，不给列表加 N+1） */
  const [detail, setDetail] = useState<RunDetailPayload | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const guardRef = useRef<ScopeGuard | null>(null);
  if (guardRef.current === null) guardRef.current = new ScopeGuard();
  const guard = guardRef.current;
  guard.setScope(`${orgId}::${run.id}`);

  const loadDetail = useCallback(async () => {
    if (detail || detailBusy) return;
    const ticket = guard.begin("detail");
    setDetailBusy(true);
    setDetailErr(null);
    try {
      const d = await workspaceFetch<RunDetailPayload>(
        `/api/supplier-intel/runs/${run.id}?orgId=${encodeURIComponent(orgId)}`,
        { signal: ticket.signal },
      );
      if (!ticket.isCurrent()) return;
      setDetail(d);
    } catch (e) {
      if (!ticket.isCurrent()) return;
      setDetailErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (ticket.shouldSettle()) setDetailBusy(false);
      ticket.done();
    }
  }, [detail, detailBusy, guard, orgId, run.id]);

  const internalCandidates = (detail?.candidates ?? []).filter(
    (c) => c.originSource !== "EXTERNAL_SEARCH" && c.originSource !== "NEW_DISCOVERY",
  );

  return (
    <div
      data-testid="run-card"
      data-run-id={run.id}
      data-exec-state={execState}
      className={`rounded-xl border bg-[var(--card-bg)] p-3 space-y-3 ${
        selected ? "border-[var(--accent)]" : "border-[var(--border)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs ${TONE_CLASS[status.tone]}`}>{status.label}</span>
        <span className="text-xs text-[var(--muted)]">
          {new Date(run.createdAt).toLocaleString("zh-CN")}
        </span>
        {requirements.length > 0 ? (
          <span className="text-xs text-[var(--muted)]">需求 {requirements.length} 条</span>
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

      {/* FR1-F：未收尾的搜索在卡片上也给出路，不必回到顶部 */}
      {execState === "RECOVERY_REQUIRED" || (execState === "IDLE" && run.status === "PLANNED") ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--warning-bg)] px-2 py-1.5 text-xs text-[var(--warning)]">
          <span className="min-w-0 flex-1">
            {execState === "RECOVERY_REQUIRED"
              ? "上一次执行没有正常结束，结果无法确认。请取消后重新发起。"
              : "已创建但还没有执行。"}
          </span>
          {canWrite && execState === "IDLE" ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={onResume}
              data-testid="card-resume"
              className="rounded-full border border-current px-2 py-0.5 disabled:opacity-50"
            >
              继续执行
            </button>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={onCancel}
              data-testid="card-cancel"
              className="rounded-full border border-current px-2 py-0.5 disabled:opacity-50"
            >
              取消
            </button>
          ) : null}
        </div>
      ) : null}

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

      {/* FR3-A：内部找到的供应商——点开才知道是哪几家 */}
      <details data-testid="internal-candidates" onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void loadDetail();
      }}>
        <summary className="cursor-pointer text-xs text-[var(--accent)]">
          <ChevronDown size={11} className="mr-1 inline" />
          内部找到的供应商
        </summary>
        <div className="mt-2 space-y-1">
          <p className="text-[11px] text-[var(--muted)]">
            这些是本组织已有的供应商记录（企业记忆 / 历史合作 / 供应商库）被这次搜索命中的部分。
            只表示「值得看看」，不代表通过采购审核，也没有排名。
          </p>
          {detailBusy ? (
            <p className="flex items-center gap-1 text-xs text-[var(--muted)]">
              <Loader2 size={11} className="animate-spin" /> 加载中
            </p>
          ) : detailErr ? (
            <p className="text-xs text-[var(--danger)]">{detailErr}</p>
          ) : detail === null ? (
            <p className="text-xs text-[var(--muted)]">展开以加载</p>
          ) : internalCandidates.length === 0 ? (
            <p className="text-xs text-[var(--muted)]" data-testid="internal-candidates-empty">
              这次搜索没有从内部来源命中任何供应商。
            </p>
          ) : (
            <ul className="space-y-1" data-testid="internal-candidate-list">
              {internalCandidates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] px-2 py-1 text-xs"
                  data-testid="internal-candidate"
                >
                  <span className="min-w-0 truncate font-medium" title={c.name ?? ""}>
                    {c.name ?? "（供应商记录已不可读）"}
                  </span>
                  <span className="rounded bg-[var(--background)] px-1 text-[10px] text-[var(--muted)]">
                    {ORIGIN_SOURCE_LABELS[c.originSource] ?? c.originSource}
                  </span>
                  {c.region ? <span className="text-[var(--muted)]">{c.region}</span> : null}
                  {c.category ? <span className="text-[var(--muted)]">{c.category}</span> : null}
                  {c.website ? (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-[var(--accent)] underline"
                    >
                      官网
                    </a>
                  ) : null}
                  <a
                    href={`/suppliers?supplierId=${encodeURIComponent(c.supplierId)}`}
                    className="ml-auto text-[var(--accent)] underline"
                  >
                    打开供应商档案
                  </a>
                </li>
              ))}
            </ul>
          )}
          {detail?.candidatesTruncated ? (
            <p className="text-[11px] text-[var(--muted)]">
              命中较多，这里只列出前 {detail.candidates.length} 家（共 {detail.counts.candidates} 家）。
            </p>
          ) : null}
        </div>
      </details>

      {/* FR3-D：历史 Run 的当时内容——只读它自己的快照 */}
      {requirements.length > 0 ? (
        <details data-testid="run-requirement-snapshot">
          <summary className="cursor-pointer text-xs text-[var(--accent)]">
            查看当时的采购要求（{requirements.length} 条）
          </summary>
          <ul className="mt-2 space-y-1.5">
            {requirements.map((r, i) => (
              <li key={`${r.key}-${i}`} className="rounded border border-[var(--border)] px-2 py-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {r.key ? <span className="text-[var(--muted)]">{r.key}</span> : null}
                  <span className="rounded bg-[var(--background)] px-1 text-[10px] text-[var(--muted)]">
                    {snapshotMandatoryLabel(r.mandatory)}
                  </span>
                </div>
                {r.textZh ? (
                  <p className="mt-0.5 whitespace-pre-wrap">{r.textZh}</p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">中文未记录（当时的快照里没有译文）</p>
                )}
                {r.textEn ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-[var(--muted)]">{r.textEn}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {run.briefSnapshotJson ? (
        <details data-testid="run-brief-snapshot">
          <summary className="cursor-pointer text-xs text-[var(--accent)]">查看当时的搜索简报</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--background)] p-2 text-[11px] text-[var(--text-secondary)]">
            {JSON.stringify(run.briefSnapshotJson, null, 2)}
          </pre>
        </details>
      ) : null}

      {queries.length > 0 ? (
        <details className="text-xs" data-testid="run-queries">
          <summary className="cursor-pointer text-[var(--accent)]">
            本次计划搜索词（{queries.length}）
          </summary>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {externalPlannedOnly
              ? "这些是计划阶段生成的检索词。本次外部来源没有执行，所以它们一条都没有真的发出去。"
              : `这些是计划阶段生成的检索词；已执行的外部来源 ${externalExecuted.length} 个（逐来源状态见上方）。`}
          </p>
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
          <AlertTriangle size={11} /> 本次没有记录到计划搜索词
        </p>
      )}
    </div>
  );
}
