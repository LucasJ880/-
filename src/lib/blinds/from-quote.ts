/**
 * 报价单 Shades 行 → Blinds 工艺单行
 *
 * 与 Vinyl 侧同一套三级口径（auto / default / todo），见 src/lib/vinyl/from-quote.ts。
 *
 * 报价端两个关键工艺字段：
 *   Lift 列   → 加了 C（无绳），L/R=拉绳 M=电动 C=无绳
 *   Valance 列 → #191（2026-09-03）起是**定价档位** None / Cassette / Fascia，
 *                粒度比工艺的 8 种罩盒（HeadrailType）粗，且两者没有确定的对应关系，
 *                所以桥不猜：只有恰好存的是引擎枚举时才直通，其余一律落 todo 由工厂补。
 * 历史报价单缺这些项时同样如实落到 todo。
 */

import type { ItemInput } from "./calculation-engine";
import { isHeadrailType } from "./headrail-labels";
import type { WorkOrderNote } from "@/lib/vinyl/from-quote";
import type { QuoteShadeLine } from "@/lib/work-orders/quote-form-snapshot";

/** 报价端产品 → 工艺引擎产品类型；null = 无减尺规则 */
export function mapProductType(product: string): string | null {
  switch (String(product || "").trim()) {
    case "Zebra":
      return "斑马帘";
    case "Roller":
      return "卷帘";
    case "SHANGRILA":
      return "香格里拉";
    // Cordless Cellular / SkylightHoneycomb / Allusion / Roman：引擎无减尺规则
    default:
      return null;
  }
}

/**
 * Lift 一列同时承载「操控方式」与「拉杆位置」两个工艺概念：
 *   L → (普通, 左)   R → (普通, 右)   M → (电动, 无侧)   C → (无绳, 无侧)
 * 无绳/电动没有拉杆侧，controlSide 留空而不是塞个默认的 R —— 那会让工厂以为有绳在右边。
 */
export function mapLift(
  lift: string,
): { controlType: string; controlSide: string } | null {
  switch (String(lift || "").trim().toUpperCase()) {
    case "L":
      return { controlType: "普通", controlSide: "L" };
    case "R":
      return { controlType: "普通", controlSide: "R" };
    case "M":
      return { controlType: "电动", controlSide: "M" };
    case "C":
      return { controlType: "无绳", controlSide: "" };
    default:
      return null;
  }
}

/** C=Ceiling→顶装，W=Wall→侧装 */
export function mapBracket(bracket: string): string | null {
  const b = String(bracket || "").trim().toUpperCase();
  if (b === "C") return "顶装";
  if (b === "W") return "侧装";
  return null;
}

/** I=Inside→IN，O=Outside→OUT（工艺侧还有 Tight，报价端无此选项） */
export function mapMount(mount: string): string | null {
  const m = String(mount || "").trim().toUpperCase();
  if (m === "I" || m === "IN") return "IN";
  if (m === "O" || m === "OUT") return "OUT";
  return null;
}

export interface BlindsLineMapping {
  input: ItemInput & { location: string; fabricSku: string; controlSide: string; mountType: string };
  notes: WorkOrderNote[];
}

export function mapShadeLineToBlinds(
  line: QuoteShadeLine,
  itemNumber: number,
): BlindsLineMapping {
  const notes: WorkOrderNote[] = [];
  const at = (msg: string) => `#${itemNumber} ${line.location || "(未命名)"}: ${msg}`;

  // ── productType ──
  const productType = mapProductType(line.product);
  if (!productType) {
    notes.push({
      code: "UNSUPPORTED_PRODUCT",
      message: at(
        line.product
          ? `产品「${line.product}」暂无工艺减尺规则（仅 Zebra / Roller / SHANGRILA），需人工确认`
          : "报价单未选产品",
      ),
      kind: "todo",
    });
  }

  // ── headrailType：仅当 Valance 恰好是引擎枚举时直通（见文件头） ──
  const headrailType = isHeadrailType(line.valance) ? line.valance : null;
  if (!headrailType) {
    notes.push({
      code: "MISSING_HEADRAIL",
      message: at(
        line.valance
          ? `报价单 Valance 为「${line.valance}」（定价档位），具体是 8 种罩盒中的哪一种需工厂补，全部减尺依赖它`
          : "报价单未选罩盒（Valance 列），全部减尺依赖它，必须补",
      ),
      kind: "todo",
    });
  }

  // ── controlType / controlSide ──
  const lift = mapLift(line.lift);
  if (!lift) {
    notes.push({
      code: "MISSING_LIFT",
      message: at("报价单未选 Lift，无法确定操控方式（拉绳/电动/无绳）"),
      kind: "todo",
    });
  }

  // ── measureType ──
  const measureType = mapMount(line.mount);
  if (!measureType) {
    notes.push({
      code: "MISSING_MEASURE_TYPE",
      message: at("报价单未选内外装，暂按 IN 处理"),
      kind: "default",
    });
  }

  // ── mountType ──
  const mountType = mapBracket(line.bracket);
  if (!mountType) {
    notes.push({
      code: "MISSING_MOUNT_TYPE",
      message: at("报价单未选 Bracket，安装方式暂按顶装处理"),
      kind: "default",
    });
  }

  if (!line.sku) {
    notes.push({ code: "MISSING_SKU", message: at("面料货号未填"), kind: "todo" });
  }

  return {
    input: {
      location: line.location,
      width: line.widthIn,
      height: line.heightIn,
      fabricSku: line.sku,
      productType: productType ?? "",
      measureType: measureType ?? "IN",
      controlType: lift?.controlType ?? "",
      controlSide: lift?.controlSide ?? "",
      headrailType: headrailType ?? "",
      mountType: mountType ?? "顶装",
      // 布纱比交给引擎按 fabricSku 查目录；查不到会体现在 ratioSource
      fabricRatio: null,
      silkRatio: null,
      bottomBarWidth: null,
    },
    notes,
  };
}
