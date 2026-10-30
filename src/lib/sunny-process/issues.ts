/**
 * 待核对清单：由"当前参数 + 引擎校验"在读取时重新计算（design D6），
 * 工厂改对参数后阻断项自动消失；映射默认值的提示在当前值仍等于默认值时显示。
 */

import { CONTROL_TYPES, HEADRAIL_TYPES, MEASURE_TYPES, PRODUCT_TYPES } from "@/lib/blinds/deduction-rules";
import { DRAPE_CRAFTS, DRAPE_MOUNTS } from "./drapes-calc";
import type { ProcessSpec } from "./process-spec";
import { SPLIT_ERROR_ZH, computeVinylWindow, type VinylHeader } from "./vinyl-calc";

export type IssueLevel = "info" | "block";
export type IssueSection = "blinds" | "domestic" | "drapes" | "vinyl" | "purchase" | "order";

export interface ProcessIssue {
  level: IssueLevel;
  section: IssueSection;
  /** 段内行号（1 起）；订单级为 0 */
  line: number;
  field: string;
  messageZh: string;
}

export const SECTION_LABEL_ZH: Record<IssueSection, string> = {
  blinds: "Blinds 自产",
  domestic: "国内下单",
  drapes: "窗帘",
  vinyl: "Vinyl 百叶",
  purchase: "外采购",
  order: "订单",
};

/** BlindsOrderItem 里参与校验的字段 */
export interface BlindsItemLike {
  itemNumber?: number;
  width: number;
  height: number;
  productType: string;
  measureType: string;
  controlType: string;
  controlSide: string;
  headrailType: string;
  mountType: string;
  fabricRatio: number | null;
  silkRatio: number | null;
}

export function vinylHeaderOf(spec: ProcessSpec, orderNo: string): VinylHeader {
  return {
    orderNo,
    louver: spec.settings.vinyl.louver ?? 3.5,
    color: spec.settings.vinyl.color,
    defaultRod: spec.settings.vinyl.defaultRod,
  };
}

const POSTS_RE = /^[1-4][TH]$/;

export function computeIssues(items: BlindsItemLike[], spec: ProcessSpec, orderNo = ""): ProcessIssue[] {
  const out: ProcessIssue[] = [];
  const block = (section: IssueSection, line: number, field: string, messageZh: string) => out.push({ level: "block", section, line, field, messageZh });

  // 映射默认值提示
  for (const n of spec.notes) {
    let current: unknown;
    if (n.section === "blinds") current = (items[n.line - 1] as unknown as Record<string, unknown> | undefined)?.[n.field];
    else if (n.section === "order") current = n.field === "vinyl.color" ? spec.settings.vinyl.color : n.value;
    else current = (spec[n.section][n.line - 1] as unknown as Record<string, unknown> | undefined)?.[n.field];
    if (current === n.value || (current == null && n.value == null)) {
      out.push({ level: "info", section: n.section, line: n.line, field: n.field, messageZh: n.messageZh });
    }
  }

  if (items.length + spec.domestic.length + spec.drapes.length + spec.vinyl.length + spec.purchase.length === 0) {
    block("order", 0, "lines", "工艺单没有任何行");
  }

  items.forEach((it, i) => {
    const line = i + 1;
    if (!(it.width > 0) || !(it.height > 0)) block("blinds", line, "size", "宽或高无效");
    if (!(PRODUCT_TYPES as readonly string[]).includes(it.productType)) block("blinds", line, "productType", `产品类型「${it.productType}」不是卷帘/斑马帘/香格里拉`);
    if (!(CONTROL_TYPES as readonly string[]).includes(it.controlType)) block("blinds", line, "controlType", `操控方式「${it.controlType}」无减尺表`);
    if (!(HEADRAIL_TYPES as readonly string[]).includes(it.headrailType)) block("blinds", line, "headrailType", `罩盒类型「${it.headrailType}」无减尺表`);
    if (!(MEASURE_TYPES as readonly string[]).includes(it.measureType)) block("blinds", line, "measureType", `测量方式「${it.measureType}」无效`);
    if (it.productType === "斑马帘" && (!(Number(it.fabricRatio) > 0) || !(Number(it.silkRatio) > 0))) {
      block("blinds", line, "fabricRatio", "斑马帘缺布纱比，无法计算裁剪位");
    }
  });

  spec.domestic.forEach((r, i) => {
    const line = i + 1;
    if (!(r.widthIn > 0) || !(r.heightIn > 0)) block("domestic", line, "size", "宽或高无效");
    if (!r.productType) block("domestic", line, "productType", "缺产品类型");
  });

  spec.drapes.forEach((r, i) => {
    const line = i + 1;
    if (!(r.widthIn > 0) || !(r.heightIn > 0)) block("drapes", line, "size", "宽或高无效");
    if (!(DRAPE_CRAFTS as readonly string[]).includes(r.craft)) block("drapes", line, "craft", "未选工艺（韩褶P / 蛇型R）");
    if (!(r.qty >= 1)) block("drapes", line, "qty", "数量至少 1 扇");
    if (!(r.fullness > 0)) block("drapes", line, "fullness", "褶皱倍数无效");
    if (!(DRAPE_MOUNTS as readonly string[]).includes(r.mount)) block("drapes", line, "mount", "未选安装方式（顶装C / 墙装W）");
    if (r.mount === "墙装W" && !r.rod) block("drapes", line, "rod", "墙装缺杆子类型（影响成品高扣减）");
  });

  if (spec.vinyl.length > 0) {
    if (spec.settings.vinyl.louver === null) {
      block("order", 0, "vinyl.louver", `百叶尺寸「${spec.settings.vinyl.louverQuote || "未选"}」原件不支持（仅 2.5" / 3.5"）`);
    }
    const header = vinylHeaderOf(spec, orderNo);
    spec.vinyl.forEach((w, i) => {
      const line = i + 1;
      if (!(w.width > 0) || !(w.height > 0)) block("vinyl", line, "size", "尺寸无效");
      if (!(w.panels >= 1 && w.panels <= 9 && Number.isInteger(w.panels))) block("vinyl", line, "panels", "扇数须为 1–9");
      const letters = w.openCode.replace(/[TIH\s]/gi, "");
      if (letters.length !== w.panels || /[^LR]/i.test(letters)) block("vinyl", line, "openCode", "扇数/开合不匹配");
      if (w.posts && !POSTS_RE.test(w.posts)) block("vinyl", line, "posts", "分隔柱格式应为 1T…4T / 1H…4H");
      if (w.structure !== "无框" && !w.frame) block("vinyl", line, "frame", "缺外框类型");
      const r = computeVinylWindow(w, header);
      if (w.structure !== "无框" && w.frame && !r.frameSupported) {
        block("vinyl", line, "frame", `外框组合 ${w.frame}/${w.inOut}/${w.frameCount} 不受支持（原件仅 L-IN-4、L-OUT-4、Z/T-IN-4、Z/T-IN-3+1、Door-OUT-4、Door-OUT-3+1）`);
      }
      if (r.splitError === true) block("vinyl", line, "split", SPLIT_ERROR_ZH);
      if (w.rail2In && (Number.isNaN(r.rail2) || Number.isNaN(r.louverMiddle))) {
        block("vinyl", line, "rail2In", "双中分档输入错误：检查第一、第二档位置及各段高度");
      } else if (r.splitError === null || [r.pitch, r.louverTotal, r.rodUpper, r.rodLower].some((x) => Number.isNaN(x))) {
        block("vinyl", line, "calc", "百叶片数 / 孔距计算出错，请检查中分档与切分输入");
      }
      if (r.openKey === 0 && w.openCode) out.push({ level: "info", section: "vinyl", line, field: "openCode", messageZh: `开启代码：原件未定义 ${w.openCode} 的开启代码` });
    });
  }

  // 外采购行按销售填写原样下单，不阻断；只提示一次
  if (spec.purchase.length > 0) {
    out.push({ level: "info", section: "purchase", line: 0, field: "purchase", messageZh: `${spec.purchase.length} 行走外采购（按销售填写原样生成，不做工艺计算），请外采购按「外采购单」下单` });
  }
  spec.purchase.forEach((p, i) => {
    if (!(p.widthIn > 0) || !(p.heightIn > 0)) block("purchase", i + 1, "size", "宽或高无效");
  });

  return out;
}

/**
 * 可进下料总表 / 标签的 Vinyl 窗号（1 起）：该窗无阻断，且订单级百叶尺寸受支持。
 * 有阻断的窗原件也只会算出 0 / 负数 / 错误，不能交给工厂下料。
 */
export function cuttableVinylLines(spec: ProcessSpec, issues: ProcessIssue[]): Set<number> {
  const out = new Set<number>();
  if (issues.some((i) => i.level === "block" && i.section === "order" && i.field === "vinyl.louver")) return out;
  const blocked = new Set(issues.filter((i) => i.level === "block" && i.section === "vinyl").map((i) => i.line));
  spec.vinyl.forEach((_, k) => { if (!blocked.has(k + 1)) out.add(k + 1); });
  return out;
}

export function blockingIssues(issues: ProcessIssue[]): ProcessIssue[] {
  return issues.filter((i) => i.level === "block");
}
