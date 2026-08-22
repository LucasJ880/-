/**
 * Customer Quote Builder（Quote Operations Phase 2）
 *  - 客户报价 ≠ 内部成本：客户行是明确公开的销售行（QuoteLineItem, isInternal=false），绝不自动暴露 QuoteCostLine。
 *  - 抬头 / 条款以快照存 ProjectQuote.customerJson / termsJson（不建第二套 CRM；默认值来自 Project + 分析事实）。
 *  - 「Generate Customer Quote Draft」= 确定性建议（成本分组 → 公开行，间接成本与利润按比例摊入），必须人工确认后才成为正式客户行；
 *    Commission / Profit / Supplier 永不成为客户行。
 *  - 内容冻结：approved/superseded/awarded/cancelled 报价的客户行/抬头/条款不可改（与成本行同一纪律）。
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import type { QuoteCalcResult } from "./calc";
import { FROZEN_STATUSES } from "./contract";
import { getQuote, QuoteEngineError, QUOTE_AUDIT_TARGET, type QuoteRecord } from "./service";
import type { TierResult } from "./standing-offer";

export const CUSTOMER_QUOTE_AUDIT_ACTIONS = {
  CUSTOMER_QUOTE_UPDATED: "customer_quote_updated",
  CUSTOMER_QUOTE_DRAFT_GENERATED: "customer_quote_draft_generated",
  CUSTOMER_QUOTE_PDF_GENERATED: "customer_quote_pdf_generated",
} as const;

const str = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim().slice(0, max) : v === null ? null : undefined), z.string().nullable().optional());
const num = () => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.number().finite().nullable());

export const customerHeaderSchema = z.object({
  clientName: str(120),
  clientCompany: str(160),
  clientAddress: str(400),
  contactName: str(120),
  contactEmail: str(160),
  contactPhone: str(60),
  projectName: str(200),
  projectNumber: str(80),
  tenderNumber: str(80),
  preparedBy: str(120),
  /** YYYY-MM-DD */
  quoteDate: str(10),
  /** YYYY-MM-DD → 同步写 ProjectQuote.validUntil */
  validUntil: str(10),
});
export type CustomerHeader = z.infer<typeof customerHeaderSchema>;

export const customerTermsSchema = z.object({
  paymentTerms: str(1000),
  delivery: str(600),
  leadTime: str(300),
  warranty: str(1000),
  validity: str(300),
  exclusions: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
  assumptions: z.array(z.string().trim().min(1).max(300)).max(40).optional(),
  notes: str(2000),
});
export type CustomerTerms = z.infer<typeof customerTermsSchema>;

export const customerLineSchema = z.object({
  id: z.string().optional(),
  sortOrder: z.number().int().default(0),
  section: str(80),
  item: z.string().trim().min(1).max(200),
  description: str(600),
  quantity: num(),
  unit: str(30),
  unitPrice: num(),
  /** 省略时 = quantity × unitPrice */
  amount: num().optional(),
  optional: z.boolean().default(false),
  allowance: z.boolean().default(false),
  taxable: z.boolean().default(true),
  notes: str(300),
  /** 内部溯源（成本类别 / 成本行 id），只存 sourceJson，绝不进客户视图 */
  source: z.object({ categories: z.array(z.string()).optional(), costLineIds: z.array(z.string()).optional(), generator: z.string().optional() }).nullable().optional(),
});
export type CustomerLinePayload = z.infer<typeof customerLineSchema>;

export const customerQuotePatchSchema = z.object({
  header: customerHeaderSchema.optional(),
  terms: customerTermsSchema.optional(),
  lines: z.array(customerLineSchema).max(200).optional(),
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineAmount(l: { quantity: number | null; unitPrice: number | null; amount?: number | null }): number {
  if (l.amount != null && Number.isFinite(l.amount)) return round2(l.amount);
  if (l.quantity != null && l.unitPrice != null) return round2(l.quantity * l.unitPrice);
  return 0;
}

/* ------------------------------ 草稿生成（确定性） ------------------------------ */

type DraftGroup = { key: string; section: string; item: string; description: string; categories: readonly string[] };

/** 公开分组：成本类别 → 客户可见行（佣金/利润/供应商/财务成本永不单列，按比例摊入可见行） */
const VISIBLE_GROUPS: DraftGroup[] = [
  { key: "supply", section: "Section A — Base Work", item: "Supply of products", description: "Supply of specified products, delivered to site", categories: ["PROCUREMENT", "MATERIAL", "LOGISTICS", "FREIGHT", "CUSTOMS", "DUTY", "WAREHOUSING"] },
  { key: "install", section: "Section A — Base Work", item: "Installation", description: "Installation, site labour and equipment", categories: ["LABOUR", "EQUIPMENT", "SITE_GENERAL"] },
  { key: "engineering", section: "Section A — Base Work", item: "Engineering, permits & inspections", description: "Shop drawings, permits, testing and inspections", categories: ["ENGINEERING", "PERMIT", "COMPLIANCE"] },
];
/** 这些类别绝不单独出现在客户行（摊入可见行） */
export const NEVER_CUSTOMER_VISIBLE_CATEGORIES: readonly string[] = ["PROJECT_MANAGEMENT", "INSURANCE", "BOND", "FINANCING", "ADMIN", "COMMISSION", "CONTINGENCY", "PROFIT", "OTHER"];

export type CustomerDraftLine = Omit<CustomerLinePayload, "id"> & { amount: number };

/**
 * 由内部计算结果生成客户报价草稿行：可见分组成本 + 按成本占比摊入的间接成本与毛利 = 卖价（精确到分，余数并入最大行）。
 * Standing Offer：按分级单价生成。草稿仅建议，必须人工确认。
 */
export function generateCustomerDraftLines(input: { calc: QuoteCalcResult; quoteType: string; tiers?: TierResult[] | null; productLabel?: string | null }): CustomerDraftLine[] {
  const { calc } = input;
  if (input.quoteType === "STANDING_OFFER" && input.tiers && input.tiers.length > 0) {
    return input.tiers.map((t, i) => ({
      sortOrder: (i + 1) * 10,
      section: "Unit pricing by annual volume tier",
      item: `${t.tierName} (${t.minQuantity.toLocaleString("en-CA")}–${t.maxQuantity == null ? "∞" : t.maxQuantity.toLocaleString("en-CA")} pcs)`,
      description: "Unit price per piece, delivered",
      quantity: t.expectedQuantity,
      unit: "pc",
      unitPrice: t.unitPrice,
      amount: round2(t.calculatedRevenue),
      optional: false,
      allowance: false,
      taxable: true,
      notes: null,
      source: { generator: "standing-offer-tiers", categories: [] },
    }));
  }
  const costOf = new Map(calc.breakdown.map((b) => [b.category, b.amount]));
  const groups = VISIBLE_GROUPS.map((g) => ({ g, cost: g.categories.reduce((s, c) => s + (costOf.get(c) ?? 0), 0) })).filter((x) => x.cost > 0);
  const visibleCost = groups.reduce((s, x) => s + x.cost, 0);
  const selling = round2(calc.sellingPrice);
  const product = input.productLabel?.trim() || "products";
  if (groups.length === 0 || visibleCost <= 0) {
    return [{ sortOrder: 10, section: "Section A — Base Work", item: `Supply & installation of ${product}`, description: null, quantity: 1, unit: "lot", unitPrice: selling, amount: selling, optional: false, allowance: false, taxable: true, notes: null, source: { generator: "single-line", categories: [...costOf.keys()] } }];
  }
  // 按可见成本占比分配卖价（间接成本 + 毛利自然摊入）
  let allocated = 0;
  const lines: CustomerDraftLine[] = groups.map((x, i) => {
    const amount = round2((selling * x.cost) / visibleCost);
    allocated = round2(allocated + amount);
    return {
      sortOrder: (i + 1) * 10,
      section: x.g.section,
      item: x.g.key === "supply" ? `Supply of ${product}` : x.g.item,
      description: x.g.description,
      quantity: 1,
      unit: "lot",
      unitPrice: amount,
      amount,
      optional: false,
      allowance: false,
      taxable: true,
      notes: null,
      source: { generator: "cost-groups-prorata", categories: [...x.g.categories] },
    };
  });
  const remainder = round2(selling - allocated);
  if (remainder !== 0) {
    const biggest = lines.reduce((a, b) => (b.amount > a.amount ? b : a));
    biggest.amount = round2(biggest.amount + remainder);
    biggest.unitPrice = biggest.amount;
  }
  lines.push({ sortOrder: (lines.length + 1) * 10, section: "Section A — Base Work", item: "Delivery", description: "Included in the above", quantity: 1, unit: "lot", unitPrice: 0, amount: 0, optional: false, allowance: false, taxable: true, notes: null, source: { generator: "included-note", categories: [] } });
  return lines;
}

/* ------------------------------ 默认抬头（来自项目，不建 CRM） ------------------------------ */

export async function resolveCustomerHeaderDefaults(projectId: string): Promise<Partial<CustomerHeader>> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { name: true, clientOrganization: true, solicitationNumber: true, code: true } });
  if (!p) return {};
  const run = await db.tenderAnalysisRun.findFirst({ where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } }, orderBy: { createdAt: "desc" }, select: { summaryJson: true } });
  const cf = (run?.summaryJson as { criticalFacts?: Record<string, { status?: string; text?: string | null }> } | null)?.criticalFacts ?? null;
  const tenderNo = cf?.tender_number?.status === "KNOWN" && cf.tender_number.text ? cf.tender_number.text.slice(0, 80) : p.solicitationNumber ?? null;
  return { clientCompany: p.clientOrganization ?? null, projectName: p.name, projectNumber: p.code ?? null, tenderNumber: tenderNo };
}

/* ------------------------------ 编辑（冻结纪律） ------------------------------ */

function assertEditable(q: { status: string }) {
  if ((FROZEN_STATUSES as readonly string[]).includes(q.status)) throw new QuoteEngineError("QUOTE_FROZEN", `状态 ${q.status} 的报价已冻结（含客户报价行/抬头/条款），请创建修订版本`, 409);
}

export function customerHeaderOf(q: { customerJson: Prisma.JsonValue | null }): CustomerHeader {
  const parsed = customerHeaderSchema.safeParse(q.customerJson ?? {});
  return parsed.success ? parsed.data : {};
}
export function customerTermsOf(q: { termsJson: Prisma.JsonValue | null }): CustomerTerms {
  const parsed = customerTermsSchema.safeParse(q.termsJson ?? {});
  return parsed.success ? parsed.data : {};
}

function compact<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export async function updateCustomerQuote(input: { quoteId: string; projectId: string; orgId: string; userId: string; patch: unknown }): Promise<QuoteRecord> {
  const q = await getQuote(input.quoteId, input.projectId);
  if (q.orgId !== input.orgId) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  assertEditable(q);
  const patch = customerQuotePatchSchema.parse(input.patch);
  await db.$transaction(async (tx) => {
    if (patch.header || patch.terms) {
      const header = patch.header ? { ...customerHeaderOf(q), ...compact(patch.header) } : undefined;
      const terms = patch.terms ? { ...customerTermsOf(q), ...compact(patch.terms) } : undefined;
      const validUntil = patch.header?.validUntil !== undefined ? (patch.header.validUntil ? new Date(patch.header.validUntil) : null) : undefined;
      await tx.projectQuote.update({
        where: { id: q.id },
        data: {
          ...(header ? { customerJson: JSON.parse(JSON.stringify(header)) as Prisma.InputJsonValue } : {}),
          ...(terms ? { termsJson: JSON.parse(JSON.stringify(terms)) as Prisma.InputJsonValue, paymentTerms: terms.paymentTerms ?? q.paymentTerms } : {}),
          ...(validUntil !== undefined && !(validUntil && Number.isNaN(validUntil.getTime())) ? { validUntil } : {}),
        },
      });
    }
    if (patch.lines) {
      const keep = new Set(patch.lines.filter((l) => l.id).map((l) => l.id!));
      // 只管理公开行（isInternal=false）；legacy 内部行不动
      await tx.quoteLineItem.deleteMany({ where: { quoteId: q.id, isInternal: false, id: { notIn: [...keep] } } });
      for (const l of patch.lines) {
        const amount = lineAmount(l);
        const data = {
          sortOrder: l.sortOrder,
          category: l.optional ? "optional" : l.allowance ? "allowance" : "product",
          itemName: l.item,
          specification: l.description ?? null,
          unit: l.unit ?? null,
          quantity: l.quantity == null ? null : new Prisma.Decimal(l.quantity.toFixed(2)),
          unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice.toFixed(2)),
          totalPrice: new Prisma.Decimal(amount.toFixed(2)),
          remarks: l.notes ?? null,
          isInternal: false,
          section: l.section ?? null,
          optional: l.optional,
          allowance: l.allowance,
          taxable: l.taxable,
          sourceJson: (l.source ?? undefined) as Prisma.InputJsonValue | undefined,
        };
        if (l.id && q.lineItems.some((x) => x.id === l.id && !x.isInternal)) await tx.quoteLineItem.update({ where: { id: l.id }, data });
        else await tx.quoteLineItem.create({ data: { ...data, quoteId: q.id } });
      }
    }
  });
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: CUSTOMER_QUOTE_AUDIT_ACTIONS.CUSTOMER_QUOTE_UPDATED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, afterData: { header: !!patch.header, terms: !!patch.terms, lines: patch.lines?.length ?? null, version: q.version } }).catch(() => undefined);
  return getQuote(q.id, input.projectId);
}
