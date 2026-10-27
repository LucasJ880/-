/**
 * 从 SalesQuote.formDataJson（QuoteFormState 序列化）里取出工艺单需要的那部分。
 *
 * 纪律：
 *   - lib 层不从 app 目录 import 类型（沿用 quote-agreed-payment 的做法），
 *     这里自己声明一份**窄**结构，只声明真正用到的字段；
 *   - 全程防御式解析：报价单是历史数据，字段可能缺、可能是空串、可能类型不对，
 *     解析失败一律返回空快照，绝不抛异常打断签名主流程。
 */

/** 报价单 Shutters 行（对应 QuoteFormState.shutterOrders 的一项） */
export interface QuoteShutterLine {
  location: string;
  /** 16 分制合并后的英寸；0 表示没填 */
  widthIn: number;
  heightIn: number;
  /** 外框：报价端取值 L / Z / S / G / M / Casing / 空 */
  frame: string;
  /** 开启方向：报价端取值 L / R / LR / 空 */
  openDirection: string;
  /** 安装：报价端取值 I / O / 空 */
  mountType: string;
  /** 分隔档：自由文本 */
  midRail: string;
  panelCount: number | null;
  /** 备注/草图栏 */
  draft: string;
}

/** 报价单 Shades 行（对应 QuoteFormState.shadeOrders 的一项） */
export interface QuoteShadeLine {
  location: string;
  widthIn: number;
  heightIn: number;
  /** 产品：Zebra / Roller / SHANGRILA / Cordless Cellular / SkylightHoneycomb / Allusion / Roman */
  product: string;
  sku: string;
  /** 安装：I / O / 空 */
  mount: string;
  /** L=拉绳左 R=拉绳右 M=电动 C=无绳 */
  lift: string;
  /** C=顶装 W=侧装 */
  bracket: string;
  /** 罩盒：2026-08-29 起存工艺引擎的 HeadrailType 枚举；历史单可能是自由文本 */
  valance: string;
  note: string;
}

export interface QuoteFormSnapshot {
  /** 是否成功解析出内容 */
  ok: boolean;
  /** 订单级：Wooden / Vinyl */
  shutterMaterial: string;
  /** 订单级：报价端取值 2-1/2" / 3-1/2" / 4-1/2" / Arch */
  shutterLouverSize: string;
  shutterOrders: QuoteShutterLine[];
  shadeOrders: QuoteShadeLine[];
  /** Drapery/Sheer 无工艺引擎，只登记存在性 */
  drapeOrderCount: number;
}

const EMPTY: QuoteFormSnapshot = {
  ok: false,
  shutterMaterial: "",
  shutterLouverSize: "",
  shutterOrders: [],
  shadeOrders: [],
  drapeOrderCount: 0,
};

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** 报价单一律 16 分制：整数英寸 + 十六分之几 */
export function fractionToInches(whole: unknown, frac: unknown): number {
  return num(whole) + num(frac) / 16;
}

function parseShutterLine(raw: unknown): QuoteShutterLine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const panelCountRaw = o.panelCount;
  const panelCount =
    panelCountRaw === null || panelCountRaw === undefined || panelCountRaw === ""
      ? null
      : Math.trunc(num(panelCountRaw)) || null;

  return {
    location: str(o.location),
    widthIn: fractionToInches(o.widthWhole, o.widthFrac),
    heightIn: fractionToInches(o.heightWhole, o.heightFrac),
    frame: str(o.frame),
    openDirection: str(o.openDirection).toUpperCase(),
    mountType: str(o.mountType).toUpperCase(),
    midRail: str(o.midRail),
    panelCount,
    draft: str(o.draft),
  };
}

function parseShadeLine(raw: unknown): QuoteShadeLine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    location: str(o.location),
    widthIn: fractionToInches(o.widthWhole, o.widthFrac),
    heightIn: fractionToInches(o.heightWhole, o.heightFrac),
    product: str(o.product),
    sku: str(o.sku),
    mount: str(o.mount).toUpperCase(),
    lift: str(o.lift).toUpperCase(),
    bracket: str(o.bracket).toUpperCase(),
    valance: str(o.valance),
    note: str(o.note),
  };
}

export function parseQuoteFormSnapshot(
  formDataJson: string | null | undefined,
): QuoteFormSnapshot {
  if (!formDataJson || typeof formDataJson !== "string") return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(formDataJson);
  } catch {
    return EMPTY;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY;

  const o = parsed as Record<string, unknown>;
  const rawShutters = Array.isArray(o.shutterOrders) ? o.shutterOrders : [];
  const rawShades = Array.isArray(o.shadeOrders) ? o.shadeOrders : [];

  return {
    ok: true,
    shutterMaterial: str(o.shutterMaterial),
    shutterLouverSize: str(o.shutterLouverSize),
    shutterOrders: rawShutters
      .map(parseShutterLine)
      .filter((l): l is QuoteShutterLine => l !== null)
      // 报价端保存时已过滤空行，这里再兜一层：位置和尺寸全空的不算一扇窗
      .filter((l) => l.location || l.widthIn > 0 || l.heightIn > 0),
    shadeOrders: rawShades
      .map(parseShadeLine)
      .filter((l): l is QuoteShadeLine => l !== null)
      .filter((l) => l.location || l.sku || l.widthIn > 0),
    drapeOrderCount: Array.isArray(o.drapeOrders) ? o.drapeOrders.length : 0,
  };
}
