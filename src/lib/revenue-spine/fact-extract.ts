/**
 * Revenue Spine — 从人工回复里规则化抽取商务事实（B-2，openspec change fde-fact-proposals）
 *
 * 纯函数，不调用 LLM。目标字段只限 commercialFacts 既有的 6 个键：
 *   moq / sampleLeadTime / productionLeadTime / loadingPorts / signature / catalogUrl
 * - 先截掉回复里引用的历史邮件（买家原信里的网址 / 电话不能当成我方事实）；
 * - 含币种、金额、价格、费用、折扣、佣金、付款或账期条款、百分比的行整行跳过（价格永远"需内部确认"，见 reply-draft.ts）；
 * - 每行按分句判断（"样品 7 天，大货 30-35 天"拆开看），每个字段只取第一个值；
 * - 网址 / WhatsApp 不取买家邮箱同域或与买家联系方式相同的值。
 */

import { captureNumbers, isClosing, type DraftSection } from "./fde/draft-diff";

export type FactField = "moq" | "sampleLeadTime" | "productionLeadTime" | "loadingPorts" | "signature" | "catalogUrl";
export const FACT_FIELDS: readonly FactField[] = ["moq", "sampleLeadTime", "productionLeadTime", "loadingPorts", "signature", "catalogUrl"];

export interface MoqValue {
  quantity: number;
  unit: string;
  /** 按什么计（色 / 款 / 单）；回复里没写时为 null，起卡时沿用企业当前值 */
  per: string | null;
}
export interface SampleLeadTimeValue {
  stockDays: number | null;
  customDaysMin: number | null;
  customDaysMax: number | null;
}
export interface ProductionLeadTimeValue {
  daysMin: number;
  daysMax: number;
  /** 起算点；回复里没写时为 null，起卡时沿用企业当前值 */
  startsFrom: string | null;
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

const PRICE_RE = new RegExp(
  [
    // 币种符号与百分比
    String.raw`\$|¥|￥|€|£|%`,
    // 币种代码：后面紧跟数字也算（"USD4.80"、"RMB25/pc"）；"Europe" 不算
    String.raw`\b(?:usd|rmb|cny|eur|gbp)(?![a-z])`,
    // CAD / AUD / HKD 只在紧挨数字时算（窗饰行业常说"CAD 图纸"）
    String.raw`\b(?:cad|aud|hkd)\s*\$?\d|\d[\d.,]*\s*(?:cad|aud|hkd)\b`,
    // 价格、费用、付款与账期（"60 days credit"、"net 30"）；"in charge of" 不算
    String.raw`\b(?:price[sd]?|pricing|costs?|discounts?|rebates?|commissions?|payments?|quotations?|quoted|dollars?|euros?|cents?|fees?|credit|t\/t|l\/c|o\/a|d\/p|net\s*\d+)\b|(?<!\bin\s)\bcharges?\b`,
    String.raw`\bfree\s+samples?\b|\bsamples?\s+(?:are|is)\s+free\b`,
    // 中文：金额单位只在紧挨数字或后跟"/ 每"时算（"元旦"、"元丰"不算）；"块"还可能是件数（"样品 3 块"），
    // 只在后跟"钱 / 一 / 每 / /"时算（"30块一件"）；"费"只认具体费用词（"消费者"不算）
    String.raw`报价|价格|单价|价钱|折扣|优惠|返点|佣金|付款|账期|货款|人民币|美元|美金|欧元|英镑|港币|港元|日元|块钱|\d\s*元|\d\s*块\s*(?:钱|一|每|[/／])|(?:元|块)\s*[/／每]`,
    String.raw`费用|运费|样品费|打样费|模具费|开版费|版费|手续费|快递费|收费|免费`,
  ].join("|"),
  "i",
);

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

/** "低于 / below" 句式里关键词前面的数字是买家的数量，不是起订量 */
const BELOW_RE = /\b(?:below|less\s+than|under|lower\s+than|short\s+of)\b|低于|不到|少于|不足|达不到/i;
/** 关键词前紧挨着的"数字 + 单位（+ 按什么计）"（"500 pcs MOQ"、"每色500件起订"） */
const NUMBER_BEFORE_KEYWORD_RE = /(\d[\d,]*(?:\.\d+)?\s*[A-Za-z件个套米]+(?:\s*[/／]\s*[A-Za-z色款]+|\s+per\s+[A-Za-z]+)?)\s*$/;

/**
 * 起订量取关键词之后最近的数字（"Your order of 300 pcs is below our MOQ of 500 pcs" → 500）；
 * 关键词之后没有数字时，只取紧挨在关键词前面的那个（"500 pcs MOQ"），且句子不是"低于起订量"句式。
 */
function moqOf(clause: string): MoqValue | null {
  const k = MOQ_RE.exec(clause);
  if (!k) return null;
  const valid = (n: { unit: string; value: number }) => !!MOQ_UNITS[n.unit] && Number.isInteger(n.value) && n.value > 0;
  const adjacent = BELOW_RE.test(clause) ? null : NUMBER_BEFORE_KEYWORD_RE.exec(clause.slice(0, k.index))?.[1];
  const n = captureNumbers(clause.slice(k.index)).find(valid) ?? (adjacent ? captureNumbers(adjacent).find(valid) : undefined);
  if (!n) return null;
  let per = n.per ? PER_NORMALIZE[n.per] : undefined;
  if (!per) {
    const m = PER_FALLBACK_RE.exec(clause);
    const word = (m?.[1] ?? m?.[2] ?? m?.[3])?.toLowerCase().replace("colour", "color");
    per = word ? PER_NORMALIZE[word] : undefined;
  }
  return { quantity: n.value, unit: MOQ_UNITS[n.unit], per: per ?? null };
}

const SAMPLE_RE = /\bsamples?\b|\bsampling\b|样品|打样|样板|寄样/i;
/** 现货样（"samples can be ready in 7 days" 的 ready 不算现货） */
const STOCK_RE = /\bstock\s+samples?\b|\bin[-\s]stock\b|\bexisting\s+samples?\b|\bready[-\s]made\b|现货|现成/i;
/** 大货起算点里的"样品"字样（"after PP sample approval"）不算样品时效 */
const PP_SAMPLE_RE = /\b(pp|pre-?production)\s+samples?(\s+approval)?\b|产前样|大货样|确认样/gi;
const PRODUCTION_RE = /\bproduction\b|lead\s*time|\bbulk\b|mass\s+production|\bdelivery\b|大货|生产周期|生产时间|交期|货期/i;
/** 运输时间不是大货周期（"Delivery to your warehouse takes 25-30 days by sea"） */
const TRANSIT_RE = /\bby\s+(?:sea|air|rail|train|truck|express|courier)\b|\btransit\b|\bsailing\b|\bvoyage\b|\bshipping\s+time\b|\bto\s+your\s+(?:port|warehouse|door|address|country)\b|\bdoor[-\s]to[-\s]door\b|海运|空运|铁路|快递|船期|航程|运输时间|在途|到港/i;

function sampleOf(clause: string): SampleLeadTimeValue | null {
  const withoutPp = clause.replace(PP_SAMPLE_RE, " ");
  if (!SAMPLE_RE.test(withoutPp)) return null;
  const range = dayRange(clause);
  if (!range) return null;
  if (STOCK_RE.test(clause)) return { stockDays: range.min, customDaysMin: null, customDaysMax: null };
  return { stockDays: null, customDaysMin: range.min, customDaysMax: range.max };
}

/** 起算点；句子里没写时返回 null（不猜，起卡时沿用企业当前值） */
function startsFromOf(clause: string): string | null {
  if (/\b(pp|pre-?production)\s+sample|产前样|大货样|确认样/i.test(clause)) return DEFAULT_PRODUCTION_STARTS_FROM;
  if (/\bdeposit\b|定金|订金/i.test(clause)) return "deposit received";
  if (/order\s+confirmation|confirm(?:ed|ing)?\s+(?:the\s+)?order|确认订单|下单/i.test(clause)) return "order confirmation";
  return null;
}

function productionOf(clause: string): ProductionLeadTimeValue | null {
  const withoutPp = clause.replace(PP_SAMPLE_RE, " ");
  // "Pre-production sample takes 5 days" 里的 production 是产前样的，不是大货
  if (!PRODUCTION_RE.test(withoutPp) || TRANSIT_RE.test(clause)) return null;
  // 去掉起算点后仍提到样品 → 这一句说的是样品时效，不是大货
  if (SAMPLE_RE.test(withoutPp)) return null;
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
/** 目的港 / 卸货港不是我方装运港 */
const DESTINATION_PORT_RE = /\bdestination\b|\bdischarge\b|\bpod\b|\bport\s+of\s+(?:destination|discharge|entry)\b|\bto\s+(?:the\s+)?port\s+of\b|\bdeliver(?:ed|y)?\s+to\b|目的港|卸货港|到港|目的地/i;

/** 港口名（任何写法，含 "Ningbo Port" / "宁波港"）→ 英文规范名；不认识返回 null */
export function canonicalPort(name: string): string | null {
  const n = name.trim().toLowerCase().replace(/\s*(?:port|harbou?r|港)$/, "").trim();
  return LOADING_PORTS.find((p) => p.name.toLowerCase() === n || p.aliases.includes(n))?.name ?? null;
}

function portsOf(clause: string): string[] {
  if (!PORT_CONTEXT_RE.test(clause) || DESTINATION_PORT_RE.test(clause)) return [];
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

/** 目录链接只收 https（与商务事实合并规则一致）：www. 开头补 https://；http:// 不收（无法确认支持 https） */
export function normalizeCatalogUrl(url: string): string | null {
  if (/^https:\/\//i.test(url)) return `https://${url.slice("https://".length)}`;
  if (/^www\./i.test(url)) return `https://${url}`;
  return null;
}

/** 社交主页不是企业网站 */
const SOCIAL_HOST_RE = /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|wa\.me|weixin\.qq\.com)$/i;

const TITLE_RE =
  /\b(sales|export|marketing|account|business\s+development|general|purchasing|product|project)?\s*(manager|director|executive|representative|specialist|coordinator|assistant|ceo|founder)\b|经理|总监|主管|专员|业务员|总经理/i;
/** "WhatsApp: +86…"、"WhatsApp/WeChat: +86…"、"WhatsApp & WeChat +86…" */
const WHATSAPP_RE = /whats\s*app(?:\s*[/&,，、]\s*(?:we\s*chat|微信|viber|line))?\s*[:：]?\s*(\+?\d[\d\s()-]{6,}\d)/i;
const POSTSCRIPT_RE = /^p\.?\s?s\.?(?:\s|:|：)/i;

/** 签名段里的职位 / WhatsApp / 网站；lineIndex 是第一个抽到的子字段所在的行（作证据句） */
function signatureOf(lines: readonly string[], domain: string | null, buyerPhoneDigits: string | null): { value: SignatureValue; lineIndex: number } | null {
  let title: string | null = null;
  let whatsapp: string | null = null;
  let website: string | null = null;
  let first = -1;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || isClosing(line) || POSTSCRIPT_RE.test(line)) return;
    const hit = () => {
      if (first < 0) first = i;
    };
    const wa = WHATSAPP_RE.exec(line);
    if (wa) {
      const v = wa[1].replace(/\s+/g, " ").trim();
      if (!whatsapp && (!buyerPhoneDigits || digitsOf(v) !== buyerPhoneDigits)) {
        whatsapp = v;
        hit();
      }
      return;
    }
    const url = firstUrl(line);
    if (url && !CATALOG_RE.test(line) && !line.includes("@")) {
      const host = hostOf(url);
      if (!website && !isBuyerUrl(url, domain) && !(host && SOCIAL_HOST_RE.test(host))) {
        website = url;
        hit();
      }
      return;
    }
    // 职位是短行（不超过 6 个词），不是一句话
    if (!title && line.length <= 60 && line.split(/\s+/).length <= 6 && TITLE_RE.test(line) && !/\d|@|https?:|www\./i.test(line)) {
      title = line.replace(/[,，]$/, "");
      hit();
    }
  });
  return title || whatsapp || website ? { value: { title, whatsapp, website }, lineIndex: first } : null;
}

export interface ExtractOptions {
  /** 买家邮箱（取同域排除） */
  buyerEmail?: string | null;
  /** 买家电话（WhatsApp 与之相同则排除） */
  buyerPhone?: string | null;
  /**
   * 整封回复里有没有结束语。只传新增行时必须由调用方按整封回复判：
   * 结束语和草稿一样时不算新增，只看传进来的行会误以为没有结束语，把签名口号当事实抽。
   */
  signatureHasClosing?: boolean;
}

/**
 * 从带段落类型的行里抽取商务事实（行应已截掉引用）。每个字段只取第一个值；lineIndex 指向触发它的那一行。
 * 事实段 / 追问段 / 问候段里的行都看前 5 个字段；签名只看签名段。
 * 签名段里没有结束语时（"Hi Mark,\n\nMOQ is 500 pcs per color." 这种短回复，最后一段会被兜底判成签名），
 * 签名段的行也看前 5 个字段。
 */
export function extractFacts(lines: readonly FactLine[], opts: ExtractOptions = {}): ExtractedFact[] {
  const domain = buyerDomain(opts.buyerEmail);
  const buyerPhoneDigits = opts.buyerPhone ? digitsOf(opts.buyerPhone) || null : null;
  const found = new Map<FactField, ExtractedFact>();
  const put = (f: ExtractedFact) => {
    if (!found.has(f.field)) found.set(f.field, f);
  };

  const signatureHasClosing = opts.signatureHasClosing ?? lines.some((l) => l.section === "signature" && isClosing(l.line.trim()));
  lines.forEach(({ line, section }, lineIndex) => {
    if ((section === "signature" && signatureHasClosing) || isPriceLine(line)) return;
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
      const rawUrl = firstUrl(line);
      const url = rawUrl ? normalizeCatalogUrl(rawUrl) : null;
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
    if (sig) put({ field: "signature", value: sig.value, lineIndex: sigIndexes[sig.lineIndex] });
  }
  return FACT_FIELDS.map((f) => found.get(f)).filter((f): f is ExtractedFact => !!f);
}

// ── 规范键与中文展示 ──────────────────────────────────────

/** 比较与驳回去重用的规范键（同一事实不同写法得到同一个键） */
export function factValueKey(field: FactField, value: unknown): string {
  const v = value as Record<string, unknown> & unknown[];
  switch (field) {
    case "moq":
      return `${v.quantity}|${String(v.unit).toLowerCase()}|${v.per ? String(v.per).toLowerCase() : "-"}`;
    case "sampleLeadTime":
      return `${v.stockDays ?? "-"}|${v.customDaysMin ?? "-"}|${v.customDaysMax ?? "-"}`;
    case "productionLeadTime":
      return `${v.daysMin}|${v.daysMax}|${v.startsFrom ? String(v.startsFrom).toLowerCase() : "-"}`;
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
      return v.per ? `${v.quantity} ${v.unit} / ${v.per}` : `${v.quantity} ${v.unit}`;
    case "sampleLeadTime": {
      const parts: string[] = [];
      if (v.stockDays) parts.push(`现货样 ${v.stockDays} 天`);
      if (v.customDaysMin) parts.push(`定制样 ${v.customDaysMin}${v.customDaysMax && v.customDaysMax !== v.customDaysMin ? `–${v.customDaysMax}` : ""} 天`);
      return parts.join("，") || "未配置";
    }
    case "productionLeadTime":
      return `${v.daysMin}${v.daysMax !== v.daysMin ? `–${v.daysMax}` : ""} 天${v.startsFrom ? `（自 ${v.startsFrom} 起）` : ""}`;
    case "loadingPorts":
      return (value as string[]).join("、");
    case "signature":
      return [v.title ? `职位 ${v.title}` : null, v.whatsapp ? `WhatsApp ${v.whatsapp}` : null, v.website ? `网站 ${v.website}` : null].filter(Boolean).join("，") || "未配置";
    case "catalogUrl":
      return String(value);
  }
}
