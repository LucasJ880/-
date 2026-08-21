"use client";

/**
 * Award / Project（Quote Operations Phase 2 P0-D 入口）：award 后预算版本（DRAFT → 激活 → 冻结中标基线）+ 财务表现入口。
 * 复用 /api/projects/[id]/finance/budget（T2-P1.5）；财务控制未启用时明示。
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type Version = { id: string; versionNumber: number; status: string; totalBudgetAmount: string; note: string | null };
type Payload = { versions?: Version[]; canManage?: boolean; summary?: { hasActiveBudget?: boolean; hasBaseline?: boolean } };
const STATUS_ZH: Record<string, string> = { DRAFT: "草稿", ACTIVE: "生效中", SUPERSEDED: "已被取代", AWARD_BASELINE: "中标基线" };

export function AwardProjectPanel({ projectId, quoteId, quoteStatus }: { projectId: string; quoteId: string; quoteStatus: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null | "disabled">(null);
  const [summary, setSummary] = useState<{ hasActiveBudget: boolean; hasBaseline: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/finance/budget`);
    if (res.status === 404) { setData("disabled"); return; }
    if (!res.ok) { setData(null); return; }
    setData((await res.json()) as Payload);
    const s = await apiJson<{ summary: { hasActiveBudget: boolean; hasBaseline: boolean } }>(`/api/projects/${projectId}/finance/summary`).catch(() => null);
    setSummary(s?.summary ?? null);
  }, [projectId]);
  useEffect(() => { if (quoteStatus === "awarded") void load(); }, [load, quoteStatus]);
  if (quoteStatus !== "awarded") return null;
  const post = async (body: unknown) => {
    setBusy(true); setMsg(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/finance/budget`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { error?: string };
      setMsg(res.ok ? "已更新" : json.error ?? "操作失败");
      await load();
    } finally { setBusy(false); }
  };
  const versions = data && data !== "disabled" ? data.versions ?? [] : [];
  const fromQuote = versions.filter((v) => (v.note ?? "").includes("award") || (v.note ?? "").includes("Quote"));
  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 text-[11px]" data-testid="award-project-panel">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Award / Project · 项目预算</h3><button type="button" onClick={() => router.push(`/projects/${projectId}?tab=workbench`)} className="rounded border border-border px-2 py-1">查看 Financial Performance →</button></div>
      {data === "disabled" ? <p className="mt-1 text-muted">财务控制（TENDER_FINANCIAL_CONTROL_ENABLED）未启用：报价已 awarded，但项目预算 / Budget vs Actual 不可用。</p> : null}
      {data && data !== "disabled" ? (
        <div className="mt-2 space-y-1">
          {versions.length === 0 ? <p className="text-muted">尚无预算版本（award 时选择了「不建预算」）。可在财务控制卡中手动新建。</p> : null}
          {versions.map((v) => <div key={v.id} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1"><span>v{v.versionNumber} · {Number(v.totalBudgetAmount).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} · {STATUS_ZH[v.status] ?? v.status}{v.note ? ` · ${v.note}` : ""}</span>{data.canManage && v.status === "DRAFT" ? <button type="button" disabled={busy} onClick={() => void post({ action: "activate", versionId: v.id })} className="rounded border border-accent bg-accent/10 px-2 py-0.5 font-medium">激活为当前预算</button> : null}</div>)}
          {data.canManage && summary?.hasActiveBudget && !summary?.hasBaseline ? <button type="button" disabled={busy} onClick={() => { if (window.confirm("冻结中标基线？不可逆，永久保留原始成本假设。")) void post({ action: "freeze_baseline" }); }} className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-indigo-800">冻结中标基线（Original Budget）</button> : null}
          <p className="text-[10px] text-muted">预算行 sourceReference = quote:{quoteId.slice(-6)}…（来源可追溯）{fromQuote.length ? `；来自报价的版本：${fromQuote.map((v) => `v${v.versionNumber}`).join(", ")}` : ""}</p>
        </div>
      ) : null}
      {msg ? <p className="mt-1 text-muted">{msg}</p> : null}
    </div>
  );
}
