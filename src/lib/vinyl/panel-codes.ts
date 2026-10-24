/**
 * Vinyl 百叶窗「开启状态」编码表
 * 来源: 工艺单!G3 —— 把方向码（L / LR / LLRR / LTLTR …）映射成 "条/盖" 两个数
 *
 * 原表是一串 8~9 层嵌套 IF，2.5" 和 3.5" 各一套（3.5" 是 2.5" 的超集）。
 * Lucas 明确说这张表**还会继续加码**，所以做成数据表 + 运行时覆盖：
 *
 *   1. DEFAULT_PANEL_CODES —— 誊录自 V15，改表时对着改这里；
 *   2. resolvePanelSpec(code, louverSize, overrides) —— overrides 由调用方
 *      从组织配置里读，无需改代码即可加新码；
 *   3. 查不到就是查不到（返回 null），**不猜**。原表 else 分支给 0，
 *      会静默算出 条=0 盖=0 的物料，比空着更危险。
 */

export interface PanelSpec {
  /** LEFT(G3,1) —— 条（LIGHT BLOCK 盖条）数量 */
  strips: number;
  /** RIGHT(G3,1) —— 盖数量 */
  caps: number;
}

/** 一条编码定义：某个方向码在某个百叶尺寸下对应的 条/盖 */
export interface PanelCodeRule extends PanelSpec {
  code: string;
  /** 适用的百叶尺寸；null = 两种尺寸都适用 */
  louverSize: number | null;
}

/**
 * V15 誊录。
 * 2.5" 与 3.5" 共有的放 louverSize=null；只有 3.5" 有的单列（原表 2.5" 分支缺这几条）。
 */
export const DEFAULT_PANEL_CODES: readonly PanelCodeRule[] = [
  // "1/1"
  { code: "L", louverSize: null, strips: 1, caps: 1 },
  { code: "R", louverSize: null, strips: 1, caps: 1 },
  { code: "TL", louverSize: null, strips: 1, caps: 1 },
  { code: "TR", louverSize: null, strips: 1, caps: 1 },
  { code: "TRT", louverSize: null, strips: 1, caps: 1 },
  { code: "RT", louverSize: null, strips: 1, caps: 1 },
  { code: "LT", louverSize: 3.5, strips: 1, caps: 1 }, // 2.5" 分支里没有 LT
  // "3/1"
  { code: "LR", louverSize: null, strips: 3, caps: 1 },
  { code: "TLRT", louverSize: null, strips: 3, caps: 1 },
  // "4/2"
  { code: "LRTR", louverSize: null, strips: 4, caps: 2 },
  { code: "LLR", louverSize: null, strips: 4, caps: 2 },
  { code: "LIR", louverSize: null, strips: 4, caps: 2 },
  { code: "LTLR", louverSize: 3.5, strips: 4, caps: 2 }, // 仅 3.5"
  // "3/3"
  { code: "LTLTR", louverSize: null, strips: 3, caps: 3 },
  // "5/3"
  { code: "LLRR", louverSize: null, strips: 5, caps: 3 },
  { code: "LTLRTR", louverSize: null, strips: 5, caps: 3 },
  // "6/2"
  { code: "LRTLR", louverSize: null, strips: 6, caps: 2 },
  // "4/4"
  { code: "LTLTRTR", louverSize: null, strips: 4, caps: 4 },
  { code: "LTRTRTR", louverSize: 3.5, strips: 4, caps: 4 }, // 仅 3.5"
  // "9/3"
  { code: "LRTLRTLR", louverSize: 3.5, strips: 9, caps: 3 }, // 仅 3.5"
];

/** 方向码统一大写、去空格 —— 落库与查表都走它 */
export function normalizePanelCode(code: string): string {
  return String(code || "").replace(/\s+/g, "").toUpperCase();
}

const normCode = normalizePanelCode;

/** 可选的百叶尺寸（编码表校验用） */
export const LOUVER_SIZES_FOR_CODES = [2.5, 3.5] as const;

function buildIndex(rules: readonly PanelCodeRule[]): Map<string, PanelCodeRule> {
  const m = new Map<string, PanelCodeRule>();
  for (const r of rules) {
    // 尺寸专属的优先级高于通用条目
    const generic = `${normCode(r.code)}|*`;
    const specific = `${normCode(r.code)}|${r.louverSize}`;
    m.set(r.louverSize == null ? generic : specific, r);
  }
  return m;
}

const DEFAULT_INDEX = buildIndex(DEFAULT_PANEL_CODES);

/**
 * 查方向码对应的 条/盖。
 *
 * @param overrides 组织自定义的编码（覆盖同名默认项）。给 null/[] 即用内置表。
 * @returns 查不到返回 null —— 调用方必须把这行标成「待补」，不要当 0 用。
 */
export function resolvePanelSpec(
  code: string,
  louverSize: number,
  overrides?: readonly PanelCodeRule[] | null,
): PanelSpec | null {
  const key = normCode(code);
  if (!key) return null;

  const lookup = (idx: Map<string, PanelCodeRule>): PanelSpec | null => {
    const hit = idx.get(`${key}|${louverSize}`) ?? idx.get(`${key}|*`);
    return hit ? { strips: hit.strips, caps: hit.caps } : null;
  };

  if (overrides && overrides.length > 0) {
    const fromOverride = lookup(buildIndex(overrides));
    if (fromOverride) return fromOverride;
  }
  return lookup(DEFAULT_INDEX);
}

/** 某个百叶尺寸下所有可用的方向码（给下拉框/校验用） */
export function listPanelCodes(
  louverSize: number,
  overrides?: readonly PanelCodeRule[] | null,
): string[] {
  const all = [...DEFAULT_PANEL_CODES, ...(overrides ?? [])];
  const out = new Set<string>();
  for (const r of all) {
    if (r.louverSize == null || r.louverSize === louverSize) out.add(normCode(r.code));
  }
  return [...out].sort();
}

/**
 * 原表把 条/盖 写成 "5/3" 一个字符串，再用 LEFT/RIGHT 各取 1 位。
 * 到两位数（比如 "10/3"）就会取错 —— 这里按 "/" 切分，对现有编码结果完全一致，
 * 但不会在加码到两位数时悄悄算错。
 */
export function parsePanelSpecText(text: string): PanelSpec | null {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  return { strips: Number(m[1]), caps: Number(m[2]) };
}

export function formatPanelSpec(spec: PanelSpec): string {
  return `${spec.strips}/${spec.caps}`;
}
