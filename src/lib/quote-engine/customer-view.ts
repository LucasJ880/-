/**
 * Customer Quote View · 客户侧投影（只含批准公开字段）。
 * 内部字段（供应商成本/采购价/佣金/利润/内部备注/毛利/供应商名/导入原始数据/置信度/来源文件）绝不进入本投影——
 * 探针用白名单键集做反例守卫；PDF 渲染前必须再跑 customerViewLeaks（命中即拒绝生成）。
 *
 * Phase 2 扩展：分组（section）/ Optional / Allowance / Taxable / 抬头 / 条款 / 我方公司信息。
 * 税基（B5）：税按「客户可见 · 非 optional · taxable」行小计重算，不复用引擎售价口径的税额。
 */

import { computeTax, type QuoteCalcResult } from "./calc";
import type { TaxConfig } from "./contract";
import type { TierResult } from "./standing-offer";

export type CustomerLine = { section: string | null; item: string; description: string | null; quantity: number | null; unit: string | null; unitPrice: number | null; amount: number; optional: boolean; allowance: boolean; taxable: boolean; notes: string | null };
export type CustomerHeaderView = { clientName: string | null; clientCompany: string | null; clientAddress: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; projectName: string | null; projectNumber: string | null; tenderNumber: string | null; preparedBy: string | null; quoteDate: string | null; revision: string };
export type CustomerTermsView = { paymentTerms: string | null; delivery: string | null; leadTime: string | null; warranty: string | null; validity: string | null; exclusions: string[]; assumptions: string[]; notes: string | null };
export type CompanyIdentityView = { name: string | null; addressLines: string[]; phone: string | null; email: string | null; website: string | null; taxNumber: string | null };
export type CustomerQuoteView = {
  quoteNumber: string | null;
  title: string;
  currency: string;
  version: number;
  status: string;
  validUntil: string | null;
  header: CustomerHeaderView;
  company: CompanyIdentityView;
  sections: string[];
  lines: CustomerLine[];
  subtotal: number;
  taxableSubtotal: number;
  optionalTotal: number;
  allowanceTotal: number;
  tax: { gst: number; hst: number; pst: number };
  total: number;
  terms: CustomerTermsView;
};

export const CUSTOMER_VIEW_ALLOWED_KEYS = new Set(["quoteNumber", "title", "currency", "version", "status", "validUntil", "header", "company", "sections", "lines", "subtotal", "taxableSubtotal", "optionalTotal", "allowanceTotal", "tax", "total", "terms"]);
export const CUSTOMER_LINE_ALLOWED_KEYS = new Set(["section", "item", "description", "quantity", "unit", "unitPrice", "amount", "optional", "allowance", "taxable", "notes"]);
export const CUSTOMER_HEADER_ALLOWED_KEYS = new Set(["clientName", "clientCompany", "clientAddress", "contactName", "contactEmail", "contactPhone", "projectName", "projectNumber", "tenderNumber", "preparedBy", "quoteDate", "revision"]);
export const CUSTOMER_TERMS_ALLOWED_KEYS = new Set(["paymentTerms", "delivery", "leadTime", "warranty", "validity", "exclusions", "assumptions", "notes"]);
export const COMPANY_ALLOWED_KEYS = new Set(["name", "addressLines", "phone", "email", "website", "taxNumber"]);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : []);

export type CustomerViewQuoteInput = {
  quoteNumber: string | null;
  title: string | null;
  name: string | null;
  currency: string;
  version: number;
  status: string;
  validUntil: Date | null;
  quoteType: string;
  customerJson?: unknown;
  termsJson?: unknown;
  lineItems: Array<{ itemName: string; specification: string | null; unit: string | null; quantity: unknown; unitPrice: unknown; totalPrice: unknown; isInternal: boolean; category: string; section?: string | null; optional?: boolean; allowance?: boolean; taxable?: boolean; remarks?: string | null; sortOrder?: number }>;
};

export function buildCustomerView(input: {
  quote: CustomerViewQuoteInput;
  calc: QuoteCalcResult | null;
  tiers?: TierResult[] | null;
  /** 报价税配置（B5：税必须按客户可见应税小计重算，不复用引擎售价口径的税额） */
  tax?: TaxConfig | null;
  /** 我方公司信息（组织投标档案 quoteHeader）；缺省全空 */
  company?: Partial<CompanyIdentityView> | null;
}): CustomerQuoteView {
  const q = input.quote;
  const num = (v: unknown) => (v == null ? null : Number(v));
  const h = (q.customerJson && typeof q.customerJson === "object" ? (q.customerJson as Record<string, unknown>) : {}) as Record<string, unknown>;
  const t = (q.termsJson && typeof q.termsJson === "object" ? (q.termsJson as Record<string, unknown>) : {}) as Record<string, unknown>;
  let lines: CustomerLine[] = [...q.lineItems]
    .filter((i) => !i.isInternal)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((i) => ({
      section: i.section ?? null,
      item: i.itemName,
      description: i.specification ?? null,
      quantity: num(i.quantity),
      unit: i.unit ?? null,
      unitPrice: num(i.unitPrice),
      amount: num(i.totalPrice) ?? 0,
      optional: i.optional === true || i.category === "optional",
      allowance: i.allowance === true || i.category === "allowance",
      taxable: i.taxable !== false,
      notes: i.remarks ?? null,
    }));
  // 引擎报价且无人工卖价行：用定价结果生成汇总行（Supply+Install 单行；Standing Offer 按分级单价）
  if (lines.length === 0 && input.calc) {
    if (q.quoteType === "STANDING_OFFER" && input.tiers && input.tiers.length > 0) {
      lines = input.tiers.map((tr) => ({ section: null, item: `${tr.tierName}（${tr.minQuantity.toLocaleString()}–${tr.maxQuantity == null ? "∞" : tr.maxQuantity.toLocaleString()} pcs）`, description: "Unit price per piece", quantity: tr.expectedQuantity, unit: "pc", unitPrice: tr.unitPrice, amount: tr.calculatedRevenue, optional: false, allowance: false, taxable: true, notes: null }));
    } else {
      lines = [{ section: null, item: q.name ?? q.title ?? "Supply & Install", description: null, quantity: 1, unit: "lot", unitPrice: input.calc.sellingPrice, amount: input.calc.sellingPrice, optional: false, allowance: false, taxable: true, notes: null }];
    }
  }
  const included = lines.filter((l) => !l.optional);
  const subtotal = round2(included.reduce((sum, l) => sum + l.amount, 0));
  const taxableSubtotal = round2(included.filter((l) => l.taxable).reduce((sum, l) => sum + l.amount, 0));
  const optionalTotal = round2(lines.filter((l) => l.optional).reduce((sum, l) => sum + l.amount, 0));
  const allowanceTotal = round2(included.filter((l) => l.allowance).reduce((sum, l) => sum + l.amount, 0));
  const tx = computeTax(taxableSubtotal, input.tax ?? null);
  const tax = { gst: tx.gst, hst: tx.hst, pst: tx.pst };
  const total = round2(subtotal + tx.gst + tx.hst + tx.pst);
  const sections = [...new Set(lines.map((l) => l.section).filter((x): x is string => !!x))];
  const header: CustomerHeaderView = {
    clientName: s(h.clientName), clientCompany: s(h.clientCompany), clientAddress: s(h.clientAddress), contactName: s(h.contactName), contactEmail: s(h.contactEmail), contactPhone: s(h.contactPhone),
    projectName: s(h.projectName), projectNumber: s(h.projectNumber), tenderNumber: s(h.tenderNumber), preparedBy: s(h.preparedBy), quoteDate: s(h.quoteDate), revision: `V${q.version}`,
  };
  const terms: CustomerTermsView = { paymentTerms: s(t.paymentTerms), delivery: s(t.delivery), leadTime: s(t.leadTime), warranty: s(t.warranty), validity: s(t.validity), exclusions: arr(t.exclusions), assumptions: arr(t.assumptions), notes: s(t.notes) };
  const c = input.company ?? {};
  const company: CompanyIdentityView = { name: s(c.name), addressLines: arr(c.addressLines), phone: s(c.phone), email: s(c.email), website: s(c.website), taxNumber: s(c.taxNumber) };
  return { quoteNumber: q.quoteNumber, title: q.name ?? q.title ?? "Quotation", currency: q.currency, version: q.version, status: q.status, validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null, header, company, sections, lines, subtotal, taxableSubtotal, optionalTotal, allowanceTotal, tax, total, terms };
}

/** 反例守卫用：投影对象不得含任何内部键（键名级） */
export const INTERNAL_KEY_PATTERN = /cost|supplier|margin|markup|commission|profit|internal|sourcing|fx|duty|freight|landed|scenario|breakdown|confidence|import|evidence|provenance|rawAmount|vendor/i;
export function customerViewLeaks(view: unknown): string[] {
  const leaks: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (INTERNAL_KEY_PATTERN.test(k)) leaks.push(`${path}.${k}`);
      walk(v, `${path}.${k}`);
    }
  };
  walk(view, "$");
  return leaks;
}

/** 结构白名单（键集级）：顶层 / 行 / 抬头 / 条款 / 公司 —— 多出任何键即视为泄露 */
export function customerViewUnexpectedKeys(view: CustomerQuoteView): string[] {
  const out: string[] = [];
  for (const k of Object.keys(view)) if (!CUSTOMER_VIEW_ALLOWED_KEYS.has(k)) out.push(`$.${k}`);
  view.lines.forEach((l, i) => { for (const k of Object.keys(l)) if (!CUSTOMER_LINE_ALLOWED_KEYS.has(k)) out.push(`$.lines[${i}].${k}`); });
  for (const k of Object.keys(view.header)) if (!CUSTOMER_HEADER_ALLOWED_KEYS.has(k)) out.push(`$.header.${k}`);
  for (const k of Object.keys(view.terms)) if (!CUSTOMER_TERMS_ALLOWED_KEYS.has(k)) out.push(`$.terms.${k}`);
  for (const k of Object.keys(view.company)) if (!COMPANY_ALLOWED_KEYS.has(k)) out.push(`$.company.${k}`);
  return out;
}
