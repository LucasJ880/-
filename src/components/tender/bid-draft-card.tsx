"use client";

/**
 * 投标文件起草卡（工作台）：一键生成英文提交稿 + 中文审阅注（AI_DRAFT），
 * 展示上次起草的占位/待确认计数与内部注；未标合规矩阵越多，占位越多——先标矩阵再起草。
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { UNCONFIRMED_BASIS_DRAFT_NOTE_ZH } from "@/lib/tender-decision-gates/gates";

type Payload = {
  runId: string | null;
  requirementCount: number;
  markedCount: number;
  draft: {
    generatedAt: string;
    placeholders: number;
    toConfirm: number;
    excludedNameHits: number;
    forbiddenHits: number;
    requirementCount: number;
    internalNotesZh: string[];
    /** FLOW-H5：起草所用的分析当时是否已批准（开关开着时起草的才有） */
    basedOnApprovedAnalysis?: boolean;
  } | null;
  latestDoc: { id: string; createdAt: string; version: number } | null;
  /** FLOW-H5：开关开着时才有 */
  gates?: BidDraftGates;
};

/** FLOW-H5：起草元信息接口返回的提醒（开关开着时才有） */
export type BidDraftGates = { noGoZh: string | null; pendingAnalysisZh: string | null };

/** FLOW-H5：起草卡片上的提醒与标注（只提醒，不拦）。没有就不渲染 */
export function BidDraftGateNotes({ gates, basedOnApprovedAnalysis }: { gates?: Payload["gates"]; basedOnApprovedAnalysis?: boolean }) {
  const lines: Array<{ key: string; text: string }> = [];
  if (gates?.noGoZh) lines.push({ key: "nogo", text: gates.noGoZh });
  if (gates?.pendingAnalysisZh) lines.push({ key: "pending", text: gates.pendingAnalysisZh });
  if (gates && basedOnApprovedAnalysis === false) lines.push({ key: "basis", text: UNCONFIRMED_BASIS_DRAFT_NOTE_ZH });
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-[11px] text-amber-800" data-testid="bid-draft-gate-notes">
      {lines.map((l) => (
        <li key={l.key} data-note={l.key}>
          {l.text}
        </li>
      ))}
    </ul>
  );
}

export function BidDraftCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<Payload>(`/api/projects/${projectId}/bid-draft`).then(setData).catch(() => setData(null));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!data || !data.runId) return null;

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType: "bid_draft" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "起草完成，见「文件」tab；占位项须人工补齐后才可提交" : json.error ?? "起草失败，请稍后重试");
      load();
    } catch {
      setMsg("起草失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const unmarked = Math.max(0, data.requirementCount - data.markedCount);
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="bid-draft-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText size={16} className="text-accent/60" />
          投标文件起草
          <span className="text-[10px] font-normal text-muted">AI 草稿 · 人工审阅后才可提交 · 能力与价格不编造</span>
        </h3>
        {canManage ? (
          <button
            type="button"
            data-testid="bid-draft-generate"
            disabled={busy}
            onClick={() => void generate()}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-foreground/80 hover:bg-accent/5"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {busy ? "起草中（约 1–2 分钟）…" : data.draft ? "重新起草" : "生成英文提交稿草案"}
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        合规矩阵已标 {data.markedCount}/{data.requirementCount} 条
        {unmarked > 0 ? `——未标的 ${unmarked} 条在草稿中会是 [TO CONFIRM] 占位，建议先标矩阵再起草` : "——全部已标"}
      </p>
      <BidDraftGateNotes gates={data.gates} basedOnApprovedAnalysis={data.draft?.basedOnApprovedAnalysis} />
      {data.draft ? (
        <div className="mt-2 rounded-lg border border-border/60 px-3 py-2 text-xs">
          <p className="text-foreground/85">
            上次起草 {data.draft.generatedAt.slice(0, 16).replace("T", " ")} · 占位 {data.draft.placeholders} 处 · 待确认要求 {data.draft.toConfirm} 条
            {data.draft.excludedNameHits > 0 ? ` · 竞对名称替换 ${data.draft.excludedNameHits}` : ""}
            {data.draft.forbiddenHits > 0 ? ` · 禁用语替换 ${data.draft.forbiddenHits}` : ""}
          </p>
          {data.draft.internalNotesZh.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-[11px] text-muted">
              {data.draft.internalNotesZh.slice(0, 6).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {msg ? <p className="mt-2 text-[11px] text-muted">{msg}</p> : null}
    </div>
  );
}
