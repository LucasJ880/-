/**
 * Revenue Spine — 电话 E.164 归一与比对（客户去重第二级键，PRD F2.3）
 *
 * 纯函数、零依赖（不引第三方号码库：本轮不加依赖，规则只覆盖去重需要的部分）：
 *   - 国际格式（+ / 00 / 该国国际冠码）→ "+<国家码><号码>"；
 *   - 本地格式 + 国家提示（询盘里的国家字段、客户档案的国家）→ 去掉国内长途前缀（0 / 北美 1）后加国家码；
 *   - 没有国家提示的本地格式 → 无法确定 E.164，返回 null，不参与电话比对；
 *   - WhatsApp wa_id 的已知写法差异归一：墨西哥手机 +52 1 …（旧手机前缀）→ +52 …，阿根廷手机 +54 9 … → +54 …。
 * 校验只到"国家码存在 + 总长 8–15 位（北美恰 11 位、区号 / 局号首位 2–9）"，不做号段级合法性判断。
 *
 * 比对宁可漏合并也不误合并（phonesMatch）：两边都必须归一成可信的 E.164 且相等；
 * 网页表单常见的占位号（0000000000、1234567890、9999999 …）不参与比对。
 */

import { detectCountries } from "./lexicon";

/** ITU 国家码（前缀互不包含，可按 1–3 位逐级查） */
const CALLING_CODES: ReadonlySet<string> = new Set(
  [
    "1 7",
    "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98",
    "211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239",
    "240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269",
    "290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 379",
    "380 381 382 383 385 386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509",
    "590 591 592 593 594 595 596 597 598 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692",
    "800 808 850 852 853 855 856 870 878 880 881 882 883 886 888",
    "960 961 962 963 964 965 966 967 968 970 971 972 973 974 975 976 977 979 992 993 994 995 996 998",
  ]
    .join(" ")
    .split(" "),
);

export interface DialingCountry {
  iso2: string;
  /** 国家码（不含 +） */
  cc: string;
  /** 国内长途前缀（拨国际时去掉）；null = 没有（如意大利号码首位 0 是号码本身） */
  trunk: string | null;
  /** 该国国际冠码（除通用的 00 之外）：北美 011、澳大利亚 0011、日本 010 */
  intl?: string;
  /** 英文国名与常见写法（小写）；lexicon 的规范国名必须在内，以便复用其中文 / 别名识别 */
  names: string[];
}

const DIALING_COUNTRIES: DialingCountry[] = [
  { iso2: "CA", cc: "1", trunk: "1", intl: "011", names: ["canada"] },
  { iso2: "US", cc: "1", trunk: "1", intl: "011", names: ["united states", "usa", "us", "america", "united states of america"] },
  { iso2: "GB", cc: "44", trunk: "0", names: ["united kingdom", "uk", "england", "scotland", "wales", "great britain", "britain"] },
  { iso2: "AU", cc: "61", trunk: "0", intl: "0011", names: ["australia"] },
  { iso2: "DE", cc: "49", trunk: "0", names: ["germany", "deutschland"] },
  { iso2: "FR", cc: "33", trunk: "0", names: ["france"] },
  { iso2: "IT", cc: "39", trunk: null, names: ["italy"] },
  { iso2: "ES", cc: "34", trunk: null, names: ["spain"] },
  { iso2: "NL", cc: "31", trunk: "0", names: ["netherlands", "holland"] },
  { iso2: "JP", cc: "81", trunk: "0", intl: "010", names: ["japan"] },
  { iso2: "KR", cc: "82", trunk: "0", names: ["south korea", "korea"] },
  { iso2: "AE", cc: "971", trunk: "0", names: ["united arab emirates", "uae"] },
  { iso2: "SA", cc: "966", trunk: "0", names: ["saudi arabia", "saudi"] },
  { iso2: "MX", cc: "52", trunk: null, names: ["mexico"] },
  { iso2: "BR", cc: "55", trunk: "0", names: ["brazil"] },
  { iso2: "IN", cc: "91", trunk: "0", names: ["india"] },
  { iso2: "SG", cc: "65", trunk: null, names: ["singapore"] },
  { iso2: "MY", cc: "60", trunk: "0", names: ["malaysia"] },
  { iso2: "TH", cc: "66", trunk: "0", names: ["thailand"] },
  { iso2: "VN", cc: "84", trunk: "0", names: ["vietnam", "viet nam"] },
  { iso2: "NZ", cc: "64", trunk: "0", names: ["new zealand"] },
  { iso2: "SE", cc: "46", trunk: "0", names: ["sweden"] },
  { iso2: "NO", cc: "47", trunk: null, names: ["norway"] },
  { iso2: "DK", cc: "45", trunk: null, names: ["denmark"] },
  { iso2: "PL", cc: "48", trunk: null, names: ["poland"] },
  { iso2: "TR", cc: "90", trunk: "0", names: ["turkey", "türkiye", "turkiye"] },
  { iso2: "ZA", cc: "27", trunk: "0", names: ["south africa"] },
  { iso2: "CN", cc: "86", trunk: "0", names: ["china"] },
  { iso2: "HK", cc: "852", trunk: null, names: ["hong kong"] },
  { iso2: "TW", cc: "886", trunk: "0", names: ["taiwan"] },
  { iso2: "IE", cc: "353", trunk: "0", names: ["ireland"] },
  { iso2: "BE", cc: "32", trunk: "0", names: ["belgium"] },
  { iso2: "CH", cc: "41", trunk: "0", names: ["switzerland"] },
  { iso2: "AT", cc: "43", trunk: "0", names: ["austria"] },
  { iso2: "PT", cc: "351", trunk: null, names: ["portugal"] },
  { iso2: "GR", cc: "30", trunk: null, names: ["greece"] },
  { iso2: "FI", cc: "358", trunk: "0", names: ["finland"] },
  { iso2: "IL", cc: "972", trunk: "0", names: ["israel"] },
  { iso2: "PH", cc: "63", trunk: "0", names: ["philippines"] },
  { iso2: "ID", cc: "62", trunk: "0", names: ["indonesia"] },
  { iso2: "PK", cc: "92", trunk: "0", names: ["pakistan"] },
  { iso2: "BD", cc: "880", trunk: "0", names: ["bangladesh"] },
  { iso2: "EG", cc: "20", trunk: "0", names: ["egypt"] },
  { iso2: "NG", cc: "234", trunk: "0", names: ["nigeria"] },
  { iso2: "KE", cc: "254", trunk: "0", names: ["kenya"] },
  { iso2: "CL", cc: "56", trunk: null, names: ["chile"] },
  { iso2: "CO", cc: "57", trunk: null, names: ["colombia"] },
  { iso2: "PE", cc: "51", trunk: "0", names: ["peru"] },
  { iso2: "AR", cc: "54", trunk: "0", names: ["argentina"] },
  { iso2: "RU", cc: "7", trunk: "8", names: ["russia", "russian federation"] },
  { iso2: "QA", cc: "974", trunk: null, names: ["qatar"] },
  { iso2: "KW", cc: "965", trunk: null, names: ["kuwait"] },
];

const BY_ISO2 = new Map(DIALING_COUNTRIES.map((c) => [c.iso2, c]));
const BY_NAME = new Map<string, DialingCountry>();
for (const c of DIALING_COUNTRIES) for (const n of c.names) BY_NAME.set(n, c);

/** 国家提示 → 拨号规则：ISO 两位码（UK 视同 GB）→ 英文国名 → lexicon 别名（含中文、城市名，如「加拿大」「Toronto, Canada」） */
export function resolveDialingCountry(hint: string | null | undefined): DialingCountry | null {
  const h = (hint ?? "").trim();
  if (!h) return null;
  if (/^[A-Za-z]{2}$/.test(h)) {
    const iso = h.toUpperCase() === "UK" ? "GB" : h.toUpperCase();
    return BY_ISO2.get(iso) ?? null;
  }
  const lower = h.toLowerCase().replace(/\s+/g, " ");
  const direct = BY_NAME.get(lower);
  if (direct) return direct;
  for (const hit of detectCountries(lower)) {
    const c = BY_NAME.get(hit.country.toLowerCase());
    if (c) return c;
  }
  return null;
}

/** 国际号码（不含 +）拆国家码：国家码前缀互不包含，按 1–3 位查 */
export function splitCallingCode(digits: string): { cc: string; national: string } | null {
  for (let n = 1; n <= 3 && n < digits.length; n++) {
    const cc = digits.slice(0, n);
    if (CALLING_CODES.has(cc)) return { cc, national: digits.slice(n) };
  }
  return null;
}

/** 去掉分机号、多号码的后几个、「+44 (0)20」里不拨的 (0)，全角 + 归一 */
function cleanPhone(raw: string): string {
  let s = raw.replace(/＋/g, "+").trim();
  // 多个号码只取第一个（逗号 / 分号 / 竖线；不按斜杠切：德式「089/1234567」用斜杠隔区号）
  s = s.split(/[,;|]/)[0] ?? "";
  s = s.replace(/\s*(?:ext\.?|extension|x|#|分机|转)\s*\d{1,6}\s*$/i, "");
  s = s.replace(/\(\s*0\s*\)/g, "");
  return s.trim();
}

function plausibleInternational(d: string): boolean {
  if (d.length < 8 || d.length > 15) return false;
  const split = splitCallingCode(d);
  if (!split) return false;
  if (split.cc !== "1") return true;
  // 北美：恰 10 位国内号码，区号与局号首位都是 2–9（「+1 123 456 7890」不是真实号码）
  return split.national.length === 10 && /^[2-9]\d\d[2-9]/.test(split.national);
}

/**
 * WhatsApp wa_id 与 E.164 的已知差异（同一手机两种写法）→ 统一成一种再比对：
 *   - 墨西哥：wa_id 常带旧的手机前缀 1（52 1 55 1234 5678），2019 年后的 E.164 是 52 55 1234 5678；
 *   - 阿根廷：手机国际格式带 9（54 9 11 2345 6789），表单常写成 54 11 2345 6789。
 * 号段按固话 / 手机分配，同一 10 位国内号码不会既是固话又是手机，去掉前缀不会把两个号码合成一个。
 */
function canonicalMobilePrefix(intl: string): string {
  if (intl.length === 13 && intl.startsWith("521")) return `52${intl.slice(3)}`;
  if (intl.length === 13 && intl.startsWith("549")) return `54${intl.slice(3)}`;
  return intl;
}

function nationalToInternational(d: string, c: DialingCountry): string | null {
  if (c.cc === "1") {
    if (d.length === 10) return `1${d}`;
    if (d.length === 11 && d.startsWith("1")) return d;
    return null;
  }
  if (c.trunk && d.startsWith(c.trunk)) return c.cc + d.slice(c.trunk.length);
  // 写了国家码却没写 +（如「44 7700 900123」）：总长要够长才这样认，免得把以国家码数字开头的本地号误判
  if (d.startsWith(c.cc) && d.length >= c.cc.length + 9) return d;
  return c.cc + d;
}

/**
 * 归一为 E.164（"+16475551234"）；无法确定时返回 null。
 * countryHint：询盘 / 客户档案里的国家（英文名、ISO 两位码、中文名均可）。
 */
export function toE164(raw: string | null | undefined, countryHint?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const s = cleanPhone(raw);
  const d = s.replace(/\D/g, "");
  if (d.length < 7) return null;
  const hint = resolveDialingCountry(countryHint);
  let intl: string | null;
  if (/^[\s(]*\+/.test(s)) intl = d;
  else if (hint?.intl && d.startsWith(hint.intl)) intl = d.slice(hint.intl.length);
  else if (d.startsWith("00")) intl = d.slice(2);
  else intl = hint ? nationalToInternational(d, hint) : null;
  if (!intl) return null;
  const canonical = canonicalMobilePrefix(intl);
  return plausibleInternational(canonical) ? `+${canonical}` : null;
}

/** 严格递增 / 递减的连续数字（允许 9→0 / 0→9 回绕），至少 7 位：1234567890、9876543210 */
function isDigitRun(s: string): boolean {
  if (s.length < 7) return false;
  const step = (Number(s[1]) - Number(s[0]) + 10) % 10;
  if (step !== 1 && step !== 9) return false;
  for (let i = 1; i < s.length; i++) {
    if ((Number(s[i]) - Number(s[i - 1]) + 10) % 10 !== step) return false;
  }
  return true;
}

/**
 * 网页表单常见的占位 / 乱填号码（不参与客户去重）：国内号码全是同一个数字、含 7 位以上相同数字、
 * 或整串是连续递增 / 递减数字。真实号码极少满足；判错的代价只是少合并一次。
 */
export function isPlaceholderPhone(e164: string): boolean {
  const d = e164.replace(/\D/g, "");
  const national = splitCallingCode(d)?.national ?? d;
  return /^(\d)\1*$/.test(national) || /(\d)\1{6,}/.test(national) || isDigitRun(national) || isDigitRun(d);
}

/** 可用于客户去重的 E.164：能归一、且不是占位号；否则 null */
export function matchablePhoneE164(raw: string | null | undefined, countryHint?: string | null): string | null {
  const e164 = toE164(raw, countryHint);
  return e164 && !isPlaceholderPhone(e164) ? e164 : null;
}

export interface PhoneWithHint {
  phone: string | null | undefined;
  country?: string | null;
}

/**
 * 两个电话是否同一号码（客户去重用）：两边都能归一成可信的 E.164（各用自己的国家提示）且相等才算。
 * 不再借用另一边的国家码去猜本地号，也不比较原始数字串：没有国家提示的本地号、占位号一律不参与比对
 * （宁可漏合并、建出一个重复客户，也不把别人的询盘挂到另一家公司的商机上）。
 */
export function phonesMatch(a: PhoneWithHint, b: PhoneWithHint): boolean {
  const ea = matchablePhoneE164(a.phone, a.country);
  return ea !== null && ea === matchablePhoneE164(b.phone, b.country);
}
