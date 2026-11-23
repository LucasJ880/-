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
  currencyLabelZh,
  engineErrorZh,
  isLineModeQuote,
  readBidLineMeta,
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
import { costLinesToState, defaultLineModeState, linePrefillMessageZh, seedRowsFromSchedule, stateToWrites, type CostLineWrite } from "./mapping";
import { isLumpSumQuote, readLumpMeta } from "../lump-sum/contract";
import { frozenNoteZh } from "../quote-confirm/contract";
import { buildOurBidLine } from "../quote-confirm/service";
import type { TenderBidResolution } from "@/lib/quote-engine/tender-bid";

/** 我方报价是总价报价时导出处的原因（spec tender/quote-line-mode「按招标方价格表导出」） */
export const LUMP_EXPORT_UNAVAILABLE_ZH = "我方报价是只报总价的，没有逐行单价，不能按招标方价格表导出；招标方要价格表的话，请用逐行报价做一份并定为我方报价";

export type LineCaps = { canEdit: boolean; canApprove: boolean };

export const QUOTE_CHANGED_ZH = "这份报价刚被别人改过（也可能是你在专业模式里改的），这次没保存";
/** 冻结提示（BIDPAGE-6：已批准的写「另起新版」，不再叫人去专业模式） */
export const frozenZh = (status: string) => frozenNoteZh(status);

/**
 * 导出的 CSV 会被人用表格软件打开：以 = + - @ 或制表符、回车开头的品名会被当成公式，前面加一个 ' 让它按文字显示
 *（品名可能来自招标分析抽出的外部文件；共用的 `official-export.ts` 不改）。
 */
export function csvSafeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export const D = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v.toFixed(8)));

export { isLineModeQuote };

/** 投标工作区里存下、且校验通过的价格表（不看投标工作区开关，只读它存下的块） */
export async function usableSchedule(projectId: string): Promise<PriceScheduleLine[] | null> {
  const stored = await loadWorkspace(projectId);
  const lines = (stored?.priceSchedule?.lines ?? []) as PriceScheduleLine[];
  if (lines.length === 0) return null;
  return validatePriceSchedule(lines).valid ? lines : null;
}

export function writeData(orgId: string | null, w: CostLineWrite) {
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

type OurBid = { id: string | null; status: string };

const ourBidOf = (bid: TenderBidResolution): OurBid => ({ id: bid.status === "AUTHORITATIVE" ? bid.quote?.id ?? null : null, status: bid.status });

async function ourBidQuoteId(projectId: string, orgId: string): Promise<OurBid> {
  return ourBidOf(await resolveTenderBid({ projectId, orgId, internal: true }));
}

/** 导出不可用的原因：没定 / 新版没定时说在这一页定（BIDPAGE-6，spec tender/quote-line-mode「按招标方价格表导出」） */
export const EXPORT_NOT_DECIDED_ZH = "报价定为我方报价后才能导出：打开报价点「定为我方报价」（没有批准权限的点「提交给负责人」）";
export const EXPORT_REVISION_PENDING_ZH = "我方报价有新版还没定：新版定为我方报价后才能导出";

export async function exportAvailability(projectId: string, orgId: string, known?: OurBid): Promise<ExportAvailability> {
  const bid = known ?? (await ourBidQuoteId(projectId, orgId));
  if (!bid.id) {
    return {
      available: false,
      reasonZh:
        bid.status === "QUOTE_REVISION_PENDING" ? EXPORT_REVISION_PENDING_ZH : EXPORT_NOT_DECIDED_ZH,
    };
  }
  const q = await db.projectQuote.findFirst({ where: { id: bid.id, projectId, orgId }, select: { id: true, version: true, engineJson: true, quoteType: true } });
  if (q && isLumpSumQuote(q)) return { available: false, reasonZh: LUMP_EXPORT_UNAVAILABLE_ZH };
  if (!q || !isLineModeQuote(q)) return { available: false, reasonZh: "我方报价是在专业模式里做的，这里只能导出逐行报价；要按价格表导出，请用逐行报价做一份并定为我方报价" };
  return { available: true, quoteId: q.id, version: q.version };
}

export async function listLineQuotes(input: { projectId: string; orgId: string; caps: LineCaps }): Promise<QuoteListView> {
  const [rows, resolution, schedule] = await Promise.all([
    db.projectQuote.findMany({
      where: { projectId: input.projectId, quoteType: { not: "CUSTOM" } },
      orderBy: [{ updatedAt: "desc" }],
      select: { id: true, name: true, quoteNumber: true, version: true, status: true, quoteType: true, currency: true, engineJson: true, summaryJson: true, updatedAt: true },
    }),
    resolveTenderBid({ projectId: input.projectId, orgId: input.orgId, internal: true }),
    usableSchedule(input.projectId),
  ]);
  const bid = ourBidOf(resolution);
  const quotes = rows.map((q) => {
    const sp = (q.summaryJson as { sellingPrice?: unknown } | null)?.sellingPrice;
    return {
      id: q.id,
      name: q.name,
      quoteNumber: q.quoteNumber,
      version: q.version,
      status: q.status,
      quoteType: q.quoteType,
      currency: q.currency,
      entryMode: isLineModeQuote(q) ? ("LINE" as const) : isLumpSumQuote(q) ? ("LUMP_SUM" as const) : null,
      sellingPrice: typeof sp === "number" && Number.isFinite(sp) ? sp : null,
      updatedAt: q.updatedAt.toISOString(),
      isOurBid: bid.id === q.id,
      proModeHref: proModeHrefOf(input.projectId, q.id),
    };
  });
  const [exportView, ourBid] = await Promise.all([exportAvailability(input.projectId, input.orgId, bid), buildOurBidLine(input.projectId, resolution)]);
  return { capabilities: input.caps, quotes, scheduleLineCount: schedule?.length ?? 0, export: exportView, ourBid };
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
      title: name ?? "逐行报价",
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

export async function inquiryQuotesOf(projectId: string): Promise<InquiryQuoteOption[]> {
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
  // 逐行表的汇率、金额都按加元写；专业模式里把报价币种改掉了，就只能在专业模式里做
  if (q.currency !== "CAD") throw new QuoteEngineError("NOT_LINE_MODE", `这份报价的币种在专业模式里改成了${currencyLabelZh(q.currency)}，逐行报价只按加元做，请在专业模式里打开`, 409);
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
          prefill: { state: p.state, messageZh: linePrefillMessageZh(p), text: p.text },
        }))
      : Promise.resolve(null),
  ]);
  return {
    quote: { id: q.id, name: q.name, quoteNumber: q.quoteNumber, quoteType: q.quoteType, version: q.version, status: q.status, currency: q.currency, updatedAt: q.updatedAt.toISOString(), frozen: (FROZEN_STATUSES as readonly string[]).includes(q.status) },
    capabilities: input.caps,
    state: read.state,
    notices: read.notices,
    others: read.others.map((l) => ({ id: l.id, description: l.description, category: l.category, amount: amountById.get(l.id) ?? null, included: l.included, fromLump: readLumpMeta(l.metadata) != null })),
    computed,
    inquiryQuotes,
    seed,
    proModeHref: proModeHrefOf(input.projectId, q.id),
  };
}

/* ---------------------------------- 存 ---------------------------------- */

/**
 * 点选询价回复的行：回复必须是本项目已报价的那一条，价与币种与回复一致；供应商一律取自库里。
 * 不是点选的行：供应商不取提交的——只沿用库里同一条货品行原有的（那一行原来也不是点选来的，例如专业模式里填的），否则为空。
 */
export async function resolveInquiryRows(projectId: string, state: LineModeState, current: QuoteRecord["costLines"]): Promise<LineModeState> {
  const manualGoods = new Map(
    current.flatMap((l) => {
      const meta = readBidLineMeta(l.metadata);
      return meta?.role === "goods" && !meta.inquiryItemId ? [[l.id, l] as const] : [];
    }),
  );
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
    if (!r.inquiryItemId) {
      const kept = r.costLineId ? manualGoods.get(r.costLineId) : undefined;
      return { ...r, supplierId: kept?.supplierId ?? null, supplierName: kept?.supplierName ?? null };
    }
    const it = byId.get(r.inquiryItemId);
    if (!it) {
      issues.push({ rowNo: i + 1, messageZh: `第 ${i + 1} 行选的询价回复找不到了（可能已取消），请重新选或改成手填` });
      return r;
    }
    const replied = it.unitPrice == null ? null : Number(it.unitPrice);
    if (replied == null || r.unitPrice !== replied || r.currency !== it.currency) {
      issues.push({ rowNo: i + 1, messageZh: `第 ${i + 1} 行的供应商报价和选中的询价回复对不上（回复可能改过）：请重新选一次，或改成手填并选证据类别` });
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
  if ((FROZEN_STATUSES as readonly string[]).includes(q.status)) throw new QuoteEngineError("QUOTE_FROZEN", frozenZh(q.status), 409);
  if (q.updatedAt.toISOString() !== input.request.baseUpdatedAt) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CHANGED_ZH, 409);
  const checked = validateLineModeState(input.request.state);
  if (!checked.ok) throw new QuoteEngineError("VALIDATION", checked.issues[0].messageZh, 400, { issues: checked.issues });
  // 专业模式里把定价方式改成了别的：逐行保存会改回按售价毛利；没填目标毛利率就保存会变成零毛利，先拦下
  if (q.pricingMethod !== "MARGIN_ON_REVENUE" && checked.state.targetMarginPct == null) {
    const msg = "定价方式在专业模式里改过：逐行报价只按目标毛利率（按售价）定价，请先填目标毛利率再保存";
    throw new QuoteEngineError("VALIDATION", msg, 400, { issues: [{ rowNo: null, messageZh: msg }] });
  }
  const state = await resolveInquiryRows(input.projectId, checked.state, q.costLines);
  const writes = stateToWrites(state, q.costLines);
  const before = { sellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null };
  await db.$transaction(async (tx) => {
    // 先按读取时的修改时间占住这份报价：别人在这之间改过 → 0 行 → 409，整笔不写
    const cas = await tx.projectQuote.updateMany({
      where: { id: q.id, updatedAt: q.updatedAt, status: { notIn: [...FROZEN_STATUSES] } },
      data: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: D(state.targetMarginPct) },
    });
    if (cas.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CHANGED_ZH, 409);
    if (writes.deleteIds.length) await tx.quoteCostLine.deleteMany({ where: { quoteId: q.id, id: { in: writes.deleteIds } } });
    for (const u of writes.updates) {
      const res = await tx.quoteCostLine.updateMany({ where: { id: u.id, quoteId: q.id }, data: writeData(q.orgId, u.data) });
      if (res.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CHANGED_ZH, 409);
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
  assertLineMode(q);
  const { read, computed } = buildLineComputed(q);
  if (!computed.ok) throw new QuoteEngineError("EXPORT_UNAVAILABLE", computed.errorsZh[0] ?? "报价算不出，不能导出", 409);
  const lines: PriceScheduleLine[] = read.state.rows.map((r, i) => ({ lineNo: i + 1, description: csvSafeText(r.description), quantity: r.quantity, uom: r.uom, packCount: r.packCount ?? undefined }));
  const result = exportOfficialPriceSchedule(lines, exportUnitPrices(computed.allocation));
  if (!result.ok) throw new QuoteEngineError("EXPORT_UNAVAILABLE", result.messageZh, 409);
  const safe = (q.quoteNumber ?? q.id).replace(/[^A-Za-z0-9_-]+/g, "-");
  return { csv: result.csv, filename: `price-schedule-${safe}-v${q.version}.csv`, total: result.total };
}
