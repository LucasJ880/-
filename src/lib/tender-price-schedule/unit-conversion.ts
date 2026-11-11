/**
 * TI-1 单位换算与金额（纯函数，定点）
 *
 * 规则：
 * - 招标的数量与单位是事实，换算只产出新值，不改写行项。
 * - 供应商按件报价 → 招标单位单价 = 件价 × 包装数；只换算一次。
 * - 已按招标单位报价 → 原样使用，不再乘包装数。
 * - 成组单位缺包装数且按件报价 → 拒绝，不用默认值。
 * - 单价先舍入到分，再算行合计；总计 = 各行合计之和。
 */
import { Prisma } from "@prisma/client";
import { dec, roundMoney, ZERO, type DecimalInput } from "@/lib/project-finance/money";
import { isGroupedUom, toDecimalOrNull, type PriceScheduleLine } from "./contract";

export const QUOTE_BASES = ["PER_PIECE", "PER_TENDER_UOM"] as const;
export type QuoteBasis = (typeof QUOTE_BASES)[number];

export type PiecesPerUnit =
  | { ok: true; pieces: number }
  | { ok: false; code: "PACK_COUNT_MISSING"; messageZh: string };

/** 每个招标单位含多少件。成组单位必须给包装数；其它单位缺省为 1。 */
export function piecesPerTenderUnit(line: Pick<PriceScheduleLine, "lineNo" | "uom" | "packCount">): PiecesPerUnit {
  if (line.packCount !== null && line.packCount !== undefined) return { ok: true, pieces: line.packCount };
  if (isGroupedUom(line.uom)) {
    return { ok: false, code: "PACK_COUNT_MISSING", messageZh: `第 ${line.lineNo} 行单位为 ${line.uom}，缺少包装数，无法按件换算` };
  }
  return { ok: true, pieces: 1 };
}

export type ConvertedQuote =
  | {
      ok: true;
      lineNo: number;
      /** 招标单位与数量：原样带出，未改写 */
      uom: string;
      quantity: Prisma.Decimal;
      /** 招标单位单价（未舍入；舍入在 priceLine 里做一次） */
      tenderUnitPrice: Prisma.Decimal;
      /** 所需件数 = 数量 × 包装数；按招标单位报价且包装数未知时为 null */
      requiredPieces: Prisma.Decimal | null;
      piecesPerUnit: number | null;
      basis: QuoteBasis;
    }
  | { ok: false; lineNo: number; code: "PACK_COUNT_MISSING" | "QUANTITY_INVALID" | "PRICE_INVALID"; messageZh: string };

export function convertQuoteToTenderUom(
  line: PriceScheduleLine,
  quote: { unitPrice: DecimalInput; basis: QuoteBasis },
): ConvertedQuote {
  const quantity = toDecimalOrNull(line.quantity);
  if (!quantity || quantity.lte(ZERO)) {
    return { ok: false, lineNo: line.lineNo, code: "QUANTITY_INVALID", messageZh: `第 ${line.lineNo} 行数量无效` };
  }
  const price = toDecimalOrNull(quote.unitPrice);
  if (!price || price.lt(ZERO)) {
    return { ok: false, lineNo: line.lineNo, code: "PRICE_INVALID", messageZh: `第 ${line.lineNo} 行报价无效` };
  }
  const ppu = piecesPerTenderUnit(line);
  if (quote.basis === "PER_TENDER_UOM") {
    return {
      ok: true, lineNo: line.lineNo, uom: line.uom, quantity, tenderUnitPrice: price,
      requiredPieces: ppu.ok ? quantity.times(ppu.pieces) : null,
      piecesPerUnit: ppu.ok ? ppu.pieces : null,
      basis: quote.basis,
    };
  }
  if (!ppu.ok) return { ok: false, lineNo: line.lineNo, code: ppu.code, messageZh: ppu.messageZh };
  return {
    ok: true, lineNo: line.lineNo, uom: line.uom, quantity,
    tenderUnitPrice: price.times(ppu.pieces),
    requiredPieces: quantity.times(ppu.pieces),
    piecesPerUnit: ppu.pieces,
    basis: quote.basis,
  };
}

export type PricedLine = { lineNo: number; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; extended: Prisma.Decimal };

/** 单价舍入到分 → 行合计 = 舍入后单价 × 数量（再舍入到分，覆盖小数数量）。 */
export function priceLine(input: { lineNo: number; quantity: DecimalInput; unitPrice: DecimalInput }): PricedLine {
  const quantity = dec(input.quantity);
  const unitPrice = roundMoney(input.unitPrice);
  return { lineNo: input.lineNo, quantity, unitPrice, extended: roundMoney(unitPrice.times(quantity)) };
}

/** 总计 = 各行合计之和（不由未舍入总额倒推）。 */
export function priceSchedule(
  entries: ReadonlyArray<{ lineNo: number; quantity: DecimalInput; unitPrice: DecimalInput }>,
): { lines: PricedLine[]; total: Prisma.Decimal } {
  const lines = entries.map(priceLine);
  const total = lines.reduce((acc, l) => acc.plus(l.extended), ZERO);
  return { lines, total: roundMoney(total) };
}
