/**
 * TI-2 逐行直接成本（纯函数，定点）
 *
 * 直接成本 = 货值（折加元）+ 关税 + 运费 + 本地配送 + 其它不可回收 + 不可抵扣税 + 计入成本的预备金。
 * 两类失败分开处理：
 * - 输入自相矛盾（本地行带关税 / 国际运费、起订量非正）→ 拒绝（Rejection）；
 * - 缺参数（报价、数量、汇率及其来源与日期、关税率）→ 该行成本为空并列出原因，不用默认值。
 */
import { Prisma } from "@prisma/client";
import { dec, roundMoney, ZERO, type DecimalInput } from "@/lib/project-finance/money";
import { toDecimalOrNull } from "@/lib/tender-price-schedule/contract";
import { piecesPerTenderUnit } from "@/lib/tender-price-schedule/unit-conversion";
import type { CostLineInput, DutyBasis, DutyInput, LineBlocker, LineCost, Rejection } from "./contract";

type D = Prisma.Decimal;
const HUNDRED = new Prisma.Decimal(100);
const filled = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;
const money = (v: DecimalInput | null | undefined): D => roundMoney(toDecimalOrNull(v) ?? ZERO);

/** 四项齐全才算已核实；只校验齐全，不校验税率对不对。 */
export function dutyBasisOf(duty: DutyInput): DutyBasis {
  return filled(duty.hsCode) && filled(duty.origin) && filled(duty.sourceRef) && filled(duty.asOf) ? "VERIFIED" : "SENSITIVITY";
}

export type LineBase = {
  input: CostLineInput;
  quantity: D | null;
  requiredPieces: D | null;
  purchasePieces: D | null;
  excessPieces: D | null;
  goodsCad: D | null;
  dutyBasis: DutyBasis | null;
  dutyRatePct: D | null;
  blockers: LineBlocker[];
};

/** 第一步：数量、采购件数、货值与缺参数检查（运费分摊需要货值作依据，所以先算到这里）。 */
export function prepareLine(input: CostLineInput): { ok: true; base: LineBase } | Rejection {
  const { line, quote } = input;
  const n = line.lineNo;
  const reject = (code: Rejection["code"], messageZh: string): Rejection => ({ ok: false, code, lineNo: n, messageZh });

  if (input.sourcing === "DOMESTIC") {
    const dutyRate = input.duty ? toDecimalOrNull(input.duty.ratePct) : null;
    const intl = toDecimalOrNull(input.internationalFreightCad);
    if ((dutyRate && dutyRate.gt(ZERO)) || (intl && intl.gt(ZERO))) {
      return reject("DOMESTIC_HAS_IMPORT_CHARGES", `第 ${n} 行是本地采购，不得计入关税或国际运费`);
    }
  }
  for (const [label, v] of [["起订量", quote?.moqPieces], ["整包装件数", quote?.cartonPieces]] as const) {
    if (v !== null && v !== undefined && (!Number.isInteger(v) || v <= 0)) {
      return reject("INVALID_PURCHASE_RULE", `第 ${n} 行${label}必须是正整数`);
    }
  }
  let dutyRatePct: D | null = null;
  if (input.duty) {
    dutyRatePct = toDecimalOrNull(input.duty.ratePct);
    if (!dutyRatePct || dutyRatePct.lt(ZERO) || dutyRatePct.gt(HUNDRED)) return reject("INVALID_RATE", `第 ${n} 行关税率无效`);
  }

  const blockers: LineBlocker[] = [];
  const quantityRaw = toDecimalOrNull(line.quantity);
  const quantity = quantityRaw && quantityRaw.gt(ZERO) ? quantityRaw : null;
  if (!quantity) blockers.push({ code: "MISSING_QUANTITY", messageZh: "缺数量" });

  const price = quote ? toDecimalOrNull(quote.unitPrice) : null;
  const priceOk = !!price && price.gte(ZERO);
  if (!priceOk) blockers.push({ code: "MISSING_QUOTE", messageZh: "缺供应商报价" });

  const ppu = piecesPerTenderUnit(line);
  const needsPieces = !!quote && (quote.basis === "PER_PIECE" || quote.moqPieces != null || quote.cartonPieces != null);
  if (needsPieces && !ppu.ok) blockers.push({ code: "MISSING_PACK_COUNT", messageZh: "缺包装数" });

  let fxRate: D | null = ONE_CAD;
  if (quote && quote.currency.trim().toUpperCase() !== "CAD") {
    const r = toDecimalOrNull(input.fx?.rateCadPerUnit);
    fxRate = r && r.gt(ZERO) ? r : null;
    if (!fxRate) blockers.push({ code: "MISSING_FX_RATE", messageZh: "缺汇率" });
    if (!filled(input.fx?.source)) blockers.push({ code: "MISSING_FX_SOURCE", messageZh: "缺汇率来源" });
    if (!filled(input.fx?.asOf)) blockers.push({ code: "MISSING_FX_DATE", messageZh: "缺汇率日期" });
  }
  if (input.sourcing === "IMPORT" && !input.duty) blockers.push({ code: "MISSING_DUTY_RATE", messageZh: "缺关税率" });

  let requiredPieces: D | null = null;
  let purchasePieces: D | null = null;
  let excessPieces: D | null = null;
  let goodsCad: D | null = null;
  if (quantity && ppu.ok) {
    requiredPieces = quantity.times(ppu.pieces);
    purchasePieces = requiredPieces;
    if (quote?.moqPieces != null && purchasePieces.lt(quote.moqPieces)) purchasePieces = dec(quote.moqPieces);
    if (quote?.cartonPieces != null) purchasePieces = purchasePieces.div(quote.cartonPieces).ceil().times(quote.cartonPieces);
    excessPieces = purchasePieces.minus(requiredPieces);
  }
  if (blockers.length === 0 && quantity && price && fxRate && quote) {
    const original = ppu.ok && purchasePieces
      ? purchasePieces.times(quote.basis === "PER_PIECE" ? price : price.div(ppu.pieces))
      : quantity.times(price);
    goodsCad = roundMoney(original.times(fxRate));
  }
  return {
    ok: true,
    base: { input, quantity, requiredPieces, purchasePieces, excessPieces, goodsCad, dutyRatePct, dutyBasis: input.duty ? dutyBasisOf(input.duty) : null, blockers },
  };
}

const ONE_CAD = new Prisma.Decimal(1);

/**
 * 第二步：关税、进口 GST、运费与直接成本。
 * allocatedFreightCad = 整票费用分摊到本行的部分；reserveInCostPct = 计入成本的预备金率之和。
 */
export function finalizeLine(
  base: LineBase,
  opts: { importGst: { ratePct: DecimalInput; itcEligible: boolean }; allocatedFreightCad?: D; reserveInCostPct?: D },
): LineCost {
  const { input } = base;
  const { line, quote } = input;
  const head = {
    lineNo: line.lineNo,
    description: line.description,
    uom: line.uom,
    quantity: base.quantity,
    sourcing: input.sourcing,
    evidenceKind: quote?.evidenceKind ?? null,
    quoteUnitPrice: quote ? toDecimalOrNull(quote.unitPrice) : null,
    quoteCurrency: quote ? quote.currency.trim().toUpperCase() : null,
    quoteBasis: quote?.basis ?? null,
    requiredPieces: base.requiredPieces,
    purchasePieces: base.purchasePieces,
    excessPieces: base.excessPieces,
    dutyBasis: base.dutyBasis,
    dutyRatePct: base.dutyRatePct,
  };
  if (base.blockers.length > 0 || !base.goodsCad || !base.quantity) {
    return {
      ...head, complete: false, blockers: base.blockers,
      goodsCad: null, dutyCad: null, freightCad: null, localDeliveryCad: null, otherCad: null, nonRecoverableTaxCad: null,
      reserveInCostCad: null, directCostCad: null, unitCostCad: null, importGstCashCad: null,
    };
  }
  const isImport = input.sourcing === "IMPORT";
  const goodsCad = base.goodsCad;
  const dutyCad = isImport && base.dutyRatePct ? roundMoney(goodsCad.times(base.dutyRatePct).div(HUNDRED)) : ZERO;
  const importGstCashCad = isImport ? roundMoney(goodsCad.plus(dutyCad).times(dec(opts.importGst.ratePct)).div(HUNDRED)) : ZERO;
  const itcEligible = input.importGstItcEligible ?? opts.importGst.itcEligible;
  const nonRecoverableTaxCad = itcEligible ? ZERO : importGstCashCad;
  const freightCad = roundMoney(
    money(isImport ? input.internationalFreightCad : null).plus(opts.allocatedFreightCad ?? ZERO).plus(money(input.domesticFreightCad)),
  );
  const localDeliveryCad = money(input.localDeliveryCad);
  const otherCad = money(input.otherNonRecoverableCad);
  const beforeReserve = goodsCad.plus(dutyCad).plus(freightCad).plus(localDeliveryCad).plus(otherCad).plus(nonRecoverableTaxCad);
  const reserveInCostCad = opts.reserveInCostPct && opts.reserveInCostPct.gt(ZERO)
    ? roundMoney(beforeReserve.times(opts.reserveInCostPct).div(HUNDRED))
    : ZERO;
  const directCostCad = roundMoney(beforeReserve.plus(reserveInCostCad));
  return {
    ...head, complete: true, blockers: [],
    goodsCad, dutyCad, freightCad, localDeliveryCad, otherCad, nonRecoverableTaxCad, reserveInCostCad,
    directCostCad, unitCostCad: directCostCad.div(base.quantity), importGstCashCad,
  };
}
