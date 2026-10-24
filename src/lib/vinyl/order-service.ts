/**
 * VinylOrder 落库/读取的共用逻辑。
 *
 * 纪律（与 Blinds 一致）：
 *   - 落库时存一份计算快照，但**导出永远重算**，不信库里的值；
 *   - 重算按工单自己的 ruleVersion 走；
 *   - 开启状态编码表从组织配置读（车间可自行加码），不写死。
 */

import { db } from "@/lib/db";
import {
  calculateVinylItem,
  type VinylItemInput,
  type VinylOrderContext,
} from "./calculation-engine";
import { loadPanelCodeOverrides } from "./panel-code-store";
import { VINYL_RULE_VERSION, LOUVER_SIZES } from "./frame-rules";

export interface VinylItemPayload extends VinylItemInput {
  itemNumber?: number;
}

/** 把外部传入的一行收敛成引擎认的输入（不做业务判断，只做类型收敛） */
export function coerceItemInput(raw: Record<string, unknown>, index: number): VinylItemPayload {
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    itemNumber: index + 1,
    location: str(raw.location),
    width: num(raw.width) ?? 0,
    height: num(raw.height) ?? 0,
    panelCount: num(raw.panelCount) ?? 0,
    panelCode: str(raw.panelCode),
    dividerSpec: raw.dividerSpec ? str(raw.dividerSpec) : null,
    specialMidRail: num(raw.specialMidRail),
    midRailRatio: num(raw.midRailRatio),
    tiltRodPosition: raw.tiltRodPosition ? str(raw.tiltRodPosition) : null,
    frameType: str(raw.frameType),
    frameCount: str(raw.frameCount),
    inOut: str(raw.inOut),
    structure: str(raw.structure) || "有框",
    itemRemark: raw.itemRemark ? str(raw.itemRemark) : null,
  };
}

export async function buildOrderContext(
  orgId: string,
  louverSize: number,
): Promise<VinylOrderContext> {
  return {
    louverSize,
    panelCodeOverrides: await loadPanelCodeOverrides(orgId),
  };
}

export function normalizeLouverSize(v: unknown): number {
  const n = Number(v);
  return (LOUVER_SIZES as readonly number[]).includes(n) ? n : 3.5;
}

/** 计算并组装 VinylOrderItem 的 create 数据 */
export function buildItemRows(items: VinylItemPayload[], ctx: VinylOrderContext) {
  return items.map((input, i) => {
    const calc = calculateVinylItem(input, ctx);
    return {
      itemNumber: input.itemNumber ?? i + 1,
      location: input.location ?? "",
      width: input.width,
      height: input.height,
      panelCount: input.panelCount,
      panelCode: input.panelCode,
      dividerSpec: input.dividerSpec ?? null,
      specialMidRail: input.specialMidRail ?? null,
      midRailRatio: input.midRailRatio ?? null,
      tiltRodPosition: input.tiltRodPosition ?? null,
      frameType: input.frameType,
      frameCount: input.frameCount,
      inOut: input.inOut,
      structure: input.structure,
      itemRemark: input.itemRemark ?? null,
      frameSignature: calc.frameSignature,
      cavityWidth: calc.cavityWidth,
      cavityHeight: calc.cavityHeight,
      panelWidth: calc.panelWidth,
      panelHeight: calc.panelHeight,
      midRail: calc.midRail,
      midRailFromBottom: calc.midRailFromBottom,
      topLouvers: calc.topLouvers,
      bottomLouvers: calc.bottomLouvers,
      louverPitch: calc.louverPitch,
      strips: calc.panelSpec?.strips ?? null,
      caps: calc.panelSpec?.caps ?? null,
      squareFeet: calc.squareFeet,
      // 未解决的问题落库，工厂端能看见「这单哪几行要补」
      warningsJson: calc.warnings.length ? JSON.stringify(calc.warnings) : null,
      sortOrder: i,
    };
  });
}

/** 读一张工单并转成导出/展示需要的形状 */
export async function loadOrderForExport(orgId: string, id: string) {
  const order = await db.vinylOrder.findFirst({
    where: { id, orgId },
    include: { items: { orderBy: { itemNumber: "asc" } } },
  });
  if (!order) return null;

  return {
    order,
    exportData: {
      code: order.code,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      installDate: order.installDate,
      remarks: order.remarks,
      louverSize: order.louverSize,
      color: order.color,
      ruleVersion: order.ruleVersion || VINYL_RULE_VERSION,
      items: order.items.map<VinylItemPayload>((it) => ({
        itemNumber: it.itemNumber,
        location: it.location,
        width: it.width,
        height: it.height,
        panelCount: it.panelCount,
        panelCode: it.panelCode,
        dividerSpec: it.dividerSpec,
        specialMidRail: it.specialMidRail,
        midRailRatio: it.midRailRatio,
        tiltRodPosition: it.tiltRodPosition,
        frameType: it.frameType,
        frameCount: it.frameCount,
        inOut: it.inOut,
        structure: it.structure,
        itemRemark: it.itemRemark,
      })),
    },
  };
}
