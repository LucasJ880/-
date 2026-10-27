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

/**
 * 国内下单表没有对应列的自产字段，写成备注里的固定标记，退回自产时原样解析回来（不丢值）：
 *   测量 Tight / 安装 侧装 / 拉杆 M / 底杆覆盖 39.5 / 布纱比 3.3:2.1
 */
const MARK = {
  tight: /^测量 Tight$/,
  mount: /^安装 (\S+)$/,
  side: /^拉杆 (\S+)$/,
  bottomBar: /^底杆覆盖 (\d+(?:\.\d+)?)$/,
  ratio: /^布纱比 (\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/,
} as const;

function parseMarks(remark: string) {
  const out: { tight: boolean; mount: string | null; side: string | null; bottomBar: number | null; ratio: [number, number] | null; rest: string } = {
    tight: false, mount: null, side: null, bottomBar: null, ratio: null, rest: "",
  };
  const rest: string[] = [];
  for (const part of remark.split("；").map((x) => x.trim()).filter(Boolean)) {
    let m: RegExpMatchArray | null;
    if (MARK.tight.test(part)) out.tight = true;
    else if ((m = part.match(MARK.mount))) out.mount = m[1]!;
    else if ((m = part.match(MARK.side))) out.side = m[1]!;
    else if ((m = part.match(MARK.bottomBar))) out.bottomBar = Number(m[1]);
    else if ((m = part.match(MARK.ratio))) out.ratio = [Number(m[1]), Number(m[2])];
    else rest.push(part);
  }
  out.rest = rest.join("；");
  return out;
}

/** 自产行 → 国内下单行：字段原样带过去（测量 / 操控 / 拉杆位置换成国内下单表的写法；没有对应列的写进备注标记） */
export function itemToDomesticRow(it: MovableItem): DomesticSpecRow {
  const mountOk = it.mountType === "顶装" || it.mountType === "墙装";
  const sideOk = it.controlSide === "L" || it.controlSide === "R";
  const remark = [
    it.measureType === "Tight" ? "测量 Tight" : "",
    !mountOk && it.mountType ? `安装 ${it.mountType}` : "",
    !sideOk && it.controlSide ? `拉杆 ${it.controlSide}` : "",
    it.bottomBarWidth != null ? `底杆覆盖 ${it.bottomBarWidth}` : "",
    it.productType === "斑马帘" && Number(it.fabricRatio) > 0 && Number(it.silkRatio) > 0 ? `布纱比 ${it.fabricRatio}:${it.silkRatio}` : "",
    it.itemRemark ?? "",
  ].filter(Boolean).join("；");
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
    mount: mountOk ? it.mountType : "",
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
/** 退回的自产行：拉杆位置 / 安装方式可能是报价单之外的值（M / 侧装），由备注标记还原 */
export type ReturnedItem = Omit<BlindsItemDraft, "controlSide" | "mountType"> & { controlSide: string; mountType: string; bottomBarWidth: number | null };

export function domesticRowToItem(r: DomesticSpecRow, zebraRatios?: readonly ZebraRatioEntry[]): { item: ReturnedItem; defaults: { field: string; value: string | number; messageZh: string }[] } {
  const defaults: { field: string; value: string | number; messageZh: string }[] = [];
  const productType = r.productType as BlindsItemDraft["productType"];
  let headrailType = r.headrail;
  if (!(HEADRAIL_TYPES as readonly string[]).includes(headrailType)) {
    headrailType = productType === "卷帘" ? "单轨无盒" : "亮白插片圆盒";
    defaults.push({ field: "headrailType", value: headrailType, messageZh: `退回自产：罩盒「${r.headrail || "未填"}」不在减尺表里，按 ${headrailType}，请核对` });
  }
  const marks = parseMarks(r.remark);
  const measureType = (marks.tight ? "Tight" : r.measure === "外装" ? "OUT" : "IN") as BlindsItemDraft["measureType"];
  let fabricRatio: number | null = null;
  let silkRatio: number | null = null;
  if (productType === "斑马帘" && marks.ratio) {
    // 发给国内前的布纱比（可能是工厂手改过的）原样带回
    [fabricRatio, silkRatio] = marks.ratio;
  } else if (productType === "斑马帘") {
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
  return {
    item: {
      location: r.location || r.code,
      width: r.widthIn,
      height: r.heightIn,
      fabricSku: r.sku,
      productType,
      measureType: (MEASURE_TYPES as readonly string[]).includes(measureType) ? measureType : "IN",
      controlType: (r.control === "电机" ? "电动" : r.control === "无绳" ? "无绳" : "普通") as BlindsItemDraft["controlType"],
      controlSide: marks.side ?? (r.side === "左" ? "L" : "R"),
      headrailType,
      mountType: marks.mount ?? (r.mount === "墙装" ? "墙装" : "顶装"),
      fabricRatio,
      silkRatio,
      bottomBarWidth: marks.bottomBar,
      itemRemark: marks.rest || null,
    },
    defaults,
  };
}

/** 自产行字段 ⇄ 国内下单字段（提示跟着行走时换算字段名与值） */
const NOTE_FIELD_TO_DOMESTIC: Record<string, { field: string; value: (v: MappingNote["value"]) => MappingNote["value"] }> = {
  headrailType: { field: "headrail", value: (v) => v },
  mountType: { field: "mount", value: (v) => v },
  measureType: { field: "measure", value: (v) => (v === "OUT" ? "外装" : v === "IN" ? "内装" : v) },
  controlSide: { field: "side", value: (v) => (v === "L" ? "左" : v === "R" ? "右" : v) },
};
const NOTE_FIELD_TO_BLINDS: Record<string, { field: string; value: (v: MappingNote["value"]) => MappingNote["value"] }> = {
  headrail: { field: "headrailType", value: (v) => v },
  mount: { field: "mountType", value: (v) => v },
  measure: { field: "measureType", value: (v) => (v === "外装" ? "OUT" : v === "内装" ? "IN" : v) },
  side: { field: "controlSide", value: (v) => (v === "左" ? "L" : v === "右" ? "R" : v) },
};

/** 被挪走行的提示跟到新段的新行号（只搬有对应字段的；布纱比等无对应列的丢弃，值已写进备注标记） */
function carryNotes(notes: MappingNote[], from: MappingNote["section"], to: MappingNote["section"], lineMap: Map<number, number>, fieldMap: typeof NOTE_FIELD_TO_DOMESTIC): MappingNote[] {
  return notes.flatMap((n) => {
    const line = n.section === from ? lineMap.get(n.line) : undefined;
    const f = fieldMap[n.field];
    return line && f ? [{ ...n, section: to, line, field: f.field, value: f.value(n.value), messageZh: n.messageZh }] : [];
  });
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
  items: (MovableItem | ReturnedItem)[];
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
    const movedTo = new Map<number, number>();
    items.forEach((it, i) => {
      if (ids.has(it.id)) {
        movedRows.push(itemToDomesticRow(it));
        movedTo.set(i + 1, spec.domestic.length + movedRows.length);
      } else keptIdx.push(i + 1);
    });
    const notes = [...renumberNotes(spec.notes, "blinds", keptIdx), ...carryNotes(spec.notes, "blinds", "domestic", movedTo, NOTE_FIELD_TO_DOMESTIC)];
    return {
      items: keptIdx.map((k) => items[k - 1]!),
      spec: { ...spec, domestic: [...spec.domestic, ...movedRows], notes },
      moved: movedRows.length,
    };
  }
  const lines = new Set(req.domesticLines);
  const keptIdx: number[] = [];
  const back: ReturnedItem[] = [];
  const newNotes: MappingNote[] = [];
  const backTo = new Map<number, number>();
  spec.domestic.forEach((r, i) => {
    if (lines.has(i + 1) && canReturnToInHouse(r)) {
      const { item, defaults } = domesticRowToItem(r, zebraRatios);
      const line = items.length + back.length + 1;
      backTo.set(i + 1, line);
      back.push(item);
      for (const d of defaults) newNotes.push({ section: "blinds", line, field: d.field, value: d.value, messageZh: d.messageZh });
    } else {
      keptIdx.push(i + 1);
    }
  });
  const carried = carryNotes(spec.notes, "domestic", "blinds", backTo, NOTE_FIELD_TO_BLINDS);
  const notes = [...renumberNotes(spec.notes, "domestic", keptIdx), ...carried, ...newNotes.filter((n) => !carried.some((c) => c.line === n.line && c.field === n.field))];
  return {
    items: [...items, ...back],
    spec: { ...spec, domestic: keptIdx.map((k) => spec.domestic[k - 1]!), notes },
    moved: back.length,
  };
}
