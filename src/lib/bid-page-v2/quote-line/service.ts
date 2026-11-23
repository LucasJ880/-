/**
 * BIDPAGE-3 逐行报价 — 服务（读写库；只由 `/api/projects/[id]/bid-page/quotes/**` 调用，调用方已过报价权限守卫与金额门）
 *
 * - 金额、成本、供应商报价只从这里出，接口只给「报价内部成本权限 ∧ 财务查看权」的人（design D7）。
 * - 写只动由逐行表管理的成本行（`mapping.ts`），不写 `QuoteLineItem`、不写投标工作区、不写浏览器。
 * - 四个数与每行的数都来自 `computeForQuote`（报价引擎一套算法），分摊见 `allocation.ts`。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { round2 } from "@/lib/quote-engine/calc";
import { FROZEN_STATUSES, engineConfigSchema } from "@/lib/quote-engine/contract";
import {
  QUOTE_AUDIT_ACTIONS,
  QUOTE_AUDIT_TARGET,
  QuoteEngineError,
  computeForQuote,
  createEngineQuote,
  getQuote,
  nextQuoteNumber,
  snapshotQuote,
  type QuoteRecord,
} from "@/lib/quote-engine/service";
import { QUOTE_ENGINE_CALC_VERSION } from "@/lib/quote-engine/contract";
import { defaultEngineConfig } from "@/lib/quote-engine/templates";
import { resolveTenderBid } from "@/lib/quote-engine/tender-bid";
import { loadWorkspace } from "@/lib/tender-bid-workspace/store";
import { loadSchedulePrefill } from "@/lib/tender-bid-workspace/schedule-prefill-service";
import { validatePriceSchedule, type PriceScheduleLine } from "@/lib/tender-price-schedule/contract";
import { exportOfficialPriceSchedule } from "@/lib/tender-price-schedule/official-export";
import { allocateFromEngine, exportUnitPrices } from "./allocation";
import {
  BUSINESS_TYPE_TO_QUOTE_TYPE,
  engineErrorZh,
  engineWarningZh,
  proModeHrefOf,
  validateLineModeState,
  type BusinessType,
  type ExportAvailability,
  type InquiryQuoteOption,
  type LineModeState,
  type LineModeView,
  type QuoteListView,
  type SaveLineModeRequest,
} from "./contract";
import { costLinesToState, defaultLineModeState, seedRowsFromSchedule, stateToWrites, type CostLineWrite } from "./mapping";

export type LineCaps = { canEdit: boolean; canApprove: boolean };

const D = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toFixed(8)));

export function isLineModeQuote(q: { engineJson: unknown }): boolean {
  const parsed = engineConfigSchema.safeParse(q.engineJson ?? {});
  return parsed.success && parsed.data.entryMode === "LINE";
}

/** 投标工作区里存下、且校验通过的价格表（不看投标工作区开关，只读它存下的块） */
export async function usableSchedule(projectId: string): Promise<PriceScheduleLine[] | null> {
  const stored = await loadWorkspace(projectId);
  const lines = (stored?.priceSchedule?.lines ?? []) as PriceScheduleLine[];
  if (lines.length === 0) return null;
  return validatePriceSchedule(lines).valid ? lines : null;
}

function writeData(orgId: string | null, w: CostLineWrite) {
  return {
    orgId,
    sortOrder: w.sortOrder,
    category: w.category,
    subcategory: w.subcategory,
    description: w.description,
    quantity: D(w.quantity),
    unit: w.unit,
    unitCost: D(w.unitCost),
    sourceCurrency: w.sourceCurrency,
    fxRate: D(w.fxRate),
    fxRateSource: w.fxRateSource,
    calculationType: w.calculationType,
    calculationBase: w.calculationBase,
    rate: D(w.rate),
    duration: D(w.duration),
    supplierId: w.supplierId,
    supplierName: w.supplierName,
    source: w.source,
    included: w.included,
    metadata: w.metadata as Prisma.InputJsonValue,
  };
}

/* ---------------------------------- 列表 ---------------------------------- */

async function ourBidQuoteId(projectId: string, orgId: string): Promise<{ id: string | null; status: string }> {
  const bid = await resolveTenderBid({ projectId, orgId, internal: true });
  return { id: bid.status === "AUTHORITATIVE" ? bid.quote?.id ?? null : null, status: bid.status };
}

export async function exportAvailability(projectId: string, orgId: string): Promise<ExportAvailability> {
  const bid = await ourBidQuoteId(projectId, orgId);
  if (!bid.id) return { available: false, reasonZh: "报价定为我方报价后才能导出" };
  const q = await db.projectQuote.findFirst({ where: { id: bid.id, projectId }, select: { id: true, version: true, engineJson: true } });
  if (!q || !isLineModeQuote(q)) return { available: false, reasonZh: "我方报价不是逐行报价做的，不能按价格表导出" };
  return { available: true, quoteId: q.id, version: q.version };
}

export async function listLineQuotes(input: { projectId: string; orgId: string; caps: LineCaps }): Promise<QuoteListView> {
  const [rows, bid, schedule] = await Promise.all([
    db.projectQuote.findMany({
      where: { projectId: input.projectId, quoteType: { not: "CUSTOM" } },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, name: true, title: true, quoteNumber: true, version: true, status: true, quoteType: true, engineJson: true, summaryJson: true, updatedAt: true },
    }),
    ourBidQuoteId(input.projectId, input.orgId),
    usableSchedule(input.projectId),
  ]);
  const quotes = rows.map((q) => {
    const sp = (q.summaryJson as { sellingPrice?: unknown } | null)?.sellingPrice;
    return {
      id: q.id,
      name: q.name ?? q.title ?? null,
      quoteNumber: q.quoteNumber,
      version: q.version,
      status: q.status,
      quoteType: q.quoteType,
      entryMode: isLineModeQuote(q) ? ("LINE" as const) : null,
      sellingPrice: typeof sp === "number" && Number.isFinite(sp) ? sp : null,
      updatedAt: q.updatedAt.toISOString(),
      isOurBid: bid.id === q.id,
      proModeHref: proModeHrefOf(input.projectId, q.id),
    };
  });
  return { capabilities: input.caps, quotes, scheduleLineCount: schedule?.length ?? 0, export: await exportAvailability(input.projectId, input.orgId) };
}

/* ---------------------------------- 新建 ---------------------------------- */

export async function createLineQuote(input: { projectId: string; orgId: string; userId: string; businessType: BusinessType; name?: string | null }): Promise<{ id: string; entryMode: "LINE" | null; proModeHref: string }> {
  if (input.businessType !== "SUPPLY_ONLY") {
    // 供货加安装 / 长期供货协议：照改版前的模板建好，从专业模式打开
    const q = await createEngineQuote({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, quoteType: BUSINESS_TYPE_TO_QUOTE_TYPE[input.businessType], name: input.name ?? null });
    return { id: q.id, entryMode: null, proModeHref: proModeHrefOf(input.projectId, q.id) };
  }
  const schedule = await usableSchedule(input.projectId);
  const state = defaultLineModeState(schedule ? seedRowsFromSchedule(schedule) : []);
  const writes = stateToWrites(state, []);
  const engine = engineConfigSchema.parse({ ...defaultEngineConfig("SUPPLY_ONLY"), entryMode: "LINE" });
  const name = input.name?.trim() || null;
  const q = await db.projectQuote.create({
    data: {
      projectId: input.projectId,
      orgId: input.orgId,
      templateType: "supply_only",
      quoteType: "SUPPLY_ONLY",
      quoteNumber: await nextQuoteNumber(input.orgId, input.projectId),
      name,
      version: 1,
      title: name ?? "逐行报价 v1",
      currency: "CAD",
      status: "draft",
      pricingMethod: "MARGIN_ON_REVENUE",
      pricingRate: null,
      engineJson: engine as Prisma.InputJsonValue,
      calcVersion: QUOTE_ENGINE_CALC_VERSION,
      createdById: input.userId,
      costLines: { create: writes.creates.map((w) => writeData(input.orgId, w)) },
    },
    select: { id: true, version: true },
  });
  await snapshotQuote(q.id, input.projectId);
  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: QUOTE_AUDIT_ACTIONS.QUOTE_CREATED,
    targetType: QUOTE_AUDIT_TARGET,
    targetId: q.id,
    afterData: { quoteType: "SUPPLY_ONLY", version: q.version, entryMode: "LINE", rows: state.rows.length, rowSource: schedule ? "schedule" : "empty" },
  }).catch(() => undefined);
  return { id: q.id, entryMode: "LINE", proModeHref: proModeHrefOf(input.projectId, q.id) };
}

/* ---------------------------------- 读 ---------------------------------- */

async function inquiryQuotesOf(projectId: string): Promise<InquiryQuoteOption[]> {
  const items = await db.inquiryItem.findMany({
    where: { status: "quoted", inquiry: { projectId, status: { not: "canceled" } } },
    select: { id: true, supplierId: true, unitPrice: true, totalPrice: true, currency: true, repliedAt: true, supplier: { select: { name: true } }, inquiry: { select: { roundNumber: true } } },
    orderBy: [{ repliedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return items.map((i) => ({
    inquiryItemId: i.id,
    supplierId: i.supplierId,
    supplierName: i.supplier.name,
    roundNumber: i.inquiry.roundNumber,
    repliedAt: i.repliedAt?.toISOString() ?? null,
    unitPrice: i.unitPrice == null ? null : Number(i.unitPrice),
    totalPrice: i.totalPrice == null ? null : Number(i.totalPrice),
    currency: i.currency,
  }));
}

function assertLineMode(q: QuoteRecord) {
  if (!isLineModeQuote(q)) throw new QuoteEngineError("NOT_LINE_MODE", "这份报价不是逐行报价，请在专业模式里打开", 409);
}

/** 由一份报价算出逐行视图里的状态、结果与分摊（读、保存后、导出共用） */
export function buildLineComputed(q: QuoteRecord) {
  const read = costLinesToState(q.costLines, q);
  const computed = computeForQuote(q).calc;
  const goods = read.state.rows.map((r, i) => ({ costLineId: read.goodsIds[i], lineNo: i + 1, quantity: r.quantity, priced: r.unitPrice != null }));
  if (!computed.ok) {
    return { read, computed: { ok: false as const, errorsZh: [...new Set(computed.errors.map((e) => engineErrorZh(e.code, e.message)))] }, amountById: new Map<string, number>() };
  }
  const allocation = allocateFromEngine(goods, computed);
  return {
    read,
    amountById: new Map(computed.lines.map((l) => [l.id, l.amount])),
    computed: {
      ok: true as const,
      totals: {
        sellingPrice: computed.sellingPrice,
        estimatedCost: computed.estimatedCost,
        grossProfit: computed.grossProfit,
        grossMarginPct: computed.grossMarginPct,
        landedCost: round2(computed.directCost + computed.percentOfCostTotal),
      },
      allocation,
      warnings: [...new Map(computed.warnings.map((w) => [w.code, { code: w.code, messageZh: engineWarningZh(w.code, w.message) }])).values()],
    },
  };
}

export async function loadLineView(input: { projectId: string; orgId: string; quoteId: string; caps: LineCaps }): Promise<LineModeView> {
  const q = await getQuote(input.quoteId, input.projectId);
  assertLineMode(q);
  const { read, computed, amountById } = buildLineComputed(q);
  const [inquiryQuotes, seed] = await Promise.all([
    inquiryQuotesOf(input.projectId),
    read.state.rows.length === 0
      ? Promise.all([usableSchedule(input.projectId), loadSchedulePrefill({ projectId: input.projectId, orgId: input.orgId })]).then(([s, p]) => ({
          scheduleLineCount: s?.length ?? 0,
          prefill: { state: p.state, messageZh: p.messageZh, text: p.text },
        }))
      : Promise.resolve(null),
  ]);
  return {
    quote: { id: q.id, name: q.name ?? q.title ?? null, quoteNumber: q.quoteNumber, version: q.version, status: q.status, currency: q.currency, updatedAt: q.updatedAt.toISOString(), frozen: (FROZEN_STATUSES as readonly string[]).includes(q.status) },
    capabilities: input.caps,
    state: read.state,
    notices: read.notices,
    others: read.others.map((l) => ({ id: l.id, description: l.description, category: l.category, amount: amountById.get(l.id) ?? null, included: l.included })),
    computed,
    inquiryQuotes,
    seed,
    proModeHref: proModeHrefOf(input.projectId, q.id),
  };
}

/* ---------------------------------- 存 ---------------------------------- */

/** 点选询价回复的行：回复必须是本项目已报价的那一条，价与币种与回复一致；供应商一律取自库里 */
async function resolveInquiryRows(projectId: string, state: LineModeState): Promise<LineModeState> {
  const ids = [...new Set(state.rows.flatMap((r) => (r.inquiryItemId ? [r.inquiryItemId] : [])))];
  const items = ids.length
    ? await db.inquiryItem.findMany({
        where: { id: { in: ids }, status: "quoted", inquiry: { projectId, status: { not: "canceled" } } },
        select: { id: true, supplierId: true, unitPrice: true, currency: true, supplier: { select: { name: true } } },
      })
    : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const issues: Array<{ rowNo: number; messageZh: string }> = [];
  const rows = state.rows.map((r, i) => {
    if (!r.inquiryItemId) return { ...r, supplierId: null };
    const it = byId.get(r.inquiryItemId);
    if (!it) {
      issues.push({ rowNo: i + 1, messageZh: `第 ${i + 1} 行选的询价回复找不到了（可能已取消），请重新选或改成手填` });
      return r;
    }
    const replied = it.unitPrice == null ? null : Number(it.unitPrice);
    if (replied == null || r.unitPrice !== replied || r.currency !== it.currency) {
      issues.push({ rowNo: i + 1, messageZh: `第 ${i + 1} 行的报价与选中的询价回复不一致；改了价就请改成手填并选证据类别` });
      return r;
    }
    return { ...r, supplierId: it.supplierId, supplierName: it.supplier.name };
  });
  if (issues.length) throw new QuoteEngineError("VALIDATION", issues[0].messageZh, 400, { issues });
  return { ...state, rows };
}

export async function saveLineView(input: { projectId: string; orgId: string; quoteId: string; userId: string; caps: LineCaps; request: SaveLineModeRequest }): Promise<LineModeView> {
  const q = await getQuote(input.quoteId, input.projectId);
  assertLineMode(q);
  if ((FROZEN_STATUSES as readonly string[]).includes(q.status)) throw new QuoteEngineError("QUOTE_FROZEN", "这份报价已定或已结束，内容锁定；要改请在专业模式里另起新版", 409);
  if (q.updatedAt.toISOString() !== input.request.baseUpdatedAt) throw new QuoteEngineError("QUOTE_CHANGED", "这份报价刚被别人改过，请刷新后再改", 409);
  const checked = validateLineModeState(input.request.state);
  if (!checked.ok) throw new QuoteEngineError("VALIDATION", checked.issues[0].messageZh, 400, { issues: checked.issues });
  const state = await resolveInquiryRows(input.projectId, checked.state);
  const writes = stateToWrites(state, q.costLines);
  const before = { sellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null };
  await db.$transaction(async (tx) => {
    // 先按读取时的修改时间占住这份报价：别人在这之间改过 → 0 行 → 409，整笔不写
    const cas = await tx.projectQuote.updateMany({
      where: { id: q.id, updatedAt: q.updatedAt, status: { notIn: [...FROZEN_STATUSES] } },
      data: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: D(state.targetMarginPct) },
    });
    if (cas.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", "这份报价刚被别人改过，请刷新后再改", 409);
    if (writes.deleteIds.length) await tx.quoteCostLine.deleteMany({ where: { quoteId: q.id, id: { in: writes.deleteIds } } });
    for (const u of writes.updates) {
      const res = await tx.quoteCostLine.updateMany({ where: { id: u.id, quoteId: q.id }, data: writeData(q.orgId, u.data) });
      if (res.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", "这份报价刚被别人改过，请刷新后再改", 409);
    }
    for (const c of writes.creates) await tx.quoteCostLine.create({ data: { ...writeData(q.orgId, c), quoteId: q.id } });
  });
  const after = await snapshotQuote(q.id, input.projectId);
  await logAudit({
    userId: input.userId,
    orgId: q.orgId,
    projectId: input.projectId,
    action: QUOTE_AUDIT_ACTIONS.QUOTE_UPDATED,
    targetType: QUOTE_AUDIT_TARGET,
    targetId: q.id,
    beforeData: before,
    afterData: { sellingPrice: after.calc.ok ? after.calc.sellingPrice : null, entryMode: "LINE", rows: state.rows.length, created: writes.creates.length, updated: writes.updates.length, deleted: writes.deleteIds.length },
  }).catch(() => undefined);
  return loadLineView({ projectId: input.projectId, orgId: input.orgId, quoteId: q.id, caps: input.caps });
}

/* ---------------------------------- 导出 ---------------------------------- */

export async function exportLineQuote(input: { projectId: string; orgId: string; quoteId: string }): Promise<{ csv: string; filename: string; total: string }> {
  const availability = await exportAvailability(input.projectId, input.orgId);
  if (!availability.available) throw new QuoteEngineError("EXPORT_UNAVAILABLE", availability.reasonZh, 409);
  if (availability.quoteId !== input.quoteId) throw new QuoteEngineError("EXPORT_UNAVAILABLE", "这份报价不是当前的我方报价，不能导出；请导出当前的我方报价", 409);
  const q = await getQuote(input.quoteId, input.projectId);
  const { read, computed } = buildLineComputed(q);
  if (!computed.ok) throw new QuoteEngineError("EXPORT_UNAVAILABLE", computed.errorsZh[0] ?? "报价算不出，不能导出", 409);
  const lines: PriceScheduleLine[] = read.state.rows.map((r, i) => ({ lineNo: i + 1, description: r.description, quantity: r.quantity, uom: r.uom, packCount: r.packCount ?? undefined }));
  const result = exportOfficialPriceSchedule(lines, exportUnitPrices(computed.allocation));
  if (!result.ok) throw new QuoteEngineError("EXPORT_UNAVAILABLE", result.messageZh, 409);
  const safe = (q.quoteNumber ?? q.id).replace(/[^A-Za-z0-9_-]+/g, "-");
  return { csv: result.csv, filename: `price-schedule-${safe}-v${q.version}.csv`, total: result.total };
}
