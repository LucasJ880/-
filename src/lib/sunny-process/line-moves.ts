/**
 * 自产 Blinds 行 ⇄ 国内下单表（2026-10-27 拍板：多开一个按钮，一键发给国内；
 * 发给国内的行按销售写的直接生成，交外采购）。
 *
 * 只是在草稿工艺单内部挪行：BlindsOrderItem → spec.domestic（或反向），不对外发送任何东西
 * （发给供应商仍由人导出国内下单表后自行处理）。纯函数；落库见 autogen.ts moveProcessOrderLines。
 */

import { HEADRAIL_TYPES, MEASURE_TYPES, PRODUCT_TYPES } from "@/lib/blinds/deduction-rules";
import type { DomesticSpecRow, MappingNote, ProcessSpec } from "./process-spec";
import type { BlindsItemDraft } from "./quote-mapping";
import { ratioPartText, zebraRatioFor, type ZebraRatioEntry } from "./zebra-ratios";

/** BlindsOrderItem 里挪行要用的字段 */
export interface MovableItem {
  id: string;
  location: string;
  width: number;
  height: number;
  fabricSku: string;
  productType: string;
  measureType: string;
  controlType: string;
  controlSide: string;
  headrailType: string;
  mountType: string;
  fabricRatio: number | null;
  silkRatio: number | null;
  bottomBarWidth: number | null;
  itemRemark: string | null;
}

const QUOTE_PRODUCT: Record<string, string> = { 斑马帘: "Zebra", 卷帘: "Roller", 香格里拉: "SHANGRILA" };

/** 自产行 → 国内下单行：字段原样带过去（测量 / 操控 / 拉杆位置换成国内下单表的写法） */
export function itemToDomesticRow(it: MovableItem): DomesticSpecRow {
  const remark = [it.measureType === "Tight" ? "测量 Tight" : "", it.itemRemark ?? ""].filter(Boolean).join("；");
  return {
    location: it.location,
    code: it.location,
    widthIn: it.width,
    heightIn: it.height,
    productType: it.productType,
    sku: it.fabricSku,
    measure: it.measureType === "OUT" ? "外装" : "内装",
    control: it.controlType === "电动" ? "电机" : it.controlType === "无绳" ? "无绳" : "普通",
    side: it.controlSide === "L" ? "左" : it.controlSide === "R" ? "右" : "无",
    headrail: it.headrailType,
    mount: it.mountType === "墙装" ? "墙装" : "顶装",
    remark,
    quoteProduct: QUOTE_PRODUCT[it.productType] ?? "",
  };
}

export const IN_HOUSE_PRODUCTS: readonly string[] = PRODUCT_TYPES;

/** 国内下单行能否退回自产：产品是卷帘 / 斑马帘 / 香格里拉 */
export function canReturnToInHouse(r: DomesticSpecRow): boolean {
  return IN_HOUSE_PRODUCTS.includes(r.productType);
}

/** 国内下单行 → 自产行；罩盒不在减尺表里时按默认，斑马帘查布纱比表。返回需要提示的默认项 */
export function domesticRowToItem(r: DomesticSpecRow, zebraRatios?: readonly ZebraRatioEntry[]): { item: BlindsItemDraft; defaults: { field: string; value: string | number; messageZh: string }[] } {
  const defaults: { field: string; value: string | number; messageZh: string }[] = [];
  const productType = r.productType as BlindsItemDraft["productType"];
  let headrailType = r.headrail;
  if (!(HEADRAIL_TYPES as readonly string[]).includes(headrailType)) {
    headrailType = productType === "卷帘" ? "单轨无盒" : "亮白插片圆盒";
    defaults.push({ field: "headrailType", value: headrailType, messageZh: `退回自产：罩盒「${r.headrail || "未填"}」不在减尺表里，按 ${headrailType}，请核对` });
  }
  const tight = /测量 Tight/.test(r.remark);
  const measureType = (tight ? "Tight" : r.measure === "外装" ? "OUT" : "IN") as BlindsItemDraft["measureType"];
  let fabricRatio: number | null = null;
  let silkRatio: number | null = null;
  if (productType === "斑马帘") {
    const z = zebraRatioFor(zebraRatios, r.sku);
    fabricRatio = z.fabric;
    silkRatio = z.silk;
    defaults.push({
      field: "fabricRatio", value: fabricRatio,
      messageZh: z.match
        ? `斑马帘布纱比取自对照表「${z.match.code}」：${ratioPartText(z.fabric)} : ${ratioPartText(z.silk)}`
        : `面料 ${r.sku || "（未填）"} 不在布纱比对照表里，斑马帘布纱比默认 3:2，请按面料核对（影响裁剪位）`,
    });
  }
  const remark = r.remark.replace(/测量 Tight；?/, "").trim();
  return {
    item: {
      location: r.location || r.code,
      width: r.widthIn,
      height: r.heightIn,
      fabricSku: r.sku,
      productType,
      measureType: (MEASURE_TYPES as readonly string[]).includes(measureType) ? measureType : "IN",
      controlType: (r.control === "电机" ? "电动" : r.control === "无绳" ? "无绳" : "普通") as BlindsItemDraft["controlType"],
      controlSide: r.side === "左" ? "L" : "R",
      headrailType,
      mountType: r.mount === "墙装" ? "墙装" : "顶装",
      fabricRatio,
      silkRatio,
      itemRemark: remark || null,
    },
    defaults,
  };
}

/** 段内行号重排：保留的旧行号（1 起）按新顺序编号，被挪走的行的提示丢弃 */
function renumberNotes(notes: MappingNote[], section: MappingNote["section"], keptOldLines: number[]): MappingNote[] {
  const map = new Map(keptOldLines.map((old, k) => [old, k + 1]));
  return notes.flatMap((n) => {
    if (n.section !== section) return [n];
    const line = map.get(n.line);
    return line ? [{ ...n, line }] : [];
  });
}

export interface MovePlan {
  /** 移动后的自产行（保留行在前、退回的行在后），按新顺序 */
  items: (MovableItem | BlindsItemDraft)[];
  spec: ProcessSpec;
  moved: number;
}

export type MoveRequest =
  | { to: "domestic"; itemIds: string[] }
  | { to: "in_house"; domesticLines: number[] };

/** 规划一次挪行；version 不变（由保存方 +1）。无可挪的行返回 moved=0 */
export function planLineMove(items: MovableItem[], spec: ProcessSpec, req: MoveRequest, zebraRatios?: readonly ZebraRatioEntry[]): MovePlan {
  if (req.to === "domestic") {
    const ids = new Set(req.itemIds);
    const keptIdx: number[] = [];
    const movedRows: DomesticSpecRow[] = [];
    items.forEach((it, i) => {
      if (ids.has(it.id)) movedRows.push(itemToDomesticRow(it));
      else keptIdx.push(i + 1);
    });
    const notes = renumberNotes(spec.notes, "blinds", keptIdx);
    return {
      items: keptIdx.map((k) => items[k - 1]!),
      spec: { ...spec, domestic: [...spec.domestic, ...movedRows], notes },
      moved: movedRows.length,
    };
  }
  const lines = new Set(req.domesticLines);
  const keptIdx: number[] = [];
  const back: BlindsItemDraft[] = [];
  const newNotes: MappingNote[] = [];
  spec.domestic.forEach((r, i) => {
    if (lines.has(i + 1) && canReturnToInHouse(r)) {
      const { item, defaults } = domesticRowToItem(r, zebraRatios);
      const line = items.length + back.length + 1;
      back.push(item);
      for (const d of defaults) newNotes.push({ section: "blinds", line, field: d.field, value: d.value, messageZh: d.messageZh });
    } else {
      keptIdx.push(i + 1);
    }
  });
  const notes = [...renumberNotes(spec.notes, "domestic", keptIdx), ...newNotes];
  return {
    items: [...items, ...back],
    spec: { ...spec, domestic: keptIdx.map((k) => spec.domestic[k - 1]!), notes },
    moved: back.length,
  };
}
