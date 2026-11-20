"use client";

/**
 * CHAIN-3 进口线索：情报页签「供应链情报」槽里的摘要 + 槽位网格下方的完整面板。
 * 接口 404（开关关）时槽里保留原来的规划占位句与状态徽标（读取中也一样，不闪）；出错只写一句，不影响其余槽位。
 * 只解析用户贴进来的文字；不访问任何网站、不调模型（服务端同样）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { IMPORT_LEADS_TEXT, importResultZh, slotSummaryZh, type ExporterSummary, type ImportLeadsView, type PendingSuggestionView } from "@/lib/tender-import-leads/aggregate-pure";
import { IMPORT_HEADER_NAMES_ZH } from "@/lib/tender-import-leads/parse";
import type { ImportResult } from "@/lib/tender-import-leads/service";

export const IMPORT_LEADS_UI = {
  slotButton: "导入 / 查看进口线索",
  slotHide: "收起进口线索",
  unreadable: "进口线索暂时读不出来，请稍后刷新。",
  empty: "还没有导入进口记录。",
  panelTitle: "进口线索（人工导入）",
  textLabel: "进口记录（连同表头）",
  columnsHint: "把表格里的记录连同表头一起粘贴进来（逗号或制表符分隔）。需要的列：进口商、出口商；可选：日期、品名、数量、来源网址。",
  sourceLabel: "来源说明",
  sourceLabelPlaceholder: "在哪里查到的（如网站名称）；记录里没有来源网址时必填",
  dateOrderLabel: "日期写法",
  importButton: "导入",
  importing: "正在导入…",
  keepTextNote: "有没导入的记录：上面的内容保留着，改好后整张表重新导入即可，已导入的不会重复。",
  unrelatedOnlyNote: "对不上中标者的记录不用改，重新导入也会跳过。",
  winnersPrefix: "本项目采购方的历史中标者（来自授标记录，不含我方结果）：",
  noImportWithoutWinners: "没有可比对的历史中标者，暂时不能导入。",
  noBuyerNext: "在项目信息里填上采购方名称后再来。",
  noneNext: "先在本项目的「历史授标检索」里人工确认这个采购方的中标记录（或请组织管理员在「历史中标」页确认），再来导入。",
  readOnly: "你只有查看权限；导入和加入供应商库需要能修改本项目。",
  /** CHAIN-3c：不是组织管理员时，待确认的一对下面写这一句 */
  notAdminNote: "只有组织管理员能确认或否决；对本组织所有项目生效。",
  decidedTitle: "已裁决的（对本组织所有项目生效）",
  decidedConfirmed: "已确认是同一家",
  decidedRejected: "已标为不是同一家",
  revokeButton: "撤回",
  confirmRevoke: "撤回后这一对回到「要确认是不是同一家」，本组织所有项目都会随之改变。确定撤回吗？",
  rejectedNote: "在「国内采购 / 找供应商」页的「供应商线索」里标为不采用的记录不会显示在这里。",
  confirmSame: "确定是同一家吗？确认后本组织所有项目都会把这两个名称当成同一家；组织管理员可以撤回。",
  confirmReject: "确定不是同一家吗？否决后本组织所有项目都不再把这两个名称当成同一家，也不再提示；组织管理员可以撤回。",
  addSupplier: "加入供应商库",
  adding: "正在加入…",
  linkNew: (n: number) => `关联新导入的 ${n} 条`,
  supplierReady: "已在供应商库",
  supplierMissingEmail: "缺联系邮箱，去补邮箱",
  supplierInactive: "已停用",
  supplierNotAdded: "未加入供应商库",
  winnersMore: (n: number) => ` 等 ${n} 家`,
  dateUnknown: "日期未知",
  historical: "已超过 12 个月",
  close: "收起",
} as const;

const DATE_ORDER_OPTIONS: Array<{ value: "YMD" | "MDY" | "DMY"; label: string }> = [
  { value: "YMD", label: "年在前（默认）" },
  { value: "MDY", label: "月/日/年（美国网站常用）" },
  { value: "DMY", label: "日/月/年" },
];

export type ImportLeadsState = { kind: "loading" } | { kind: "hidden" } | { kind: "error" } | { kind: "ok"; view: ImportLeadsView };

export function useImportLeads(projectId: string | null | undefined) {
  const [state, setState] = useState<ImportLeadsState>({ kind: "loading" });
  useEffect(() => {
    setState({ kind: "loading" });
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

export const IMPORT_LEADS_PANEL_ID = "import-leads-panel";

/** 槽里的摘要：「{N} 家出口商（{M} 条线索）」+ 汇总排序前 3 家 + 按钮（读取中与开关关时由外层保留原来的占位句） */
export function ImportLeadsSlotSummary({ state, open, onToggle }: { state: ImportLeadsState; open: boolean; onToggle: () => void }) {
  if (state.kind === "error") return <p>{IMPORT_LEADS_UI.unreadable}</p>;
  if (state.kind !== "ok") return null;
  const v = state.view;
  return (
    <>
      <p className="text-foreground/70">{slotSummaryZh(v)}</p>
      {v.exporters.slice(0, 3).map((e) => (
        <p key={e.exporterKey} className="truncate">
          {e.exporterName}：共 {e.shipments} 票，近 12 个月 {e.last12Months} 票
        </p>
      ))}
      {v.suggestions.length ? <p>另有 {v.suggestions.length} 对要确认是不是同一家</p> : null}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={IMPORT_LEADS_PANEL_ID}
        className="mt-1 text-xs text-accent underline-offset-2 hover:underline"
        data-testid="import-leads-toggle"
      >
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

const btn = "rounded border border-border px-2.5 py-1 text-xs hover:bg-muted/30 disabled:opacity-50";

function SupplierCell({ e, canEdit, busyKey, onAdd }: { e: ExporterSummary; canEdit: boolean; busyKey: string | null; onAdd: () => void }) {
  const busy = busyKey === `row:${e.exporterKey}`;
  const action =
    canEdit && (!e.supplier || e.unlinkedLeads > 0) ? (
      <button type="button" disabled={busyKey !== null} onClick={onAdd} className={btn} aria-label={`把 ${e.exporterName} ${e.supplier ? "新导入的记录关联到供应商库" : "加入供应商库"}`}>
        {busy ? IMPORT_LEADS_UI.adding : e.supplier ? IMPORT_LEADS_UI.linkNew(e.unlinkedLeads) : IMPORT_LEADS_UI.addSupplier}
      </button>
    ) : null;
  if (!e.supplier) return action ?? <span className="text-muted">{IMPORT_LEADS_UI.supplierNotAdded}</span>;
  const status = [IMPORT_LEADS_UI.supplierReady, e.supplier.active ? "" : IMPORT_LEADS_UI.supplierInactive, e.supplier.hasEmail ? "" : IMPORT_LEADS_UI.supplierMissingEmail].filter(Boolean).join(" · ");
  return (
    <span className="flex flex-col items-start gap-1">
      <Link href={`/suppliers/${encodeURIComponent(e.supplier.id)}`} className="text-xs text-accent underline-offset-2 hover:underline">
        {status}
      </Link>
      {action}
    </span>
  );
}

function SuggestionRow({ s, canDecide, busy, onDecide }: { s: PendingSuggestionView; canDecide: boolean; busy: boolean; onDecide: (decision: "CONFIRMED" | "REJECTED") => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>
        「{s.importerName}」和中标者「{s.winnerName}」可能是同一家（{s.basisZh}），涉及 {s.recordCount} 条记录。
      </span>
      {canDecide ? (
        <span className="flex gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(IMPORT_LEADS_UI.confirmSame)) onDecide("CONFIRMED");
            }}
            className={btn}
            aria-label={`${s.importerName} 和 ${s.winnerName} 是同一家`}
          >
            是同一家
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(IMPORT_LEADS_UI.confirmReject)) onDecide("REJECTED");
            }}
            className={btn}
            aria-label={`${s.importerName} 和 ${s.winnerName} 不是同一家`}
          >
            不是
          </button>
        </span>
      ) : null}
    </li>
  );
}

function winnersNextStep(view: ImportLeadsView): string | null {
  if (view.winners.status === "no_buyer") return IMPORT_LEADS_UI.noBuyerNext;
  if (view.winners.status === "none") return IMPORT_LEADS_UI.noneNext;
  return null;
}

export function ImportLeadsPanel({ projectId, view, onView, onClose }: { projectId: string; view: ImportLeadsView; onView: (v: ImportLeadsView) => void; onClose: () => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/tender-intel/import-leads`;
  const ref = useRef<HTMLElement | null>(null);
  const [text, setText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [dateOrder, setDateOrder] = useState<"YMD" | "MDY" | "DMY">("YMD");
  const [busy, setBusy] = useState<"import" | "decide" | string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const refresh = async () => {
    const fresh = await apiFetch(base).then((r) => (r.ok ? (r.json() as Promise<ImportLeadsView>) : null)).catch(() => null);
    if (fresh) onView(fresh);
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const doImport = () =>
    run("import", async () => {
      setResult(null);
      const out = await postJson(base, { text, sourceLabel: sourceLabel || null, dateOrder });
      if (!out.ok) return setError(out.error);
      const r = out.json.result as ImportResult;
      setResult(r);
      onView(out.json.view as ImportLeadsView);
      // 全部顺利才清空：有没导入的记录时留着原文，改好重新导入（已导入的不会重复）
      if (r.problems.length === 0 && r.unrelated === 0) setText("");
    });
  const decide = (pairKey: string, decision: "CONFIRMED" | "REJECTED") =>
    run("decide", async () => {
      const out = await postJson(`${base}/aliases`, { pairKey, decision });
      if (!out.ok) {
        setError(out.error);
        await refresh();
        return;
      }
      onView(out.json.view as ImportLeadsView);
      setNotice(decision === "CONFIRMED" ? IMPORT_LEADS_TEXT.aliasConfirmed : IMPORT_LEADS_TEXT.aliasRejected);
    });
  // CHAIN-3c：撤回（组织管理员）；裁决已被同事换掉时 409，刷新后照实说
  const revoke = (pairKey: string, decisionId: string) =>
    run("decide", async () => {
      const out = await postJson(`${base}/aliases/revoke`, { pairKey, decisionId });
      if (!out.ok) {
        setError(out.error);
        await refresh();
        return;
      }
      onView(out.json.view as ImportLeadsView);
      const wasRejected = (out.json as { revokedDecision?: string }).revokedDecision === "REJECTED";
      setNotice(wasRejected ? `${IMPORT_LEADS_TEXT.revoked}${IMPORT_LEADS_TEXT.revokedRejection}` : IMPORT_LEADS_TEXT.revoked);
    });
  const addSupplier = (exporterKey: string) =>
    run(`row:${exporterKey}`, async () => {
      const out = await postJson(`${base}/suppliers`, { exporterKey });
      if (!out.ok) {
        setError(out.error);
        await refresh();
        return;
      }
      setNotice(((out.json.result as { messageZh?: string }) ?? {}).messageZh ?? null);
      onView(out.json.view as ImportLeadsView);
    });

  const winnersOk = view.winners.status === "ok";
  const next = winnersNextStep(view);
  return (
    <section ref={ref} id={IMPORT_LEADS_PANEL_ID} className="rounded-xl border border-border/70 bg-background/40 p-4 text-xs" data-testid="import-leads-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{IMPORT_LEADS_UI.panelTitle}</h3>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-foreground">
          {IMPORT_LEADS_UI.close}
        </button>
      </div>
      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{view.caveatZh}</p>
      <ul className="mt-2 space-y-0.5 text-muted">
        {view.sourceNotesZh.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="mt-2 text-foreground/80">
        {view.winners.status === "ok"
          ? `${IMPORT_LEADS_UI.winnersPrefix}${view.winners.names.slice(0, 8).join("、")}${view.winners.names.length > 8 ? IMPORT_LEADS_UI.winnersMore(view.winners.names.length) : ""}`
          : view.winners.messageZh}
        {next ? ` ${next}` : ""}
      </p>

      {view.canEdit ? (
        winnersOk ? (
          <div className="mt-3 space-y-2">
            <label className="block text-foreground/80" htmlFor="import-leads-text">
              {IMPORT_LEADS_UI.textLabel}
            </label>
            <p className="text-muted">{IMPORT_LEADS_UI.columnsHint}</p>
            <p className="text-[11px] text-muted">{IMPORT_HEADER_NAMES_ZH}</p>
            <textarea
              id="import-leads-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-border bg-background p-2 font-mono text-[11px]"
              data-testid="import-leads-text"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-foreground/80">
                {IMPORT_LEADS_UI.dateOrderLabel}
                <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "YMD" | "MDY" | "DMY")} className="rounded-md border border-border bg-background px-1 py-1">
                  {DATE_ORDER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[14rem] flex-1 items-center gap-1 text-foreground/80">
                {IMPORT_LEADS_UI.sourceLabel}
                <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder={IMPORT_LEADS_UI.sourceLabelPlaceholder} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1" />
              </label>
              <button type="button" disabled={busy !== null || !text.trim()} onClick={doImport} className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-50">
                {busy === "import" ? IMPORT_LEADS_UI.importing : IMPORT_LEADS_UI.importButton}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-muted">{IMPORT_LEADS_UI.noImportWithoutWinners}</p>
        )
      ) : (
        <p className="mt-3 text-muted">{IMPORT_LEADS_UI.readOnly}</p>
      )}

      <div role="status" aria-live="polite" className="mt-2 space-y-0.5">
        {error ? <p className="text-red-600">{error}</p> : null}
        {notice ? <p className="text-foreground">{notice}</p> : null}
        {result ? (
          <>
            <p className="text-foreground">{importResultZh(result)}</p>
            {result.problems.map((p) => (
              <p key={p.code} className="text-amber-700">
                {p.messageZh}
              </p>
            ))}
            {result.problems.length ? <p className="text-muted">{IMPORT_LEADS_UI.keepTextNote}</p> : result.unrelated ? <p className="text-muted">{IMPORT_LEADS_UI.unrelatedOnlyNote}</p> : null}
          </>
        ) : null}
      </div>

      {view.suggestions.length ? (
        <div className="mt-3">
          <p className="font-medium text-foreground">要确认是不是同一家</p>
          <ul className="mt-1 space-y-1">
            {view.suggestions.map((s) => (
              <SuggestionRow key={s.pairKey} s={s} canDecide={view.canDecideAliases} busy={busy !== null} onDecide={(d) => decide(s.pairKey, d)} />
            ))}
          </ul>
          {view.canDecideAliases ? null : <p className="mt-1 text-muted">{IMPORT_LEADS_UI.notAdminNote}</p>}
        </div>
      ) : null}

      {view.decidedPairs.length ? (
        <div className="mt-3">
          <p className="font-medium text-foreground">{IMPORT_LEADS_UI.decidedTitle}</p>
          <ul className="mt-1 space-y-1">
            {view.decidedPairs.map((d) => (
              <li key={d.pairKey} className="flex flex-wrap items-center gap-2">
                <span>
                  「{d.importerName}」和「{d.winnerName}」：{d.decision === "CONFIRMED" ? IMPORT_LEADS_UI.decidedConfirmed : IMPORT_LEADS_UI.decidedRejected}（{d.deciderName}，{d.decidedOn}），涉及 {d.recordCount} 条记录
                </span>
                {view.canDecideAliases ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(IMPORT_LEADS_UI.confirmRevoke)) revoke(d.pairKey, d.decisionId);
                    }}
                    className={btn}
                    aria-label={`撤回「${d.importerName}」和「${d.winnerName}」的裁决`}
                  >
                    {IMPORT_LEADS_UI.revokeButton}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="font-medium text-foreground">出口商汇总</p>
        {view.exporters.length ? (
          <ul className="mt-1 divide-y divide-border/50">
            {view.exporters.map((e) => (
              <li key={e.exporterKey} className="grid gap-1 py-2 sm:grid-cols-[minmax(10rem,1.4fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(9rem,1fr)] sm:items-start sm:gap-3">
                <span className="font-medium text-foreground">{e.exporterName}</span>
                <span>
                  <span className="text-muted">供货给：</span>
                  {e.winnerNames.join("、")}
                </span>
                <span>
                  共 {e.shipments} 票，近 12 个月 {e.last12Months} 票
                  <span className="block text-muted">
                    最近一票 {e.latestDate ?? IMPORT_LEADS_UI.dateUnknown}
                    {e.historical ? <span className="ml-1 rounded border border-amber-300 px-1 text-[10px] text-amber-700">{IMPORT_LEADS_UI.historical}</span> : null}
                  </span>
                </span>
                <span>
                  <span className="text-muted">和本标要求重合的词：</span>
                  {e.sharedKeywords.length ? e.sharedKeywords.join("、") : "—"}
                </span>
                <SupplierCell e={e} canEdit={view.canEdit} busyKey={busy === "import" || busy === "decide" ? "__busy__" : busy} onAdd={() => addSupplier(e.exporterKey)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">{slotSummaryZh(view)}</p>
        )}
        <p className="mt-2 text-[11px] text-muted">
          每条记录的状态：{view.leadStatusZh}。
          <Link href={`/projects/intelligence/supply-chain?projectId=${encodeURIComponent(projectId)}`} className="underline-offset-2 hover:underline">
            {IMPORT_LEADS_UI.rejectedNote}
          </Link>
        </p>
      </div>
    </section>
  );
}
