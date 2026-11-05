/**
 * 协作通知 COLLAB-2：脱敏（design D10，spec notifications/activity-events「敏感内容的判定」）
 *
 * 一段文字只要含金额、电话、地址或内部财务词，就整段换成 REDACTED_TEXT，不做局部遮盖（纪律 4）。
 * 金额、电话、地址是本 change 的规则；内部财务词复用 Muse 通道（strict）与驾驶舱的词表，只导入、不修改。
 * 比 Muse 通道更严：这些文字会进个人邮箱。
 */

import { containsOutboundSensitive } from "@/lib/muse-bridge/contract";
import { COCKPIT_SENSITIVE_PATTERNS } from "@/lib/cockpit/waiting";

export const REDACTED_TEXT = "（含敏感信息，请在青砚查看）";

const CURRENCY_CODES = "CAD|USD|RMB|CNY|HKD|EUR|GBP|AUD";

/** 金额：货币符号或币种代码紧挨数字；数字后跟元 / 万元 / 美元 / 加元 / 块；金额类字眼后跟数字 */
const MONEY_PATTERNS: readonly RegExp[] = [
  /[$¥￥€£]\s*\d/,
  new RegExp(`\\b(?:${CURRENCY_CODES})\\s*\\d`, "i"),
  new RegExp(`\\d\\s*(?:${CURRENCY_CODES})\\b`, "i"),
  /\d\s*(?:万元|美元|加元|元|块)/,
  /(?:金额|总额|总价|单价|报价|价格|定金|尾款|余款)\s*[:：]?\s*[$¥￥]?\s*\d/,
];

/** 电话：北美格式、中国大陆手机号、带 + 的国际号码、10 位及以上连续数字 */
const PHONE_PATTERNS: readonly RegExp[] = [
  /(?<!\d)\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  /\+\d{1,3}[\s-]?\d[\d\s-]{6,}\d/,
  /\d{10,}/,
];

const STREET_WORDS =
  "St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Cres|Crescent|Ct|Court|Way|Lane|Ln|Pl|Place|Pkwy|Parkway|Hwy|Highway|Terrace|Trail|Circle|Sq|Square|Gate|Grove";

/** 地址：门牌号加英文街道词、加拿大邮编、中文路名后跟门牌号、带数字的号楼 / 栋 / 单元 / 室 */
const ADDRESS_PATTERNS: readonly RegExp[] = [
  new RegExp(`(?<![\\d.])\\d{1,6}[A-Za-z]?\\s+(?:[A-Za-z0-9][\\w.'-]*\\s+){1,4}(?:${STREET_WORDS})\\b`, "i"),
  /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i,
  /(?:路|街|大道|巷|弄)\s*\d+\s*[号號]/,
  /\d+\s*(?:号楼|號樓|栋|幢|单元|室)/,
];

/** 内部财务词：既有 Muse 通道（strict）与驾驶舱的敏感词 */
function containsInternalFinance(text: string): boolean {
  return (
    containsOutboundSensitive(text, { strict: true }) ||
    COCKPIT_SENSITIVE_PATTERNS.some((p) => p.test(text))
  );
}

export function isSensitiveText(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    MONEY_PATTERNS.some((p) => p.test(text)) ||
    PHONE_PATTERNS.some((p) => p.test(text)) ||
    ADDRESS_PATTERNS.some((p) => p.test(text)) ||
    containsInternalFinance(text)
  );
}

/** 用户输入的文字：命中任一类 → 整段替换；不命中原样返回；空值 → 空串 */
export function redactText(text: string | null | undefined): string {
  if (!text) return "";
  return isSensitiveText(text) ? REDACTED_TEXT : text;
}
