"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
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
  moduleKey: string | null;
  humanConfirmed: boolean;
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
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "已确认",
  investigating: "调查中",
  risk: "存在风险",
  unknown: "暂时未知",
};

export function IntelligenceRoomClient({
  projectId,
  projectName,
  closeDate,
  ownerName,
  bidPhaseStatus,
}: Props) {
  const [room, setRoom] = useState<Room | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [factContent, setFactContent] = useState("");
  const [factModule, setFactModule] = useState("historical_awards");
  const [factConfidence, setFactConfidence] = useState("INFERRED");
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

  useEffect(() => {
    void load();
  }, [load]);

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
            sourceType: "manual",
            humanConfirmed: factConfidence === "CONFIRMED",
            extractedBy: "human",
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setFactContent("");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = (room?.summaryJson || {}) as Record<string, unknown>;

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
                  setChatHint("国内供应商 PDF 已生成，请在项目文件中查看");
                });
              }}
            >
              生成国内供应商 PDF
            </Link>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)]">
          截止：{closeDate || "暂时未知"} · 负责人：{ownerName || "未指定"} ·
          状态：{bidPhaseStatus || "—"} · Go：{room?.goDecision || "未决定"}
        </p>
      </header>

      <StartIntelligencePanel
        projectId={projectId}
        hasRoom={!!room}
        goDecision={room?.goDecision}
        bidPhaseStatus={bidPhaseStatus}
      />

      {loadError && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {loadError}
        </p>
      )}
      {chatHint && <p className="text-sm text-green-700">{chatHint}</p>}

      {/* 30 秒看懂项目 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">30 秒看懂项目</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["一句话摘要", room?.summaryText || "调查中"],
            ["采购单位", String(summary.procuringAgency || "暂时未知")],
            ["产品或服务", String(summary.product || "调查中")],
            [
              "周期采购可能",
              summary.possiblyRecurring == null
                ? "暂时未知"
                : String(summary.possiblyRecurring),
            ],
            ["上一轮中标方", String(summary.previousWinner || "暂时未知")],
            [
              "历史合同金额",
              String(summary.historicalContractValue || "暂时未知"),
            ],
            ["当前建议", String(summary.recommendation || "调查中")],
            [
              "重大阻塞",
              Array.isArray(summary.majorBlockers)
                ? (summary.majorBlockers as string[]).join("；") || "无"
                : "调查中",
            ],
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

      {/* 八模块 */}
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
                  {STATUS_LABEL[m.status] || m.status}
                </span>
              </div>
              <pre className="text-[11px] text-[var(--muted)] whitespace-pre-wrap max-h-40 overflow-auto">
                {JSON.stringify(m.dataJson ?? {}, null, 2)}
              </pre>
            </div>
          ))}
          {!room && (
            <p className="text-sm text-[var(--muted)]">
              尚未创建调查室。请先点击「确认进入投标调查」。
            </p>
          )}
        </div>
      </section>

      {/* 事实沉淀 */}
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
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="HIGH_CONFIDENCE">HIGH_CONFIDENCE</option>
              <option value="INFERRED">INFERRED</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </label>
          <input
            className="min-w-[240px] flex-1 rounded border px-2 py-1.5 text-sm"
            placeholder="例如：Cox’s Bazar Trading Inc. 于某年中标…"
            value={factContent}
            onChange={(e) => setFactContent(e.target.value)}
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
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
                <span>{f.confidence}</span>
                <span>{f.sourceType}</span>
                <span>{f.moduleKey || "—"}</span>
                {f.humanConfirmed && <span>人工确认</span>}
              </div>
              <p className="mt-1">{f.content}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* AI 对话入口（统一入口占位：链到项目助手） */}
      <section className="rounded-xl border border-[var(--border)] p-4 space-y-2">
        <h2 className="text-lg font-semibold">主 AI 对话</h2>
        <p className="text-sm text-[var(--muted)]">
          统一 AI 入口：在项目工作台继续提问（周期采购、中标方、合同金额、生成国内
          PDF）。回答中的可沉淀事实请用上方「建议保存」写入结构化字段，勿只留在聊天里。
        </p>
        <Link
          href={`/projects/${projectId}?tab=workspace`}
          className="inline-block text-sm underline"
        >
          打开项目工作台对话
        </Link>
      </section>
    </div>
  );
}
