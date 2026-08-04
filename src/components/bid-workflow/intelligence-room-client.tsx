"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import {
  confidenceLabel,
  projectAiTabHref,
  sourceTypeLabel,
} from "@/lib/bid-workflow/display-labels";
import { bidPhaseLabel, goDecisionLabel } from "@/lib/bid-workflow/labels";
import { ModuleDataView } from "./module-data-view";
import { StartIntelligencePanel } from "./start-intelligence-panel";

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
  projectName: string;
  closeDate: string | null;
  ownerName: string | null;
  bidPhaseStatus: string | null;
  projectTypeLabel?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "已确认",
  investigating: "调查中",
  risk: "存在风险",
  unknown: "暂时未知",
};

function confidenceTone(code: string): string {
  if (code === "CONFIRMED") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (code === "HIGH_CONFIDENCE") return "bg-sky-50 text-sky-800 border-sky-200";
  if (code === "INFERRED") return "bg-amber-50 text-amber-900 border-amber-200";
  return "bg-stone-50 text-stone-700 border-stone-200";
}

export function IntelligenceRoomClient({
  projectId,
  projectName,
  closeDate,
  ownerName,
  bidPhaseStatus,
  projectTypeLabel,
}: Props) {
  const [room, setRoom] = useState<Room | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [factContent, setFactContent] = useState("");
  const [factModule, setFactModule] = useState("historical_awards");
  const [factConfidence, setFactConfidence] = useState("INFERRED");
  const [factSourceUrl, setFactSourceUrl] = useState("");
  const [factSourcePage, setFactSourcePage] = useState("");
  const [recentChanges, setRecentChanges] = useState<string[]>([]);
  const [chatHint, setChatHint] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/bid-intelligence`);
      const data = await res.json();
      if (data.unavailable) {
        setLoadError("调查室数据暂不可用（可能尚未迁移），项目页仍可使用");
        setRoom(null);
        return;
      }
      setRoom(data.room);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
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
  }, [load, loadRecent]);

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
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = (room?.summaryJson || {}) as Record<string, unknown>;
  const projectType =
    projectTypeLabel ||
    (typeof summary.projectType === "string" && summary.projectType) ||
    "暂未分类";
  const recentText =
    recentChanges.length > 0
      ? recentChanges.slice(0, 3).join("；")
      : Array.isArray(summary.recentChanges) &&
          (summary.recentChanges as unknown[]).length > 0
        ? (summary.recentChanges as string[]).join("；")
        : "暂无新的重要变化";

  const aiHref = projectAiTabHref(projectId);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="space-y-2 border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-[var(--muted)]">投标智能调查室</p>
            <h1 className="text-2xl font-semibold">{projectName}</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href={`/projects/${projectId}`} className="underline">
              返回项目
            </Link>
            <Link href="/suppliers" className="underline">
              查看供应商
            </Link>
            <Link
              href={`/projects/${projectId}/generate-pdf`}
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                void apiFetch(`/api/projects/${projectId}/generate-pdf`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ docType: "china_supplier_brief" }),
                }).then(async (res) => {
                  const data = await res.json();
                  if (!res.ok) {
                    setLoadError(data.error || "PDF 生成失败");
                    return;
                  }
                  const url =
                    data.document?.fileUrl ||
                    data.document?.blobUrl ||
                    null;
                  if (url) {
                    setChatHint("国内供应商 PDF 已生成");
                    window.open(url, "_blank", "noopener,noreferrer");
                  } else {
                    setChatHint("国内供应商 PDF 已生成，请在项目文件中查看");
                  }
                });
              }}
            >
              生成国内供应商 PDF
            </Link>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)]">
          截止：{closeDate || "暂时未知"} · 负责人：{ownerName || "未指定"} ·
          阶段：{bidPhaseLabel(bidPhaseStatus)} · 人工决定：
          {goDecisionLabel(room?.goDecision)}
        </p>
      </header>

      <StartIntelligencePanel
        projectId={projectId}
        hasRoom={!!room}
        goDecision={room?.goDecision}
        bidPhaseStatus={bidPhaseStatus}
        onChanged={() => {
          void load();
          void loadRecent();
        }}
      />

      {loadError && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {loadError}
        </p>
      )}
      {chatHint && <p className="text-sm text-green-700">{chatHint}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">30 秒看懂项目</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["一句话摘要", room?.summaryText || "调查中"],
            ["采购单位", String(summary.procuringAgency || "暂时未知")],
            ["产品或服务", String(summary.product || "调查中")],
            ["项目类型", projectType],
            [
              "周期采购可能",
              summary.possiblyRecurring == null
                ? "暂时未知"
                : summary.possiblyRecurring === true
                  ? "可能是"
                  : summary.possiblyRecurring === false
                    ? "不太像"
                    : String(summary.possiblyRecurring),
            ],
            ["上一轮中标方", String(summary.previousWinner || "暂时未知")],
            [
              "历史合同金额",
              String(summary.historicalContractValue || "暂时未知"),
            ],
            ["当前建议（AI）", String(summary.recommendation || "调查中")],
            [
              "重大阻塞",
              Array.isArray(summary.majorBlockers)
                ? (summary.majorBlockers as string[]).join("；") || "无"
                : "调查中",
            ],
            ["最近变化", recentText],
            [
              "下一步",
              Array.isArray(summary.nextActions)
                ? (summary.nextActions as string[]).slice(0, 2).join("；")
                : "调查中",
            ],
          ].map(([label, value]) => (
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
              尚未创建调查室。请先点击「确认进入投标调查」。
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

      <section className="rounded-xl border border-[var(--border)] p-4 space-y-2">
        <h2 className="text-lg font-semibold">主 AI 对话</h2>
        <p className="text-sm text-[var(--muted)]">
          在项目 AI 工作台继续提问。可沉淀事实请用上方「建议保存」写入，勿只留在聊天里。
        </p>
        <Link href={aiHref} className="inline-block text-sm underline" data-testid="project-ai-tab-link">
          打开项目 AI 工作台
        </Link>
      </section>
    </div>
  );
}
