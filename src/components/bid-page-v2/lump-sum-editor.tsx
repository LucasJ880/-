"use client";

/**
 * BIDPAGE-4 新版「标书与报价」页 ② 定报价：只报总价的「总价构成表」
 * （openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode，design D11）
 *
 * 一行一个大项（项目 | 金额或比例 | 备注）；开始只有货品、海运费、关税、销售税 4 行，其余从「添加一项」里选；不预置空行。
 * 所有数（六个数、算式、每项金额）都由服务端用报价引擎算好再返回；这里不算数、不读写浏览器存储。
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  CURRENCY_NAME_ZH,
  LINE_EVIDENCE_KINDS,
  LINE_EVIDENCE_LABELS_ZH,
  LINE_MODE_MAX_ROWS,
  LINE_UOMS,
  QUOTE_STATUS_ZH,
  currencyLabelZh,
  piecesPerUnit,
  quoteDisplayName,
  uomLabelZh,
  type LineModeIssue,
  type LineRow,
} from "@/lib/bid-page-v2/quote-line/contract";
import { LUMP_ITEM_SPEC, LUMP_MARKUP_NOTE_ZH, LUMP_NOTES_MAX, LUMP_OTHER_LABEL_MAX, addableKeys, emptyLumpItem, lumpFormulaLinesZh, type LumpItem, type LumpItemKey, type LumpState, type LumpView } from "@/lib/bid-page-v2/lump-sum/contract";
import { CurrencySelect, InquiryPicker, InvalidContext, Note, NumInput, PresetRows, money, pct, useInvalidRegistry } from "./quote-ui";

export const LUMP_TEXT = {
  title: "只报总价",
  tableHeaders: ["项目", "金额或比例", "备注"],
  addItem: "添加一项",
  notFilled: "没填，不计入",
  goods: "货品",
  goodsTotal: "填一个总数",
  expand: "展开成明细",
  collapse: "改回填一个总数",
  detailHeaders: ["品名（型号）", "数量", "供应商报价（原币）", "金额（加元）"],
  addDetail: "加一行明细",
  salesTax: "销售税",
  taxNote: "销售税按税前报价 × 比例算（HST / GST / PST 按项目所在省填，空着按 0）；不算成本、不进定价，系统记的我方报价是税前报价",
  targetEmpty: "目标毛利率还没填，按 0% 算",
  landedDefine: "这里的到手成本 = 货品 + 上面填金额与按成本比例算的各项（不含预置、按报价算的保函）",
  submitInProMode: "提交、批准在专业模式里做",
  openInProMode: "用专业模式打开",
  toLine: "转成逐行报价",
  toLineConfirm: "转成逐行报价：货品明细变成逐行表的行；报关费、国内运费、按货值的关税变成逐行表的共用参数；海运费金额、安装等其余各项留在报价里（逐行表里列为「从只报总价转来的项」，照样计入）；销售税的比例留着，逐行表上不显示。合计不变，以后能再转回只报总价。确定？",
  convertDirty: "有修改还没保存：先保存或放弃修改，再转换",
  readOnly: "你可以看这份报价，但没有编辑权限；要修改请找项目负责人",
  dirty: "有修改还没保存：下面的数字是上次保存时的，保存后更新",
  discard: "放弃修改",
  conflictHint: "你这次的修改还在框里：先把要改的记下来，点「收起」再「打开」看最新内容，然后重新填",
  marginNote: "毛利率已扣销售提成，所以比目标毛利率低（目标毛利率按扣提成前算）",
} as const;

export const LUMP_TOTAL_LABELS = ["成本合计", "税前报价", "销售税", "含税总价", "利润", "毛利率"] as const;

const frozenZh = (status: string) => `这份报价「${QUOTE_STATUS_ZH[status] ?? status}」，内容锁定；要改请在专业模式里另起新版`;
const newDetail = (): LineRow => ({ costLineId: null, description: "", quantity: 1, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: null, currency: "CNY", evidenceKind: null, inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" });
const itemLabel = (it: Pick<LumpItem, "key">, i: number) => (it.key === "other" ? `其它（第 ${i + 1} 项）` : LUMP_ITEM_SPEC[it.key].labelZh);

export function LumpTotals({ view, dirty }: { view: LumpView; dirty: boolean }) {
  const c = view.computed;
  const commissionOn = view.state.presets.commission.included && (view.state.presets.commission.ratePct ?? 0) > 0;
  return (
    <div className="space-y-2" data-testid="lump-totals">
      {dirty ? <Note tone="warn">{LUMP_TEXT.dirty}</Note> : null}
      {c.ok ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ["成本合计", money(c.totals.estimatedCost)],
                ["税前报价", money(c.totals.sellingPrice)],
                ["销售税", money(c.totals.salesTax)],
                ["含税总价", money(c.totals.totalWithTax)],
                ["利润", money(c.totals.grossProfit)],
                ["毛利率", pct(c.totals.grossMarginPct)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/60 px-3 py-2">
                <div className="text-xs text-muted">{k}</div>
                <div className="text-base font-semibold">{v}</div>
              </div>
            ))}
          </div>
          {c.formula ? (
            <div className="space-y-0.5 text-xs text-muted" data-testid="lump-formula">
              {lumpFormulaLinesZh(c.formula).map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
          ) : (
            <Note tone="warn" testId="lump-formula-markup">
              {LUMP_MARKUP_NOTE_ZH}
            </Note>
          )}
          {commissionOn ? <div className="text-xs text-muted">{LUMP_TEXT.marginNote}</div> : null}
          {view.state.targetMarginPct == null && c.formula ? <div className="text-xs text-muted">{LUMP_TEXT.targetEmpty}</div> : null}
          {c.warnings.map((w) => (
            // 没有预备金是常态（判断点 5 不默认带），写成灰色说明，不当警告
            <Note key={w.code} tone={w.code === "NO_CONTINGENCY" ? "muted" : "warn"}>
              {w.messageZh}
            </Note>
          ))}
        </>
      ) : (
        <Note tone="error" testId="lump-errors">
          还算不出报价：{c.errorsZh.join("；")}
        </Note>
      )}
    </div>
  );
}

export function LumpSumEditor({ projectId, view, onSaved, onClose, onConverted = () => undefined }: { projectId: string; view: LumpView; onSaved: (v: LumpView) => void; onClose: () => void; onConverted?: (quoteId: string, entryMode: "LINE" | "LUMP_SUM") => void }) {
  const [state, setState] = useState<LumpState>(view.state);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<{ message: string; issues: LineModeIssue[]; conflict: boolean } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const { invalid, setInvalid, reportInvalid } = useInvalidRegistry();
  const editable = view.capabilities.canEdit && !view.quote.frozen;
  const base = `/api/projects/${encodeURIComponent(projectId)}/bid-page/quotes/${encodeURIComponent(view.quote.id)}`;

  // 换了一份报价或保存成功后，以服务端的状态为准
  useEffect(() => {
    setState(view.state);
    setDirty(false);
  }, [view]);

  const update = (fn: (s: LumpState) => LumpState) => {
    setState((s) => fn(s));
    setDirty(true);
  };
  const ensureFx = (s: LumpState, ccy: string): LumpState => (ccy === "CAD" || s.fx[ccy] ? s : { ...s, fx: { ...s.fx, [ccy]: { rate: null, source: null } } });
  const setItem = (i: number, patch: Partial<LumpItem>) => update((s) => ({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const setDetail = (i: number, patch: Partial<LineRow>) => update((s) => ({ ...s, details: s.details.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`${base}/lump`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUpdatedAt: view.quote.updatedAt, state }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: String(data?.error ?? "保存没成功，请稍后再试"), issues: (data?.details?.issues ?? []) as LineModeIssue[], conflict: res.status === 409 });
        return;
      }
      onSaved(data as LumpView);
    } catch {
      setError({ message: "保存没成功（网络问题），请稍后再试", issues: [], conflict: false });
    } finally {
      setSaving(false);
    }
  }, [base, view.quote.updatedAt, state, onSaved]);

  const convertToLine = useCallback(async () => {
    if (!window.confirm(LUMP_TEXT.toLineConfirm)) return;
    setConverting(true);
    setError(null);
    try {
      const res = await apiFetch(`${base}/convert`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "LINE", baseUpdatedAt: view.quote.updatedAt }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: String(data?.error ?? "没转成，请稍后再试"), issues: [], conflict: false });
        return;
      }
      onConverted(view.quote.id, "LINE");
    } catch {
      setError({ message: "没转成（网络问题），请稍后再试", issues: [], conflict: false });
    } finally {
      setConverting(false);
    }
  }, [base, view.quote.id, view.quote.updatedAt, onConverted]);

  const amounts = view.computed.ok && !dirty ? view.computed.amountById : null;
  const shown = (id: string | null) => (amounts && id && amounts[id] != null ? money(amounts[id]) : null);
  const g = state.goods;
  const usedCurrencies = [
    ...new Set([
      ...Object.keys(state.fx),
      ...(g.mode === "total" ? [g.currency] : []),
      ...state.details.map((r) => r.currency),
      ...state.items.filter((i) => i.kind === "amount").map((i) => i.currency),
    ]),
  ].filter((c) => c !== "CAD");
  const canAdd = addableKeys(state.items);
  const isSupplyOnly = view.quote.quoteType === "SUPPLY_ONLY";

  return (
    <InvalidContext.Provider value={reportInvalid}>
      <div key={`${view.quote.updatedAt}-${resetKey}`} className="space-y-4 rounded-xl border border-border/60 px-4 py-3" data-testid="lump-editor">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-medium">
            {LUMP_TEXT.title} · {quoteDisplayName(view.quote)} · 第 {view.quote.version} 版 · {QUOTE_STATUS_ZH[view.quote.status] ?? view.quote.status}
          </div>
          <a className="text-xs text-accent underline-offset-2 hover:underline" href={view.proModeHref}>
            {LUMP_TEXT.submitInProMode}
          </a>
          <div className="relative ml-auto">
            <button type="button" className="rounded border border-border px-2 py-1 text-xs" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
              更多
            </button>
            {moreOpen ? (
              <div className="absolute right-0 z-10 mt-1 w-56 rounded border border-border bg-card-bg py-1 text-sm shadow" role="menu">
                <a role="menuitem" className="block px-3 py-1 hover:bg-accent-soft" href={view.proModeHref} data-testid="lump-editor-pro-mode">
                  {LUMP_TEXT.openInProMode}
                </a>
                {editable && isSupplyOnly ? (
                  <>
                    <button type="button" role="menuitem" className="block w-full px-3 py-1 text-left hover:bg-accent-soft disabled:opacity-60" disabled={!view.convertToLine.available || dirty || converting} onClick={() => void convertToLine()} data-testid="lump-editor-to-line">
                      {converting ? "正在转换…" : LUMP_TEXT.toLine}
                    </button>
                    {!view.convertToLine.available ? <div className="px-3 py-1 text-xs text-muted">{view.convertToLine.reasonZh}</div> : dirty ? <div className="px-3 py-1 text-xs text-muted">{LUMP_TEXT.convertDirty}</div> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <button type="button" className="text-xs text-muted" onClick={onClose}>
            收起
          </button>
        </div>

        {view.quote.frozen ? <Note>{frozenZh(view.quote.status)}</Note> : !view.capabilities.canEdit ? <Note>{LUMP_TEXT.readOnly}</Note> : null}
        {view.notices.map((n) => (
          <Note key={n} tone="warn">
            {n}
          </Note>
        ))}

        <LumpTotals view={view} dirty={dirty} />

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="lump-table">
            <thead>
              <tr className="text-left text-xs text-muted">
                {LUMP_TEXT.tableHeaders.map((h) => (
                  <th key={h} className="px-2 py-1 font-normal">
                    {h}
                  </th>
                ))}
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {/* 货品：填一个总数，或展开成明细 */}
              <tr className="border-t border-border/60 align-top" data-testid="lump-row-goods">
                <td className="px-2 py-1 font-medium">{LUMP_TEXT.goods}</td>
                <td className="space-y-1 px-2 py-1">
                  {g.mode === "total" ? (
                    <>
                      <div className="flex flex-wrap items-center gap-1">
                        <NumInput label="货品总数" value={g.amount} disabled={!editable} onChange={(v) => update((s) => ({ ...s, goods: { ...s.goods, amount: v, inquiryItemId: null, supplierId: null, supplierName: null } }))} className="w-32" />
                        <CurrencySelect label="货品币种" value={g.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, goods: { ...s.goods, currency: c, inquiryItemId: null, supplierId: null, supplierName: null } }, c))} />
                      </div>
                      {g.inquiryItemId ? (
                        <div className="text-xs text-muted">来自询价回复的总价：{g.supplierName ?? "供应商"}（{CURRENCY_NAME_ZH[g.currency] ?? g.currency}）</div>
                      ) : g.amount != null ? (
                        <select aria-label="货品总数证据类别" className="rounded border border-border px-1 py-1 text-xs" disabled={!editable} value={g.evidenceKind ?? ""} onChange={(e) => update((s) => ({ ...s, goods: { ...s.goods, evidenceKind: (e.target.value || null) as LumpState["goods"]["evidenceKind"] } }))}>
                          <option value="">选证据类别（必选）</option>
                          {LINE_EVIDENCE_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {LINE_EVIDENCE_LABELS_ZH[k]}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <InquiryPicker
                        options={view.inquiryQuotes}
                        selectedId={g.inquiryItemId}
                        price="total"
                        disabled={!editable}
                        onPick={(o) =>
                          o && o.totalPrice != null
                            ? update((s) => ensureFx({ ...s, goods: { ...s.goods, amount: o.totalPrice, currency: o.currency, inquiryItemId: o.inquiryItemId, supplierId: o.supplierId, supplierName: o.supplierName, evidenceKind: null } }, o.currency))
                            : update((s) => ({ ...s, goods: { ...s.goods, inquiryItemId: null, supplierId: null, supplierName: null } }))
                        }
                      />
                      {g.amount == null ? <div className="text-xs text-muted">还没填，暂按 0 算</div> : null}
                      {editable ? (
                        <button type="button" className="text-xs text-accent underline" onClick={() => update((s) => ({ ...s, goods: { ...s.goods, mode: "detail" }, details: s.details.length ? s.details : [newDetail()] }))} data-testid="lump-goods-expand">
                          {LUMP_TEXT.expand}（型号 × 数量 × 单价）
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div>
                        明细合计 {view.computed.ok && !dirty ? money(view.computed.goodsAmount) : "（保存后更新）"}（{state.details.length} 行，见下方明细）
                      </div>
                      {editable ? (
                        <button
                          type="button"
                          className="text-xs text-accent underline"
                          data-testid="lump-goods-collapse"
                          onClick={() => {
                            if (state.details.length > 0 && !window.confirm(`会删掉 ${state.details.length} 条明细，确定？`)) return;
                            update((s) => ({ ...s, goods: { ...s.goods, mode: "total" }, details: [] }));
                          }}
                        >
                          {LUMP_TEXT.collapse}
                        </button>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="px-2 py-1">
                  <input aria-label="货品备注" className="w-48 rounded border border-border px-2 py-1" maxLength={LUMP_NOTES_MAX} disabled={!editable} value={g.notes ?? ""} onChange={(e) => update((s) => ({ ...s, goods: { ...s.goods, notes: e.target.value || null } }))} />
                </td>
                <td />
              </tr>

              {state.items.map((it, i) => {
                const spec = LUMP_ITEM_SPEC[it.key];
                const name = itemLabel(it, i);
                const value = it.kind === "amount" ? it.amount : it.ratePct;
                return (
                  <tr key={`${it.costLineId ?? "new"}-${i}`} className="border-t border-border/60 align-top" data-testid="lump-row">
                    <td className="px-2 py-1">
                      {it.key === "other" ? (
                        <input aria-label={`${name}名称`} placeholder="其它（填名称）" className="w-40 rounded border border-border px-2 py-1" maxLength={LUMP_OTHER_LABEL_MAX} disabled={!editable} value={it.label ?? ""} onChange={(e) => setItem(i, { label: e.target.value })} />
                      ) : (
                        spec.labelZh
                      )}
                    </td>
                    <td className="space-y-1 px-2 py-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {spec.percent ? (
                          <select aria-label={`${name}填法`} className="rounded border border-border px-1 py-1 text-xs" disabled={!editable} value={it.kind} onChange={(e) => setItem(i, { kind: e.target.value as LumpItem["kind"] })}>
                            <option value="amount">金额</option>
                            <option value="percent">比例</option>
                          </select>
                        ) : null}
                        {it.kind === "amount" ? (
                          <>
                            <NumInput label={`${name}金额`} value={it.amount} disabled={!editable} onChange={(v) => setItem(i, { amount: v })} className="w-28" />
                            <CurrencySelect label={`${name}币种`} value={it.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, currency: c } : x)) }, c))} />
                          </>
                        ) : (
                          <>
                            <NumInput label={`${name}比例`} value={it.ratePct} disabled={!editable} onChange={(v) => setItem(i, { ratePct: v })} className="w-20" />
                            <span>%</span>
                          </>
                        )}
                      </div>
                      {it.kind === "percent" && spec.percent ? <div className="text-xs text-muted">{spec.percent.baseZh}</div> : null}
                      <div className="text-xs text-muted">{value == null ? LUMP_TEXT.notFilled : shown(it.costLineId) ? `= ${shown(it.costLineId)}` : null}</div>
                    </td>
                    <td className="px-2 py-1">
                      <input aria-label={`${name}备注`} className="w-48 rounded border border-border px-2 py-1" maxLength={LUMP_NOTES_MAX} disabled={!editable} value={it.notes ?? ""} onChange={(e) => setItem(i, { notes: e.target.value || null })} />
                    </td>
                    <td className="px-2 py-1">
                      {editable ? (
                        <button type="button" aria-label={`删掉${name}`} className="text-xs text-muted" onClick={() => update((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) }))}>
                          删
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}

              {/* 销售税：配置里的税，不是成本行 */}
              <tr className="border-t border-border/60 align-top" data-testid="lump-row-tax">
                <td className="px-2 py-1 font-medium">{LUMP_TEXT.salesTax}</td>
                <td className="space-y-1 px-2 py-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {(["hstPct", "gstPct", "pstPct"] as const).map((k) => (
                      <span key={k} className="flex items-center gap-1">
                        {k === "hstPct" ? "HST" : k === "gstPct" ? "GST" : "PST"}
                        <NumInput label={`销售税 ${k === "hstPct" ? "HST" : k === "gstPct" ? "GST" : "PST"}`} value={state.tax[k]} disabled={!editable} onChange={(v) => update((s) => ({ ...s, tax: { ...s.tax, [k]: v } }))} className="w-16" />%
                      </span>
                    ))}
                  </div>
                  {view.computed.ok && !dirty ? <div className="text-xs text-muted">= {money(view.computed.totals.salesTax)}</div> : null}
                </td>
                <td className="px-2 py-1 text-xs text-muted">{LUMP_TEXT.taxNote}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="lump-add">
            <select
              aria-label={LUMP_TEXT.addItem}
              className="rounded border border-border px-2 py-1"
              value=""
              onChange={(e) => {
                const k = e.target.value as LumpItemKey;
                if (k) update((s) => ({ ...s, items: [...s.items, emptyLumpItem(k)] }));
              }}
            >
              <option value="">{LUMP_TEXT.addItem}…</option>
              {canAdd.map((k) => (
                <option key={k} value={k}>
                  {LUMP_ITEM_SPEC[k].labelZh}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {g.mode === "detail" ? (
          <div className="space-y-2" data-testid="lump-details">
            <div className="text-sm font-medium">货品明细</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    {LUMP_TEXT.detailHeaders.map((h) => (
                      <th key={h} className="px-2 py-1 font-normal">
                        {h}
                      </th>
                    ))}
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {state.details.map((r, i) => {
                    const canPiece = piecesPerUnit(r.uom, r.packCount) != null && (r.packCount ?? 1) > 1;
                    const at = `明细第 ${i + 1} 行`;
                    return (
                      <tr key={i} className="border-t border-border/60 align-top" data-testid="lump-detail-row">
                        <td className="px-2 py-1">
                          <span className="mr-1 text-xs text-muted">{i + 1}</span>
                          <input aria-label={`${at}品名`} className="w-56 rounded border border-border px-2 py-1" disabled={!editable} maxLength={500} value={r.description} onChange={(e) => setDetail(i, { description: e.target.value })} />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <NumInput label={`${at}数量`} value={r.quantity} disabled={!editable} onChange={(v) => setDetail(i, { quantity: v ?? 0 })} className="w-20" />
                          <select aria-label={`${at}单位`} className="ml-1 rounded border border-border px-1 py-1" disabled={!editable} value={r.uom} onChange={(e) => setDetail(i, { uom: e.target.value })}>
                            {LINE_UOMS.map((u) => (
                              <option key={u} value={u}>
                                {uomLabelZh(u)}
                              </option>
                            ))}
                          </select>
                          {r.packCount ? <div className="text-xs text-muted">每单位 {r.packCount} 件</div> : null}
                        </td>
                        <td className="space-y-1 px-2 py-1">
                          <div className="flex items-center gap-1">
                            <NumInput label={`${at}供应商报价`} value={r.unitPrice} disabled={!editable} onChange={(v) => setDetail(i, { unitPrice: v, inquiryItemId: null, supplierId: null, supplierName: null })} />
                            <CurrencySelect label={`${at}币种`} value={r.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, details: s.details.map((x, j) => (j === i ? { ...x, currency: c, inquiryItemId: null, supplierId: null, supplierName: null } : x)) }, c))} />
                          </div>
                          {canPiece || r.basis === "PER_PIECE" ? (
                            <select aria-label={`${at}报价口径`} className="rounded border border-border px-1 py-1 text-xs" disabled={!editable} value={r.basis} onChange={(e) => setDetail(i, { basis: e.target.value as LineRow["basis"], inquiryItemId: null, supplierId: null, supplierName: null })}>
                              <option value="PER_TENDER_UOM">按招标单位</option>
                              <option value="PER_PIECE">{canPiece ? `按件（× ${r.packCount}）` : "按件（这一行没有包装数，不能按件）"}</option>
                            </select>
                          ) : null}
                          {r.inquiryItemId ? (
                            <div className="text-xs text-muted">来自询价回复：{r.supplierName ?? "供应商"}（{CURRENCY_NAME_ZH[r.currency] ?? r.currency}）</div>
                          ) : r.unitPrice != null ? (
                            <select aria-label={`${at}证据类别`} className="rounded border border-border px-1 py-1 text-xs" disabled={!editable} value={r.evidenceKind ?? ""} onChange={(e) => setDetail(i, { evidenceKind: (e.target.value || null) as LineRow["evidenceKind"] })}>
                              <option value="">选证据类别（必选）</option>
                              {LINE_EVIDENCE_KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {LINE_EVIDENCE_LABELS_ZH[k]}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <InquiryPicker
                            options={view.inquiryQuotes}
                            selectedId={r.inquiryItemId}
                            disabled={!editable}
                            onPick={(o) =>
                              o && o.unitPrice != null
                                ? update((s) => ensureFx({ ...s, details: s.details.map((x, j) => (j === i ? { ...x, unitPrice: o.unitPrice, currency: o.currency, inquiryItemId: o.inquiryItemId, supplierId: o.supplierId, supplierName: o.supplierName, evidenceKind: null } : x)) }, o.currency))
                                : setDetail(i, { inquiryItemId: null, supplierId: null, supplierName: null })
                            }
                          />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">{shown(r.costLineId) ?? "—"}</td>
                        <td className="px-2 py-1">
                          {editable ? (
                            <button type="button" aria-label={`删掉${at}`} className="text-xs text-muted" onClick={() => update((s) => ({ ...s, details: s.details.filter((_, j) => j !== i) }))}>
                              删
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {editable ? (
              <button type="button" className="rounded border border-border px-3 py-1 text-sm" disabled={state.details.length >= LINE_MODE_MAX_ROWS} onClick={() => update((s) => ({ ...s, details: [...s.details, newDetail()] }))}>
                {LUMP_TEXT.addDetail}
              </button>
            ) : null}
          </div>
        ) : null}

        {usedCurrencies.length > 0 ? (
          <fieldset className="space-y-2 rounded-lg border border-border/60 px-3 py-2 text-sm" data-testid="lump-fx">
            <legend className="px-1 text-xs text-muted">汇率（一种币一个汇率）</legend>
            {usedCurrencies.map((ccy) => (
              <div key={ccy} className="flex flex-wrap items-center gap-2">
                <span>汇率：1 {currencyLabelZh(ccy)} =</span>
                <NumInput label={`${ccy} 汇率`} value={state.fx[ccy]?.rate ?? null} disabled={!editable} onChange={(v) => update((s) => ({ ...s, fx: { ...s.fx, [ccy]: { rate: v, source: s.fx[ccy]?.source ?? null } } }))} />
                <span>加元，来源</span>
                <input aria-label={`${ccy} 汇率来源`} placeholder="例：中国银行 11 月 20 日牌价" className="w-48 rounded border border-border px-2 py-1" maxLength={40} disabled={!editable} value={state.fx[ccy]?.source ?? ""} onChange={(e) => update((s) => ({ ...s, fx: { ...s.fx, [ccy]: { rate: s.fx[ccy]?.rate ?? null, source: e.target.value || null } } }))} />
              </div>
            ))}
          </fieldset>
        ) : null}

        <fieldset className="space-y-2 rounded-lg border border-border/60 px-3 py-2 text-sm" data-testid="lump-presets">
          <legend className="px-1 text-xs text-muted">预置（每个项目可改、可关）</legend>
          <div className="text-xs text-muted">{LUMP_TEXT.landedDefine}</div>
          <PresetRows presets={state.presets} editable={editable} onChange={(fn) => update((s) => ({ ...s, presets: fn(s.presets) }))} />
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
            <span>目标毛利率（按售价）：</span>
            <NumInput label="目标毛利率" value={state.targetMarginPct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, targetMarginPct: v }))} className="w-16" />
            <span>%</span>
          </div>
        </fieldset>

        {view.others.length > 0 ? (
          <Note testId="lump-others">
            另有 {view.others.length} 条其它成本行（不归总价构成表管，照样计入）：
            {view.others.map((o) => `${o.description}${o.included ? `（${money(o.amount)}）` : "（不计入）"}${o.reasonZh ? `——${o.reasonZh}` : o.fromLump ? "" : "——在专业模式里加的"}`).join("、")}。
          </Note>
        ) : null}

        {error ? (
          <Note tone="error" testId="lump-save-error">
            {error.message}
            {error.issues.length > 1 ? (
              <ul className="mt-1 list-disc pl-5">
                {error.issues.map((x) => (
                  <li key={x.messageZh}>{x.messageZh}</li>
                ))}
              </ul>
            ) : null}
            {error.conflict ? <div className="mt-1">{LUMP_TEXT.conflictHint}</div> : null}
          </Note>
        ) : null}
        {invalid.size > 0 ? (
          <Note tone="error" testId="lump-invalid">
            有 {invalid.size} 个格子填的不是数字（标红的那几格），改好才能保存
          </Note>
        ) : null}
        {editable ? (
          <div className="flex gap-3">
            <button type="button" disabled={saving || !dirty || invalid.size > 0} className="rounded bg-accent px-4 py-1.5 text-sm text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-60" onClick={save} data-testid="lump-save">
              {saving ? "正在保存…" : "保存"}
            </button>
            {dirty ? (
              <button
                type="button"
                className="text-sm text-muted"
                onClick={() => {
                  setState(view.state);
                  setDirty(false);
                  setError(null);
                  setInvalid(new Set());
                  setResetKey((k) => k + 1);
                }}
              >
                {LUMP_TEXT.discard}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </InvalidContext.Provider>
  );
}
