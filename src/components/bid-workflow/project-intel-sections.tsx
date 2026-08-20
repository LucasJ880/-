"use client";

/**
 * 项目情报调查区块（T1A：原独立「调查室」路由内容归位情报 tab）。
 * 包含：30 秒看懂 / 八个调查模块 / 事实来源与可信度（含人工录入）。
 * 调查启动（GO/HOLD/NO_GO）保留在工作台「阶段与决定」，此处不重复渲染。
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  confidenceLabel,
  sourceTypeLabel,
} from "@/lib/bid-workflow/display-labels";
import { ModuleDataView } from "./module-data-view";
import { AwardHistoryPanel } from "./award-history-panel";

type Module = {
  id: string;
  moduleKey: string;
  title: string;
  status: string;
  dataJson: unknown;
};

type Fact = {
  id: string;
  content: string;
  confidence: string;
  sourceType: string;
  sourceUrl?: string | null;
  sourceFileId?: string | null;
  sourcePage?: string | null;
  moduleKey: string | null;
  humanConfirmed: boolean;
  extractedBy?: string | null;
  extractedAt?: string;
};

type Room = {
  id: string;
  summaryText: string | null;
  summaryJson: Record<string, unknown> | null;
  summaryStatus: string;
  goDecision: string | null;
  modules: Module[];
  facts: Fact[];
};

type Props = {
  projectId: string;
  /** 项目类型标签（来自项目字段，可选） */
  projectTypeLabel?: string | null;
  /** 尚未创建调查室时引导回工作台「投标调查」 */
  onOpenWorkbench?: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "已确认",
  investigating: "调查中",
  risk: "存在风险",
  unknown: "暂时未知",
};

/* —— Phase I：Executive Brief 字段级 readiness 状态（Missing ≠ Processing） —— */
type BriefFieldState =
  | "READY"
  | "UNKNOWN"
  | "PROCESSING"
  | "STALE"
  | "CONFLICT"
  | "FAILED"
  | "NEEDS_EXTERNAL_RESEARCH"
  | "AI_RESEARCHED"
  | "DOC_STATED"
  | "NOT_STARTED";
type BriefField = { state: BriefFieldState; value: string | null };
type ExecutiveBrief = {
  analysisStatus: "NONE" | "PROCESSING" | "FAILED" | "READY" | "STALE";
  runId: string | null;
  stale: boolean;
  fields: {
    oneLiner: BriefField;
    buyer: BriefField;
    product: BriefField;
    projectType: BriefField;
    recommendation: BriefField;
    majorBlockers: BriefField;
    nextActions: BriefField;
  };
  external: {
    previousWinner: BriefField;
    historicalContractValue: BriefField;
    possiblyRecurring: BriefField;
  };
  packageChanges: string[];
  coverage?: {
    uploaded: number;
    eligible: number;
    analyzed: number;
    excluded: number;
    label: string;
    note: string | null;
  };
};

const FIELD_STATE_LABEL: Record<BriefFieldState, string> = {
  READY: "已就绪",
  UNKNOWN: "暂无数据",
  PROCESSING: "分析中",
  STALE: "需重新分析",
  CONFLICT: "存在冲突",
  FAILED: "分析失败",
  NEEDS_EXTERNAL_RESEARCH: "需外部调查",
  AI_RESEARCHED: "AI 初步调查 · 待人工确认",
  DOC_STATED: "文档载明 · 名称待核",
  NOT_STARTED: "尚未分析",
};

const FIELD_STATE_TONE: Record<BriefFieldState, string> = {
  READY: "text-emerald-700",
  UNKNOWN: "text-stone-500",
  PROCESSING: "text-sky-700",
  STALE: "text-amber-700",
  CONFLICT: "text-rose-700",
  FAILED: "text-rose-700",
  AI_RESEARCHED: "text-sky-700",
  DOC_STATED: "text-indigo-700",
  NEEDS_EXTERNAL_RESEARCH: "text-stone-500",
  NOT_STARTED: "text-stone-500",
};

/** 字段 → 展示文本（有值优先；否则按状态给出明确占位，绝不"调查中"兜底）。 */
function fieldText(f: BriefField | undefined): string {
  if (!f) return "—";
  if (f.value) return f.value;
  switch (f.state) {
    case "PROCESSING":
      return "AI 正在分析…";
    case "NOT_STARTED":
      return "尚未分析（上传招标文件后自动开始）";
    case "FAILED":
      return "分析失败，结果可能过期";
    case "NEEDS_EXTERNAL_RESEARCH":
      return "外部情报暂未获得——分析完成后会自动检索，也可在上方「历史授标检索」手动查";
    case "CONFLICT":
      return "存在未解决冲突，需澄清";
    case "UNKNOWN":
    default:
      return "暂无数据";
  }
}

function confidenceTone(code: string): string {
  if (code === "CONFIRMED") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (code === "HIGH_CONFIDENCE") return "bg-sky-50 text-sky-800 border-sky-200";
  if (code === "INFERRED") return "bg-amber-50 text-amber-900 border-amber-200";
  return "bg-stone-50 text-stone-700 border-stone-200";
}

export function ProjectIntelSections({
  projectId,
  projectTypeLabel,
  onOpenWorkbench,
}: Props) {
  const [room, setRoom] = useState<Room | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [factContent, setFactContent] = useState("");
  const [factModule, setFactModule] = useState("historical_awards");
  const [factConfidence, setFactConfidence] = useState("INFERRED");
  const [factSourceUrl, setFactSourceUrl] = useState("");
  const [factSourcePage, setFactSourcePage] = useState("");
  const [recentChanges, setRecentChanges] = useState<string[]>([]);
  const [brief, setBrief] = useState<ExecutiveBrief | null>(null);
  // EXPERIENCE flag（来自 /tender-brief）：OFF → 保持 merge 前既有 30 秒看懂渲染
  const [experienceEnabled, setExperienceEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadBrief = useCallback(async () => {
    try {
      const qs = projectTypeLabel
        ? `?projectType=${encodeURIComponent(projectTypeLabel)}`
        : "";
      const res = await apiFetch(
        `/api/projects/${projectId}/tender-brief${qs}`,
      );
      const data = await res.json();
      setExperienceEnabled(data.experienceEnabled === true);
      setBrief(data.brief ?? null);
    } catch {
      setExperienceEnabled(false);
      setBrief(null);
    }
  }, [projectId, projectTypeLabel]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-intelligence`);
      const data = await res.json();
      if (data.unavailable) {
        setLoadError("调查数据暂不可用（可能尚未迁移），项目其他功能不受影响");
        setRoom(null);
        return;
      }
      setRoom(data.room);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  const loadRecent = useCallback(async () => {
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/activity?page=1&pageSize=5`,
      );
      const data = await res.json();
      const rows = Array.isArray(data.data) ? data.data : [];
      const lines = rows
        .map((r: { summary?: string; actionLabel?: string; timestamp?: string }) => {
          const when = r.timestamp
            ? new Date(r.timestamp).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          const text = r.summary || r.actionLabel || "";
          return text ? `${when} ${text}`.trim() : "";
        })
        .filter(Boolean)
        .slice(0, 5);
      setRecentChanges(lines);
    } catch {
      setRecentChanges([]);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    void loadRecent();
    void loadBrief();
  }, [load, loadRecent, loadBrief]);

  // 分析进行中 → 轮询自动刷新（无需用户手动刷新 30 秒摘要）
  useEffect(() => {
    if (brief?.analysisStatus !== "PROCESSING") return;
    const t = setInterval(() => {
      void loadBrief();
      void loadRecent();
    }, 5000);
    return () => clearInterval(t);
  }, [brief?.analysisStatus, loadBrief, loadRecent]);

  const saveFact = async () => {
    if (!factContent.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/bid-intelligence/facts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: factContent,
            moduleKey: factModule,
            confidence: factConfidence,
            sourceType:
              factConfidence === "INFERRED" ? "ai_inference" : "manual",
            sourceUrl: factSourceUrl.trim() || undefined,
            sourcePage: factSourcePage.trim() || undefined,
            humanConfirmed: factConfidence === "CONFIRMED",
            extractedBy: "human",
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setFactContent("");
      setFactSourceUrl("");
      setFactSourcePage("");
      await load();
      await loadRecent();
      await loadBrief();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // —— EXPERIENCE OFF 兜底：merge 前既有 room-based 30 秒看懂（保持生产行为不变） ——
  const legacySummary = (room?.summaryJson || {}) as Record<string, unknown>;
  const legacyProjectType =
    projectTypeLabel ||
    (typeof legacySummary.projectType === "string" && legacySummary.projectType) ||
    "暂未分类";
  const legacyRecentText =
    recentChanges.length > 0
      ? recentChanges.slice(0, 3).join("；")
      : Array.isArray(legacySummary.recentChanges) &&
          (legacySummary.recentChanges as unknown[]).length > 0
        ? (legacySummary.recentChanges as string[]).join("；")
        : "暂无新的重要变化";
  const legacyCards: Array<[string, string]> = [
    ["一句话摘要", room?.summaryText || "调查中"],
    ["采购单位", String(legacySummary.procuringAgency || "暂时未知")],
    ["产品或服务", String(legacySummary.product || "调查中")],
    ["项目类型", legacyProjectType],
    [
      "周期采购可能",
      legacySummary.possiblyRecurring == null
        ? "暂时未知"
        : legacySummary.possiblyRecurring === true
          ? "可能是"
          : legacySummary.possiblyRecurring === false
            ? "不太像"
            : String(legacySummary.possiblyRecurring),
    ],
    ["上一轮中标方", String(legacySummary.previousWinner || "暂时未知")],
    ["历史合同金额", String(legacySummary.historicalContractValue || "暂时未知")],
    ["当前建议（AI）", String(legacySummary.recommendation || "调查中")],
    [
      "重大阻塞",
      Array.isArray(legacySummary.majorBlockers)
        ? (legacySummary.majorBlockers as string[]).join("；") || "无"
        : "调查中",
    ],
    ["最近变化", legacyRecentText],
    [
      "下一步",
      Array.isArray(legacySummary.nextActions)
        ? (legacySummary.nextActions as string[]).slice(0, 2).join("；")
        : "调查中",
    ],
  ];

  // —— Phase I：30 秒看懂 = Executive Brief 的字段级投影（EXPERIENCE ON） ——
  // FB-17.4：「最近变化」按用户要求从 30 秒看懂隐藏（活动流仍在项目动态可见）
  const f = brief?.fields;
  const ext = brief?.external;
  const briefCards: Array<{ label: string; field: BriefField; text: string }> = [
    { label: "一句话摘要", field: f?.oneLiner ?? { state: "NOT_STARTED", value: null } },
    { label: "采购单位", field: f?.buyer ?? { state: "NOT_STARTED", value: null } },
    { label: "产品或服务", field: f?.product ?? { state: "NOT_STARTED", value: null } },
    {
      label: "项目类型",
      field:
        f?.projectType ??
        (projectTypeLabel
          ? { state: "READY", value: projectTypeLabel }
          : { state: "UNKNOWN", value: null }),
    },
    { label: "当前建议（AI）", field: f?.recommendation ?? { state: "NOT_STARTED", value: null } },
    { label: "重大阻塞", field: f?.majorBlockers ?? { state: "NOT_STARTED", value: null } },
    { label: "下一步", field: f?.nextActions ?? { state: "NOT_STARTED", value: null } },
    // 外部情报（留待正式 T4）：明确"需外部调查"，不再伪装"调查中"
    { label: "周期采购可能", field: ext?.possiblyRecurring ?? { state: "NEEDS_EXTERNAL_RESEARCH", value: null } },
    { label: "上一轮中标方", field: ext?.previousWinner ?? { state: "NEEDS_EXTERNAL_RESEARCH", value: null } },
    { label: "历史合同金额", field: ext?.historicalContractValue ?? { state: "NEEDS_EXTERNAL_RESEARCH", value: null } },
  ].map((c) => ({ ...c, text: fieldText(c.field) }));

  const briefStatusHint =
    brief?.analysisStatus === "PROCESSING"
      ? "AI 正在分析招标文件…"
      : brief?.analysisStatus === "FAILED"
        ? "分析失败，结果可能过期"
        : brief?.analysisStatus === "STALE"
          ? "招标文件有更新，建议重新分析"
          : brief?.analysisStatus === "READY"
            ? "基于最新招标分析"
            : brief?.analysisStatus === "NONE"
              ? "尚未开始招标分析"
              : "";

  if (loaded && !room && !loadError) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center space-y-2">
        <p className="text-sm font-medium">尚未开展项目调查</p>
        <p className="text-xs text-[var(--muted)]">
          在工作台「投标调查」确认进入调查后，这里将展示 30 秒摘要、调查模块与事实证据。
        </p>
        {onOpenWorkbench ? (
          <button
            type="button"
            onClick={onOpenWorkbench}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
          >
            前往工作台
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {loadError}
        </p>
      )}

      {/* M1 外部情报：历史授标检索（确认后 上一轮中标方/历史金额/周期性 变 READY） */}
      {experienceEnabled ? (
        <AwardHistoryPanel projectId={projectId} onConfirmed={() => void loadBrief()} />
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">30 秒看懂项目</h2>
          {experienceEnabled ? (
            <span className="text-[11px] text-[var(--muted)]">
              {briefStatusHint}
            </span>
          ) : null}
        </div>
        {experienceEnabled && brief?.coverage ? (
          <p className="text-[11px] text-[var(--muted)]">
            {brief.coverage.label}
            {brief.coverage.note ? ` · ${brief.coverage.note}` : ""}
          </p>
        ) : null}
        {experienceEnabled ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {briefCards.map((c) => (
              <div
                key={c.label}
                className="rounded-xl border border-[var(--border)] p-3 space-y-1"
              >
                <p className="text-[11px] text-[var(--muted)]">{c.label}</p>
                <p className="text-sm font-medium leading-snug whitespace-pre-line">
                  {c.text}
                </p>
                <p className={`text-[10px] ${FIELD_STATE_TONE[c.field.state]}`}>
                  {FIELD_STATE_LABEL[c.field.state]}
                </p>
              </div>
            ))}
          </div>
        ) : (
          // EXPERIENCE OFF：merge 前既有渲染（单一 room.summaryStatus 徽标）
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {legacyCards.map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border)] p-3 space-y-1"
              >
                <p className="text-[11px] text-[var(--muted)]">{label}</p>
                <p className="text-sm font-medium leading-snug">{value}</p>
                <p className="text-[10px] text-[var(--muted)]">
                  {STATUS_LABEL[room?.summaryStatus || "unknown"] || "暂时未知"}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">八个调查模块</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(room?.modules || []).map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-[var(--border)] p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{m.title}</h3>
                <span className="text-[10px] rounded-full border px-2 py-0.5">
                  {STATUS_LABEL[m.status] || "暂时未知"}
                </span>
              </div>
              <ModuleDataView moduleKey={m.moduleKey} dataJson={m.dataJson} />
            </div>
          ))}
          {!room && (
            <p className="text-sm text-[var(--muted)]">
              尚未创建调查。请先在工作台「投标调查」确认进入调查。
            </p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">事实来源与可信度</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs space-y-1">
            <span>模块</span>
            <select
              className="block rounded border px-2 py-1 text-sm"
              value={factModule}
              onChange={(e) => setFactModule(e.target.value)}
            >
              <option value="historical_awards">历史中标调查</option>
              <option value="contract_value">合同价值解释</option>
              <option value="supply_chain">供应链调查</option>
              <option value="competitor_profile">竞争对手画像</option>
              <option value="series_identification">项目系列识别</option>
            </select>
          </label>
          <label className="text-xs space-y-1">
            <span>可信度</span>
            <select
              className="block rounded border px-2 py-1 text-sm"
              value={factConfidence}
              onChange={(e) => setFactConfidence(e.target.value)}
            >
              <option value="CONFIRMED">已确认</option>
              <option value="HIGH_CONFIDENCE">高可信</option>
              <option value="INFERRED">推断</option>
              <option value="UNKNOWN">未确认</option>
            </select>
          </label>
          <input
            className="min-w-[200px] flex-1 rounded border px-2 py-1.5 text-sm"
            placeholder="例如：Cox’s Bazar Trading Inc. 于某年中标…"
            value={factContent}
            onChange={(e) => setFactContent(e.target.value)}
          />
          <input
            className="w-40 rounded border px-2 py-1.5 text-sm"
            placeholder="来源 URL（可选）"
            value={factSourceUrl}
            onChange={(e) => setFactSourceUrl(e.target.value)}
          />
          <input
            className="w-24 rounded border px-2 py-1.5 text-sm"
            placeholder="页码"
            value={factSourcePage}
            onChange={(e) => setFactSourcePage(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || !room}
            onClick={() => void saveFact()}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            建议保存
          </button>
        </div>
        <ul className="space-y-2">
          {(room?.facts || []).map((f) => (
            <li
              key={f.id}
              className={`rounded-lg border px-3 py-2 text-sm ${confidenceTone(f.confidence)}`}
            >
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="font-medium">
                  {confidenceLabel(f.confidence)}
                </span>
                <span>{sourceTypeLabel(f.sourceType)}</span>
                {f.humanConfirmed && <span>已人工确认</span>}
                {f.extractedAt && (
                  <span>
                    {new Date(f.extractedAt).toLocaleString("zh-CN")}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[var(--foreground)]">{f.content}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                来源：{sourceTypeLabel(f.sourceType)}
                {f.sourceUrl ? (
                  <>
                    {" · "}
                    <a
                      href={f.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      打开链接
                    </a>
                  </>
                ) : null}
                {f.sourcePage ? ` · 页码 ${f.sourcePage}` : ""}
                {f.sourceFileId ? ` · 文件 ${f.sourceFileId.slice(0, 8)}…` : ""}
                {f.extractedBy ? ` · 提取：${f.extractedBy}` : ""}
              </p>
              {f.confidence === "INFERRED" && (
                <p className="mt-1 text-[11px] text-amber-900">
                  该内容为基于现有来源的推断，不代表官方确认。
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
