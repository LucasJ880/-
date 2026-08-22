/**
 * Quote & Cost Engine · 服务层（DB）。
 *  - 聚合根 = 既有 ProjectQuote（扩展字段）；成本行 QuoteCostLine；分级 QuotePricingTier；
 *    客户侧卖价行复用既有 QuoteLineItem（同步生成，不泄露内部成本）。
 *  - 计算：运行时引擎为真相（computeQuote）；保存时写快照（line.calculatedCost / quote.summaryJson+calcVersion），
 *    读取时重算并标记漂移（hybrid）。禁 NaN/Infinity 入库（assertFiniteDeep）。
 *  - 版本：approved/superseded/awarded 内容冻结；修订 = 新 ProjectQuote 行（version+1, sourceQuoteId, revisionReason），
 *    旧版本 → superseded；绝不覆盖历史。
 *  - 审计：AuditLog（logAudit，QUOTE_* action）+ ProjectEvent（ledger producers 开启时 best-effort）。
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { assertFiniteDeep, computeQuote, type QuoteCalcFailure, type QuoteCalcResult } from "./calc";
import { computeTiers, computeUnitEconomics, validateStandingOffer, validateTiers, type TierResult, type UnitEconomics } from "./standing-offer";
import {
  costLineSchema,
  engineConfigSchema,
  FROZEN_STATUSES,
  QUOTE_ENGINE_CALC_VERSION,
  QUOTE_TRANSITIONS,
  QUOTE_TYPES,
  tierSchema,
  type CostLineInput,
  type CostLinePayload,
  type EngineConfig,
  type QuoteStatus,
  type QuoteValidationError,
  type TierInput,
  type TierPayload,
} from "./contract";
import { defaultEngineConfig, templateStandingOfferLines, templateSupplyInstallLines } from "./templates";

export const QUOTE_AUDIT_ACTIONS = {
  QUOTE_CREATED: "quote_created",
  QUOTE_UPDATED: "quote_updated",
  QUOTE_VERSION_CREATED: "quote_version_created",
  QUOTE_SUBMITTED_FOR_REVIEW: "quote_submitted_for_review",
  QUOTE_APPROVED: "quote_approved",
  QUOTE_SUPERSEDED: "quote_superseded",
  QUOTE_AWARDED: "quote_awarded",
  QUOTE_CANCELLED: "quote_cancelled",
  QUOTE_AWARD_BLOCKED: "quote_award_blocked",
  PROJECT_BUDGET_CREATED: "project_budget_created",
} as const;
export const QUOTE_AUDIT_TARGET = "project_quote";

export class QuoteEngineError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

const d = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const D = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toFixed(8)));

export type QuoteRecord = Prisma.ProjectQuoteGetPayload<{ include: { costLines: true; pricingTiers: true; lineItems: true } }>;

export function toLineInputs(rows: QuoteRecord["costLines"]): CostLineInput[] {
  return rows.map((r) => ({
    id: r.id,
    sortOrder: r.sortOrder,
    category: r.category,
    subcategory: r.subcategory,
    description: r.description,
    quantity: d(r.quantity),
    unit: r.unit,
    unitCost: d(r.unitCost),
    sourceCurrency: r.sourceCurrency,
    fxRate: d(r.fxRate),
    calculationType: r.calculationType,
    calculationBase: r.calculationBase,
    rate: d(r.rate),
    duration: d(r.duration),
    included: r.included,
    supplierName: r.supplierName,
    notes: r.notes,
  }));
}
export function toTierInputs(rows: QuoteRecord["pricingTiers"]): TierInput[] {
  return rows.map((t) => ({ id: t.id, sortOrder: t.sortOrder, tierName: t.tierName, minQuantity: Number(t.minQuantity), maxQuantity: d(t.maxQuantity), expectedQuantity: Number(t.expectedQuantity), pricingMethod: t.pricingMethod, rate: d(t.rate), active: t.active }));
}
export function engineOf(q: { engineJson: unknown; quoteType: string }): EngineConfig {
  const parsed = engineConfigSchema.safeParse(q.engineJson ?? {});
  return parsed.success ? { ...defaultEngineConfig(q.quoteType), ...parsed.data } : defaultEngineConfig(q.quoteType);
}

export type QuoteComputed = {
  calc: QuoteCalcResult | QuoteCalcFailure;
  standingOffer: { unit: UnitEconomics | null; tiers: TierResult[]; errors: QuoteValidationError[] } | null;
  drift: boolean;
};

/** 运行时重算（真相）；与快照比对 → drift */
export function computeForQuote(q: QuoteRecord): QuoteComputed {
  const engine = engineOf(q);
  const calc = computeQuote({ quoteCurrency: q.currency, lines: toLineInputs(q.costLines), pricing: { method: q.pricingMethod, rate: d(q.pricingRate) }, engine });
  let standingOffer: QuoteComputed["standingOffer"] = null;
  if (q.quoteType === "STANDING_OFFER") {
    const soErrors = validateStandingOffer(engine.standingOffer, q.currency);
    const tiers = toTierInputs(q.pricingTiers);
    const tierErrors = validateTiers(tiers);
    const errors = [...soErrors, ...tierErrors.filter((e) => e.code !== "TIER_GAP")];
    const warnings = tierErrors.filter((e) => e.code === "TIER_GAP");
    if (soErrors.length === 0 && engine.standingOffer) {
      const unit = computeUnitEconomics(engine.standingOffer, q.currency);
      const revPct = calc.ok ? calc.revenuePctTotal : 0;
      const profitPct = calc.ok ? toLineInputs(q.costLines).filter((l) => l.included && l.calculationType === "PERCENT_OF_REVENUE" && l.category === "PROFIT").reduce((s, l) => s + (l.rate ?? 0), 0) : 0;
      standingOffer = { unit, tiers: errors.length === 0 ? computeTiers({ tiers, unit, revenuePctTotal: revPct, revenueBasedProfitPct: profitPct, boxesPerContainer: engine.standingOffer.boxesPerContainer ?? 0, piecesPerBox: engine.standingOffer.piecesPerBox ?? 0 }) : [], errors: [...errors, ...warnings] };
    } else {
      standingOffer = { unit: null, tiers: [], errors: [...errors, ...warnings] };
    }
  }
  const snap = (q.summaryJson as { sellingPrice?: number; calcVersion?: string } | null) ?? null;
  const drift = !!snap && calc.ok && (snap.calcVersion !== QUOTE_ENGINE_CALC_VERSION || Math.abs((snap.sellingPrice ?? NaN) - calc.sellingPrice) > 0.005);
  return { calc, standingOffer, drift };
}

export async function getQuote(quoteId: string, projectId: string): Promise<QuoteRecord> {
  const q = await db.projectQuote.findFirst({ where: { id: quoteId, projectId }, include: { costLines: { orderBy: { sortOrder: "asc" } }, pricingTiers: { orderBy: { sortOrder: "asc" } }, lineItems: { orderBy: { sortOrder: "asc" } } } });
  if (!q) throw new QuoteEngineError("QUOTE_NOT_FOUND", "报价不存在", 404);
  return q;
}

function assertEditable(q: { status: string }) {
  if ((FROZEN_STATUSES as readonly string[]).includes(q.status)) throw new QuoteEngineError("QUOTE_FROZEN", `状态 ${q.status} 的报价内容已冻结，请创建修订版本`, 409);
}

async function nextQuoteNumber(orgId: string, projectId: string): Promise<string> {
  const count = await db.projectQuote.count({ where: { orgId, quoteNumber: { not: null } } });
  return `Q-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}-${projectId.slice(-4).toUpperCase()}`;
}

export async function createEngineQuote(input: { projectId: string; orgId: string; userId: string; quoteType: string; name?: string | null; currency?: string; seedTemplate?: boolean; demo?: "A" | "B" | null }): Promise<QuoteRecord> {
  if (!(QUOTE_TYPES as readonly string[]).includes(input.quoteType)) throw new QuoteEngineError("INVALID_QUOTE_TYPE", "无效报价类型");
  // 引擎报价版本按谱系（V1/V2/V3），新谱系恒 v1；legacy 报价（旧 POST 路由）仍按项目计数，不受影响
  const existing = 0;
  const engine = defaultEngineConfig(input.quoteType);
  let lines = input.seedTemplate === false ? [] : input.quoteType === "STANDING_OFFER" ? templateStandingOfferLines() : input.quoteType === "PROJECT_SUPPLY_INSTALL" ? templateSupplyInstallLines() : [];
  let pricing: { method: string; rate: number | null } = { method: "MARKUP_ON_COST", rate: null };
  let tiers: Omit<TierPayload, "id">[] = [];
  let engineFinal: EngineConfig = engine;
  if (input.demo) {
    const { demoStandingOffer, demoSupplyInstall } = await import("./templates");
    if (input.demo === "A") { const dA = demoSupplyInstall(); lines = dA.lines; pricing = dA.pricing; engineFinal = { ...engine, ...dA.engine }; }
    else { const dB = demoStandingOffer(); lines = dB.lines; pricing = dB.pricing; engineFinal = { ...engine, ...dB.engine }; tiers = dB.tiers; }
  }
  const q = await db.projectQuote.create({
    data: {
      projectId: input.projectId,
      orgId: input.orgId,
      templateType: input.quoteType.toLowerCase(),
      quoteType: input.quoteType,
      quoteNumber: await nextQuoteNumber(input.orgId, input.projectId),
      name: input.name ?? null,
      version: existing + 1,
      title: input.name ?? `${input.quoteType} v${existing + 1}`,
      currency: input.currency ?? "CAD",
      status: "draft",
      pricingMethod: pricing.method,
      pricingRate: D(pricing.rate),
      engineJson: engineFinal as Prisma.InputJsonValue,
      calcVersion: QUOTE_ENGINE_CALC_VERSION,
      createdById: input.userId,
      costLines: { create: lines.map((l) => ({ orgId: input.orgId, sortOrder: l.sortOrder, category: l.category, subcategory: l.subcategory ?? null, description: l.description, quantity: D(l.quantity), unit: l.unit ?? null, unitCost: D(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: D(l.fxRate), fxRateSource: l.fxRateSource ?? null, calculationType: l.calculationType, calculationBase: l.calculationBase ?? null, rate: D(l.rate), duration: D(l.duration), supplierName: l.supplierName ?? null, source: l.source ?? null, notes: l.notes ?? null, included: l.included })) },
      pricingTiers: { create: tiers.map((t) => ({ orgId: input.orgId, sortOrder: t.sortOrder, tierName: t.tierName, minQuantity: D(t.minQuantity)!, maxQuantity: D(t.maxQuantity ?? null), expectedQuantity: D(t.expectedQuantity)!, pricingMethod: t.pricingMethod, rate: D(t.rate), active: t.active })) },
    },
    include: { costLines: { orderBy: { sortOrder: "asc" } }, pricingTiers: { orderBy: { sortOrder: "asc" } }, lineItems: true },
  });
  await snapshotQuote(q.id, input.projectId);
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.QUOTE_CREATED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, afterData: { quoteType: input.quoteType, version: q.version, demo: input.demo ?? null } }).catch(() => undefined);
  return getQuote(q.id, input.projectId);
}

/** 更新头/成本行/分级（draft 或 review 可改；冻结态拒绝） */
export async function updateEngineQuote(input: {
  quoteId: string;
  projectId: string;
  userId: string;
  header?: { name?: string | null; quoteNumber?: string | null; currency?: string; pricingMethod?: string; pricingRate?: number | null; internalNotes?: string | null; engine?: EngineConfig };
  lines?: CostLinePayload[];
  tiers?: TierPayload[];
}): Promise<QuoteRecord> {
  const q = await getQuote(input.quoteId, input.projectId);
  assertEditable(q);
  const before = { sellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null };
  await db.$transaction(async (tx) => {
    if (input.header) {
      const h = input.header;
      await tx.projectQuote.update({
        where: { id: q.id },
        data: {
          ...(h.name !== undefined ? { name: h.name, title: h.name ?? q.title } : {}),
          ...(h.quoteNumber !== undefined ? { quoteNumber: h.quoteNumber } : {}),
          ...(h.currency ? { currency: h.currency } : {}),
          ...(h.pricingMethod ? { pricingMethod: h.pricingMethod } : {}),
          ...(h.pricingRate !== undefined ? { pricingRate: D(h.pricingRate) } : {}),
          ...(h.internalNotes !== undefined ? { internalNotes: h.internalNotes } : {}),
          ...(h.engine ? { engineJson: engineConfigSchema.parse({ ...engineOf(q), ...h.engine }) as Prisma.InputJsonValue } : {}),
        },
      });
    }
    if (input.lines) {
      const parsed = input.lines.map((l) => costLineSchema.parse(l));
      const keep = new Set(parsed.filter((l) => l.id).map((l) => l.id!));
      await tx.quoteCostLine.deleteMany({ where: { quoteId: q.id, id: { notIn: [...keep] } } });
      for (const l of parsed) {
        const data = { orgId: q.orgId, sortOrder: l.sortOrder, category: l.category, subcategory: l.subcategory ?? null, description: l.description, quantity: D(l.quantity), unit: l.unit ?? null, unitCost: D(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: D(l.fxRate), fxRateSource: l.fxRateSource ?? null, calculationType: l.calculationType, calculationBase: l.calculationBase ?? null, rate: D(l.rate), duration: D(l.duration), supplierId: l.supplierId ?? null, supplierName: l.supplierName ?? null, source: l.source ?? null, notes: l.notes ?? null, included: l.included };
        if (l.id && q.costLines.some((x) => x.id === l.id)) await tx.quoteCostLine.update({ where: { id: l.id }, data });
        else await tx.quoteCostLine.create({ data: { ...data, quoteId: q.id } });
      }
    }
    if (input.tiers) {
      const parsed = input.tiers.map((t) => tierSchema.parse(t));
      const keep = new Set(parsed.filter((t) => t.id).map((t) => t.id!));
      await tx.quotePricingTier.deleteMany({ where: { quoteId: q.id, id: { notIn: [...keep] } } });
      for (const t of parsed) {
        const data = { orgId: q.orgId, sortOrder: t.sortOrder, tierName: t.tierName, minQuantity: D(t.minQuantity)!, maxQuantity: D(t.maxQuantity ?? null), expectedQuantity: D(t.expectedQuantity)!, pricingMethod: t.pricingMethod, rate: D(t.rate), active: t.active };
        if (t.id && q.pricingTiers.some((x) => x.id === t.id)) await tx.quotePricingTier.update({ where: { id: t.id }, data });
        else await tx.quotePricingTier.create({ data: { ...data, quoteId: q.id } });
      }
    }
  });
  const after = await snapshotQuote(q.id, input.projectId);
  await logAudit({ userId: input.userId, orgId: q.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.QUOTE_UPDATED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, beforeData: before, afterData: { sellingPrice: after.calc.ok ? after.calc.sellingPrice : null, lines: input.lines?.length ?? null, tiers: input.tiers?.length ?? null } }).catch(() => undefined);
  return getQuote(q.id, input.projectId);
}

/** 写快照：line.calculatedCost / tier.calculated* / quote.summaryJson（禁 NaN/Infinity） */
export async function snapshotQuote(quoteId: string, projectId: string): Promise<QuoteComputed> {
  const q = await getQuote(quoteId, projectId);
  const computed = computeForQuote(q);
  if (computed.calc.ok) {
    const calc = computed.calc;
    const summary = { calcVersion: QUOTE_ENGINE_CALC_VERSION, computedAt: new Date().toISOString(), sellingPrice: calc.sellingPrice, estimatedCost: calc.estimatedCost, grossProfit: calc.grossProfit, grossMarginPct: calc.grossMarginPct, markupPct: calc.markupPct, cashRequired: calc.cashRequired, financingCost: calc.financingCost, contingency: calc.contingency, breakdown: calc.breakdown, scenarios: calc.scenarios, tax: calc.tax, warnings: calc.warnings, standingOffer: computed.standingOffer ? { unit: computed.standingOffer.unit, tiers: computed.standingOffer.tiers, errors: computed.standingOffer.errors } : null };
    assertFiniteDeep(summary);
    await db.$transaction([
      db.projectQuote.update({ where: { id: q.id }, data: { summaryJson: summary as Prisma.InputJsonValue, calcVersion: QUOTE_ENGINE_CALC_VERSION, internalCost: D(calc.estimatedCost), totalAmount: D(calc.sellingPrice), subtotal: D(calc.sellingPrice), profitMargin: D(Math.max(-999, Math.min(999, calc.grossMarginPct))) } }),
      ...calc.lines.map((l) => db.quoteCostLine.update({ where: { id: l.id }, data: { calculatedCost: D(l.amount) } })),
      ...(computed.standingOffer?.tiers ?? []).map((t) => db.quotePricingTier.update({ where: { id: t.id }, data: { unitPrice: D(t.unitPrice), calculatedRevenue: D(t.calculatedRevenue), calculatedCost: D(t.calculatedCost), calculatedMargin: D(t.calculatedMargin), containersMath: D(t.containersMath), containersProcurement: t.containersProcurement } })),
    ]);
  } else {
    await db.projectQuote.update({ where: { id: q.id }, data: { summaryJson: { calcVersion: QUOTE_ENGINE_CALC_VERSION, computedAt: new Date().toISOString(), errors: computed.calc.errors } as Prisma.InputJsonValue, calcVersion: QUOTE_ENGINE_CALC_VERSION } });
  }
  return computed;
}

/** 状态机：draft→review→approved→(superseded|awarded)；cancelled；不可覆盖历史 approved */
export async function transitionQuote(input: { quoteId: string; projectId: string; userId: string; orgId: string; to: QuoteStatus; note?: string | null }): Promise<QuoteRecord> {
  const q = await getQuote(input.quoteId, input.projectId);
  const from = q.status as QuoteStatus;
  const allowed = QUOTE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.to)) throw new QuoteEngineError("INVALID_TRANSITION", `不允许 ${from} → ${input.to}`, 409);
  if (input.to === "review" || input.to === "approved") {
    const computed = computeForQuote(q);
    if (!computed.calc.ok) throw new QuoteEngineError("QUOTE_INVALID", "报价存在校验错误，不能提交/批准", 409, computed.calc.errors);
    if (computed.standingOffer && computed.standingOffer.errors.some((e) => e.code !== "TIER_GAP")) throw new QuoteEngineError("QUOTE_INVALID", "Standing Offer 分级/单位经济存在错误", 409, computed.standingOffer.errors);
  }
  const now = new Date();
  const data: Prisma.ProjectQuoteUpdateInput = { status: input.to };
  if (input.to === "review") data.submittedAt = now;
  if (input.to === "approved") { data.approvedAt = now; data.approvedById = input.userId; }
  if (input.to === "superseded") data.supersededAt = now;
  if (input.to === "awarded") data.awardedAt = now;
  if (input.to === "cancelled") data.cancelledAt = now;
  await db.projectQuote.update({ where: { id: q.id }, data });
  const action = input.to === "review" ? QUOTE_AUDIT_ACTIONS.QUOTE_SUBMITTED_FOR_REVIEW : input.to === "approved" ? QUOTE_AUDIT_ACTIONS.QUOTE_APPROVED : input.to === "superseded" ? QUOTE_AUDIT_ACTIONS.QUOTE_SUPERSEDED : input.to === "awarded" ? QUOTE_AUDIT_ACTIONS.QUOTE_AWARDED : input.to === "cancelled" ? QUOTE_AUDIT_ACTIONS.QUOTE_CANCELLED : QUOTE_AUDIT_ACTIONS.QUOTE_UPDATED;
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, beforeData: { status: from }, afterData: { status: input.to, note: input.note ?? null, version: q.version } }).catch(() => undefined);
  await appendLedgerEvent({ orgId: input.orgId, projectId: input.projectId, userId: input.userId, quoteId: q.id, eventType: `QUOTE_${input.to.toUpperCase()}`, title: `报价 v${q.version} ${input.to}`, payload: { status: input.to, from, sellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null } });
  return getQuote(q.id, input.projectId);
}

/** 修订：复制为新版本（version+1, sourceQuoteId, revisionReason），旧版本若 approved → superseded */
export async function reviseQuote(input: { quoteId: string; projectId: string; userId: string; orgId: string; reason: string }): Promise<QuoteRecord> {
  const q = await getQuote(input.quoteId, input.projectId);
  if (!input.reason.trim()) throw new QuoteEngineError("REASON_REQUIRED", "修订原因必填");
  // B3：谱系版本号在事务内、对谱系根行 FOR UPDATE 加锁后计算——并发修订被 DB 串行化，
  // 第二个事务在锁释放后重算 max，保证单调递增不撞号（不依赖应用时序）
  const lineageRoot = await findLineageRoot(q.id, input.projectId);
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProjectQuote" WHERE "id" = ${lineageRoot} FOR UPDATE`;
    const lineageIds = await collectLineage(lineageRoot, input.projectId, tx);
    const maxVer = await tx.projectQuote.aggregate({ where: { id: { in: lineageIds } }, _max: { version: true } });
    const nq = await tx.projectQuote.create({
      data: {
        projectId: q.projectId, orgId: q.orgId, templateType: q.templateType, quoteType: q.quoteType, quoteNumber: q.quoteNumber, name: q.name, title: q.title, version: (maxVer._max.version ?? q.version) + 1, status: "draft",
        currency: q.currency, tradeTerms: q.tradeTerms, paymentTerms: q.paymentTerms, deliveryDays: q.deliveryDays, validUntil: q.validUntil, moq: q.moq, originCountry: q.originCountry,
        internalNotes: q.internalNotes, pricingMethod: q.pricingMethod, pricingRate: q.pricingRate, engineJson: (q.engineJson ?? undefined) as Prisma.InputJsonValue | undefined,
        sourceQuoteId: q.id, revisionReason: input.reason.slice(0, 2000), calcVersion: QUOTE_ENGINE_CALC_VERSION, createdById: input.userId,
        costLines: { create: q.costLines.map((l) => ({ orgId: l.orgId, sortOrder: l.sortOrder, category: l.category, subcategory: l.subcategory, description: l.description, quantity: l.quantity, unit: l.unit, unitCost: l.unitCost, sourceCurrency: l.sourceCurrency, fxRate: l.fxRate, fxRateSource: l.fxRateSource, fxRateDate: l.fxRateDate, calculationType: l.calculationType, calculationBase: l.calculationBase, rate: l.rate, duration: l.duration, supplierId: l.supplierId, supplierName: l.supplierName, source: l.source, notes: l.notes, included: l.included, metadata: (l.metadata ?? undefined) as Prisma.InputJsonValue | undefined })) },
        pricingTiers: { create: q.pricingTiers.map((t) => ({ orgId: t.orgId, sortOrder: t.sortOrder, tierName: t.tierName, minQuantity: t.minQuantity, maxQuantity: t.maxQuantity, expectedQuantity: t.expectedQuantity, pricingMethod: t.pricingMethod, rate: t.rate, active: t.active })) },
        lineItems: { create: q.lineItems.map((i) => ({ sortOrder: i.sortOrder, category: i.category, itemName: i.itemName, specification: i.specification, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice, totalPrice: i.totalPrice, remarks: i.remarks, costPrice: i.costPrice, isInternal: i.isInternal })) },
      },
      select: { id: true, version: true },
    });
    if (q.status === "approved") await tx.projectQuote.update({ where: { id: q.id }, data: { status: "superseded", supersededAt: new Date() } });
    return nq;
  });
  await snapshotQuote(created.id, input.projectId);
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.QUOTE_VERSION_CREATED, targetType: QUOTE_AUDIT_TARGET, targetId: created.id, beforeData: { sourceQuoteId: q.id, sourceVersion: q.version, sourceSellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null, sourceCost: (q.summaryJson as { estimatedCost?: number } | null)?.estimatedCost ?? null, sourceMargin: (q.summaryJson as { grossMarginPct?: number } | null)?.grossMarginPct ?? null }, afterData: { version: created.version, reason: input.reason } }).catch(() => undefined);
  if (q.status === "approved") await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.QUOTE_SUPERSEDED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, afterData: { supersededBy: created.id } }).catch(() => undefined);
  return getQuote(created.id, input.projectId);
}

/** Award → Project Budget：approved/awarded 报价的成本分解映射为 ProjectBudgetVersion（复用 T2-P1.5；flag dark 时只返回映射预览） */
export const COST_TO_BUDGET_CATEGORY: Record<string, string> = {
  MATERIAL: "MATERIAL", PROCUREMENT: "MATERIAL", LOGISTICS: "FREIGHT", FREIGHT: "FREIGHT", CUSTOMS: "DUTY", DUTY: "DUTY", WAREHOUSING: "FREIGHT",
  LABOUR: "LABOUR", EQUIPMENT: "EQUIPMENT", SITE_GENERAL: "EQUIPMENT", ENGINEERING: "OVERHEAD", PERMIT: "OVERHEAD", COMPLIANCE: "OVERHEAD", PROJECT_MANAGEMENT: "OVERHEAD", INSURANCE: "OVERHEAD", BOND: "OVERHEAD", FINANCING: "OVERHEAD", ADMIN: "OVERHEAD", COMMISSION: "OVERHEAD",
  CONTINGENCY: "CONTINGENCY", PROFIT: "PROFIT", OTHER: "OTHER",
};

export function mapQuoteToBudgetLines(calc: QuoteCalcResult, quoteId: string): Array<{ category: string; amount: number; basis: string | null; basisAmount: number | null; percentage: number | null; note: string; sourceReference: string; sortOrder: number }> {
  const agg = new Map<string, number>();
  for (const b of calc.breakdown) {
    const cat = COST_TO_BUDGET_CATEGORY[b.category] ?? "OTHER";
    agg.set(cat, (agg.get(cat) ?? 0) + b.amount);
  }
  let i = 0;
  return [...agg.entries()].map(([category, amount]) => {
    const pct = ["OVERHEAD", "CONTINGENCY", "PROFIT"].includes(category);
    return { category, amount: Math.round(amount * 100) / 100, basis: pct ? "SELLING_PRICE" : null, basisAmount: pct ? calc.sellingPrice : null, percentage: pct && calc.sellingPrice > 0 ? Math.round((amount / calc.sellingPrice) * 10000) / 100 : null, note: `来自报价引擎（${quoteId}）`, sourceReference: `quote:${quoteId}`, sortOrder: (i += 10) };
  });
}

export type AwardMode = "with_budget" | "without_budget";

/**
 * Award（B2 fail-closed）：
 *  - with_budget（默认）：预算版本创建与 quote→awarded **同一事务**；财务模块未启用或创建失败 →
 *    抛 QuoteEngineError（AWARD_BLOCKED / BUDGET_CREATION_FAILED），quote 保持 approved，
 *    不产生 QUOTE_AWARDED / PROJECT_BUDGET_CREATED，但写 quote_award_blocked 审计留证。
 *  - without_budget：显式「不建项目预算直接 award」语义（独立路径，不与 with_budget 混用）。
 */
export async function awardQuoteToBudget(input: { quoteId: string; projectId: string; userId: string; orgId: string; mode?: AwardMode; deps?: { createBudgetVersion?: (args: never) => Promise<unknown> } }): Promise<{ quote: QuoteRecord; mode: AwardMode; budgetLines: ReturnType<typeof mapQuoteToBudgetLines>; budgetVersionId: string | null; budgetCreated: boolean }> {
  const mode: AwardMode = input.mode ?? "with_budget";
  const q = await getQuote(input.quoteId, input.projectId);
  if (q.status !== "approved") throw new QuoteEngineError("NOT_APPROVED", "只有 approved 报价可以 award", 409);
  const computed = computeForQuote(q);
  if (!computed.calc.ok) throw new QuoteEngineError("QUOTE_INVALID", "报价校验失败", 409, computed.calc.errors);
  const budgetLines = mapQuoteToBudgetLines(computed.calc, q.id);
  const blocked = async (code: string, message: string, details?: unknown) => {
    await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.QUOTE_AWARD_BLOCKED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, afterData: { mode, code, message, details: details ?? null, version: q.version } }).catch(() => undefined);
    return new QuoteEngineError(code, message, 409, details);
  };
  if (mode === "without_budget") {
    await transitionQuote({ quoteId: q.id, projectId: input.projectId, userId: input.userId, orgId: input.orgId, to: "awarded", note: "awarded without project budget (explicit)" });
    return { quote: await getQuote(q.id, input.projectId), mode, budgetLines, budgetVersionId: null, budgetCreated: false };
  }
  const { isFinancialControlEnabled } = await import("@/lib/project-finance/flags");
  if (!isFinancialControlEnabled()) {
    throw await blocked("AWARD_BLOCKED", "BUDGET_NOT_CREATED：TENDER_FINANCIAL_CONTROL_ENABLED 未开启，无法建立项目预算；报价保持 approved（如需不建预算直接 award，请显式使用 without_budget）");
  }
  const createBudget = (input.deps?.createBudgetVersion as unknown as typeof import("@/lib/project-finance/budget-service").createBudgetVersion | undefined) ?? (await import("@/lib/project-finance/budget-service")).createBudgetVersion;
  let budgetVersionId: string | null = null;
  try {
    budgetVersionId = await db.$transaction(async (tx) => {
      const v = await createBudget({ tx, orgId: input.orgId, projectId: input.projectId, currency: q.currency, actor: { actorType: "user", actorId: input.userId }, createdById: input.userId, note: `Quote ${q.quoteNumber ?? q.id} v${q.version} award`, lines: budgetLines.map((l) => ({ category: l.category, amount: l.amount, percentage: l.percentage, basis: l.basis, basisAmount: l.basisAmount, note: l.note, sourceReference: l.sourceReference, sortOrder: l.sortOrder })) as never });
      const id = (v as { id?: string; version?: { id?: string } }).id ?? (v as { version?: { id?: string } }).version?.id ?? null;
      if (!id) throw new Error("createBudgetVersion 未返回版本 id");
      // 同一事务：仅当状态仍为 approved 才能 award（防并发双 award）
      const r = await tx.projectQuote.updateMany({ where: { id: q.id, status: "approved" }, data: { status: "awarded", awardedAt: new Date() } });
      if (r.count !== 1) throw new Error("报价状态已变化，award 中止");
      return id;
    });
  } catch (e) {
    throw await blocked("BUDGET_CREATION_FAILED", `预算创建失败，award 已回滚：${e instanceof Error ? e.message : String(e)}`);
  }
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.PROJECT_BUDGET_CREATED, targetType: "project_budget_version", targetId: budgetVersionId, afterData: { quoteId: q.id, lines: budgetLines.length } }).catch(() => undefined);
  await logAudit({ userId: input.userId, orgId: input.orgId, projectId: input.projectId, action: QUOTE_AUDIT_ACTIONS.QUOTE_AWARDED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, beforeData: { status: "approved" }, afterData: { status: "awarded", budgetVersionId, version: q.version } }).catch(() => undefined);
  await appendLedgerEvent({ orgId: input.orgId, projectId: input.projectId, userId: input.userId, quoteId: q.id, eventType: "QUOTE_AWARDED", title: `报价 v${q.version} awarded`, payload: { budgetVersionId } });
  return { quote: await getQuote(q.id, input.projectId), mode, budgetLines, budgetVersionId, budgetCreated: true };
}

async function appendLedgerEvent(input: { orgId: string; projectId: string; userId: string; quoteId: string; eventType: string; title: string; payload: unknown }) {
  try {
    const { isLedgerProducerActive } = await import("@/lib/project-ledger/flags");
    if (!isLedgerProducerActive()) return;
    const { appendProjectEvent } = await import("@/lib/project-ledger/event-service");
    await appendProjectEvent({ orgId: input.orgId, projectId: input.projectId, eventKey: `quote:${input.quoteId}:${input.eventType}:${Date.now()}`, occurredAt: new Date(), actor: { actorType: "user", actorId: input.userId }, eventType: input.eventType, stage: "quote", title: input.title, payload: input.payload as never, refs: { quoteId: input.quoteId } as never } as never);
  } catch {
    // ledger best-effort
  }
}

async function findLineageRoot(quoteId: string, projectId: string): Promise<string> {
  let cur = quoteId;
  for (let i = 0; i < 100; i++) {
    const row = await db.projectQuote.findFirst({ where: { id: cur, projectId }, select: { sourceQuoteId: true } });
    if (!row?.sourceQuoteId) return cur;
    cur = row.sourceQuoteId;
  }
  return cur;
}
async function collectLineage(rootId: string, projectId: string, client: Prisma.TransactionClient | typeof db = db): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  for (let i = 0; i < 100 && frontier.length > 0; i++) {
    const rows = await client.projectQuote.findMany({ where: { projectId, sourceQuoteId: { in: frontier } }, select: { id: true } });
    frontier = rows.map((r) => r.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}
