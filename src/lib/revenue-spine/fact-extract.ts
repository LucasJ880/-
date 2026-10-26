/**
 * Revenue Spine — 从人工回复里规则化抽取商务事实（B-2，openspec change fde-fact-proposals）
 *
 * 纯函数，不调用 LLM。目标字段只限 commercialFacts 既有的 6 个键：
 *   moq / sampleLeadTime / productionLeadTime / loadingPorts / signature / catalogUrl
 * - 先截掉回复里引用的历史邮件（买家原信里的网址 / 电话不能当成我方事实）；
 * - 含币种、价格、折扣、佣金、付款条款或百分比的行整行跳过（价格永远"需内部确认"，见 reply-draft.ts）；
 * - 每行按分句判断（"样品 7 天，大货 30-35 天"拆开看），每个字段只取第一个值；
 * - 网址 / WhatsApp 不取买家邮箱同域或与买家联系方式相同的值。
 */

import { captureNumbers, type DraftSection } from "./fde/draft-diff";

export type FactField = "moq" | "sampleLeadTime" | "productionLeadTime" | "loadingPorts" | "signature" | "catalogUrl";
export const FACT_FIELDS: readonly FactField[] = ["moq", "sampleLeadTime", "productionLeadTime", "loadingPorts", "signature", "catalogUrl"];

export interface MoqValue {
  quantity: number;
  unit: string;
  per: string;
}
export interface SampleLeadTimeValue {
  stockDays: number | null;
  customDaysMin: number | null;
  customDaysMax: number | null;
}
export interface ProductionLeadTimeValue {
  daysMin: number;
  daysMax: number;
  startsFrom: string;
}
export interface SignatureValue {
  title: string | null;
  whatsapp: string | null;
  website: string | null;
}

export type FactValue<F extends FactField> = F extends "moq"
  ? MoqValue
  : F extends "sampleLeadTime"
    ? SampleLeadTimeValue
    : F extends "productionLeadTime"
      ? ProductionLeadTimeValue
      : F extends "loadingPorts"
        ? string[]
        : F extends "signature"
          ? SignatureValue
          : string;

export type ExtractedFact = { [F in FactField]: { field: F; value: FactValue<F>; lineIndex: number } }[FactField];

export interface FactLine {
  line: string;
  section: DraftSection;
}

/** 与 commercialFacts.productionLeadTime 合并规则的默认起算点一致（policy.ts mergeCommercialFacts） */
export const DEFAULT_PRODUCTION_STARTS_FROM = "pre-production sample approval";

// ── 引用截断 ──────────────────────────────────────────────

const QUOTE_START_RES: readonly RegExp[] = [
  /^\s*>/,
  /^\s*On .{1,200}wrote:\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^\s*(From|Sent|发件人|发送时间)\s*[:：]/i,
  /^\s*在.{1,120}写道[:：]\s*$/,
];

/** 截掉第一个引用标记及其后的全部内容（常见邮件客户端格式） */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => QUOTE_START_RES.some((re) => re.test(l)));
  return (at >= 0 ? lines.slice(0, at) : lines).join("\n").trimEnd();
}

// ── 价格行 ────────────────────────────────────────────────

const PRICE_RE =
  /(\$|US\$|\bUSD\b|¥|\bRMB\b|\bCNY\b|\bEUR\b|€|£|\bGBP\b|%|\b(price|prices|pricing|priced|cost|costs|discount|discounts|rebate|commission|payment|payments|t\/t|l\/c|quotation|quoted)\b|报价|价格|单价|价钱|折扣|优惠|返点|佣金|付款|账期|货款)/i;

export function isPriceLine(line: string): boolean {
  return PRICE_RE.test(line);
}

// ── 工具 ──────────────────────────────────────────────────

/** 分句：中文标点、分号、句点后空格、逗号后空格（"1,000" 这类千分位不拆） */
function clauses(line: string): string[] {
  return line
    .split(/[，；。;]|,\s|\.\s/)
    .map((c) => c.trim())
    .filter(Boolean);
}

const DAY_UNIT = "(working\\s+days?|business\\s+days?|days?|weeks?|个工作日|工作日|天|周|星期)";
const RANGE_RE = new RegExp(`(\\d{1,3})\\s*(?:-|–|—|~|～|to|至|到)\\s*(\\d{1,3})\\s*${DAY_UNIT}`, "i");
const SINGLE_RE = new RegExp(`(\\d{1,3})\\s*${DAY_UNIT}`, "i");

function toDays(n: number, unit: string): number {
  return /week|周|星期/i.test(unit) ? n * 7 : n;
}

/** 句中的天数区间（周按 7 天）；单个值时 min = max */
export function dayRange(text: string): { min: number; max: number } | null {
  const r = RANGE_RE.exec(text);
  if (r) {
    const a = toDays(Number(r[1]), r[3]);
    const b = toDays(Number(r[2]), r[3]);
    return a > 0 && b >= a ? { min: a, max: b } : null;
  }
  const s = SINGLE_RE.exec(text);
  if (s) {
    const d = toDays(Number(s[1]), s[2]);
    return d > 0 ? { min: d, max: d } : null;
  }
  return null;
}

const URL_RE = /\b(https?:\/\/[^\s<>()"'，。；]+|www\.[^\s<>()"'，。；]+)/i;

function firstUrl(text: string): string | null {
  const m = URL_RE.exec(text);
  return m ? m[1].replace(/[.,;:!?)\]]+$/, "") : null;
}

function hostOf(url: string): string | null {
  const m = /^(?:https?:\/\/)?([^/:?#]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

const FREE_MAIL = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "163.com", "126.com", "qq.com", "icloud.com", "live.com", "foxmail.com", "aol.com", "protonmail.com"]);

/** 买家邮箱的域名（免费邮箱不算）：网址落在这个域里就不是我方的 */
export function buyerDomain(email: string | null | undefined): string | null {
  const d = email?.split("@")[1]?.trim().toLowerCase();
  return d && !FREE_MAIL.has(d) ? d.replace(/^www\./, "") : null;
}

function isBuyerUrl(url: string, domain: string | null): boolean {
  const host = hostOf(url);
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

// ── 字段规则 ──────────────────────────────────────────────

const MOQ_RE = /\bmoq\b|minimum\s+order(?:\s+quantity)?|min\.?\s+order|起订量|最小起订|最低起订|起订/i;
const MOQ_UNITS: Record<string, string> = { pcs: "pcs", units: "units", sets: "sets", 件: "pcs", 个: "pcs", 套: "sets", m: "m", 米: "m", kg: "kg" };
const PER_NORMALIZE: Record<string, string> = {
  color: "color",
  size: "size",
  design: "design",
  style: "style",
  sku: "sku",
  item: "item",
  order: "order",
  色: "color",
  个颜色: "color",
  款: "style",
  个尺码: "size",
  单: "order",
};

/** 数字后没紧跟"per …"时，在整句里找"每色 / 每款 / 500件/色 / per colour" */
const PER_FALLBACK_RE = /每\s*(色|款|个颜色|个尺码)|[/／]\s*(色|款)|\bper\s+(colou?r|style|design|size|sku|item)\b/i;

function moqOf(clause: string): MoqValue | null {
  if (!MOQ_RE.test(clause)) return null;
  for (const n of captureNumbers(clause)) {
    const unit = MOQ_UNITS[n.unit];
    if (!unit || !Number.isInteger(n.value) || n.value <= 0) continue;
    let per = n.per ? PER_NORMALIZE[n.per] : undefined;
    if (!per) {
      const m = PER_FALLBACK_RE.exec(clause);
      const word = (m?.[1] ?? m?.[2] ?? m?.[3])?.toLowerCase().replace("colour", "color");
      per = word ? PER_NORMALIZE[word] : undefined;
    }
    return { quantity: n.value, unit, per: per ?? "order" };
  }
  return null;
}

const SAMPLE_RE = /\bsamples?\b|\bsampling\b|样品|打样|样板|寄样/i;
/** 现货样（"samples can be ready in 7 days" 的 ready 不算现货） */
const STOCK_RE = /\bstock\s+samples?\b|\bin[-\s]stock\b|\bexisting\s+samples?\b|\bready[-\s]made\b|现货|现成/i;
/** 大货起算点里的"样品"字样（"after PP sample approval"）不算样品时效 */
const PP_SAMPLE_RE = /\b(pp|pre-?production)\s+samples?(\s+approval)?\b|产前样|大货样|确认样/gi;
const PRODUCTION_RE = /\bproduction\b|lead\s*time|\bbulk\b|mass\s+production|\bdelivery\b|大货|生产周期|生产时间|交期|货期/i;

function sampleOf(clause: string): SampleLeadTimeValue | null {
  const withoutPp = clause.replace(PP_SAMPLE_RE, " ");
  if (!SAMPLE_RE.test(withoutPp)) return null;
  const range = dayRange(clause);
  if (!range) return null;
  if (STOCK_RE.test(clause)) return { stockDays: range.min, customDaysMin: null, customDaysMax: null };
  return { stockDays: null, customDaysMin: range.min, customDaysMax: range.max };
}

function startsFromOf(clause: string): string {
  if (/\b(pp|pre-?production)\s+sample|产前样|大货样|确认样/i.test(clause)) return DEFAULT_PRODUCTION_STARTS_FROM;
  if (/\bdeposit\b|定金|订金/i.test(clause)) return "deposit received";
  if (/order\s+confirmation|confirm(?:ed|ing)?\s+(?:the\s+)?order|确认订单|下单/i.test(clause)) return "order confirmation";
  return DEFAULT_PRODUCTION_STARTS_FROM;
}

function productionOf(clause: string): ProductionLeadTimeValue | null {
  if (!PRODUCTION_RE.test(clause)) return null;
  // 去掉起算点后仍提到样品 → 这一句说的是样品时效，不是大货
  if (SAMPLE_RE.test(clause.replace(PP_SAMPLE_RE, " "))) return null;
  const range = dayRange(clause);
  if (!range) return null;
  return { daysMin: range.min, daysMax: range.max, startsFrom: startsFromOf(clause) };
}

/** 中国主要装运港（英文规范名 ← 别名） */
export const LOADING_PORTS: ReadonlyArray<{ name: string; aliases: string[] }> = [
  { name: "Ningbo", aliases: ["ningbo", "宁波"] },
  { name: "Shanghai", aliases: ["shanghai", "上海"] },
  { name: "Shenzhen", aliases: ["shenzhen", "深圳"] },
  { name: "Yantian", aliases: ["yantian", "盐田"] },
  { name: "Shekou", aliases: ["shekou", "蛇口"] },
  { name: "Guangzhou", aliases: ["guangzhou", "广州"] },
  { name: "Nansha", aliases: ["nansha", "南沙"] },
  { name: "Qingdao", aliases: ["qingdao", "青岛"] },
  { name: "Xiamen", aliases: ["xiamen", "厦门"] },
  { name: "Tianjin", aliases: ["tianjin", "天津"] },
  { name: "Dalian", aliases: ["dalian", "大连"] },
  { name: "Lianyungang", aliases: ["lianyungang", "连云港"] },
  { name: "Fuzhou", aliases: ["fuzhou", "福州"] },
  { name: "Zhangjiagang", aliases: ["zhangjiagang", "张家港"] },
  { name: "Hong Kong", aliases: ["hong kong", "hongkong", "香港"] },
];

const PORT_CONTEXT_RE = /\bports?\b|\bloading\b|ship(?:ped|ping)?\s+from|\bfob\b|装运港|起运港|港口|出运港/i;

/** 港口名（任何写法）→ 英文规范名；不认识返回 null */
export function canonicalPort(name: string): string | null {
  const n = name.trim().toLowerCase();
  return LOADING_PORTS.find((p) => p.name.toLowerCase() === n || p.aliases.includes(n))?.name ?? null;
}

function portsOf(clause: string): string[] {
  if (!PORT_CONTEXT_RE.test(clause)) return [];
  const lower = clause.toLowerCase();
  const hits: Array<{ name: string; at: number }> = [];
  for (const p of LOADING_PORTS) {
    for (const a of p.aliases) {
      const re = /^[a-z ]+$/.test(a) ? new RegExp(`(?<![a-z])${a}(?![a-z])`, "i") : new RegExp(a);
      const m = re.exec(/^[a-z ]+$/.test(a) ? lower : clause);
      if (m) {
        hits.push({ name: p.name, at: m.index });
        break;
      }
    }
  }
  return hits.sort((x, y) => x.at - y.at).map((h) => h.name);
}

const CATALOG_RE = /\bcatalog(?:ue)?s?\b|\bbrochure\b|目录|产品册|画册/i;

const TITLE_RE =
  /\b(sales|export|marketing|account|business\s+development|general|purchasing|product|project)?\s*(manager|director|executive|representative|specialist|coordinator|assistant|ceo|founder)\b|经理|总监|主管|专员|业务员|总经理/i;
const CLOSING_LINE_RE = /^(best regards|kind regards|warm regards|regards|best wishes|sincerely|yours sincerely|many thanks|thanks|thank you|cheers|此致|祝好|顺祝商祺|谢谢)/i;
const WHATSAPP_RE = /whats\s*app\s*[:：]?\s*(\+?\d[\d\s()-]{6,}\d)/i;

function signatureOf(lines: readonly string[], domain: string | null, buyerPhoneDigits: string | null): SignatureValue | null {
  let title: string | null = null;
  let whatsapp: string | null = null;
  let website: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || CLOSING_LINE_RE.test(line)) continue;
    const wa = WHATSAPP_RE.exec(line);
    if (wa && !whatsapp) {
      const v = wa[1].replace(/\s+/g, " ").trim();
      if (!buyerPhoneDigits || digitsOf(v) !== buyerPhoneDigits) whatsapp = v;
      continue;
    }
    const url = firstUrl(line);
    if (url && !website && !CATALOG_RE.test(line) && !line.includes("@")) {
      if (!isBuyerUrl(url, domain)) website = url;
      continue;
    }
    if (!title && line.length <= 60 && TITLE_RE.test(line) && !/\d|@|https?:|www\./i.test(line)) title = line.replace(/[,，]$/, "");
  }
  return title || whatsapp || website ? { title, whatsapp, website } : null;
}

export interface ExtractOptions {
  /** 买家邮箱（取同域排除） */
  buyerEmail?: string | null;
  /** 买家电话（WhatsApp 与之相同则排除） */
  buyerPhone?: string | null;
}

/**
 * 从带段落类型的行里抽取商务事实（行应已截掉引用）。每个字段只取第一个值；lineIndex 指向触发它的那一行。
 * 事实段 / 追问段 / 问候段里的行都看前 5 个字段；签名只看签名段。
 */
export function extractFacts(lines: readonly FactLine[], opts: ExtractOptions = {}): ExtractedFact[] {
  const domain = buyerDomain(opts.buyerEmail);
  const buyerPhoneDigits = opts.buyerPhone ? digitsOf(opts.buyerPhone) || null : null;
  const found = new Map<FactField, ExtractedFact>();
  const put = (f: ExtractedFact) => {
    if (!found.has(f.field)) found.set(f.field, f);
  };

  lines.forEach(({ line, section }, lineIndex) => {
    if (section === "signature" || isPriceLine(line)) return;
    for (const clause of clauses(line)) {
      const moq = moqOf(clause);
      if (moq) put({ field: "moq", value: moq, lineIndex });
      const sample = sampleOf(clause);
      if (sample) put({ field: "sampleLeadTime", value: sample, lineIndex });
      const production = productionOf(clause);
      if (production) put({ field: "productionLeadTime", value: production, lineIndex });
      const ports = portsOf(clause);
      if (ports.length) put({ field: "loadingPorts", value: ports, lineIndex });
    }
    if (CATALOG_RE.test(line)) {
      const url = firstUrl(line);
      if (url && !isBuyerUrl(url, domain)) put({ field: "catalogUrl", value: url, lineIndex });
    }
  });

  const sigIndexes = lines.map((l, i) => (l.section === "signature" && !isPriceLine(l.line) ? i : -1)).filter((i) => i >= 0);
  if (sigIndexes.length) {
    const sig = signatureOf(
      sigIndexes.map((i) => lines[i].line),
      domain,
      buyerPhoneDigits,
    );
    if (sig) put({ field: "signature", value: sig, lineIndex: sigIndexes[0] });
  }
  return FACT_FIELDS.map((f) => found.get(f)).filter((f): f is ExtractedFact => !!f);
}

// ── 规范键与中文展示 ──────────────────────────────────────

/** 比较与驳回去重用的规范键（同一事实不同写法得到同一个键） */
export function factValueKey(field: FactField, value: unknown): string {
  const v = value as Record<string, unknown> & unknown[];
  switch (field) {
    case "moq":
      return `${v.quantity}|${String(v.unit).toLowerCase()}|${String(v.per).toLowerCase()}`;
    case "sampleLeadTime":
      return `${v.stockDays ?? "-"}|${v.customDaysMin ?? "-"}|${v.customDaysMax ?? "-"}`;
    case "productionLeadTime":
      return `${v.daysMin}|${v.daysMax}|${String(v.startsFrom).toLowerCase()}`;
    case "loadingPorts":
      return [...new Set((value as string[]).map((p) => canonicalPort(p) ?? p.trim()))].sort().join("|");
    case "signature":
      return `${v.title ?? "-"}|${v.whatsapp ? digitsOf(String(v.whatsapp)) : "-"}|${v.website ? hostOf(String(v.website)) ?? v.website : "-"}`;
    case "catalogUrl":
      return String(value).trim().replace(/\/+$/, "").toLowerCase();
  }
}

export const FACT_FIELD_LABELS: Record<FactField, string> = {
  moq: "起订量",
  sampleLeadTime: "样品时效",
  productionLeadTime: "大货周期",
  loadingPorts: "装运港",
  signature: "落款",
  catalogUrl: "目录链接",
};

/** 卡片里的中文展示；null / 空 → "未配置" */
export function factValueLabel(field: FactField, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return "未配置";
  const v = value as Record<string, unknown>;
  switch (field) {
    case "moq":
      return `${v.quantity} ${v.unit} / ${v.per}`;
    case "sampleLeadTime": {
      const parts: string[] = [];
      if (v.stockDays) parts.push(`现货样 ${v.stockDays} 天`);
      if (v.customDaysMin) parts.push(`定制样 ${v.customDaysMin}${v.customDaysMax && v.customDaysMax !== v.customDaysMin ? `–${v.customDaysMax}` : ""} 天`);
      return parts.join("，") || "未配置";
    }
    case "productionLeadTime":
      return `${v.daysMin}${v.daysMax !== v.daysMin ? `–${v.daysMax}` : ""} 天（自 ${v.startsFrom} 起）`;
    case "loadingPorts":
      return (value as string[]).join("、");
    case "signature":
      return [v.title ? `职位 ${v.title}` : null, v.whatsapp ? `WhatsApp ${v.whatsapp}` : null, v.website ? `网站 ${v.website}` : null].filter(Boolean).join("，") || "未配置";
    case "catalogUrl":
      return String(value);
  }
}
