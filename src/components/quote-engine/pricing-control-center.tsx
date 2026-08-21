"use client";

/**
 * Pricing Control Center（Quote & Cost Engine Phase 1）
 * Header → KPI Cards → Cost Builder（按类别展开）→ Pricing（口径显式）→ Scenario → Standing Offer Panel → Customer Preview
 * 不是 Excel clone：计算在服务端引擎，页面只做输入与展示；AI 分析仅 advisory。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { CALCULATION_TYPES, COST_CATEGORIES, PRICING_METHOD_LABELS, type CostLinePayload, type TierPayload } from "@/lib/quote-engine/contract";
import type { QuoteCalcResult, QuoteCalcFailure } from "@/lib/quote-engine/calc";
import type { TierResult, UnitEconomics } from "@/lib/quote-engine/standing-offer";
import type { CustomerQuoteView } from "@/lib/quote-engine/customer-view";
import type { QuoteAnalysis } from "@/lib/quote-engine/analyze";
import { CostImportPanel } from "./cost-import-panel";
import { CustomerQuoteBuilder } from "./customer-quote-builder";
import { TenderBidPanel } from "./tender-our-bid";
import { AwardProjectPanel } from "./award-project-panel";

type Line = CostLinePayload & { id: string; calculatedCost?: number | null };
type Tier = TierPayload & { id: string };
type Quote = { id: string; quoteNumber: string | null; name: string | null; quoteType: string; status: string; version: number; sourceQuoteId: string | null; revisionReason: string | null; currency: string; pricingMethod: string; pricingRate: number | null; internalNotes: string | null; engine: Record<string, unknown> | null; costLines: Line[]; tiers: Tier[] };
type Computed = { calc: QuoteCalcResult | QuoteCalcFailure; standingOffer: { unit: UnitEconomics | null; tiers: TierResult[]; errors: Array<{ code: string; message: string }> } | null; drift: boolean };
type Payload = { quote: Quote; computed: Computed; capabilities: { canViewInternal: boolean; canEdit: boolean; canApprove: boolean } };

const money = (n: number | null | undefined, ccy = "CAD") => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy, maximumFractionDigits: 2 }));
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);
const CAT_ORDER = ["MATERIAL", "PROCUREMENT", "LOGISTICS", "FREIGHT", "CUSTOMS", "DUTY", "WAREHOUSING", "LABOUR", "EQUIPMENT", "SITE_GENERAL", "ENGINEERING", "PERMIT", "COMPLIANCE", "PROJECT_MANAGEMENT", "INSURANCE", "BOND", "FINANCING", "ADMIN", "COMMISSION", "CONTINGENCY", "PROFIT", "OTHER"];
const CAT_ZH: Record<string, string> = { MATERIAL: "材料", PROCUREMENT: "采购", LOGISTICS: "物流", FREIGHT: "运费", CUSTOMS: "清关", DUTY: "关税", WAREHOUSING: "仓储", LABOUR: "人工", EQUIPMENT: "设备", SITE_GENERAL: "现场", ENGINEERING: "工程", PERMIT: "许可", COMPLIANCE: "合规", PROJECT_MANAGEMENT: "项目管理", INSURANCE: "保险", BOND: "保函", FINANCING: "融资", ADMIN: "管理费", COMMISSION: "佣金", CONTINGENCY: "不可预见费", PROFIT: "利润", OTHER: "其它" };

export function PricingControlCenter({ projectId, quoteId }: { projectId: string; quoteId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [header, setHeader] = useState<{ name: string; pricingMethod: string; pricingRate: string; currency: string }>({ name: "", pricingMethod: "MARKUP_ON_COST", pricingRate: "", currency: "CAD" });
  const [so, setSo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [view, setView] = useState<"internal" | "customer">("internal");
  const [customer, setCustomer] = useState<CustomerQuoteView | null>(null);
  const [analysis, setAnalysis] = useState<QuoteAnalysis | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiJson<Payload>(`/api/projects/${projectId}/quote-engine/${quoteId}`);
      setData(res);
      setLines(res.quote.costLines);
      setTiers(res.quote.tiers);
      setHeader({ name: res.quote.name ?? "", pricingMethod: res.quote.pricingMethod, pricingRate: res.quote.pricingRate?.toString() ?? "", currency: res.quote.currency });
      const s = (res.quote.engine?.standingOffer ?? {}) as Record<string, unknown>;
      setSo(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v == null ? "" : String(v)])));
    } catch {
      setData(null);
    }
  }, [projectId, quoteId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (extra?: { tiers?: Tier[] }) => {
    setBusy("save"); setMsg(null);
    try {
      const n = (v: string) => (v.trim() === "" ? null : Number(v));
      const soPayload = data?.quote.quoteType === "STANDING_OFFER" ? { standingOffer: { supplierCostPerPiece: n(so.supplierCostPerPiece ?? ""), supplierCurrency: so.supplierCurrency || "CAD", fxRate: n(so.fxRate ?? ""), piecesPerBox: n(so.piecesPerBox ?? ""), boxesPerContainer: n(so.boxesPerContainer ?? ""), moq: n(so.moq ?? ""), annualQuantity: n(so.annualQuantity ?? ""), freightPerContainer: n(so.freightPerContainer ?? ""), customsPerContainer: n(so.customsPerContainer ?? ""), dutyPct: n(so.dutyPct ?? ""), warehousePerContainer: n(so.warehousePerContainer ?? ""), otherPerContainer: n(so.otherPerContainer ?? ""), inventoryCarryingPct: n(so.inventoryCarryingPct ?? "") } } : {};
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine/${quoteId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ header: { name: header.name || null, pricingMethod: header.pricingMethod, pricingRate: n(header.pricingRate), currency: header.currency, engine: soPayload }, lines: lines.map((l) => ({ ...l, id: l.id.startsWith("new-") ? undefined : l.id })), tiers: (extra?.tiers ?? tiers).map((t) => ({ ...t, id: t.id.startsWith("new-") ? undefined : t.id })) }) });
      const json = (await res.json()) as { error?: string; details?: unknown };
      if (!res.ok) setMsg(`${json.error ?? "保存失败"}${json.details ? "：" + JSON.stringify(json.details).slice(0, 300) : ""}`);
      else setMsg("已保存并重算");
      await load();
    } finally { setBusy(null); }
  };
  const transition = async (to: string) => {
    setBusy(to); setMsg(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine/${quoteId}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
      const json = (await res.json()) as { error?: string; details?: unknown };
      setMsg(res.ok ? `状态 → ${to}` : `${json.error ?? "失败"}${json.details ? "：" + JSON.stringify(json.details).slice(0, 300) : ""}`);
      await load();
    } finally { setBusy(null); }
  };
  const revise = async () => {
    const reason = window.prompt("修订原因（必填，将写入审计）");
    if (!reason) return;
    setBusy("revise");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine/${quoteId}/revise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const json = (await res.json()) as { id?: string; error?: string };
      if (res.ok && json.id) window.location.href = `/projects/${projectId}/quote-engine/${json.id}`;
      else setMsg(json.error ?? "修订失败");
    } finally { setBusy(null); }
  };
  const award = async (mode: "with_budget" | "without_budget") => {
    const msgConfirm = mode === "with_budget" ? "Award：建立项目预算版本并标记 awarded（同一事务；预算建不了就不 award）？" : "显式「不建项目预算」直接 award？（独立语义，审计会记录）";
    if (!window.confirm(msgConfirm)) return;
    setBusy("award");
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quote-engine/${quoteId}/award`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const json = (await res.json()) as { error?: string; code?: string; budgetCreated?: boolean; budgetVersionId?: string | null };
      setMsg(res.ok ? (json.budgetCreated ? `已 award，预算版本 ${json.budgetVersionId} 已创建` : "已 award（显式不建预算）") : `${json.code ?? ""} ${json.error ?? "失败"}——报价保持 approved`);
      await load();
    } finally { setBusy(null); }
  };
  const loadCustomer = async () => {
    const res = await apiJson<{ customerView: CustomerQuoteView }>(`/api/projects/${projectId}/quote-engine/${quoteId}/customer-view`).catch(() => null);
    setCustomer(res?.customerView ?? null);
    setView("customer");
  };
  const loadAnalysis = async () => {
    const res = await apiJson<{ analysis: QuoteAnalysis | null }>(`/api/projects/${projectId}/quote-engine/${quoteId}/analyze`).catch(() => null);
    setAnalysis(res?.analysis ?? null);
  };

  const grouped = useMemo(() => {
    const by = new Map<string, Line[]>();
    for (const l of lines) by.set(l.category, [...(by.get(l.category) ?? []), l]);
    return CAT_ORDER.filter((c) => by.has(c)).map((c) => ({ category: c, items: by.get(c)! }));
  }, [lines]);
  const amountOf = (id: string) => (data?.computed.calc.ok ? data.computed.calc.lines.find((l) => l.id === id)?.amount ?? null : null);

  if (!data) return <div className="p-6 text-sm text-muted">加载报价引擎…（未启用或无权限时不可见）</div>;
  const q = data.quote;
  const calc = data.computed.calc;
  const editable = data.capabilities.canEdit && (q.status === "draft" || q.status === "review");
  const ccy = q.currency;
  const updateLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = (category: string) => setLines((ls) => [...ls, { id: `new-${Date.now()}`, sortOrder: (ls.length + 1) * 10, category, subcategory: null, description: "新成本行", quantity: null, unit: null, unitCost: null, sourceCurrency: ccy, fxRate: null, fxRateSource: null, calculationType: "FIXED", calculationBase: null, rate: null, duration: null, supplierId: null, supplierName: null, source: null, notes: null, included: true }]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" data-testid="pricing-control-center">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card-bg px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <input value={header.name} disabled={!editable} onChange={(e) => setHeader((h) => ({ ...h, name: e.target.value }))} placeholder="报价名称" className="rounded border border-border bg-transparent px-2 py-1 text-sm font-semibold text-foreground" />
            <span className="rounded-full border border-border px-2 text-[10px] text-muted">{q.quoteType}</span>
            <span className={`rounded-full px-2 text-[10px] ${q.status === "approved" || q.status === "awarded" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "border border-border text-muted"}`}>{q.status}</span>
            <span className="text-[10px] text-muted">v{q.version}{q.sourceQuoteId ? "（修订）" : ""} · {q.quoteNumber ?? "—"} · {ccy}</span>
          </div>
          {q.revisionReason ? <p className="mt-1 text-[11px] text-muted">修订原因：{q.revisionReason}</p> : null}
          {data.computed.drift ? <p className="mt-1 text-[11px] text-amber-700">快照与实时计算不一致（calcVersion 或数值漂移）——保存一次以刷新快照</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {editable ? <button type="button" disabled={busy != null} onClick={() => void save()} className="rounded border border-border bg-accent/10 px-2 py-1">{busy === "save" ? "保存中…" : "保存并重算"}</button> : null}
          {data.capabilities.canEdit && q.status === "draft" ? <button type="button" disabled={busy != null} onClick={() => void transition("review")} className="rounded border border-border px-2 py-1">提交审核</button> : null}
          {data.capabilities.canApprove && q.status === "review" ? <button type="button" disabled={busy != null} onClick={() => void transition("approved")} className="rounded border border-emerald-300 px-2 py-1 text-emerald-800">批准</button> : null}
          {data.capabilities.canEdit && q.status === "review" ? <button type="button" disabled={busy != null} onClick={() => void transition("draft")} className="rounded border border-border px-2 py-1">退回草稿</button> : null}
          {data.capabilities.canEdit && (q.status === "approved" || q.status === "superseded" || q.status === "awarded") ? <button type="button" disabled={busy != null} onClick={() => void revise()} className="rounded border border-border px-2 py-1">创建修订版本</button> : null}
          {data.capabilities.canApprove && q.status === "approved" ? <><button type="button" disabled={busy != null} onClick={() => void award("with_budget")} className="rounded border border-violet-300 px-2 py-1 text-violet-800">Award + 建项目预算</button><button type="button" disabled={busy != null} onClick={() => void award("without_budget")} className="rounded border border-border px-2 py-1 text-muted">仅 Award（不建预算）</button></> : null}
          {data.capabilities.canEdit && (q.status === "draft" || q.status === "review" || q.status === "approved") ? <button type="button" disabled={busy != null} onClick={() => { if (window.confirm("取消此报价？")) void transition("cancelled"); }} className="rounded border border-border px-2 py-1 text-muted">取消</button> : null}
          <button type="button" onClick={() => (view === "internal" ? void loadCustomer() : setView("internal"))} className="rounded border border-border px-2 py-1">{view === "internal" ? "客户报价预览" : "返回内部视图"}</button>
        </div>
      </div>
      {msg ? <p className="text-[11px] text-muted">{msg}</p> : null}

      {view === "customer" ? (
        <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="customer-preview">
          <h3 className="text-sm font-semibold">Customer Quote Preview（仅公开字段；无成本/佣金/利润）</h3>
          {customer ? (
            <table className="mt-2 w-full text-[12px]"><thead className="text-muted"><tr><th className="text-left py-1">Item</th><th className="text-left">Description</th><th className="text-right">Qty</th><th className="text-left pl-2">Unit</th><th className="text-right">Unit Price</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{customer.lines.map((l, i) => (<tr key={i} className="border-t border-border/40"><td className="py-1">{l.item}{l.optional ? "（Optional）" : ""}{l.allowance ? "（Allowance）" : ""}</td><td>{l.description ?? ""}</td><td className="text-right">{l.quantity ?? ""}</td><td className="pl-2">{l.unit ?? ""}</td><td className="text-right">{money(l.unitPrice, customer.currency)}</td><td className="text-right">{money(l.amount, customer.currency)}</td></tr>))}</tbody>
              <tfoot className="border-t border-border"><tr><td colSpan={5} className="text-right py-1">Subtotal</td><td className="text-right">{money(customer.subtotal, customer.currency)}</td></tr>{customer.tax.hst ? <tr><td colSpan={5} className="text-right">HST</td><td className="text-right">{money(customer.tax.hst, customer.currency)}</td></tr> : null}{customer.tax.gst ? <tr><td colSpan={5} className="text-right">GST</td><td className="text-right">{money(customer.tax.gst, customer.currency)}</td></tr> : null}{customer.tax.pst ? <tr><td colSpan={5} className="text-right">PST</td><td className="text-right">{money(customer.tax.pst, customer.currency)}</td></tr> : null}<tr className="font-semibold"><td colSpan={5} className="text-right">Total</td><td className="text-right">{money(customer.total, customer.currency)}</td></tr></tfoot></table>
          ) : <p className="mt-2 text-[11px] text-muted">加载中…</p>}
        </div>
      ) : (
        <>
          {/* KPI */}
          {calc.ok ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6" data-testid="kpi-cards">
              {[["Total Bid", money(calc.sellingPrice, ccy)], ["Estimated Cost", money(calc.estimatedCost, ccy)], ["Gross Profit", money(calc.grossProfit, ccy)], ["Gross Margin", pct(calc.grossMarginPct)], ["Markup", pct(calc.markupPct)], ["Cash Required", money(calc.cashRequired, ccy)], ["Financing Cost", money(calc.financingCost, ccy)], ["Contingency", money(calc.contingency, ccy)], ["Quote Version", `v${q.version}`]].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-card-bg px-3 py-2"><div className="text-[10px] text-muted">{k}</div><div className="text-sm font-semibold">{v}</div></div>
              ))}
              {data.computed.standingOffer?.unit ? [["Cost / Piece", money(data.computed.standingOffer.unit.landedPerPiece, ccy)], ["Cost / Box", money(data.computed.standingOffer.unit.landedPerBox, ccy)], ["Sell / Piece", money(data.computed.standingOffer.tiers[0]?.unitPrice ?? null, ccy)], ["Sell / Box", money(data.computed.standingOffer.tiers[0]?.boxPrice ?? null, ccy)], ["Containers (L1)", data.computed.standingOffer.tiers[0] ? `${data.computed.standingOffer.tiers[0].containersMath} → ${data.computed.standingOffer.tiers[0].containersProcurement}` : "—"]].map(([k, v]) => (<div key={k} className="rounded-lg border border-border bg-card-bg px-3 py-2"><div className="text-[10px] text-muted">{k}</div><div className="text-sm font-semibold">{v}</div></div>)) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-[12px]" data-testid="calc-errors"><b>校验错误（修正后才能定价）：</b><ul className="list-disc pl-4">{calc.errors.map((e, i) => <li key={i}>{e.code}{e.lineId ? `（行 ${e.lineId.slice(-4)}）` : ""}：{e.message}</li>)}</ul></div>
          )}

          {/* Pricing */}
          <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="pricing-panel">
            <h3 className="text-sm font-semibold">Pricing（定价口径必须显式）</h3>
            <div className="mt-2 flex flex-wrap items-end gap-3 text-[12px]">
              <label className="text-muted">Pricing Method<br /><select disabled={!editable} value={header.pricingMethod} onChange={(e) => setHeader((h) => ({ ...h, pricingMethod: e.target.value }))} className="mt-0.5 rounded border border-border bg-transparent px-2 py-1 text-foreground">{Object.entries(PRICING_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="text-muted">{header.pricingMethod === "MARGIN_ON_REVENUE" ? "Target Margin %（on selling price）" : "Markup %（on cost）"}<br /><input type="number" disabled={!editable} value={header.pricingRate} onChange={(e) => setHeader((h) => ({ ...h, pricingRate: e.target.value }))} className="mt-0.5 w-28 rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>
              {calc.ok ? <span className="text-muted">收入基数行合计 {pct(calc.revenuePctTotal)}（Admin/Commission/Financing/Profit 以售价为基数 → 售价 = 成本 /(1 − Σ%)，不是 × (1 + Σ%)）</span> : null}
            </div>
          </div>

          {/* Cost Builder */}
          {/* Phase 2 · Source Documents + Cost Import Review（抽取→人工审核→确认→成本行） */}
          <CostImportPanel projectId={projectId} quoteId={quoteId} editable={editable} currency={ccy} onApplied={() => void load()} />

          <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="cost-builder">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Cost Builder（成本行，内部视图）</h3>{editable ? <select className="rounded border border-border bg-transparent px-2 py-1 text-[11px]" defaultValue="" onChange={(e) => { if (e.target.value) { addLine(e.target.value); e.target.value = ""; } }}><option value="">+ 添加成本行到类别…</option>{COST_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_ZH[c] ?? c}</option>)}</select> : null}</div>
            {grouped.map((g) => {
              const total = g.items.reduce((s, l) => s + (amountOf(l.id) ?? 0), 0);
              const isOpen = open[g.category] ?? true;
              return (
                <div key={g.category} className="mt-2 rounded-lg border border-border/60">
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.category]: !isOpen }))} className="flex w-full items-center justify-between px-3 py-1.5 text-[12px]"><span className="font-medium">{CAT_ZH[g.category] ?? g.category} <span className="text-muted">{g.items.length} 行</span></span><span className="font-mono">{money(total, ccy)}</span></button>
                  {isOpen ? (
                    <div className="overflow-x-auto border-t border-border/40 px-2 py-1">
                      <table className="w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">说明</th><th>类型</th><th>数量</th><th>时长/箱</th><th>单价/费率</th><th>币种</th><th>FX</th><th>基数</th><th>%</th><th>纳入</th><th className="text-right">金额({ccy})</th><th /></tr></thead>
                        <tbody>{g.items.map((l) => (
                          <tr key={l.id} className={`border-t border-border/30 ${l.included ? "" : "opacity-50"}`}>
                            <td><input disabled={!editable} value={l.description} onChange={(e) => updateLine(l.id, { description: e.target.value })} className="w-44 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td><select disabled={!editable} value={l.calculationType} onChange={(e) => updateLine(l.id, { calculationType: e.target.value as Line["calculationType"] })} className="rounded border border-border/60 bg-transparent px-1">{CALCULATION_TYPES.filter((t) => t !== "TIER_BASED" && t !== "CUSTOM_FORMULA").map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                            <td><input type="number" disabled={!editable} value={l.quantity ?? ""} onChange={(e) => updateLine(l.id, { quantity: e.target.value === "" ? null : Number(e.target.value) })} className="w-16 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td><input type="number" disabled={!editable} value={l.duration ?? ""} onChange={(e) => updateLine(l.id, { duration: e.target.value === "" ? null : Number(e.target.value) })} className="w-16 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td><input type="number" disabled={!editable} value={l.unitCost ?? ""} onChange={(e) => updateLine(l.id, { unitCost: e.target.value === "" ? null : Number(e.target.value) })} className="w-20 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td><input disabled={!editable} value={l.sourceCurrency} onChange={(e) => updateLine(l.id, { sourceCurrency: e.target.value.toUpperCase().slice(0, 3) })} className="w-12 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td>
                              <input
                                type="number"
                                disabled={!editable || l.sourceCurrency === ccy}
                                value={l.fxRate == null ? "" : l.fxRate}
                                onChange={(e) => updateLine(l.id, { fxRate: e.target.value === "" ? null : Number(e.target.value) })}
                                className="w-16 rounded border border-border/60 bg-transparent px-1"
                              />
                            </td>
                            <td><input disabled={!editable} value={l.calculationBase ?? ""} placeholder="DIRECT_COST" onChange={(e) => updateLine(l.id, { calculationBase: e.target.value || null })} className="w-24 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td><input type="number" disabled={!editable} value={l.rate ?? ""} onChange={(e) => updateLine(l.id, { rate: e.target.value === "" ? null : Number(e.target.value) })} className="w-14 rounded border border-border/60 bg-transparent px-1" /></td>
                            <td className="text-center"><input type="checkbox" disabled={!editable} checked={l.included} onChange={(e) => updateLine(l.id, { included: e.target.checked })} /></td>
                            <td className="text-right font-mono">{money(amountOf(l.id), ccy)}</td>
                            <td>{editable ? <span className="flex gap-1"><button type="button" title="复制" onClick={() => setLines((ls) => [...ls, { ...l, id: `new-${Date.now()}`, sortOrder: l.sortOrder + 1 }])} className="text-muted">⧉</button><button type="button" title="删除" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} className="text-danger">×</button></span> : null}</td>
                          </tr>
                        ))}</tbody></table>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Standing Offer */}
          {q.quoteType === "STANDING_OFFER" ? (
            <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="standing-offer-panel">
              <h3 className="text-sm font-semibold">Standing Offer · Unit Economics</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
                {[["supplierCostPerPiece", "供应商单件成本"], ["supplierCurrency", "供应商币种"], ["fxRate", "汇率(→报价币)"], ["piecesPerBox", "件/箱"], ["boxesPerContainer", "箱/柜"], ["moq", "MOQ"], ["annualQuantity", "年估数量"], ["freightPerContainer", "运费/柜"], ["customsPerContainer", "清关/柜"], ["dutyPct", "关税 %"], ["warehousePerContainer", "仓储/柜"], ["otherPerContainer", "其它/柜"], ["inventoryCarryingPct", "库存持有 %"]].map(([k, label]) => (
                  <label key={k} className="text-muted">{label}<br /><input disabled={!editable} value={so[k] ?? ""} onChange={(e) => setSo((s) => ({ ...s, [k]: e.target.value }))} className="mt-0.5 w-full rounded border border-border bg-transparent px-1.5 py-0.5 text-foreground" /></label>
                ))}
              </div>
              {data.computed.standingOffer?.unit ? (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 text-[11px]">
                  {(() => { const u = data.computed.standingOffer.unit; return [["Pieces / container", u.piecesPerContainer.toLocaleString()], ["Supplier / container", money(u.supplierPerContainer, ccy)], ["Freight", money(u.freightPerContainer, ccy)], ["Customs", money(u.customsPerContainer, ccy)], ["Duty", money(u.dutyPerContainer, ccy)], ["Warehouse", money(u.warehousePerContainer, ccy)], ["Other + inventory", money(u.otherPerContainer + u.inventoryPerContainer, ccy)], ["= Landed / container", money(u.landedPerContainer, ccy)], ["Landed / box", money(u.landedPerBox, ccy)], ["Landed / piece", u.landedPerPiece.toFixed(4)]].map(([k, v]) => <div key={k} className="rounded border border-border/60 px-2 py-1"><div className="text-muted">{k}</div><div className="font-mono">{v}</div></div>); })()}
                </div>
              ) : null}
              {data.computed.standingOffer?.errors.length ? <ul className="mt-2 list-disc pl-4 text-[11px] text-amber-700">{data.computed.standingOffer.errors.map((e, i) => <li key={i}>{e.code}：{e.message}</li>)}</ul> : null}
              <div className="mt-3 flex items-center justify-between"><h4 className="text-[12px] font-medium">Quantity Tiers（分级）</h4>{editable ? <button type="button" onClick={() => setTiers((ts) => [...ts, { id: `new-${Date.now()}`, sortOrder: (ts.length + 1) * 10, tierName: `Level ${ts.length + 1}`, minQuantity: 0, maxQuantity: null, expectedQuantity: 0, pricingMethod: "MARGIN_ON_REVENUE", rate: null, active: true }])} className="rounded border border-border px-2 py-0.5 text-[11px]">+ 分级</button> : null}</div>
              <div className="overflow-x-auto"><table className="mt-1 w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">名称</th><th>Min</th><th>Max</th><th>期望数量</th><th>口径</th><th>%</th><th>有效</th><th className="text-right">柜数(数学→采购)</th><th className="text-right">单件价</th><th className="text-right">箱价</th><th className="text-right">收入</th><th className="text-right">成本</th><th className="text-right">毛利率</th><th /></tr></thead>
                <tbody>{tiers.map((t) => { const r = data.computed.standingOffer?.tiers.find((x) => x.id === t.id); return (
                  <tr key={t.id} className="border-t border-border/30">
                    <td><input disabled={!editable} value={t.tierName} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, tierName: e.target.value } : x)))} className="w-20 rounded border border-border/60 bg-transparent px-1" /></td>
                    <td><input type="number" disabled={!editable} value={t.minQuantity} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, minQuantity: Number(e.target.value) } : x)))} className="w-20 rounded border border-border/60 bg-transparent px-1" /></td>
                    <td><input type="number" disabled={!editable} value={t.maxQuantity ?? ""} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, maxQuantity: e.target.value === "" ? null : Number(e.target.value) } : x)))} className="w-24 rounded border border-border/60 bg-transparent px-1" /></td>
                    <td><input type="number" disabled={!editable} value={t.expectedQuantity} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, expectedQuantity: Number(e.target.value) } : x)))} className="w-24 rounded border border-border/60 bg-transparent px-1" /></td>
                    <td><select disabled={!editable} value={t.pricingMethod} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, pricingMethod: e.target.value as Tier["pricingMethod"] } : x)))} className="rounded border border-border/60 bg-transparent px-1"><option value="MARKUP_ON_COST">Markup</option><option value="MARGIN_ON_REVENUE">Margin</option></select></td>
                    <td><input type="number" disabled={!editable} value={t.rate ?? ""} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, rate: e.target.value === "" ? null : Number(e.target.value) } : x)))} className="w-14 rounded border border-border/60 bg-transparent px-1" /></td>
                    <td className="text-center"><input type="checkbox" disabled={!editable} checked={t.active} onChange={(e) => setTiers((ts) => ts.map((x) => (x.id === t.id ? { ...x, active: e.target.checked } : x)))} /></td>
                    <td className="text-right font-mono">{r ? `${r.containersMath} → ${r.containersProcurement}` : "—"}</td><td className="text-right font-mono">{r ? r.unitPrice.toFixed(4) : "—"}</td><td className="text-right font-mono">{r ? r.boxPrice.toFixed(2) : "—"}</td><td className="text-right font-mono">{money(r?.calculatedRevenue ?? null, ccy)}</td><td className="text-right font-mono">{money(r?.calculatedCost ?? null, ccy)}</td><td className="text-right font-mono">{pct(r?.calculatedMargin ?? null)}</td>
                    <td>{editable ? <button type="button" onClick={() => setTiers((ts) => ts.filter((x) => x.id !== t.id))} className="text-danger">×</button> : null}</td>
                  </tr>); })}</tbody></table></div>
            </div>
          ) : null}

          {/* Breakdown + Scenarios + Analysis */}
          {calc.ok ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="cost-breakdown">
                <h3 className="text-sm font-semibold">Cost Breakdown</h3>
                <table className="mt-2 w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">类别</th><th className="text-right">金额</th><th className="text-right">% 售价</th><th className="text-right">% 成本</th></tr></thead>
                  <tbody>{calc.breakdown.map((b) => <tr key={b.category} className={`border-t border-border/30 ${b.category === "PROFIT" ? "font-semibold" : ""}`}><td>{CAT_ZH[b.category] ?? b.category}{b.category === "PROFIT" ? "（非采购成本）" : ""}</td><td className="text-right font-mono">{money(b.amount, ccy)}</td><td className="text-right font-mono">{pct(b.pctOfSelling)}</td><td className="text-right font-mono">{b.category === "PROFIT" ? "—" : pct(b.pctOfCost)}</td></tr>)}</tbody></table>
              </div>
              <div className="rounded-xl border border-border bg-card-bg p-4" data-testid="scenarios">
                <h3 className="text-sm font-semibold">Scenario Pricing（参数可在 engine.scenarios 配置）</h3>
                <table className="mt-2 w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">情景</th><th>口径</th><th className="text-right">售价</th><th className="text-right">毛利</th><th className="text-right">毛利率</th><th className="text-right">加成</th><th>风险</th></tr></thead>
                  <tbody>{calc.scenarios.map((s) => <tr key={s.key} className="border-t border-border/30"><td>{s.labelZh}</td><td className="text-center">{s.method === "MARGIN_ON_REVENUE" ? `Margin ${s.rate}%` : `Markup ${s.rate}%`}</td><td className="text-right font-mono">{money(s.sellingPrice, ccy)}</td><td className="text-right font-mono">{money(s.grossProfit, ccy)}</td><td className="text-right font-mono">{pct(s.grossMarginPct)}</td><td className="text-right font-mono">{pct(s.markupPct)}</td><td className={`text-center ${s.risk === "HIGH" ? "text-danger" : s.risk === "MEDIUM" ? "text-amber-700" : "text-emerald-700"}`}>{s.risk}</td></tr>)}</tbody></table>
                <div className="mt-3 flex items-center gap-2"><button type="button" onClick={() => void loadAnalysis()} className="rounded border border-border px-2 py-1 text-[11px]">运行分析（advisory）</button>{analysis ? <span className="text-[10px] text-muted">{analysis.version}</span> : null}</div>
                {analysis ? <div className="mt-2 text-[11px]"><ul className="list-disc pl-4">{[...analysis.summary, ...analysis.missingCostItems, ...analysis.recommendations].map((s, i) => <li key={i}>{s}</li>)}</ul><p className="mt-1 text-[10px] text-muted">Margin risk: {analysis.marginRisk.level} · 仅供参考，不会修改报价；最终价格由人工确认。</p></div> : null}
              </div>
            </div>
          ) : null}
          {/* Phase 2 · Customer Quote（公开行 / 抬头 / 条款 / 草稿 / PDF） */}
          <CustomerQuoteBuilder projectId={projectId} quoteId={quoteId} editable={data.capabilities.canEdit} currency={ccy} onChanged={() => void load()} />
          {/* Phase 2 · Tender Integration（Approved Quote → Our Bid） */}
          <TenderBidPanel projectId={projectId} quoteId={quoteId} quoteStatus={q.status} canApprove={data.capabilities.canApprove} onChanged={() => void load()} />
          {/* Phase 2 · Award / Project（预算激活 / 基线 / Financial Performance 入口） */}
          <AwardProjectPanel projectId={projectId} quoteId={quoteId} quoteStatus={q.status} />
          {busy ? <p className="text-[11px] text-muted"><Loader2 size={12} className="inline animate-spin" /> 处理中…</p> : null}
        </>
      )}
    </div>
  );
}
