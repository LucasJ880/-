/**
 * 斑马帘布纱比目录（权威源）
 *
 * 来源: Blinds 工艺单_圆盒侧盖加厚标准版20251024.xlsx → Sheet1!W 列
 * 该列是车间长期手工维护的「面料 → 布/纱比」清单，本文件是它的逐行誊录。
 *
 * 为什么需要它:
 *   纵向Ref 的裁剪位公式对任意布/纱比都成立（见 calcZebraCuttingPosition），
 *   真实 SKU 的比例绝大多数**不是** 3:2（如 3 2/16 : 2 2/16、2 15/16 : 1 15/16）。
 *   过去代码把布纱比锁死在 3:2，导致斑马帘裁剪位在真实面料上静默失效。
 *
 * 纪律:
 *   1. 只做精确匹配（含大小写/空格/全角冒号归一化），**绝不模糊匹配**。
 *      查不到就返回 not_found，由调用方要求人工填写——猜错比查不到更贵。
 *   2. 同一 SKU 出现两个不同比例时标记为 conflict，同样拒绝返回值。
 *   3. 誊录时保留厂商编号与括号内的内部 SKU（两者都可作为 key 查询）。
 */

/** 一条目录记录；ratio 单位为英寸（16 分制换算后的小数） */
export interface FabricRatioEntry {
  /** 厂商编号（W 列行首那个），如 "ZE-215-F1091" */
  vendorCode: string;
  /** 括号里的内部 SKU（可能没有），如 "SD-ZB-F1091" */
  internalSku?: string;
  /** 布长（英寸） */
  fabric: number;
  /** 纱长（英寸） */
  silk: number;
  /** 原始文本，便于人工比对 */
  raw: string;
  /** 目录分区：进口 / 本地 */
  origin: "import" | "local";
}

/** 把 "3 2/16" / "3" / "2 15/16" 解析为小数英寸 */
export function parseRatioValue(text: string): number {
  const t = text.trim();
  const m = /^(\d+)(?:\s+(\d+)\/(\d+))?$/.exec(t);
  if (!m) return NaN;
  const whole = Number(m[1]);
  if (!m[2]) return whole;
  const num = Number(m[2]);
  const den = Number(m[3]);
  if (!den) return NaN;
  return whole + num / den;
}

/**
 * 目录原文（逐行誊录自 Sheet1!W，顺序保持一致）。
 * 格式: "<厂商编号> <布>:<纱>  (<内部SKU>)"；全角冒号在解析时归一。
 */
const RAW_IMPORT_LINES: string[] = [
  "ZE-215-F1091 3 2/16:2 2/16 (SD-ZB-F1091)",
  "ZE-245-BL201 3 2/16:1 15/16 (SB-ZB-BL201)",
  "ZE-295-268A15-1 3:2 (SU-ZE-004)",
  "ZE-215-F1821 3 8/16:2 4/16 (SD-ZB-F1821)",
  "ZE-215-F1092 3 4/16:2 3/16",
  "ZE220-20A36-A 3:2 (SU-ZE-005)",
  "YJ85-221-4 3:2 2/16",
  "YJ70-D002 3:2 (SUNNY-D-002)",
  "YJ85-19A38-1 3:2 (SUNNY-19A38-1)",
  // Sheet1!W 第 10 行是 ZE-245-BL201「新」，比例与第 2 行完全一致，属良性重复，不再誊录。
  "ZE-215-F1094 3 6/16:2",
  "ZE163-20A19-3 3:1 15/16",
  "SA-ZD-20237-0 3 7/16:2 5/16",
  "SC-ZD-XZ78-6 2 15/16:1 15/16",
  "SG-ZD-IO 3 15/16:2 12/16",
  "SC-ZD-XZ74-1 3 9/16:2 5/16",
  "SA-ZC-A19-3 4 13/16:3 8/16",
  "SA-ZD-A162-1 3:1 15/16",
  "SA-ZD-A162-2 3:2 5/16",
  "SB-ZB-BL207 3 4/16:2 1/16",
  // ⚠️ 与上面 "SC-ZD-XZ74-1 3 9/16:2 5/16" 冲突（布长 3 9/16 vs 3 6/16）。
  //    原表两行并存，未标注哪一条作废；此处如实保留，由 lookup 返回 conflict。
  "SC-ZD-XZ74-1 3 6/16:2 5/16",
  "SC-ZD-XZ74-3 3 9/16:2 5/16",
  "SC-ZD-XZ78-1 3:2",
  "Nova 2 14/16:2",
];

const RAW_LOCAL_LINES: string[] = [
  "Modina White 2 14/16:1 15/16",
  "Rimini Forst 3 14/16:2 5/16 (Mohair White)",
];

/**
 * 卷帘面料（Sheet1!W 底部「卷帘」分区）——卷帘无布纱比，只登记存在性，
 * 便于将来核对 SKU 是否属于卷帘而非斑马帘。
 */
export const ROLLER_FABRIC_CODES: readonly string[] = [
  "SU-ZM-150-A2101",
  "SU-ZM-150-A2102",
  "SU-ZC-120-3921-1",
  "SU-ZC-98-3910",
  "Green 2000 3% Grey",
];

function parseLine(raw: string, origin: "import" | "local"): FabricRatioEntry | null {
  // 全角冒号归一
  const line = raw.replace(/：/g, ":").trim();
  const aliasMatch = /\(([^)]+)\)\s*$/.exec(line);
  const internalSku = aliasMatch ? aliasMatch[1].trim() : undefined;
  const body = aliasMatch ? line.slice(0, aliasMatch.index).trim() : line;

  const colon = body.indexOf(":");
  if (colon < 0) return null;

  const right = body.slice(colon + 1).trim();
  const left = body.slice(0, colon).trim();

  // left = "<厂商编号> <布>"；布可能是 "3" 或 "3 2/16"
  const leftMatch = /^(.*?)\s+(\d+(?:\s+\d+\/\d+)?)$/.exec(left);
  if (!leftMatch) return null;

  const vendorCode = leftMatch[1].trim();
  const fabric = parseRatioValue(leftMatch[2]);
  const silk = parseRatioValue(right);
  if (!Number.isFinite(fabric) || !Number.isFinite(silk)) return null;

  return { vendorCode, internalSku, fabric, silk, raw, origin };
}

export const FABRIC_RATIO_CATALOG: readonly FabricRatioEntry[] = [
  ...RAW_IMPORT_LINES.map((l) => parseLine(l, "import")),
  ...RAW_LOCAL_LINES.map((l) => parseLine(l, "local")),
].filter((e): e is FabricRatioEntry => e !== null);

/** 归一化 key：去空格、转大写、全角冒号转半角 */
function normKey(s: string): string {
  return s.replace(/：/g, ":").replace(/\s+/g, "").toUpperCase();
}

type Index = Map<string, FabricRatioEntry[]>;

const index: Index = (() => {
  const m: Index = new Map();
  const push = (key: string, entry: FabricRatioEntry) => {
    const k = normKey(key);
    if (!k) return;
    const list = m.get(k);
    if (list) list.push(entry);
    else m.set(k, [entry]);
  };
  for (const e of FABRIC_RATIO_CATALOG) {
    push(e.vendorCode, e);
    if (e.internalSku) push(e.internalSku, e);
  }
  return m;
})();

export type FabricRatioLookup =
  | { status: "ok"; fabric: number; silk: number; entry: FabricRatioEntry }
  | { status: "not_found" }
  | { status: "conflict"; entries: FabricRatioEntry[] };

/**
 * 按面料 SKU / 厂商编号查布纱比。
 * fail-closed：查不到或冲突都不返回数值，调用方必须让人工补录。
 */
export function lookupFabricRatio(sku: string | null | undefined): FabricRatioLookup {
  if (!sku) return { status: "not_found" };
  const hits = index.get(normKey(sku));
  if (!hits || hits.length === 0) return { status: "not_found" };

  const distinct = hits.filter(
    (e, i) =>
      hits.findIndex((o) => o.fabric === e.fabric && o.silk === e.silk) === i,
  );
  if (distinct.length > 1) return { status: "conflict", entries: hits };

  const e = distinct[0];
  return { status: "ok", fabric: e.fabric, silk: e.silk, entry: e };
}

/** 目录里所有存在冲突（同 SKU 两个不同比例）的 key，供体检页面列出 */
export function listConflictingSkus(): string[] {
  const out: string[] = [];
  for (const [key, hits] of index) {
    const distinct = hits.filter(
      (e, i) =>
        hits.findIndex((o) => o.fabric === e.fabric && o.silk === e.silk) === i,
    );
    if (distinct.length > 1) out.push(key);
  }
  return out.sort();
}
