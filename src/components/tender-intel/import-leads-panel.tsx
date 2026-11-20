"use client";

/**
 * CHAIN-3 进口线索：情报页签「供应链情报」槽里的摘要 + 槽位网格下方的完整面板。
 * 接口 404（开关关）时槽里保留原来的规划占位句；出错只写一句，不影响其余槽位。
 * 只解析用户贴进来的文字；不访问任何网站、不调模型（服务端同样）。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import type { ExporterSummary, ImportLeadsView, PendingSuggestionView } from "@/lib/tender-import-leads/aggregate-pure";
import type { ImportResult } from "@/lib/tender-import-leads/service";

export const IMPORT_LEADS_UI = {
  slotButton: "导入 / 查看进口线索",
  slotHide: "收起进口线索",
  unreadable: "进口线索暂时读不出来，请稍后刷新。",
  empty: "还没有导入进口记录。",
  loading: "正在读取…",
  panelTitle: "进口线索（人工导入）",
  columnsHint: "把表格里的记录连同表头一起粘贴进来（逗号或制表符分隔）。需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。",
  sourceLabelPlaceholder: "来源说明：在哪里查到的（如网站名称）；记录里没有来源网址时必填",
  dateOrderLabel: "日期写法",
  importButton: "导入",
  winnersPrefix: "本项目采购方的历史中标者（来自授标记录，不含我方结果）：",
  noImportWithoutWinners: "没有可比对的历史中标者，暂时不能导入。",
  confirmReject: "确定不是同一家吗？否决后不能撤回，这两个名称以后不再建议。",
  addSupplier: "加入供应商库",
  supplierReady: "已在供应商库",
  supplierMissingEmail: "已在供应商库，缺联系邮箱（去补上）",
  supplierInactive: "（已停用）",
  dateUnknown: "日期未知",
  historical: "已超过 12 个月",
} as const;

const DATE_ORDER_OPTIONS: Array<{ value: "YMD" | "MDY" | "DMY"; label: string }> = [
  { value: "YMD", label: "年在前（缺省）" },
  { value: "MDY", label: "月/日/年（美国网站常用）" },
  { value: "DMY", label: "日/月/年" },
];

/** 导入结果那一句（数字照接口给的） */
export function importResultZh(r: ImportResult): string {
  const parts = [`导入 ${r.imported} 条（${r.matched} 条对上中标者，${r.suggested} 条待确认是不是同一家）`];
  if (r.duplicates) parts.push(`跳过重复 ${r.duplicates} 条`);
  if (r.unrelated) parts.push(`${r.unrelated} 条的进口商与历史中标者都对不上，没有导入${r.unrelatedImporters.length ? `（${r.unrelatedImporters.join("、")}）` : ""}`);
  return `${parts.join("；")}。`;
}

export type ImportLeadsState = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ok"; view: ImportLeadsView };

export function useImportLeads(projectId: string | null | undefined) {
  const [state, setState] = useState<ImportLeadsState>({ kind: "loading" });
  useEffect(() => {
    if (!projectId) {
      setState({ kind: "hidden" });
      return;
    }
    let cancelled = false;
    apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tender-intel/import-leads`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setState({ kind: "hidden" });
        if (!res.ok) return setState({ kind: "error" });
        const view = (await res.json()) as ImportLeadsView;
        if (!cancelled) setState({ kind: "ok", view });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const setView = useCallback((view: ImportLeadsView) => setState({ kind: "ok", view }), []);
  return { state, setView };
}

/** 槽里的摘要：「{N} 家出口商（{M} 条线索）」+ 汇总排序前 3 家 + 按钮 */
export function ImportLeadsSlotSummary({ state, open, onToggle }: { state: ImportLeadsState; open: boolean; onToggle: () => void }) {
  if (state.kind === "loading") return <p>{IMPORT_LEADS_UI.loading}</p>;
  if (state.kind === "error") return <p>{IMPORT_LEADS_UI.unreadable}</p>;
  if (state.kind !== "ok") return null;
  const v = state.view;
  return (
    <>
      <p className="text-foreground/70">{v.exporters.length ? `${v.exporters.length} 家出口商（${v.leadCount} 条线索）` : IMPORT_LEADS_UI.empty}</p>
      {v.exporters.slice(0, 3).map((e) => (
        <p key={e.exporterKey} className="truncate">
          {e.exporterName}：{e.shipments} 票（近 12 个月 {e.last12Months} 票）
        </p>
      ))}
      {v.suggestions.length ? <p>另有 {v.suggestions.length} 对疑似同一家等确认</p> : null}
      <button type="button" onClick={onToggle} className="mt-1 text-xs text-accent underline-offset-2 hover:underline" data-testid="import-leads-toggle">
        {open ? IMPORT_LEADS_UI.slotHide : IMPORT_LEADS_UI.slotButton}
      </button>
    </>
  );
}

async function postJson(url: string, body: unknown): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await apiFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof json.error === "string" ? json.error : "操作没有成功，请稍后再试。" };
    return { ok: true, json };
  } catch {
    return { ok: false, error: "网络出错，请稍后再试。" };
  }
}

function SupplierCell({ e, canEdit, busy, onAdd }: { e: ExporterSummary; canEdit: boolean; busy: boolean; onAdd: () => void }) {
  if (!e.supplier) {
    return canEdit ? (
      <button type="button" disabled={busy} onClick={onAdd} className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted/30 disabled:opacity-50">
        {IMPORT_LEADS_UI.addSupplier}
      </button>
    ) : (
      <span className="text-muted">—</span>
    );
  }
  const label = e.supplier.hasEmail ? IMPORT_LEADS_UI.supplierReady : IMPORT_LEADS_UI.supplierMissingEmail;
  return (
    <Link href={`/suppliers/${encodeURIComponent(e.supplier.id)}`} className="text-[11px] text-accent underline-offset-2 hover:underline">
      {label}
      {e.supplier.active ? "" : IMPORT_LEADS_UI.supplierInactive}
    </Link>
  );
}

function SuggestionRow({ s, canEdit, busy, onDecide }: { s: PendingSuggestionView; canEdit: boolean; busy: boolean; onDecide: (decision: "CONFIRMED" | "REJECTED") => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>
        「{s.importerName}」和中标者「{s.winnerName}」可能是同一家（{s.basisZh}），涉及 {s.recordCount} 条记录。
      </span>
      {canEdit ? (
        <span className="flex gap-1">
          <button type="button" disabled={busy} onClick={() => onDecide("CONFIRMED")} className="rounded border border-border px-2 py-0.5 text-[11px] disabled:opacity-50">
            是同一家
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(IMPORT_LEADS_UI.confirmReject)) onDecide("REJECTED");
            }}
            className="rounded border border-border px-2 py-0.5 text-[11px] disabled:opacity-50"
          >
            不是
          </button>
        </span>
      ) : null}
    </li>
  );
}

export function ImportLeadsPanel({ projectId, view, onView }: { projectId: string; view: ImportLeadsView; onView: (v: ImportLeadsView) => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/tender-intel/import-leads`;
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [dateOrder, setDateOrder] = useState<"YMD" | "MDY" | "DMY">("YMD");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const doImport = () =>
    run(async () => {
      const out = await postJson(base, { text, sourceLabel: sourceLabel || null, dateOrder });
      if (!out.ok) return setError(out.error);
      setResult(out.json.result as ImportResult);
      onView(out.json.view as ImportLeadsView);
      setText("");
    });
  const decide = (pairKey: string, decision: "CONFIRMED" | "REJECTED") =>
    run(async () => {
      const out = await postJson(`${base}/aliases`, { pairKey, decision });
      if (!out.ok) {
        setError(out.error);
        const fresh = await apiFetch(base).then((r) => (r.ok ? (r.json() as Promise<ImportLeadsView>) : null)).catch(() => null);
        if (fresh) onView(fresh);
        return;
      }
      onView(out.json.view as ImportLeadsView);
    });
  const addSupplier = (exporterKey: string) =>
    run(async () => {
      const out = await postJson(`${base}/suppliers`, { exporterKey });
      if (!out.ok) return setError(out.error);
      setNotice(((out.json.result as { messageZh?: string }) ?? {}).messageZh ?? null);
      onView(out.json.view as ImportLeadsView);
    });

  const winnersOk = view.winners.status === "ok";
  return (
    <section className="rounded-xl border border-border/70 bg-background/40 p-4 text-xs" data-testid="import-leads-panel">
      <h3 className="text-sm font-medium text-foreground">{IMPORT_LEADS_UI.panelTitle}</h3>
      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{view.caveatZh}</p>
      <p className="mt-1 text-muted">每条导入的记录状态：{view.leadStatusZh}</p>
      <ul className="mt-2 space-y-0.5 text-muted">
        {view.sourceNotesZh.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="mt-2 text-foreground/80">
        {view.winners.status === "ok" ? `${IMPORT_LEADS_UI.winnersPrefix}${view.winners.names.join("、")}` : view.winners.messageZh}
      </p>

      {view.canEdit ? (
        winnersOk ? (
          <div className="mt-3 space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={IMPORT_LEADS_UI.columnsHint}
              rows={6}
              className="w-full rounded-md border border-border bg-background p-2 font-mono text-[11px]"
              data-testid="import-leads-text"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder={IMPORT_LEADS_UI.sourceLabelPlaceholder} className="min-w-[16rem] flex-1 rounded-md border border-border bg-background px-2 py-1" />
              <label className="flex items-center gap-1 text-muted">
                {IMPORT_LEADS_UI.dateOrderLabel}
                <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "YMD" | "MDY" | "DMY")} className="rounded-md border border-border bg-background px-1 py-1">
                  {DATE_ORDER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy || !text.trim()} onClick={doImport} className="rounded-md bg-accent px-3 py-1 text-white disabled:opacity-50">
                {IMPORT_LEADS_UI.importButton}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-muted">{IMPORT_LEADS_UI.noImportWithoutWinners}</p>
        )
      ) : null}

      {error ? <p className="mt-2 text-red-600">{error}</p> : null}
      {notice ? <p className="mt-2 text-foreground">{notice}</p> : null}
      {result ? (
        <div className="mt-2 space-y-0.5">
          <p className="text-foreground">{importResultZh(result)}</p>
          {result.problems.map((p) => (
            <p key={p.code} className="text-amber-700">
              {p.messageZh}
            </p>
          ))}
        </div>
      ) : null}

      {view.suggestions.length ? (
        <div className="mt-3">
          <p className="font-medium text-foreground">待确认是不是同一家</p>
          <ul className="mt-1 space-y-1">
            {view.suggestions.map((s) => (
              <SuggestionRow key={s.pairKey} s={s} canEdit={view.canEdit} busy={busy} onDecide={(d) => decide(s.pairKey, d)} />
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="font-medium text-foreground">出口商汇总</p>
        {view.exporters.length ? (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-2 font-normal">出口商</th>
                  <th className="py-1 pr-2 font-normal">对应中标者</th>
                  <th className="py-1 pr-2 font-normal">票数（近 12 个月）</th>
                  <th className="py-1 pr-2 font-normal">最近一票</th>
                  <th className="py-1 pr-2 font-normal">品名与本标要求共有的词</th>
                  <th className="py-1 font-normal">供应商库</th>
                </tr>
              </thead>
              <tbody>
                {view.exporters.map((e) => (
                  <tr key={e.exporterKey} className="border-t border-border/50 align-top">
                    <td className="py-1 pr-2 text-foreground">{e.exporterName}</td>
                    <td className="py-1 pr-2">{e.winnerNames.join("、")}</td>
                    <td className="py-1 pr-2">
                      {e.shipments}（{e.last12Months}）
                    </td>
                    <td className="py-1 pr-2">
                      {e.latestDate ?? IMPORT_LEADS_UI.dateUnknown}
                      {e.historical ? <span className="ml-1 rounded border border-amber-300 px-1 text-[10px] text-amber-700">{IMPORT_LEADS_UI.historical}</span> : null}
                    </td>
                    <td className="py-1 pr-2">{e.sharedKeywords.length ? e.sharedKeywords.join("、") : "—"}</td>
                    <td className="py-1">
                      <SupplierCell e={e} canEdit={view.canEdit} busy={busy} onAdd={() => addSupplier(e.exporterKey)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1 text-muted">{IMPORT_LEADS_UI.empty}</p>
        )}
      </div>
    </section>
  );
}
