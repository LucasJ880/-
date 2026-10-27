/**
 * 已签字报价单 Order Form（SalesQuote.formDataJson）→ 工艺单输入。
 *
 * 口径（2026-10-27 Lucas 拍板 + design D6）：
 *   Lift L/R → 普通拉绳（拉杆位置 L/R），Lift M → 电动（拉杆位置默认 R，提示）
 *   Mount I/O → IN/OUT；Bracket C/W → 顶装/墙装（行内空时取单头 Brackets Type，再空默认顶装，提示）
 *   Valance Cassette → 亮白插片圆盒、Fascia → 哑白方型罩盒、None → 单轨无盒（均提示，草稿可改）
 *   斑马帘布纱比默认 3:2（提示）
 *   窗帘：Pleat P → 韩褶P、R → 蛇型R、G → 无模板（阻断）；Fullness 180/230 → 1.8/2.3；Panels S/D → 1/2；
 *         Bracket C/W → 顶装C/墙装W；杆型 同行布+纱 → 方双轨、否则方单轨（提示）；版本默认 6cm
 *   Vinyl：百叶 2-1/2" → 2.5、3-1/2" → 3.5、其余阻断；外框 L/Z 直映，其余留空（阻断）；外框数 4；有框；
 *          开合编码由 Open Dir + 扇数推导（提示）；Mid Rail 能解析成正数 → 第一档底部(in)
 *   Wooden 百叶 → 无模板（阻断）
 * 纯函数，不做 I/O；所有默认推导写 MappingNote。
 */

import { DEFAULT_ZEBRA_RATIO } from "@/lib/blinds/deduction-rules";
import { DEFAULT_DRAPE_VERSION } from "./drapes-engine";
import {
  PROCESS_SPEC_SCHEMA,
  type DomesticSpecRow,
  type DrapeSpecRow,
  type MappingNote,
  type ProcessSpec,
  type UnsupportedLine,
  type VinylSpecWindow,
} from "./process-spec";

/** Blinds 自产行（落 BlindsOrderItem，计算由 calculateItem 完成） */
export interface BlindsItemDraft {
  location: string;
  width: number;
  height: number;
  fabricSku: string;
  productType: "卷帘" | "斑马帘" | "香格里拉";
  measureType: "IN" | "OUT";
  controlType: "普通" | "电动";
  controlSide: "L" | "R";
  headrailType: string;
  mountType: "顶装" | "墙装";
  fabricRatio: number | null;
  silkRatio: number | null;
  itemRemark: string | null;
}

export interface QuoteMappingResult {
  blindsItems: BlindsItemDraft[];
  spec: Omit<ProcessSpec, "version" | "source">;
  /** 有任一可生产行（含无模板行，它们也需要工厂处理） */
  producible: boolean;
}

// ── formDataJson 的结构化读取（只读用到的字段，类型不可信）──

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/**
 * 整数英寸 + 1/16 分数 → 小数英寸（与报价单 fractionToInches 同口径）；
 * 整数部分为空视为未填（与报价单计价循环 `!l.widthWhole → continue` 一致）
 */
export function inchesOf(whole: unknown, frac: unknown): number {
  if (s(whole) === "") return 0;
  const w = Number.parseFloat(s(whole));
  const f = Number.parseFloat(s(frac));
  return (Number.isFinite(w) ? w : 0) + (Number.isFinite(f) ? f : 0) / 16;
}

const IN_HOUSE: Record<string, BlindsItemDraft["productType"]> = {
  Zebra: "斑马帘",
  Roller: "卷帘",
  SHANGRILA: "香格里拉",
};

const DOMESTIC_PRODUCT: Record<string, string> = {
  "Cordless Cellular": "蜂窝帘",
  SkylightHoneycomb: "蜂窝帘",
  Allusion: "梦幻帘",
  Roman: "罗马帘",
  "Roman Shade": "罗马帘",
};

export const VALANCE_TO_HEADRAIL: Record<string, string> = {
  Cassette: "亮白插片圆盒",
  Fascia: "哑白方型罩盒",
  None: "单轨无盒",
};

function headrailFor(valance: string, product: string): { value: string; noteZh: string } {
  const v = valance.trim();
  if (VALANCE_TO_HEADRAIL[v]) {
    return { value: VALANCE_TO_HEADRAIL[v]!, noteZh: `罩盒按默认映射：Valance ${v} → ${VALANCE_TO_HEADRAIL[v]}，请核对颜色/型号` };
  }
  if (product === "Roller") return { value: "单轨无盒", noteZh: "报价未填 Valance，卷帘按 None → 单轨无盒，请核对" };
  return { value: "亮白插片圆盒", noteZh: "报价未填 Valance，按 Cassette → 亮白插片圆盒，请核对" };
}

function bracketOf(lineBracket: string, formBracket: string): { c: boolean; noteZh: string | null } {
  if (lineBracket === "C") return { c: true, noteZh: null };
  if (lineBracket === "W") return { c: false, noteZh: null };
  if (formBracket === "Ceiling") return { c: true, noteZh: null };
  if (formBracket === "Wall") return { c: false, noteZh: null };
  return { c: true, noteZh: "报价未填 Bracket，默认顶装，请核对" };
}

/** 开合编码推导：L → 全 L；R → 全 R；LR → 前 ⌈n/2⌉ 个 L、其余 R */
export function deriveOpenCode(dir: string, panels: number): string {
  const n = Math.max(0, Math.trunc(panels));
  if (n === 0) return "";
  if (dir === "L") return "L".repeat(n);
  if (dir === "R") return "R".repeat(n);
  if (dir === "LR") {
    const left = Math.ceil(n / 2);
    return "L".repeat(left) + "R".repeat(n - left);
  }
  return "";
}

function louverOf(raw: string): number | null {
  const v = raw.replace(/\s/g, "");
  if (v === '2-1/2"' || v === "2.5" || v === '2.5"') return 2.5;
  if (v === '3-1/2"' || v === "3.5" || v === '3.5"') return 3.5;
  return null;
}

function midRailInches(raw: string): number | null {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/16)?\s*(?:"|in|inch)?$/i);
  if (!m) return null;
  const v = Number(m[1]) + (m[2] ? Number(m[2]) / 16 : 0);
  return v > 0 ? v : null;
}

export function mapQuoteFormToProcessOrder(formDataJson: string | null | undefined): QuoteMappingResult {
  let form: Obj = {};
  try {
    form = obj(formDataJson ? JSON.parse(formDataJson) : {});
  } catch {
    form = {};
  }
  const notes: MappingNote[] = [];
  const blindsItems: BlindsItemDraft[] = [];
  const domestic: DomesticSpecRow[] = [];
  const drapes: DrapeSpecRow[] = [];
  const vinyl: VinylSpecWindow[] = [];
  const unsupported: UnsupportedLine[] = [];
  const formValance = s(form.shadeValanceType);
  const formBracket = s(form.shadeBracketType);

  // ── Shades ──
  for (const l of list(form.shadeOrders)) {
    const product = s(l.product);
    const width = inchesOf(l.widthWhole, l.widthFrac);
    const height = inchesOf(l.heightWhole, l.heightFrac);
    if (!product || !(width > 0) || !(height > 0)) continue;
    const location = s(l.location);
    const lift = s(l.lift);
    const mount = s(l.mount);
    const bracket = bracketOf(s(l.bracket), formBracket);
    const valance = s(l.valance) || formValance;
    const noteText = s(l.note);

    if (IN_HOUSE[product]) {
      const line = blindsItems.length + 1;
      const add = (field: string, value: string | number | null, messageZh: string) => notes.push({ section: "blinds", line, field, value, messageZh });
      const pt = IN_HOUSE[product]!;
      const measureType = mount === "O" ? "OUT" : "IN";
      if (mount !== "I" && mount !== "O") add("measureType", measureType, "报价未填 Mount（I/O），默认 IN，请核对");
      const motor = lift === "M";
      const controlType = motor ? "电动" : "普通";
      const controlSide = lift === "L" ? "L" : "R";
      if (motor) add("controlSide", controlSide, "电机侧默认 R，请核对");
      else if (lift !== "L" && lift !== "R") add("controlSide", controlSide, "报价未填 Lift，默认普通拉绳、拉杆位置 R，请核对");
      const hr = headrailFor(valance, product);
      add("headrailType", hr.value, hr.noteZh);
      if (bracket.noteZh) add("mountType", "顶装", bracket.noteZh);
      let fabricRatio: number | null = null;
      let silkRatio: number | null = null;
      if (pt === "斑马帘") {
        fabricRatio = DEFAULT_ZEBRA_RATIO.fabric;
        silkRatio = DEFAULT_ZEBRA_RATIO.silk;
        add("fabricRatio", fabricRatio, "斑马帘布纱比默认 3:2，请按面料核对（影响裁剪位）");
      }
      blindsItems.push({
        location, width, height, fabricSku: s(l.sku), productType: pt, measureType, controlType, controlSide,
        headrailType: hr.value, mountType: bracket.c ? "顶装" : "墙装", fabricRatio, silkRatio,
        itemRemark: noteText || null,
      });
      continue;
    }

    const dp = DOMESTIC_PRODUCT[product];
    if (!dp) {
      unsupported.push({ section: "shade", location, widthIn: width, heightIn: height, reasonZh: `产品 ${product} 没有工艺模板` });
      continue;
    }
    const line = domestic.length + 1;
    const add = (field: string, value: string | number | null, messageZh: string) => notes.push({ section: "domestic", line, field, value, messageZh });
    const control = product === "Cordless Cellular" ? "无绳" : lift === "M" ? "电机" : "普通";
    if (product !== "Cordless Cellular" && lift !== "L" && lift !== "R" && lift !== "M") add("control", control, "报价未填 Lift，默认普通，请核对");
    const measure = mount === "O" ? "外装" : "内装";
    if (mount !== "I" && mount !== "O") add("measure", measure, "报价未填 Mount（I/O），默认内装，请核对");
    if (bracket.noteZh) add("mount", "顶装", bracket.noteZh);
    if (dp === "罗马帘") add("productType", dp, "原件国内下单表下拉没有罗马帘，按罗马帘下单，请与供应商确认");
    domestic.push({
      location, code: location, widthIn: width, heightIn: height, productType: dp, sku: s(l.sku), measure, control,
      side: lift === "L" ? "左" : lift === "R" ? "右" : "无", headrail: "", mount: bracket.c ? "顶装" : "墙装",
      remark: [product === "SkylightHoneycomb" ? "天窗蜂窝帘" : "", noteText].filter(Boolean).join("；"),
      quoteProduct: product,
    });
  }

  // ── Shutters ──
  const material = s(form.shutterMaterial) || "Vinyl";
  const louverQuote = s(form.shutterLouverSize);
  const louver = louverOf(louverQuote);
  const shutterLines = list(form.shutterOrders)
    .map((l) => ({ l, width: inchesOf(l.widthWhole, l.widthFrac), height: inchesOf(l.heightWhole, l.heightFrac) }))
    .filter((x) => x.width > 0 && x.height > 0);
  for (const { l, width, height } of shutterLines) {
    const location = s(l.location);
    if (material === "Wooden") {
      unsupported.push({ section: "shutter", location, widthIn: width, heightIn: height, reasonZh: "Wooden（实木）百叶没有工艺模板" });
      continue;
    }
    const line = vinyl.length + 1;
    const add = (field: string, value: string | number | null, messageZh: string) => notes.push({ section: "vinyl", line, field, value, messageZh });
    const panels = Math.max(0, Math.trunc(Number(l.panelCount) || 0));
    const dir = s(l.openDirection);
    const openCode = deriveOpenCode(dir, panels);
    if (openCode) add("openCode", openCode, `开合编码由 Open Dir ${dir} + ${panels} 扇推导为 ${openCode}，请核对（含 T 柱时需改）`);
    const qFrame = s(l.frame);
    const frame = qFrame === "L" || qFrame === "Z" ? qFrame : "";
    const midRailRaw = s(l.midRail);
    const rail1In = midRailRaw ? midRailInches(midRailRaw) : null;
    if (midRailRaw && rail1In === null) add("rail1In", null, `Mid Rail「${midRailRaw}」不是英寸数值，请填第一档底部高度或比例`);
    const qMount = s(l.mountType);
    const inOut = qMount === "O" ? "OUT" : "IN";
    if (qMount !== "I" && qMount !== "O") add("inOut", inOut, "报价未填 Mount（I/O），默认 IN，请核对");
    add("frameCount", 4, "外框数默认 4，请核对（3+1 需改）");
    vinyl.push({
      location, width, height, panels, openCode, posts: "", rail1In, rail1Ratio: null, rod: "", split: "不切分",
      frame, frameCount: 4, inOut, structure: "有框", rail2In: null,
      quoteFrame: qFrame, quoteOpenDirection: dir, quoteMidRail: midRailRaw,
    });
  }
  if (vinyl.length > 0) {
    notes.push({ section: "order", line: 0, field: "vinyl.color", value: "白色", messageZh: "Vinyl 颜色默认白色，请核对" });
  }

  // ── Drapes ──
  for (const l of list(form.drapeOrders)) {
    const location = s(l.location);
    const hasDrape = !!s(l.drapeFabricSku) && inchesOf(l.drapeWidthWhole, l.drapeWidthFrac) > 0 && inchesOf(l.drapeHeightWhole, l.drapeHeightFrac) > 0;
    const hasSheer = !!s(l.sheerFabricSku) && inchesOf(l.sheerWidthWhole, l.sheerWidthFrac) > 0 && inchesOf(l.sheerHeightWhole, l.sheerHeightFrac) > 0;
    const rod = hasDrape && hasSheer ? "方双轨" : "方单轨";
    const parts: { part: "drape" | "sheer"; p: string }[] = [];
    if (hasDrape) parts.push({ part: "drape", p: "drape" });
    if (hasSheer) parts.push({ part: "sheer", p: "sheer" });
    for (const { part, p } of parts) {
      const widthIn = inchesOf(l[`${p}WidthWhole`], l[`${p}WidthFrac`]);
      const heightIn = inchesOf(l[`${p}HeightWhole`], l[`${p}HeightFrac`]);
      const pleat = s(l[`${p}PleatStyle`]);
      if (pleat === "G") {
        unsupported.push({ section: "drape", location, widthIn, heightIn, reasonZh: `${part === "drape" ? "布帘" : "纱帘"} Grommet（打孔）工艺没有模板` });
        continue;
      }
      const line = drapes.length + 1;
      const add = (field: string, value: string | number | null, messageZh: string) => notes.push({ section: "drapes", line, field, value, messageZh });
      const craft = pleat === "P" ? "韩褶P" : pleat === "R" ? "蛇型R" : "";
      const bracket = s(l[`${p}Bracket`]);
      const mount = bracket === "C" ? "顶装C" : "墙装W";
      if (bracket !== "C" && bracket !== "W") add("mount", mount, "报价未填 Bracket，默认墙装W，请核对");
      if (mount === "墙装W") add("rod", rod, `杆型按默认：${rod}，请核对`);
      const fullnessRaw = s(l[`${p}Fullness`]);
      const fullness = (Number.parseInt(fullnessRaw, 10) || 180) / 100;
      drapes.push({
        location, part, widthIn, heightIn, sku: s(l[`${p}FabricSku`]), qty: s(l[`${p}Panels`]) === "D" ? 2 : 1,
        craft, layer: part === "drape" ? "布" : "纱", liner: part === "drape" && l.drapeLiner === true ? "是" : "否",
        fullness, mount, rod: mount === "墙装W" ? rod : "", rodColor: "",
      });
    }
  }

  const producible = blindsItems.length + domestic.length + drapes.length + vinyl.length + unsupported.length > 0;
  return {
    blindsItems,
    producible,
    spec: {
      schema: PROCESS_SPEC_SCHEMA,
      settings: {
        drapeVersion: DEFAULT_DRAPE_VERSION,
        vinyl: { louver: vinyl.length > 0 ? louver : 3.5, louverQuote, color: "白色", defaultRod: "" },
      },
      domestic,
      drapes,
      vinyl,
      unsupported,
      notes,
    },
  };
}
