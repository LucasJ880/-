"use client";

/**
 * M1 — 历史授标检索面板（外部情报）
 * 检索加拿大政府合同披露 → 展示待确认 findings（含来源）→ 人工确认写入调查室
 * → 「上一轮中标方 / 历史合同金额 / 周期采购可能」变 READY → 可再喂历史对标。
 */

import { useState } from "react";
import { Landmark, Loader2, Search } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type Finding = {
  vendorName: string;
  descriptionEn: string | null;
  contractValue: number | null;
  contractDate: string | null;
  buyerName: string | null;
  ownerOrg: string | null;
  sourceUrl: string;
};

export function AwardHistoryPanel({
  projectId,
  defaultQuery,
  onConfirmed,
}: {
  projectId: string;
  defaultQuery?: string | null;
  onConfirmed?: () => void;
}) {
  const [q, setQ] = useState(defaultQuery ?? "");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await apiJson<{
        enabled: boolean;
        ok?: boolean;
        findings?: Finding[];
        note?: string | null;
        total?: number;
      }>(`/api/projects/${projectId}/external-intel/award-history?q=${encodeURIComponent(q.trim())}`);
      setEnabled(res.enabled);
      setFindings(res.findings ?? []);
      setNote(
        !res.enabled
          ? "外部情报开关未启用（管理员在环境中开启后可用）"
          : res.note ??
              ((res.findings ?? []).length === 0 ? "未找到匹配的历史授标记录，可换关键词（如产品英文名/采购机构）再试" : null),
      );
    } catch {
      setNote("检索失败，请稍后重试");
    }
    setBusy(false);
  };

  const confirm = async (f: Finding) => {
    setConfirming(f.vendorName);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/external-intel/award-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: f.vendorName,
          contractValue: f.contractValue,
          contractDate: f.contractDate,
          sourceUrl: f.sourceUrl,
          possiblyRecurring: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "确认失败");
      setNote(`已确认：${f.vendorName} 写入调查结论`);
      onConfirmed?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setConfirming(null);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4" data-testid="award-history-panel">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Landmark size={15} className="text-[var(--accent)]" />
        历史授标检索（加拿大政府合同披露）
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        查同类采购历史上谁中标、金额多少；<b>人工确认后</b>才会写入调查结论并可用于目标价对标。
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="关键词（产品英文名 / 采购机构，如 mattress / Solicitor General）"
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          disabled={busy || !q.trim()}
          onClick={() => void search()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          检索
        </button>
      </div>
      {note ? <p className="mt-2 text-xs text-[var(--muted)]">{note}</p> : null}
      {enabled && findings.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {findings.slice(0, 8).map((f, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
            >
              <span className="min-w-0">
                <b>{f.vendorName}</b>
                {f.contractValue != null ? ` · CAD ${f.contractValue.toLocaleString()}` : ""}
                {f.contractDate ? ` · ${f.contractDate}` : ""}
                <span className="block text-[var(--muted)]">
                  {(f.descriptionEn ?? "").slice(0, 80)}
                  {f.ownerOrg ? ` · ${f.ownerOrg}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                  来源
                </a>
                <button
                  type="button"
                  disabled={confirming !== null}
                  onClick={() => void confirm(f)}
                  className="rounded bg-[var(--accent)] px-2 py-1 text-white disabled:opacity-50"
                >
                  {confirming === f.vendorName ? "确认中…" : "确认为上轮中标"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
