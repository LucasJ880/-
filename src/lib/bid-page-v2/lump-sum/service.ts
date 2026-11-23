/**
 * BIDPAGE-4 只报总价 — 服务（读写库；只由 `/api/projects/[id]/bid-page/quotes/**` 调用，调用方已过报价权限守卫与金额门）
 * （openspec change quote-lump-sum-mode，design D4 / D5 / D7 / D9）
 *
 * - 金额、比例、税、备注、供应商只从这里出，接口只给「报价内部成本权限 ∧ 财务查看权」的人。
 * - 写只动总价表管的成本行与报价配置里的税；不写 `QuoteLineItem`、投标工作区、浏览器。
 * - 六个数与算式都来自 `computeForQuote`（报价引擎一套算法）。互转写库前用引擎核对前后结果。
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { round2 } from "@/lib/quote-engine/calc";
import { FROZEN_STATUSES, QUOTE_ENGINE_CALC_VERSION, engineConfigSchema } from "@/lib/quote-engine/contract";
import {
  QUOTE_AUDIT_ACTIONS,
  QUOTE_AUDIT_TARGET,
  QuoteEngineError,
  computeForQuote,
  engineOf,
  getQuote,
  nextQuoteNumber,
  snapshotQuote,
  toLineInputs,
  type QuoteRecord,
} from "@/lib/quote-engine/service";
import { defaultEngineConfig } from "@/lib/quote-engine/templates";
import { BUSINESS_TYPE_TO_QUOTE_TYPE, currencyLabelZh, isLineModeQuote, proModeHrefOf, validateLineModeState, type BusinessType } from "../quote-line/contract";
import { costLinesToState } from "../quote-line/mapping";
import { D, QUOTE_CHANGED_ZH, frozenZh, inquiryQuotesOf, resolveInquiryRows, writeData, type LineCaps } from "../quote-line/service";
import {
  LUMP_NOT_LUMP_ZH,
  isLumpSumQuote,
  lumpEngineErrorZh,
  lumpEngineWarningZh,
  readLumpMeta,
  validateLumpState,
  type ConvertRequest,
  type LumpFormula,
  type LumpState,
  type LumpView,
  type SaveLumpRequest,
} from "./contract";
import { compareEngine, convertHintZh, convertLineToLump, convertLumpToLine, simulateWrites } from "./convert";
import { defaultLumpState, indexLumpLines, lumpStateFromLines, lumpStateToWrites, type LumpWrite, type LumpWrites } from "./mapping";

const lumpWriteData = (orgId: string | null, w: LumpWrite) => ({ ...writeData(orgId, w), ...(w.notes !== undefined ? { notes: w.notes } : {}) });

/* ---------------------------------- 新建 ---------------------------------- */

export async function createLumpQuote(input: { projectId: string; orgId: string; userId: string; businessType: Exclude<BusinessType, "STANDING_OFFER">; name?: string | null }): Promise<{ id: string; entryMode: "LUMP_SUM"; proModeHref: string }> {
  const quoteType = BUSINESS_TYPE_TO_QUOTE_TYPE[input.businessType];
  const writes = lumpStateToWrites(defaultLumpState(), []);
  const engine = engineConfigSchema.parse({ ...defaultEngineConfig(quoteType), entryMode: "LUMP_SUM" });
  const name = input.name?.trim() || null;
  const q = await db.projectQuote.create({
    data: {
      projectId: input.projectId,
      orgId: input.orgId,
      templateType: quoteType.toLowerCase(),
      quoteType,
      quoteNumber: await nextQuoteNumber(input.orgId, input.projectId),
      name,
      version: 1,
      title: name ?? "只报总价",
      currency: "CAD",
      status: "draft",
      pricingMethod: "MARGIN_ON_REVENUE",
      pricingRate: null,
      engineJson: engine as Prisma.InputJsonValue,
      calcVersion: QUOTE_ENGINE_CALC_VERSION,
      createdById: input.userId,
      costLines: { create: writes.creates.map((w) => lumpWriteData(input.orgId, w)) },
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
    afterData: { quoteType, version: q.version, entryMode: "LUMP_SUM" },
  }).catch(() => undefined);
  return { id: q.id, entryMode: "LUMP_SUM", proModeHref: proModeHrefOf(input.projectId, q.id) };
}

/* ---------------------------------- 读 ---------------------------------- */

function assertLump(q: QuoteRecord) {
  if (!isLumpSumQuote(q)) throw new QuoteEngineError("NOT_LUMP_SUM", LUMP_NOT_LUMP_ZH, 409);
  if (q.currency !== "CAD") throw new QuoteEngineError("NOT_LUMP_SUM", `这份报价的币种在专业模式里改成了${currencyLabelZh(q.currency)}，「只报总价」只能用加元做，请在专业模式里打开`, 409);
}

/** 由一份报价算出总价视图里的六个数、算式与每行金额（读、保存后共用） */
export function buildLumpComputed(q: QuoteRecord, goodsIds: readonly string[]): LumpView["computed"] {
  const calc = computeForQuote(q).calc;
  if (!calc.ok) return { ok: false, errorsZh: [...new Set(calc.errors.map((e) => lumpEngineErrorZh(e.code, e.message)))] };
  const amountById = Object.fromEntries(calc.lines.map((l) => [l.id, l.amount]));
  const salesTax = round2(calc.tax.gst + calc.tax.hst + calc.tax.pst);
  const commissionLines = q.costLines.filter((l) => l.included && l.calculationType === "PCT_OF_GROSS_PROFIT");
  const formula: LumpFormula | null =
    q.pricingMethod === "MARGIN_ON_REVENUE"
      ? {
          baseCost: calc.baseCost,
          marginPct: calc.pricing.marginOnRevenue,
          revenuePct: calc.revenuePctTotal,
          commission: commissionLines.length
            ? { ratePct: commissionLines.reduce((s, l) => s + Number(l.rate ?? 0), 0), amount: round2(commissionLines.reduce((s, l) => s + (amountById[l.id] ?? 0), 0)) }
            : null,
          sellingPrice: calc.sellingPrice,
          salesTax,
          totalWithTax: calc.tax.total,
        }
      : null;
  // 与总价表认的同一条货品总数（不是专业模式改了算法或重复的那条）
  const gtLine = indexLumpLines(q.costLines).goodsTotal;
  const goodsTotalLine = gtLine && gtLine.included ? gtLine : null;
  const goodsAmount = round2([...goodsIds, ...(goodsTotalLine ? [goodsTotalLine.id] : [])].reduce((s, id) => s + (amountById[id] ?? 0), 0));
  return {
    ok: true,
    totals: { estimatedCost: calc.estimatedCost, sellingPrice: calc.sellingPrice, salesTax, totalWithTax: calc.tax.total, grossProfit: calc.grossProfit, grossMarginPct: calc.grossMarginPct },
    formula,
    amountById,
    goodsAmount,
    warnings: [...new Map(calc.warnings.map((w) => [w.code, { code: w.code, messageZh: lumpEngineWarningZh(w.code, w.message) }])).values()],
  };
}

function convertToLineAvailability(q: QuoteRecord, state: LumpState): LumpView["convertToLine"] {
  if (q.quoteType !== "SUPPLY_ONLY") return { available: false, reasonZh: "逐行报价限于只供货的报价，供货加安装的报价不能转成逐行报价" };
  if (state.details.length === 0) return { available: false, reasonZh: "货品是一个总数，先展开成明细再转成逐行报价" };
  return { available: true };
}

export async function loadLumpView(input: { projectId: string; orgId: string; quoteId: string; caps: LineCaps }): Promise<LumpView> {
  const q = await getQuote(input.quoteId, input.projectId);
  assertLump(q);
  const read = lumpStateFromLines(q.costLines, q);
  const computed = buildLumpComputed(q, read.detailIds);
  const amountById = computed.ok ? computed.amountById : {};
  return {
    quote: {
      id: q.id,
      name: q.name,
      quoteNumber: q.quoteNumber,
      quoteType: q.quoteType,
      version: q.version,
      status: q.status,
      currency: q.currency,
      updatedAt: q.updatedAt.toISOString(),
      frozen: (FROZEN_STATUSES as readonly string[]).includes(q.status),
      pricingMethod: q.pricingMethod,
    },
    capabilities: input.caps,
    state: read.state,
    notices: read.notices,
    others: read.others.map(({ line, reasonZh, fromLump }) => ({ id: line.id, description: line.description, category: line.category, amount: amountById[line.id] ?? null, included: line.included, fromLump, reasonZh })),
    computed,
    inquiryQuotes: await inquiryQuotesOf(input.projectId),
    proModeHref: proModeHrefOf(input.projectId, q.id),
    convertToLine: convertToLineAvailability(q, read.state),
  };
}

/* ---------------------------------- 存 ---------------------------------- */

/** 货品总数点选询价回复：回复必须是本项目已报价的那一条、总价与币种一致；供应商取自库里。手填的只沿用库里原来也是手填的供应商 */
async function resolveGoodsTotal(projectId: string, state: LumpState, current: QuoteRecord["costLines"]): Promise<LumpState> {
  const g = state.goods;
  if (!g.inquiryItemId) {
    // 与写入时同一条（indexLumpLines 认的那条货品总数），不随便取第一条
    const gt = indexLumpLines(current).goodsTotal;
    const manual = gt && !readLumpMeta(gt.metadata)?.inquiryItemId ? gt : null;
    return { ...state, goods: { ...g, supplierId: manual?.supplierId ?? null, supplierName: manual?.supplierName ?? null } };
  }
  const it = await db.inquiryItem.findFirst({
    where: { id: g.inquiryItemId, status: "quoted", inquiry: { projectId, status: { not: "canceled" } } },
    select: { id: true, supplierId: true, totalPrice: true, currency: true, supplier: { select: { name: true } } },
  });
  const fail = (msg: string) => {
    throw new QuoteEngineError("VALIDATION", msg, 400, { issues: [{ rowNo: null, messageZh: msg }] });
  };
  if (!it) fail("货品总数选的询价回复找不到了（可能已取消，或不是这个项目的），请重新选或改成手填");
  const total = it!.totalPrice == null ? null : Number(it!.totalPrice);
  if (total == null || g.amount !== total || g.currency !== it!.currency) fail("货品总数和选中的询价回复对不上（回复可能改过）：请重新选一次，或改成手填并选证据类别");
  return { ...state, goods: { ...g, evidenceKind: null, supplierId: it!.supplierId, supplierName: it!.supplier.name } };
}

async function resolveDetails(projectId: string, state: LumpState, current: QuoteRecord["costLines"]): Promise<LumpState> {
  if (state.details.length === 0) return state;
  try {
    const resolved = await resolveInquiryRows(projectId, { rows: state.details, fx: state.fx, shared: { oceanFreight: { containers: null, perContainer: null, currency: "CAD" }, customs: { amount: null, currency: "CAD" }, domesticFreight: { amount: null, currency: "CAD" }, dutyPct: null }, presets: state.presets, targetMarginPct: state.targetMarginPct }, current);
    return { ...state, details: resolved.rows };
  } catch (e) {
    if (e instanceof QuoteEngineError && e.code === "VALIDATION") {
      const msg = `货品明细${e.message}`;
      throw new QuoteEngineError("VALIDATION", msg, 400, { issues: [{ rowNo: null, messageZh: msg }] });
    }
    throw e;
  }
}

const CONVERT_CHANGED_ZH = "这份报价刚被别人改过（也可能是你在专业模式里改的），这次没转换：点「收起」再「打开」看最新内容后再转";

function assertWritable(q: QuoteRecord, baseUpdatedAt: string, changedZh = QUOTE_CHANGED_ZH) {
  if ((FROZEN_STATUSES as readonly string[]).includes(q.status)) throw new QuoteEngineError("QUOTE_FROZEN", frozenZh(q.status), 409);
  if (q.updatedAt.toISOString() !== baseUpdatedAt) throw new QuoteEngineError("QUOTE_CHANGED", changedZh, 409);
}

async function writeLines(tx: Prisma.TransactionClient, q: QuoteRecord, writes: LumpWrites, changedZh = QUOTE_CHANGED_ZH) {
  if (writes.deleteIds.length) await tx.quoteCostLine.deleteMany({ where: { quoteId: q.id, id: { in: writes.deleteIds } } });
  for (const u of writes.updates) {
    const res = await tx.quoteCostLine.updateMany({ where: { id: u.id, quoteId: q.id }, data: lumpWriteData(q.orgId, u.data) });
    if (res.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", changedZh, 409);
  }
  for (const c of writes.creates) await tx.quoteCostLine.create({ data: { ...lumpWriteData(q.orgId, c), quoteId: q.id } });
}

export async function saveLumpView(input: { projectId: string; orgId: string; quoteId: string; userId: string; caps: LineCaps; request: SaveLumpRequest }): Promise<LumpView> {
  const q = await getQuote(input.quoteId, input.projectId);
  assertLump(q);
  assertWritable(q, input.request.baseUpdatedAt);
  const checked = validateLumpState(input.request.state as LumpState);
  if (!checked.ok) throw new QuoteEngineError("VALIDATION", checked.issues[0].messageZh, 400, { issues: checked.issues });
  if (q.pricingMethod !== "MARGIN_ON_REVENUE" && checked.state.targetMarginPct == null) {
    const msg = "定价方式在专业模式里改过：「只报总价」只按目标毛利率（按售价）定价，请先填目标毛利率再保存";
    throw new QuoteEngineError("VALIDATION", msg, 400, { issues: [{ rowNo: null, messageZh: msg }] });
  }
  const state = await resolveDetails(input.projectId, await resolveGoodsTotal(input.projectId, checked.state, q.costLines), q.costLines);
  const writes = lumpStateToWrites(state, q.costLines);
  const parsed = engineConfigSchema.safeParse(q.engineJson ?? {});
  const engine = engineConfigSchema.parse({ ...(parsed.success ? parsed.data : {}), tax: { hstPct: state.tax.hstPct, gstPct: state.tax.gstPct, pstPct: state.tax.pstPct } });
  const before = { sellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null };
  await db.$transaction(async (tx) => {
    // 先按读取时的修改时间占住这份报价（同时写定价与配置里的税）：别人在这之间改过 → 0 行 → 409，整笔不写
    const cas = await tx.projectQuote.updateMany({
      where: { id: q.id, updatedAt: q.updatedAt, status: { notIn: [...FROZEN_STATUSES] } },
      data: { pricingMethod: "MARGIN_ON_REVENUE", pricingRate: D(state.targetMarginPct), engineJson: engine as Prisma.InputJsonValue },
    });
    if (cas.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", QUOTE_CHANGED_ZH, 409);
    await writeLines(tx, q, writes);
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
    afterData: { sellingPrice: after.calc.ok ? after.calc.sellingPrice : null, entryMode: "LUMP_SUM", items: state.items.length, details: state.details.length, created: writes.creates.length, updated: writes.updates.length, deleted: writes.deleteIds.length },
  }).catch(() => undefined);
  return loadLumpView({ projectId: input.projectId, orgId: input.orgId, quoteId: q.id, caps: input.caps });
}

/* ---------------------------------- 互转 ---------------------------------- */

export async function convertQuote(input: { projectId: string; orgId: string; quoteId: string; userId: string; request: ConvertRequest }): Promise<{ id: string; entryMode: "LINE" | "LUMP_SUM" }> {
  const q = await getQuote(input.quoteId, input.projectId);
  const to = input.request.to;
  const isLine = isLineModeQuote(q);
  const isLump = isLumpSumQuote(q);
  const refuse = (msg: string): never => {
    throw new QuoteEngineError("CONVERT_UNAVAILABLE", msg, 409);
  };
  if (!isLine && !isLump) refuse("这份报价是在专业模式里做的，不能在这里转换");
  if ((to === "LINE" && isLine) || (to === "LUMP_SUM" && isLump)) refuse(to === "LINE" ? "这份报价已经是逐行报价" : "这份报价已经是只报总价的报价");
  if (q.currency !== "CAD") refuse(`这份报价的币种在专业模式里改成了${currencyLabelZh(q.currency)}，只能在专业模式里做`);
  assertWritable(q, input.request.baseUpdatedAt, CONVERT_CHANGED_ZH);
  const result = to === "LUMP_SUM" ? convertLineToLump(q.costLines) : convertLumpToLine(q.costLines, q.quoteType);
  if (!result.ok) return refuse(result.reasonZh);
  const writes = result.writes;

  // ① 引擎核对：按库里能存的位数模拟转换后的行，四个数不同就不转
  const engine = engineOf(q);
  const pricing = { method: q.pricingMethod, rate: q.pricingRate == null ? null : Number(q.pricingRate) };
  const before = toLineInputs(q.costLines);
  const hintZh = convertHintZh(q.costLines, to);
  const cmp = compareEngine({ quoteCurrency: q.currency, pricing, engine, before, after: simulateWrites(q.costLines, writes), hintZh });
  if (!cmp.ok) refuse(cmp.reasonZh);

  // ② 目标做法的校验：转换后的内容读出来要能原样保存
  const simulated = applyToDb(q.costLines, writes);
  if (to === "LUMP_SUM") {
    const read = lumpStateFromLines(simulated, q);
    const v = validateLumpState(read.state);
    if (!v.ok) refuse(`转换后有内容存不进总价表（${v.issues[0].messageZh}），没有转换`);
  } else {
    const read = costLinesToState(simulated, q);
    const v = validateLineModeState(read.state);
    if (!v.ok) refuse(`转换后有内容存不进逐行表（${v.issues[0].messageZh}），没有转换`);
  }

  const parsed = engineConfigSchema.safeParse(q.engineJson ?? {});
  const nextEngine = engineConfigSchema.parse({ ...(parsed.success ? parsed.data : {}), entryMode: to });
  await db.$transaction(async (tx) => {
    const cas = await tx.projectQuote.updateMany({ where: { id: q.id, updatedAt: q.updatedAt, status: { notIn: [...FROZEN_STATUSES] } }, data: { engineJson: nextEngine as Prisma.InputJsonValue } });
    if (cas.count !== 1) throw new QuoteEngineError("QUOTE_CHANGED", CONVERT_CHANGED_ZH, 409);
    await writeLines(tx, q, writes, CONVERT_CHANGED_ZH);
    // 写完按读报价时同样的顺序重读、再用引擎核对一次：有任何不同就整笔回滚（模拟之外的兜底）
    const reread = await tx.quoteCostLine.findMany({ where: { quoteId: q.id }, orderBy: { sortOrder: "asc" } });
    const again = compareEngine({ quoteCurrency: q.currency, pricing, engine, before, after: toLineInputs(reread), hintZh });
    if (!again.ok) throw new QuoteEngineError("CONVERT_UNAVAILABLE", again.reasonZh, 409);
  });
  const after = await snapshotQuote(q.id, input.projectId);
  await logAudit({
    userId: input.userId,
    orgId: q.orgId,
    projectId: input.projectId,
    action: QUOTE_AUDIT_ACTIONS.QUOTE_UPDATED,
    targetType: QUOTE_AUDIT_TARGET,
    targetId: q.id,
    beforeData: { entryMode: isLine ? "LINE" : "LUMP_SUM", sellingPrice: (q.summaryJson as { sellingPrice?: number } | null)?.sellingPrice ?? null },
    afterData: { entryMode: to, convert: to === "LUMP_SUM" ? "LINE→LUMP_SUM" : "LUMP_SUM→LINE", sellingPrice: after.calc.ok ? after.calc.sellingPrice : null, created: writes.creates.length, updated: writes.updates.length, deleted: writes.deleteIds.length },
  }).catch(() => undefined);
  return { id: q.id, entryMode: to };
}

/** 把要写的行落到内存里的库行（只给转换后的读出与校验用；数值按库里的位数取） */
function applyToDb(current: QuoteRecord["costLines"], writes: LumpWrites): QuoteRecord["costLines"] {
  const dec = (v: number | null, places: number) => (v == null ? null : new Prisma.Decimal(v.toFixed(8)).toDecimalPlaces(places, Prisma.Decimal.ROUND_HALF_UP));
  const del = new Set(writes.deleteIds);
  const upd = new Map(writes.updates.map((u) => [u.id, u.data]));
  const fromWrite = (base: QuoteRecord["costLines"][number], w: LumpWrite): QuoteRecord["costLines"][number] => ({
    ...base,
    sortOrder: w.sortOrder,
    category: w.category,
    subcategory: w.subcategory,
    description: w.description,
    quantity: dec(w.quantity, 4),
    unit: w.unit,
    unitCost: dec(w.unitCost, 4),
    sourceCurrency: w.sourceCurrency,
    fxRate: dec(w.fxRate, 8),
    fxRateSource: w.fxRateSource,
    calculationType: w.calculationType,
    calculationBase: w.calculationBase,
    rate: dec(w.rate, 4),
    duration: dec(w.duration, 4),
    supplierId: w.supplierId,
    supplierName: w.supplierName,
    source: w.source,
    notes: w.notes === undefined ? base.notes : w.notes,
    included: w.included,
    metadata: w.metadata as Prisma.JsonValue,
  });
  const template = current[0];
  const kept = current.filter((l) => !del.has(l.id)).map((l) => (upd.has(l.id) ? fromWrite(l, upd.get(l.id)!) : l));
  const created = writes.creates.map((c, i) => fromWrite({ ...(template ?? ({} as QuoteRecord["costLines"][number])), id: `new-${i}`, notes: null }, c));
  return [...kept, ...created];
}
