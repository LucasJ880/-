"use client";

/**
 * Customer Quote Builder（Quote Operations Phase 2 P0-B）
 * 抬头 / 条款 / 分组卖价行（Optional / Allowance / Taxable）/ 由内部成本生成草稿（须人工确认）/ 预览 / PDF。
 * 客户行 ≠ 内部成本：这里只编辑公开行；PDF 由服务端白名单投影生成，泄露即拒绝。
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Wand2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import type { CustomerQuoteView } from "@/lib/quote-engine/customer-view";

type Header = Record<string, string | null | undefined>;
type Terms = { paymentTerms?: string | null; delivery?: string | null; leadTime?: string | null; warranty?: string | null; validity?: string | null; exclusions?: string[]; assumptions?: string[]; notes?: string | null };
type Line = { id?: string; sortOrder: number; section: string | null; item: string; description: string | null; quantity: number | null; unit: string | null; unitPrice: number | null; amount?: number | null; optional: boolean; allowance: boolean; taxable: boolean; notes: string | null; source?: unknown };
type Payload = { header: Header; terms: Terms; lines: Line[]; defaults: { header: Header; terms: Terms & { preparedBy?: string | null } }; company: { name: string | null }; preview: CustomerQuoteView | null; leaks: string[]; frozen: boolean };
type PdfDoc = { id: string; version: number; title: string; fileUrl: string | null; stale: boolean; createdAt: string; meta: { quoteVersion?: number; total?: number; currency?: string; generatedAt?: string } };

const HEADER_FIELDS: Array<{ key: string; label: string; type?: string }> = [
  { key: "clientCompany", label: "Client company" }, { key: "clientName", label: "Client name / dept" }, { key: "clientAddress", label: "Client address" }, { key: "contactName", label: "Contact" }, { key: "contactEmail", label: "Contact email" }, { key: "contactPhone", label: "Contact phone" },
  { key: "projectName", label: "Project name" }, { key: "projectNumber", label: "Project No." }, { key: "tenderNumber", label: "Tender No." }, { key: "preparedBy", label: "Prepared by" }, { key: "quoteDate", label: "Quote date", type: "date" }, { key: "validUntil", label: "Valid until", type: "date" },
];
const money = (n: number | null | undefined, ccy: string) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: ccy }));
const amountOf = (l: Line) => (l.amount != null ? l.amount : l.quantity != null && l.unitPrice != null ? Math.round(l.quantity * l.unitPrice * 100) / 100 : 0);

export function CustomerQuoteBuilder({ projectId, quoteId, editable, currency, onChanged }: { projectId: string; quoteId: string; editable: boolean; currency: string; onChanged: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [header, setHeader] = useState<Header>({});
  const [terms, setTerms] = useState<Terms>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState<{ lines: Line[]; sellingPrice: number; note: string } | null>(null);
  const [pdfs, setPdfs] = useState<PdfDoc[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/quote-engine/${quoteId}`;

  const load = useCallback(async () => {
    const res = await apiJson<Payload>(`${base}/customer-quote`).catch(() => null);
    if (res) {
      setData(res);
      // 空字段自动并入项目/组织默认（clientCompany=项目客户组织、projectName、tenderNumber=关键事实、preparedBy=档案默认）；
      // 只填空、不覆盖已填；用户看得见、保存才落库
      const mergeEmpty = <T extends Record<string, unknown>>(stored: T, defaults: Record<string, unknown>): T => {
        const out: Record<string, unknown> = { ...stored };
        for (const [k, v] of Object.entries(defaults)) {
          const cur = out[k];
          const empty = cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0);
          const has = v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
          if (empty && has) out[k] = v;
        }
        return out as T;
      };
      setHeader(mergeEmpty(res.header, { ...res.defaults.header, preparedBy: res.defaults.terms.preparedBy ?? null }));
      setTerms(mergeEmpty(res.terms, res.defaults.terms as Record<string, unknown>));
      setLines(res.lines);
    }
    const p = await apiJson<{ documents: PdfDoc[] }>(`${base}/pdf`).catch(() => null);
    setPdfs(p?.documents ?? []);
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy("save"); setMsg(null);
    try {
      const res = await apiFetch(`${base}/customer-quote`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ header, terms, lines: lines.map((l, i) => ({ ...l, sortOrder: (i + 1) * 10, amount: amountOf(l) })) }) });
      const json = (await res.json()) as Payload & { error?: string; code?: string; details?: unknown };
      if (!res.ok) { setMsg(`${json.code ?? ""} ${json.error ?? "保存失败"}${json.details ? "：" + JSON.stringify(json.details).slice(0, 200) : ""}`); return; }
      setData(json); setHeader(json.header); setTerms(json.terms); setLines(json.lines); setDraft(null); setMsg("客户报价已保存"); onChanged();
    } finally { setBusy(null); }
  };
  const generateDraft = async () => {
    setBusy("draft"); setMsg(null);
    try {
      const res = await apiFetch(`${base}/customer-quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", productLabel: header.projectName ?? null }) });
      const json = (await res.json()) as { draft?: { lines: Line[]; sellingPrice: number; note: string }; error?: string };
      if (!res.ok || !json.draft) { setMsg(json.error ?? "生成草稿失败"); return; }
      setDraft(json.draft);
    } finally { setBusy(null); }
  };
  const generatePdf = async () => {
    if (!window.confirm("生成客户报价 PDF？（服务端会先做内部字段泄露自检，命中即拒绝；旧 PDF 保留）")) return;
    setBusy("pdf"); setMsg(null);
    try {
      const res = await apiFetch(`${base}/pdf`, { method: "POST" });
      const json = (await res.json()) as { document?: { fileUrl: string | null; version: number }; error?: string; code?: string };
      setMsg(res.ok ? `PDF #${json.document?.version} 已生成` : `${json.code ?? ""} ${json.error ?? "生成失败"}`);
      await load();
    } finally { setBusy(null); }
  };
  const patchLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch, amount: undefined } : l)));
  const addLine = (section: string | null) => setLines((ls) => [...ls, { sortOrder: (ls.length + 1) * 10, section, item: "New item", description: null, quantity: 1, unit: "lot", unitPrice: null, optional: section === "Section B — Optional", allowance: section === "Section C — Allowances", taxable: true, notes: null }]);
  const sections = [...new Set(lines.map((l) => l.section ?? ""))];
  const canEdit = editable && !!data && !data.frozen;
  const listText = (a?: string[]) => (a ?? []).join("\n");
  const parseList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  if (!data) return <div className="rounded-xl border border-border bg-card-bg p-4 text-[11px] text-muted">加载客户报价…</div>;
  const pv = data.preview;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4" data-testid="customer-quote-builder">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Customer Quote · 客户报价（公开行 ≠ 内部成本）</h3>
        <div className="flex gap-2 text-[11px]">{canEdit ? <button type="button" disabled={busy !== null} onClick={() => void generateDraft()} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1"><Wand2 size={12} />由内部成本生成草稿</button> : null}{canEdit ? <button type="button" disabled={busy !== null} onClick={() => void save()} className="rounded border border-accent bg-accent/10 px-2 py-1 font-medium">保存客户报价</button> : null}<button type="button" disabled={busy !== null || lines.length === 0} onClick={() => void generatePdf()} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1"><FileText size={12} />生成客户报价 PDF</button></div></div>
      {data.frozen ? <p className="text-[11px] text-muted">报价已冻结（approved/superseded/awarded/cancelled）：客户行 / 抬头 / 条款不可改，修订请创建新版本；PDF 可继续生成。</p> : null}
      {draft ? (
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-[11px]" data-testid="customer-draft">
          <div className="flex items-center justify-between"><b>草稿建议（合计 {money(draft.sellingPrice, currency)}）— 必须人工确认</b><div className="flex gap-2"><button type="button" onClick={() => { setLines(draft.lines.map((l) => ({ ...l, amount: l.amount }))); setDraft(null); setMsg("草稿已填入客户行，请检查后保存"); }} className="rounded border border-accent px-2 py-1">采用草稿（替换客户行）</button><button type="button" onClick={() => setDraft(null)} className="rounded border border-border px-2 py-1">放弃</button></div></div>
          <p className="text-muted">{draft.note}</p>
          <ul className="mt-1 list-disc pl-4">{draft.lines.map((l, i) => <li key={i}>{l.section ? `[${l.section}] ` : ""}{l.item} — {money(amountOf(l), currency)}</li>)}</ul>
        </div>
      ) : null}
      <details open className="text-[11px]"><summary className="cursor-pointer font-medium">Quote header（客户 / 项目 / 编号）</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{HEADER_FIELDS.map((f) => <label key={f.key} className="text-muted">{f.label}<br /><input type={f.type ?? "text"} disabled={!canEdit} value={header[f.key] ?? ""} onChange={(e) => setHeader((h) => ({ ...h, [f.key]: e.target.value || null }))} className="mt-0.5 w-full rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>)}</div>
        {canEdit ? <button type="button" onClick={() => setHeader((h) => ({ ...data.defaults.header, preparedBy: data.defaults.terms.preparedBy ?? null, ...Object.fromEntries(Object.entries(h).filter(([, v]) => v)) }))} className="mt-2 rounded border border-border px-2 py-1">填入项目默认值（采购方 / 项目名 / 招标编号）</button> : null}
      </details>
      <details className="text-[11px]"><summary className="cursor-pointer font-medium">Terms &amp; Conditions（自由文本 + 组织模板）</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["paymentTerms", "delivery", "leadTime", "warranty", "validity", "notes"] as const).map((k) => <label key={k} className="text-muted">{k}<br /><textarea disabled={!canEdit} rows={2} value={(terms[k] as string | null | undefined) ?? ""} onChange={(e) => setTerms((t) => ({ ...t, [k]: e.target.value || null }))} className="mt-0.5 w-full rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>)}
          <label className="text-muted">exclusions（每行一条）<br /><textarea disabled={!canEdit} rows={3} value={listText(terms.exclusions)} onChange={(e) => setTerms((t) => ({ ...t, exclusions: parseList(e.target.value) }))} className="mt-0.5 w-full rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>
          <label className="text-muted">assumptions（每行一条）<br /><textarea disabled={!canEdit} rows={3} value={listText(terms.assumptions)} onChange={(e) => setTerms((t) => ({ ...t, assumptions: parseList(e.target.value) }))} className="mt-0.5 w-full rounded border border-border bg-transparent px-2 py-1 text-foreground" /></label>
        </div>
        {canEdit ? <button type="button" onClick={() => setTerms((t) => ({ ...data.defaults.terms, ...Object.fromEntries(Object.entries(t).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : !!v))) }))} className="mt-2 rounded border border-border px-2 py-1">套用组织默认条款</button> : null}
      </details>
      <div className="text-[11px]">
        <div className="flex items-center justify-between"><span className="font-medium">Customer lines（分组 / Optional / Allowance / Taxable）</span>{canEdit ? <div className="flex gap-1">{["Section A — Base Work", "Section B — Optional", "Section C — Allowances"].map((s) => <button key={s} type="button" onClick={() => addLine(s)} className="rounded border border-border px-2 py-0.5">+ {s.split(" — ")[1]}</button>)}</div> : null}</div>
        <table className="mt-1 w-full"><thead className="text-muted"><tr><th className="text-left">Section</th><th className="text-left">Item</th><th className="text-left">Description</th><th className="text-right">Qty</th><th>Unit</th><th className="text-right">Unit price</th><th className="text-right">Amount</th><th>Opt</th><th>Allow</th><th>Tax</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => <tr key={l.id ?? `n${i}`} className={`border-t border-border/30 ${l.optional ? "opacity-80" : ""}`}>
            <td><input disabled={!canEdit} value={l.section ?? ""} onChange={(e) => patchLine(i, { section: e.target.value || null })} className="w-32 rounded border border-border bg-transparent px-1 py-0.5 text-foreground" /></td>
            <td><input disabled={!canEdit} value={l.item} onChange={(e) => patchLine(i, { item: e.target.value })} className="w-40 rounded border border-border bg-transparent px-1 py-0.5 text-foreground" /></td>
            <td><input disabled={!canEdit} value={l.description ?? ""} onChange={(e) => patchLine(i, { description: e.target.value || null })} className="w-48 rounded border border-border bg-transparent px-1 py-0.5 text-foreground" /></td>
            <td className="text-right"><input disabled={!canEdit} type="number" value={l.quantity ?? ""} onChange={(e) => patchLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} className="w-14 rounded border border-border bg-transparent px-1 py-0.5 text-right text-foreground" /></td>
            <td><input disabled={!canEdit} value={l.unit ?? ""} onChange={(e) => patchLine(i, { unit: e.target.value || null })} className="w-12 rounded border border-border bg-transparent px-1 py-0.5 text-foreground" /></td>
            <td className="text-right"><input disabled={!canEdit} type="number" value={l.unitPrice ?? ""} onChange={(e) => patchLine(i, { unitPrice: e.target.value === "" ? null : Number(e.target.value) })} className="w-24 rounded border border-border bg-transparent px-1 py-0.5 text-right text-foreground" /></td>
            <td className="text-right font-mono">{money(amountOf(l), currency)}</td>
            <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={l.optional} onChange={(e) => patchLine(i, { optional: e.target.checked })} /></td>
            <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={l.allowance} onChange={(e) => patchLine(i, { allowance: e.target.checked })} /></td>
            <td className="text-center"><input type="checkbox" disabled={!canEdit} checked={l.taxable} onChange={(e) => patchLine(i, { taxable: e.target.checked })} /></td>
            <td>{canEdit ? <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-danger">×</button> : null}</td>
          </tr>)}</tbody></table>
        {lines.length === 0 ? <p className="mt-1 text-muted">尚无客户行：可「由内部成本生成草稿」或手动添加。无客户行时客户视图按卖价生成单行。</p> : null}
        {sections.length > 1 ? <p className="mt-1 text-[10px] text-muted">分组：{sections.map((s) => s || "（无）").join(" · ")}</p> : null}
      </div>
      {pv ? (
        <div className="rounded-lg border border-border/60 p-3 text-[11px]" data-testid="customer-preview-totals">
          <div className="flex flex-wrap gap-4"><span>Subtotal <b>{money(pv.subtotal, pv.currency)}</b></span><span>Taxable <b>{money(pv.taxableSubtotal, pv.currency)}</b></span>{pv.tax.hst ? <span>HST <b>{money(pv.tax.hst, pv.currency)}</b></span> : null}{pv.tax.gst ? <span>GST <b>{money(pv.tax.gst, pv.currency)}</b></span> : null}{pv.tax.pst ? <span>PST <b>{money(pv.tax.pst, pv.currency)}</b></span> : null}<span>Total <b>{money(pv.total, pv.currency)}</b></span>{pv.optionalTotal ? <span className="text-muted">Optional（不计入）{money(pv.optionalTotal, pv.currency)}</span> : null}{pv.allowanceTotal ? <span className="text-muted">Allowances {money(pv.allowanceTotal, pv.currency)}</span> : null}</div>
          <p className="mt-1 text-[10px] text-muted">抬头：{pv.company.name ?? "（组织报价抬头未配置：运营 → 投标档案）"} → {pv.header.clientCompany ?? "（客户未填）"} · {pv.header.revision} · 税按客户可见应税小计计算</p>
        </div>
      ) : data.leaks.length > 0 ? <p className="text-[11px] text-danger">客户视图泄露自检命中：{data.leaks.join(", ")}</p> : null}
      {pdfs.length > 0 ? <div className="text-[11px]"><span className="font-medium">客户 PDF（按报价版本绑定，旧版保留）：</span><ul className="mt-1 list-disc pl-4">{pdfs.map((p) => <li key={p.id}>{p.fileUrl ? <a href={p.fileUrl} target="_blank" rel="noreferrer" className="text-accent underline">{p.title}</a> : p.title} · Quote V{p.meta.quoteVersion} · {money(p.meta.total ?? null, p.meta.currency ?? currency)} · {new Date(p.createdAt).toLocaleString("zh-CN")}{p.stale ? "（已被新 PDF 取代）" : ""}</li>)}</ul></div> : null}
      {msg ? <p className="text-[11px] text-muted">{msg}</p> : null}
      {busy ? <p className="text-[11px] text-muted"><Loader2 size={12} className="inline animate-spin" /> 处理中…</p> : null}
    </div>
  );
}
