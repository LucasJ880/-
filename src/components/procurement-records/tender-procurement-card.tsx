"use client";

/**
 * PROC-1 Tender 详情「情报」Tab：历史采购与资料申请。
 * - 关联合同 / call-up、前序供应商（上一次谁供货，来自合同披露等已入库记录）、进口 / 海关线索（官方来源检索指引）、资料申请。
 * - 「确认为上轮中标」调用既有人工确认路由（/api/projects/[id]/external-intel/award-history），本卡片不直接写 AwardRecord。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileSearch } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { FILES_STATUS_LABELS, OUTCOME_LABELS, REQUEST_STATUS_LABELS, type GovernmentOutcome, type RequestStatus } from "@/lib/procurement-records/labels";
import type { ImportLeadSource, SupplierRollup } from "@/lib/procurement-records/supplier-pure";

type Summary = {
  available: boolean;
  instruments?: Array<{ relation: string; id: string; officialNumber: string; title: string | null; currentExpiryAt: string | null; recordsHolderInstitution: string | null; vendorName: string | null; awardDate: string | null }>;
  callUpCount?: number;
  suppliers?: SupplierRollup;
  importLeads?: { sources: ImportLeadSource[]; notesZh: string[] };
  requests?: Array<{ id: string; title: string; status: string; filesStatus: string; analysisStatus: string; governmentOutcome: string | null; caseNumber: string | null }>;
};

const REL: Record<string, string> = { CURRENT: "当前", PREDECESSOR: "前序（关联，不是编号别名）", RELATED_HISTORY: "相关历史", CALL_UP: "call-up" };
const BASIS: Record<string, string> = { DISCLOSED_CONTRACT_VALUE: "合同披露值", UNKNOWN: "口径未知" };

function money(cents: string, currency: string): string {
  const n = Number(cents) / 100;
  return `${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function TenderProcurementCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Summary | null>(null);
  const [note, setNote] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    apiJson<Summary>(`/api/projects/${projectId}/procurement-records`).then(setData).catch(() => setData(null));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);
  if (!data || !data.available) return null;
  const inst = data.instruments ?? [];
  const reqs = data.requests ?? [];
  const sup = data.suppliers;
  const leads = data.importLeads;

  const confirmWinner = async (s: SupplierRollup["suppliers"][number]) => {
    if (!window.confirm(`确认「${s.vendorName}」为本项目的上轮中标方？\n依据：${s.confirm.evidenceSnippet}\n会写入「上轮中标」（人工确认），可在调查结论里查看。`)) return;
    setBusy(s.vendorKey);
    setNote(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/external-intel/award-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "winner", ...s.confirm }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setNote({ tone: "good", text: `已确认「${s.vendorName}」为上轮中标（人工确认）。` });
      else setNote({ tone: "bad", text: body.error ?? `确认失败（${res.status}）` });
    } finally {
      setBusy(null);
    }
  };

  const activeReqs = reqs.filter((r) => r.status !== "CLOSED");
  return (
    <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="tender-procurement-card">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileSearch size={16} className="text-accent/60" />
        历史采购与资料申请
      </h3>
      {inst.length === 0 && reqs.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          尚未关联历史合同。到 <Link className="text-accent underline" href="/projects/intelligence/monitor">采购情报</Link> 关注合同并「准备申请」，或在申请卡里关联本项目。
        </p>
      ) : (
        <div className="mt-2 space-y-1 text-xs" data-testid="tender-procurement-summary">
          <p>
            <span className="text-muted">上一次谁供货：</span>
            {sup?.lastSupplier ? (
              <>
                <span className="font-medium">{sup.lastSupplier.vendorName}</span>
                <span className="text-muted">（{sup.lastSupplier.officialNumber}，{sup.lastSupplier.awardDate ?? "日期未知"}）</span>
              </>
            ) : (
              <span className="text-muted">暂无记录</span>
            )}
          </p>
          <p>
            <span className="text-muted">资料申请：</span>
            {reqs.length ? (
              <>
                {activeReqs.length ? `${activeReqs.length} 份进行中` : "没有进行中的申请"}
                {" · 最近："}
                <Link className="text-accent underline" href={`/projects/intelligence/records/${reqs[0].id}`}>{reqs[0].title}</Link>
                <span className="text-muted">（{REQUEST_STATUS_LABELS[reqs[0].status as RequestStatus] ?? reqs[0].status}）</span>
              </>
            ) : (
              <span className="text-muted">还没有</span>
            )}
          </p>
        </div>
      )}
      {inst.length || reqs.length ? (
        <details className="mt-2 text-xs" data-testid="tender-procurement-more">
          <summary className="cursor-pointer text-muted">展开：关联合同、供应商、进口线索、全部申请</summary>
      {inst.length ? (
        <ul className="mt-2 space-y-1 text-xs">
          {inst.map((i) => (
            <li key={i.id}>
              {REL[i.relation] ?? i.relation} · <span className="font-medium">{i.officialNumber}</span> {i.title ?? ""} · 供应商 {i.vendorName ?? "未知"} · 合同日期 {i.awardDate ?? "未知"} · 公开到期 {i.currentExpiryAt ?? "未知"} · 资料持有机关 {i.recordsHolderInstitution ?? "未核实"}
            </li>
          ))}
          {data.callUpCount ? <li className="text-muted">另有关联合同下的 call-up {data.callUpCount} 笔（已计入下方供应商汇总）</li> : null}
        </ul>
      ) : null}

      {sup && (sup.suppliers.length || sup.withoutVendor) ? (
        <div className="mt-3 rounded-lg border border-border p-3 text-xs" data-testid="supplier-rollup">
          <p className="font-medium">
            前序供应商（上一次谁供货）
            {sup.lastSupplier ? (
              <span className="ml-1 font-normal">
                ：最近一次是 <span className="font-medium">{sup.lastSupplier.vendorName}</span>（{sup.lastSupplier.officialNumber}，合同日期 {sup.lastSupplier.awardDate ?? "未知"}）
              </span>
            ) : (
              <span className="ml-1 font-normal text-muted">：前序 / 相关合同里没有供应商记录</span>
            )}
          </p>
          <ul className="mt-2 space-y-2">
            {sup.suppliers.map((s) => (
              <li key={s.vendorKey} className="rounded border border-border p-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{s.vendorName}</p>
                    <p className="text-muted">
                      {s.instrumentCount} 份合同 / call-up · 最近合同日期 {s.latestAwardDate ?? "未知"}
                      {s.totals.map((t) => ` · ${BASIS[t.basis] ?? t.basis} ${money(t.cents, t.currency)}（${t.count} 笔，≠ 实际支出）`).join("")}
                    </p>
                    <p className="text-muted">{s.instruments.map((x) => `${x.officialNumber}（${REL[x.relation] ?? x.relation}${x.awardDate ? ` ${x.awardDate}` : ""}）`).join("、")}</p>
                  </div>
                  <button type="button" className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent/10 disabled:opacity-50" disabled={busy !== null} onClick={() => void confirmWinner(s)}>
                    {busy === s.vendorKey ? "确认中…" : "确认为上轮中标"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {sup.withoutVendor ? <p className="mt-1 text-muted">另有 {sup.withoutVendor} 份关联合同没有供应商记录（如招标公告、人工导入未填）。</p> : null}
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
            {sup.notesZh.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {note ? <p className={`mt-1 ${note.tone === "good" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{note.text}</p> : null}
        </div>
      ) : null}

      {leads ? (
        <details className="mt-3 rounded-lg border border-border p-3 text-xs" data-testid="import-leads">
          <summary className="cursor-pointer font-medium">进口 / 海关线索（官方公开来源，需人工检索）</summary>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
            {leads.notesZh.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <ul className="mt-2 space-y-1.5">
            {leads.sources.map((l) => (
              <li key={l.key}>
                <a className="text-accent underline" href={l.url} target="_blank" rel="noreferrer noopener">{l.label}</a>：{l.whatZh}
                <span className="text-muted">（局限：{l.limitsZh}）</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {reqs.length ? (
        <ul className="mt-3 space-y-1 text-xs">
          {reqs.map((r) => (
            <li key={r.id}>
              <Link className="text-accent underline" href={`/projects/intelligence/records/${r.id}`}>{r.title}</Link> · {REQUEST_STATUS_LABELS[r.status as RequestStatus] ?? r.status} · {FILES_STATUS_LABELS[r.filesStatus] ?? r.filesStatus}
              {r.governmentOutcome ? ` · ${OUTCOME_LABELS[r.governmentOutcome as GovernmentOutcome]}` : ""}
              {r.caseNumber ? ` · 案件 ${r.caseNumber}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
        </details>
      ) : null}
    </section>
  );
}
