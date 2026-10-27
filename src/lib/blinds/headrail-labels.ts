/**
 * 罩盒类型的显示名。
 *
 * 存储值 = 工艺引擎的枚举（HEADRAIL_TYPES，中文），这样报价单 → 工艺单是
 * 1:1 直通，桥那一层不需要任何猜测映射 —— 那是最容易出错的地方。
 *
 * 显示分两处：
 *   报价单录入界面  → "English (中文)" 双语，销售与工厂看同一个东西
 *   对客 PDF        → 只印英文
 *
 * 英文名会出现在客户拿到的报价单上。改这里一处，两处显示同步。
 *
 * 定稿状态（2026-08-29）：
 *   亮白插片圆盒 = WRW —— 业务给的**真实编码**
 *   其余 7 条 = Lucas 授权由此处自定，采用**描述性英文名而非编造编码**。
 *     理由：只有一条是真编码时，给其余 7 条也编出 XXX 形式的码，会让人分不清
 *     哪个是真的物料编号、哪个是我们瞎起的；描述性名称一眼就知道不是料号。
 *     将来业务给出真实编码，逐条替换即可。
 */

import { HEADRAIL_TYPES, type HeadrailType } from "./deduction-rules";

export const HEADRAIL_LABELS: Record<HeadrailType, { en: string; zh: string }> = {
  "亮白插片圆盒": { en: "WRW", zh: "亮白插片圆盒" },
  "哑灰方型罩盒": { en: "Square Cassette – Matte Grey", zh: "哑灰方型罩盒" },
  "哑白方型罩盒": { en: "Square Cassette – Matte White", zh: "哑白方型罩盒" },
  "灰弧": { en: "Curved Cassette – Grey", zh: "灰弧" },
  "白弧": { en: "Curved Cassette – White", zh: "白弧" },
  "双轨无盒": { en: "Dual Rail – No Cassette", zh: "双轨无盒" },
  "双轨半盒": { en: "Dual Rail – Half Cassette", zh: "双轨半盒" },
  "单轨无盒": { en: "Single Rail – No Cassette", zh: "单轨无盒" },
};

/** 下拉选项：值为引擎枚举，label 双语 */
export const HEADRAIL_OPTIONS: { value: HeadrailType; label: string }[] =
  HEADRAIL_TYPES.map((t) => ({
    value: t,
    label: `${HEADRAIL_LABELS[t].en}（${HEADRAIL_LABELS[t].zh}）`,
  }));

export function isHeadrailType(v: string): v is HeadrailType {
  return (HEADRAIL_TYPES as readonly string[]).includes(v);
}

/**
 * 对客 PDF 用的英文名。
 * 认不出来的值（历史报价单里的自由文本）原样返回，不猜也不吞。
 */
export function headrailLabelEn(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return isHeadrailType(s) ? HEADRAIL_LABELS[s].en : s;
}
