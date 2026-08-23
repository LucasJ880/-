"use client";

/**
 * Source Documents + Cost Import Review（Quote Operations Phase 2 P0-A）
 * Upload supplier quote → detected rows（Suggested Category / 置信度 / 来源）→ 人工 Review → Confirm → Apply → QuoteCostLine。
 * 抽取结果绝不自动成为成本；低置信度 / 缺币种 / 缺类别 必须人工处理。
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { COST_CATEGORIES, QUOTE_CURRENCIES } from "@/lib/quote-engine/contract";
import type { ImportRow } from "@/lib/quote-engine/import/contract";

type Reconciliation = { status: "OK" | "MISMATCH" | "NO_REFERENCE"; referenceTotal: number | null; extractedTotal: number; difference: number | null; tolerance: number | null; sheets?: Array<{ sheet: string; referenceRow: number | null; status: string }> } | null;
type ImportSummary = { id: string; status: string; sourceType: string; sourceFilename: string; supplierName: string | null; quoteDate: string | null; rowCount: number | null; errorMessage: string | null; notes: string[]; detectedCurrency: string | null; supplierCurrency: string | null; currencyMode: string; unresolvedCurrencyRows: number; aiUpdated: number; applied: { lineIds?: string[]; count?: number } | null; createdAt: string; reimportOf: string | null; reconciliation: Reconciliation; profitRowsExcluded: number; ambiguousAmountRows: number };
type ImportDetail = ImportSummary & { rows: ImportRow[] };

const STATUS_ZH: Record<string, string> = { UPLOADED: "已上传", EXTRACTING: "抽取中", REVIEW_REQUIRED: "待审核", CONFIRMED: "已确认", APPLIED: "已应用", FAILED: "失败", CANCELLED: "已取消" };
const WARN_ZH: Record<string, string> = { MISSING_AMOUNT: "缺金额", MISSING_CURRENCY: "缺币种", AMBIGUOUS_CATEGORY: "类别不明", LOW_CONFIDENCE: "低置信度", NEGATIVE_AMOUNT: "负数", UNPARSED_NUMBER: "数字未解析", QTY_PRICE_MISMATCH: "数量×单价≠金额", AMBIGUOUS_AMOUNT_COLUMN: "金额列不明（请填金额）", PROFIT_PRICING_RULE_RECOMMENDED: "利润行：建议走 Pricing/Margin" };
const money = (n: number | null | undefined, ccy: string) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy, maximumFractionDigits: 2 }));

export function CostImportPanel({ projectId, quoteId, editable, currency, onApplied }: { projectId: string; quoteId: string; editable: boolean; currency: string; onApplied: () => void }) {
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  // B3：供应商币种缺省 AUTO_DETECT（""）——绝不把报价币种当供应商币种；未识别行须人工确认
  const [supplierCurrency, setSupplierCurrency] = useState("");
  const [bulkCurrency, setBulkCurrency] = useState("CNY");
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dup, setDup] = useState<{ importId: string } | null>(null);
  const base = `/api/projects/${projectId}/quote-engine/${quoteId}/imports`;

  const loadList = useCallback(async () => {
    const res = await apiJson<{ imports: ImportSummary[] }>(base).catch(() => null);
    setImports(res?.imports ?? []);
  }, [base]);
  useEffect(() => { void loadList(); }, [loadList]);

  const openDetail = async (id: string) => {
    const res = await apiJson<{ import: ImportDetail }>(`${base}/${id}`).catch(() => null);
    if (res) { setDetail(res.import); setRows(res.import.rows ?? []); }
  };

  const upload = async (reimport = false) => {
    if (!file) return;
    setBusy("upload"); setMsg(null); setDup(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (supplierName.trim()) fd.append("supplierName", supplierName.trim());
      if (quoteDate) fd.append("quoteDate", quoteDate);
      if (supplierCurrency) fd.append("supplierCurrency", supplierCurrency);
      fd.append("ai", useAi ? "true" : "false");
      if (reimport) fd.append("reimport", "true");
      const res = await apiFetch(base, { method: "POST", body: fd });
      const json = (await res.json()) as { import?: ImportDetail; error?: string; code?: string; details?: { importId?: string }; extractionNotes?: string[] };
      if (res.status === 409 && json.code === "SOURCE_ALREADY_IMPORTED") { setDup({ importId: json.details?.importId ?? "" }); setMsg(json.error ?? "SOURCE_ALREADY_IMPORTED"); return; }
      if (!res.ok && !json.import) { setMsg(`${json.code ?? ""} ${json.error ?? "上传失败"}`); return; }
      if (json.import) { setDetail(json.import); setRows(json.import.rows ?? []); setMsg(json.import.status === "FAILED" ? `抽取失败：${json.import.errorMessage ?? ""}` : `已抽取 ${json.import.rows?.length ?? 0} 行，请审核`); }
      setFile(null);
      await loadList();
    } finally { setBusy(null); }
  };

  const saveReview = async () => {
    if (!detail) return;
    setBusy("save"); setMsg(null);
    try {
      const res = await apiFetch(`${base}/${detail.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows, supplierName: detail.supplierName, quoteDate: detail.quoteDate, supplierCurrency: supplierCurrency || null }) });
      const json = (await res.json()) as { import?: ImportDetail; error?: string };
      if (!res.ok) { setMsg(json.error ?? "保存失败"); return false; }
      if (json.import) { setDetail(json.import); setRows(json.import.rows ?? []); }
      setMsg("Review 已保存");
      return true;
    } finally { setBusy(null); }
  };

  const act = async (action: "confirm_apply" | "cancel") => {
    if (!detail) return;
    if (action === "confirm_apply") { const saved = await saveReview(); if (!saved) return; }
    if (action === "cancel" && !window.confirm("取消本次导入？（已应用的导入不可取消）")) return;
    setBusy(action); setMsg(null);
    try {
      const res = await apiFetch(`${base}/${detail.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const json = (await res.json()) as { import?: ImportDetail; error?: string; code?: string; details?: { issues?: Array<{ rowId: string; code: string; message: string }> }; lineIds?: string[] };
      if (!res.ok) { setMsg(`${json.code ?? ""} ${json.error ?? "失败"}${json.details?.issues ? "：" + json.details.issues.map((i) => `行 ${i.rowId.slice(-6)} ${i.message}`).join("；") : ""}`); return; }
      if (json.import) { setDetail(json.import); setRows(json.import.rows ?? []); }
      if (action === "confirm_apply") { setMsg(`已写入 ${json.lineIds?.length ?? 0} 条成本行（带来源溯源）`); onApplied(); }
      await loadList();
    } finally { setBusy(null); }
  };

  const patchRow = (rowId: string, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r) => (r.rowId === rowId ? { ...r, ...patch, userEdited: true } : r)));
  const reviewable = !!detail && (detail.status === "REVIEW_REQUIRED" || detail.status === "CONFIRMED") && editable;
  const included = rows.filter((r) => r.include);
  const unresolved = included.filter((r) => !r.sourceCurrency);
  const ambiguousAmount = included.filter((r) => r.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN"));
  const profitRows = rows.filter((r) => r.warnings.includes("PROFIT_PRICING_RULE_RECOMMENDED"));
  const rec = detail?.reconciliation ?? null;
  const applyBulkCurrency = () => setRows((rs) => rs.map((r) => (r.include && !r.sourceCurrency ? { ...r, sourceCurrency: bulkCurrency, warnings: r.warnings.filter((w) => w !== "MISSING_CURRENCY"), userEdited: true } : r)));

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4" data-testid="cost-import-panel">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Source Documents · 供应商报价 / 成本表导入</h3><span className="text-[10px] text-muted">Upload → Extract → Review → Confirm → 成本行（永不自动写入）</span></div>
      {editable ? (
        <div className="flex flex-wrap items-end gap-2 text-[11px]">
          <label className="text-muted">文件（xlsx / csv / pdf）<br /><input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-0.5 text-[11px]" /></label>
          <label className="text-muted">供应商<br /><input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="可选，抽取可猜" className="mt-0.5 w-36 rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>
          <label className="text-muted">报价日期<br /><input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} className="mt-0.5 rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>
          <label className="text-muted" title="供应商源币种 ≠ 报价币种：未标币种的中国供应商表不会被当成 CAD；不选则按文档信号识别，识别不到的行必须人工确认">供应商币种<br /><select value={supplierCurrency} onChange={(e) => setSupplierCurrency(e.target.value)} className="mt-0.5 rounded border border-border bg-transparent px-2 py-1 text-foreground"><option value="">自动识别（未识别需人工确认）</option>{QUOTE_CURRENCIES.map((c) => <option key={c} value={c}>{c}（显式确认）</option>)}</select></label>
          <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />AI 补充分类（仅低置信度行；不改数字）</label>
          <button type="button" disabled={!file || busy !== null} onClick={() => void upload(false)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"><Upload size={12} />上传并抽取</button>
          {dup ? <button type="button" onClick={() => void upload(true)} className="rounded border border-warning px-2 py-1 text-[11px]">同一文件已导入 → 重新导入为新版本</button> : null}
        </div>
      ) : null}
      {imports.length > 0 ? (
        <table className="w-full text-[11px]"><thead className="text-muted"><tr><th className="text-left">文件</th><th className="text-left">类型</th><th className="text-left">供应商</th><th className="text-left">状态</th><th className="text-right">行数</th><th className="text-left">时间</th><th /></tr></thead>
          <tbody>{imports.map((i) => <tr key={i.id} className={`border-t border-border/40 ${detail?.id === i.id ? "bg-accent/5" : ""}`}><td>{i.sourceFilename}</td><td>{i.sourceType}</td><td>{i.supplierName ?? "—"}</td><td>{STATUS_ZH[i.status] ?? i.status}{i.applied?.count ? `（${i.applied.count} 行）` : ""}</td><td className="text-right">{i.rowCount ?? "—"}</td><td>{new Date(i.createdAt).toLocaleDateString("zh-CN")}</td><td><button type="button" onClick={() => void openDetail(i.id)} className="text-accent">查看</button></td></tr>)}</tbody></table>
      ) : <p className="text-[11px] text-muted">尚无导入记录。</p>}
      {detail ? (
        <div className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="cost-import-review">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]"><div><b>{detail.sourceFilename}</b> · {STATUS_ZH[detail.status] ?? detail.status} · 供应商 {detail.supplierName ?? "—"} · 币种 {detail.currencyMode === "CONFIRMED" ? `人工确认 ${detail.supplierCurrency}` : `自动识别${detail.detectedCurrency ? ` ${detail.detectedCurrency}` : "（无文档信号）"}`}{detail.aiUpdated ? ` · AI 补充 ${detail.aiUpdated} 行` : ""}</div>
            {reviewable ? <div className="flex gap-2"><button type="button" disabled={busy !== null} onClick={() => void saveReview()} className="rounded border border-border px-2 py-1">保存 Review</button><button type="button" disabled={busy !== null || included.length === 0 || unresolved.length > 0 || ambiguousAmount.length > 0} title={unresolved.length > 0 ? `${unresolved.length} 行币种未确认，先选择供应商币种` : ambiguousAmount.length > 0 ? `${ambiguousAmount.length} 行金额列不明，请先填写金额` : ""} onClick={() => void act("confirm_apply")} className="rounded border border-accent bg-accent/10 px-2 py-1 font-medium disabled:opacity-50">确认并写入 {included.length} 行成本</button><button type="button" disabled={busy !== null} onClick={() => void act("cancel")} className="rounded border border-border px-2 py-1 text-danger">取消导入</button></div> : null}
          </div>
          {reviewable && unresolved.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded border border-warning/50 bg-warning/5 px-2 py-1 text-[11px]" data-testid="currency-confirmation-required">
              <span className="text-warning">CURRENCY_CONFIRMATION_REQUIRED：{unresolved.length} 行未识别币种（不会按报价币种 {currency} 兜底）。请选择供应商源币种：</span>
              <select value={bulkCurrency} onChange={(e) => setBulkCurrency(e.target.value)} className="rounded border border-border bg-transparent px-1 py-0.5 text-foreground">{QUOTE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <button type="button" onClick={applyBulkCurrency} className="rounded border border-border px-2 py-0.5">应用到 {unresolved.length} 行未识别行</button>
            </div>
          ) : null}
          {rec ? (
            <div className={`rounded border px-2 py-1 text-[11px] ${rec.status === "MISMATCH" ? "border-danger bg-danger/5 text-danger" : rec.status === "OK" ? "border-emerald-300 bg-emerald-50/40 text-emerald-800" : "border-border text-muted"}`} data-testid="import-reconciliation">
              <b>{rec.status === "MISMATCH" ? "RECONCILIATION_MISMATCH：抽取合计与工作簿参考总计不符，请逐行核对金额（系统不会自动改动金额）" : rec.status === "OK" ? "对账：抽取合计与工作簿参考总计一致（容差内）" : "对账：工作簿无参考总计（未检测到 Total/合计 或末尾校验行）"}</b>
              <div className="mt-0.5 flex flex-wrap gap-3"><span>工作簿参考总计 <b>{money(rec.referenceTotal, detail.supplierCurrency ?? detail.detectedCurrency ?? currency)}</b>{rec.sheets?.[0]?.referenceRow ? `（第 ${rec.sheets[0].referenceRow} 行）` : ""}</span><span>抽取合计 <b>{money(rec.extractedTotal, detail.supplierCurrency ?? detail.detectedCurrency ?? currency)}</b></span><span>差异 <b>{money(rec.difference, detail.supplierCurrency ?? detail.detectedCurrency ?? currency)}</b>{rec.tolerance != null ? `（容差 ${rec.tolerance.toFixed(2)}）` : ""}</span></div>
            </div>
          ) : null}
          {reviewable && ambiguousAmount.length > 0 ? <div className="rounded border border-danger/50 bg-danger/5 px-2 py-1 text-[11px] text-danger" data-testid="ambiguous-amount-required">AMBIGUOUS_AMOUNT_COLUMN：{ambiguousAmount.length} 行无法确定金额列（单价 / 总价 / 多个数值列），请在「单价 / 金额」栏人工填写后再确认；候选数值见备注。</div> : null}
          {profitRows.length > 0 ? <div className="rounded border border-warning/50 bg-warning/5 px-2 py-1 text-[11px]" data-testid="profit-rule-notice">该文件有 {profitRows.length} 行识别为利润（已默认不勾选）。利润通常应通过 Pricing / Margin 设置，而不是作为项目成本。如确需作为成本，请人工重新勾选。系统不会把 % 自动转成定价规则——定价基数由你决定。</div> : null}
          {detail.notes.length > 0 ? <ul className="list-disc pl-4 text-[10px] text-muted">{detail.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
          {detail.errorMessage ? <p className="text-[11px] text-danger">{detail.errorMessage}</p> : null}
          <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead className="text-muted"><tr><th>导入</th><th className="text-left">描述（可改）</th><th className="text-left">Suggested Category</th><th className="text-right">数量</th><th>单位</th><th className="text-right">单价 / 金额</th><th>币种</th><th>置信度</th><th className="text-left">提示</th><th className="text-left">来源</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.rowId} className={`border-t border-border/30 ${!r.include ? "opacity-50" : ""}`}>
              <td className="text-center"><input type="checkbox" disabled={!reviewable} checked={r.include} onChange={(e) => patchRow(r.rowId, { include: e.target.checked })} /></td>
              <td><input disabled={!reviewable} value={r.suggestedDescription} onChange={(e) => patchRow(r.rowId, { suggestedDescription: e.target.value })} className="w-56 rounded border border-border bg-transparent px-1 py-0.5 text-foreground" title={r.sourceDescription} /></td>
              <td><select disabled={!reviewable} value={r.suggestedCategory ?? ""} onChange={(e) => patchRow(r.rowId, { suggestedCategory: e.target.value || null, warnings: r.warnings.filter((w) => w !== "AMBIGUOUS_CATEGORY") })} className={`rounded border bg-transparent px-1 py-0.5 text-foreground ${r.suggestedCategory ? "border-border" : "border-danger"}`}><option value="">— 请选择 —</option>{COST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
              <td className="text-right"><input disabled={!reviewable} type="number" value={r.quantity ?? ""} onChange={(e) => patchRow(r.rowId, { quantity: e.target.value === "" ? null : Number(e.target.value), suggestedCalculationType: e.target.value === "" ? "FIXED" : "PER_UNIT" })} className="w-16 rounded border border-border bg-transparent px-1 py-0.5 text-right text-foreground" /></td>
              <td><input disabled={!reviewable} value={r.unit ?? ""} onChange={(e) => patchRow(r.rowId, { unit: e.target.value || null })} className="w-12 rounded border border-border bg-transparent px-1 py-0.5 text-foreground" /></td>
              <td className="text-right"><input disabled={!reviewable} type="number" value={(r.suggestedCalculationType === "PER_UNIT" ? r.unitCost : r.sourceAmount ?? r.unitCost) ?? ""} onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); const cleared = v == null ? r.warnings : r.warnings.filter((w) => w !== "AMBIGUOUS_AMOUNT_COLUMN" && w !== "MISSING_AMOUNT"); patchRow(r.rowId, r.suggestedCalculationType === "PER_UNIT" ? { unitCost: v, warnings: cleared } : { sourceAmount: v, unitCost: v, warnings: cleared }); }} className={`w-24 rounded border bg-transparent px-1 py-0.5 text-right text-foreground ${r.warnings.includes("AMBIGUOUS_AMOUNT_COLUMN") ? "border-danger" : "border-border"}`} title={r.rawAmountText ?? ""} /><div className="text-[9px] text-muted">{r.suggestedCalculationType}{r.suggestedRate != null ? ` · 源 ${r.suggestedRate}%（仅提示，未设基数）` : ""}</div></td>
              <td><select disabled={!reviewable} value={r.sourceCurrency ?? ""} onChange={(e) => patchRow(r.rowId, { sourceCurrency: e.target.value || null, warnings: r.warnings.filter((w) => w !== "MISSING_CURRENCY") })} className={`rounded border bg-transparent px-1 py-0.5 text-foreground ${r.sourceCurrency ? "border-border" : "border-danger"}`}><option value="">—</option>{QUOTE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
              <td className="text-center"><span className={r.confidence < 0.6 ? "text-warning" : "text-muted"}>{Math.round(r.confidence * 100)}%{r.aiSuggested ? " AI" : ""}</span></td>
              <td className="text-[10px] text-warning">{r.warnings.map((w) => WARN_ZH[w] ?? w).join("、")}</td>
              <td className="text-[10px] text-muted" title={r.evidence.snippet}>{r.evidence.sheet ? `${r.evidence.sheet} 行${r.evidence.row ?? "?"}` : r.evidence.pageNumber ? `第 ${r.evidence.pageNumber} 页` : "—"}</td>
            </tr>)}</tbody></table></div>
        </div>
      ) : null}
      {msg ? <p className="text-[11px] text-muted">{msg}</p> : null}
      {busy ? <p className="text-[11px] text-muted"><Loader2 size={12} className="inline animate-spin" /> 处理中…</p> : null}
    </div>
  );
}
