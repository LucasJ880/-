/**
 * Revenue Spine — 首次回复草稿（PART 6 / 14）
 *
 * 硬约束：
 * - 草稿只陈述 RFQ 已确认事实与 Factory Knowledge 中 status=available 的事实
 * - MOQ / 价格 / 生产周期 / 认证 / 交期 / 样品时效 / 付款条款 / 折扣：无数据时一律写"需内部确认"
 * - checkDraftGuardrails 在任何 LLM 润色之后再跑一次；违规回退到模板
 * - 企业在 commercialFacts 里确认过的参考值（MOQ / 大货周期）只能以模板生成的原句出现：
 *   守卫先剔除这些原句再按最严规则检查，润色后原句必须一字不差保留，否则回退模板
 * - 企业确认的草稿偏好（B-3，policy.fde）只在调用方显式传入 preferences 时生效：问候 / 结束语 / 敬语 / 禁用词。
 *   不传时每一行逻辑与偏好接入前相同（金样本 __tests__/fixtures/draft-golden-pre-b3.json 锁定）
 * - 本模块只产出草稿，不发送
 */

import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import type { FactoryKnowledgeBundle } from "./factory-knowledge";
import { unsafeToRepeat } from "./inquiry-risks";
import type { InquiryLanguage } from "./normalize";
import { normalizeStyleCode, type DraftPreferenceText, type RevenueSpinePolicy } from "./policy";
import type { ClarifyingQuestion } from "./rfq/missing-info";
import { RFQ_FIELD_LABELS, type RfqField, type RfqFields } from "./rfq/types";

export interface ReplyDraftInput {
  language: InquiryLanguage;
  contactName: string | null;
  companyName: string | null;
  orgName: string;
  senderName: string;
  fields: RfqFields;
  questions: ClarifyingQuestion[];
  knowledge: FactoryKnowledgeBundle;
  policy: RevenueSpinePolicy;
  /** 原始询盘（用于主题行） */
  inquirySubject?: string | null;
  /**
   * 展位见过面的买家（展会速记卡）：开头写展位来访而不是"通过官网联系"；
   * styles = 买家看过的参考款（OEM：做过、能做的款式，按买家规格定做，不是现货）
   */
  tradeShow?: { event: string | null; styles?: Array<{ code: string; name: string | null }> } | null;
  /** 展会卡等级（多张卡取最高）；C 级且企业开启 gradeCCatalogOnly 时只发目录、不追问 */
  boothGrade?: "A" | "B" | "C" | null;
  /** 企业确认的草稿偏好（已校验，见 draft-preferences.ts）；不传 / null = 默认模板 */
  preferences?: DraftTemplatePreferences | null;
}

/** 模板层用到的偏好（已通过校验：不含数字、不含商务承诺） */
export interface DraftTemplatePreferences {
  greeting: DraftPreferenceText;
  closing: DraftPreferenceText;
  valediction: DraftPreferenceText;
  /** key：偏好键名（如 bannedPhrases[2]），替换被退回时用来记审计 */
  bannedPhrases: ReadonlyArray<{ phrase: string; replacement: string; key?: string }>;
}

export interface ReplyDraft {
  subject: string;
  body: string;
  language: "zh" | "en";
  /** 草稿引用的事实（字段 → 值） */
  factsUsed: Array<{ field: RfqField; value: string }>;
  /** 显式声明为"需内部确认"的主题 */
  pendingInternalConfirmation: string[];
  guardrailViolations: string[];
  /** true = 模板生成；false = LLM 润色后通过守卫 */
  templateOnly: boolean;
  /**
   * 模板写入的、企业确认过的参考值原句（MOQ / 大货周期）。守卫检查前剔除；润色必须原样保留。
   * 没有配置商务事实时为空数组。
   */
  referenceLines?: string[];
  /** 只发目录、不追问（展会 C 级）；无回复跟进据此跳过 */
  catalogOnly?: boolean;
  /**
   * 只在传入偏好时出现：
   * - lines：草稿实际用到的偏好问候 / 结束语 / 敬语行（润色必须原样保留）；
   * - bannedPhrases：禁用词（润色不得多用）；keptLines：不做替换的保护行（润色判定时排除）；
   * - bannedPhrasesSkipped：替换后草稿多出了守卫违规，这一封没做替换；值是引起违规的禁用词键名（调用方记审计）。
   */
  preferences?: { lines: string[]; bannedPhrases: string[]; keptLines: string[]; bannedPhrasesSkipped?: string[] };
}

/** 剔除获准原句后按最严规则检查（原句以外不得出现任何数字承诺） */
export function checkDraftWithReferenceLines(body: string, referenceLines: readonly string[] = []): string[] {
  let stripped = body;
  for (const line of referenceLines) {
    if (line) stripped = stripped.split(line).join("");
  }
  return checkDraftGuardrails(stripped, {});
}

const fmtQty = (n: number) => n.toLocaleString("en-US");
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 英文并列：a / a and b / a, b and c；某一项自带 and 时最后一项前加逗号，免得连着两个 and */
export function joinEn(items: string[]): string {
  if (items.length <= 1) return items.join("");
  const comma = items.some((i) => / and /.test(i)) ? "," : "";
  return `${items.slice(0, -1).join(", ")}${comma} and ${items[items.length - 1]}`;
}

/** 参考值原句（MOQ / 大货周期 / 装运港）；只用企业配置的数字，不读买家来信 */
export function buildReferenceLines(knowledge: FactoryKnowledgeBundle, policy: RevenueSpinePolicy, lang: "en" | "zh"): string[] {
  const lines: string[] = [];
  const facts = policy.businessProfile.commercialFacts;
  const moq = knowledge.moq.status === "available" ? knowledge.moq.value : null;
  const lt = knowledge.leadTime.status === "available" ? knowledge.leadTime.value : null;
  const range = (a: number | null | undefined, b: number | null | undefined) =>
    a && b && b !== a ? `${a}–${b}` : `${a ?? b}`;
  if (lang === "zh") {
    const parts: string[] = [];
    if (moq) parts.push(`起订量一般为每${moq.per === "style" ? "款" : moq.per ?? "款"} ${fmtQty(moq.quantity)} ${moq.unit === "pcs" ? "件" : moq.unit}`);
    if (lt?.productionDays) {
      const from = lt.productionStartsFrom && /pre-production|bulk sample|大货样/i.test(lt.productionStartsFrom) ? "确认大货样后" : `${lt.productionStartsFrom ?? "确认大货样"}后`;
      parts.push(`大货生产一般在${from} ${range(lt.productionDays, lt.productionDaysMax)} 天`);
    }
    if (parts.length) lines.push(`供参考：${parts.join("；")}。具体以我们针对您项目的报价为准。`);
    if (facts.loadingPorts.length && parts.length) lines.push(`装运港可选：${facts.loadingPorts.join("、")}。`);
  } else {
    const parts: string[] = [];
    if (moq) parts.push(`our MOQ is typically ${fmtQty(moq.quantity)} ${moq.unit} per ${moq.per ?? "style"}`);
    if (lt?.productionDays) {
      parts.push(`bulk production usually takes ${range(lt.productionDays, lt.productionDaysMax)} days after ${lt.productionStartsFrom ?? "pre-production sample approval"}`);
    }
    if (parts.length) lines.push(`For reference, ${parts.join(", and ")}. Both are confirmed for your project in our quotation.`);
    if (facts.loadingPorts.length && parts.length) lines.push(`Loading ports: ${facts.loadingPorts.join(" or ")}.`);
  }
  return lines;
}

/** 企业配置的样品说明（买家要样品、且样品政策可用时）；可能含天数，只能以原句出现 */
export function sampleLineFor(knowledge: FactoryKnowledgeBundle, fields: RfqFields, lang: "en" | "zh"): string | null {
  if (knowledge.samplePolicy.status !== "available" || !fields.sampleRequired) return null;
  const sp = knowledge.samplePolicy.value;
  return lang === "zh"
    ? `关于样品：${sp.note || (sp.available ? "我们可以安排样品，具体方式待确认。" : "样品安排需内部确认。")}`
    : `Regarding samples: ${sp.note || (sp.available ? "we can arrange samples; details to be confirmed." : "sample arrangements are subject to internal confirmation.")}`;
}

/** 已获准引用的在市参考项目（同类目，最多一条） */
export function referenceProgramLines(policy: RevenueSpinePolicy, fields: RfqFields, lang: "en" | "zh"): string[] {
  return policy.businessProfile.commercialFacts.referencePrograms
    .filter((r) => r.category && fields.productCategory && r.category === fields.productCategory)
    .slice(0, 1)
    .map((r) => (lang === "zh" ? r.summaryZh : r.summaryEn));
}

/** 落款附加行（职位 / WhatsApp / 网站） */
export function signatureLines(policy: RevenueSpinePolicy, lang: "en" | "zh"): { afterName: string[]; afterOrg: string[] } {
  const sig = policy.businessProfile.commercialFacts.signature;
  if (!sig) return { afterName: [], afterOrg: [] };
  const afterOrg: string[] = [];
  if (sig.whatsapp) afterOrg.push(`WhatsApp ${sig.whatsapp}`);
  if (sig.website) afterOrg.push(sig.website);
  return { afterName: sig.title ? [sig.title] : [], afterOrg: lang === "zh" ? afterOrg : afterOrg };
}

/** 落款：发件人、职位、公司名、WhatsApp / 网站（首封与无回复跟进同一格式） */
export function signOff(senderName: string, orgName: string, sig?: { afterName: string[]; afterOrg: string[] }): string[] {
  return [senderName, ...(sig?.afterName ?? []), orgName, ...(sig?.afterOrg ?? [])];
}

/** 去掉企业禁止外发的款号（展会卡上记了也不写进邮件） */
export function allowedStyles<T extends { code: string }>(styles: readonly T[], policy: RevenueSpinePolicy): T[] {
  const blocked = new Set(policy.businessProfile.commercialFacts.blockedStyleCodes.map(normalizeStyleCode));
  return styles.filter((st) => !blocked.has(normalizeStyleCode(st.code)));
}

const CONFIRM_FIELDS: RfqField[] = [
  "productName",
  "quantity",
  "material",
  "composition",
  "size",
  "color",
  "customization",
  "packaging",
  "certification",
  "destinationCountry",
  "destinationCity",
  "incoterm",
  "requiredDeliveryDate",
  // 不复述买家的目标价：没必要请对方确认自己的价格，写出来也像是我方接受了这个价
];

function fmtValue(field: RfqField, fields: RfqFields, lang: "zh" | "en"): string | null {
  const v = fields[field];
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    // 买家只说了月份（「March 2027」「before March」）时抽取存的是月底：先写「end of March 2027」，不让人以为买家说了具体哪天；
    // 括号里保留 ISO 日期——买家回信引用草稿时，下一轮抽取仍按这个日期读（月份短语的优先级低于邮件头里的日期）
    const iso = v.toISOString().slice(0, 10);
    const lastDay = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + 1, 0)).getUTCDate();
    if (v.getUTCDate() === lastDay) {
      return lang === "zh" ? `${v.getUTCFullYear()}年${v.getUTCMonth() + 1}月底（${iso}）` : `end of ${MONTH_NAMES[v.getUTCMonth()]} ${v.getUTCFullYear()} (${iso})`;
    }
    return iso;
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  // 数量照原数字写（不加千分位）：买家回信会带着我们的主题 / 正文，加了千分位的旧数字在抽取打分上会和买家的新数量打平
  if (field === "quantity") return `${v}${fields.unit ? " " + fields.unit : ""}`;
  if (field === "targetPrice") return `${fields.currency ?? ""} ${v}`.trim();
  return String(v);
}

export interface GuardrailAllowances {
  moq?: string | null;
  leadTime?: string | null;
  price?: string | null;
  certification?: string[] | null;
}

/**
 * 守卫：草稿中不得出现未授权的数字承诺。
 * 返回违规描述列表（空 = 通过）。
 */
export function checkDraftGuardrails(body: string, allowed: GuardrailAllowances = {}): string[] {
  const violations: string[] = [];
  const text = body;
  const lower = body.toLowerCase();
  // 中文词前后没有 \b（\b 只认 ASCII 单词字符），中英文分开写
  if (!allowed.moq && (/\b(moq|minimum order(?: quantity)?)\b[^\n.]{0,20}?(\d[\d,]*)/i.test(text) || /(起订量|最小起订|起订)[^\n。]{0,10}?\d/.test(text))) {
    violations.push("MOQ 数字承诺（无工厂数据）");
  }
  if (!allowed.price && /(\$|€|£|usd|cad|eur|美元|加元)\s?\d|\d+(?:\.\d+)?\s?(usd|cad|eur|美元|加元|元)\s*(\/|per|each|每)/i.test(text)) {
    violations.push("价格数字承诺（无报价数据）");
  }
  if (!allowed.leadTime && /(\d+\s?(?:-|to|~)?\s?\d*\s?(days?|weeks?|天|周))\s*(?:lead time|production|delivery|to produce|for production|交期|生产周期|货期)/i.test(text)) {
    violations.push("生产周期/交期数字承诺（无工厂数据）");
  }
  if (!allowed.leadTime && /(lead time|production time|生产周期|交期)[^\n.]{0,15}?\d+\s?(days?|weeks?|天|周)/i.test(text)) {
    violations.push("生产周期/交期数字承诺（无工厂数据）");
  }
  // "Production takes 25 days"、"We can deliver within 15 days"、"20 天可以交货"
  if (
    !allowed.leadTime &&
    (/\b(production|produce|deliver(?:y|ed)?|ship(?:ped|ment)?|dispatch|ready|finish(?:ed)?|complete[ds]?)\b[^\n.]{0,25}?\b\d+\s?(?:-|to|~)?\s?\d*\s?(days?|weeks?)\b/i.test(text) ||
      /\d+\s?(天|周)[^\n。]{0,6}(交货|出货|发货|完成|到货)/.test(text))
  ) {
    violations.push("生产周期/交期数字承诺（无工厂数据）");
  }
  if (!allowed.price && /\b(fob|cif|cfr|exw|ddp|unit)\s+price\b[^\n.]{0,12}\d|\bprice\s+(?:is|of|at|will be)\s+\d/i.test(text)) {
    violations.push("价格数字承诺（无报价数据）");
  }
  if (
    !allowed.certification?.length &&
    (/(we (?:are|hold|have)|certified (?:by|with)|已通过|持有)[^\n.]{0,20}?(oeko-tex|gots|bsci|sedex|iso ?9001|grs)/i.test(text) ||
      /\b(our (?:factory|company|mill|products?)|we)\s+(?:has|have|holds?|is|are|got)\b[^\n.]{0,30}?\b(oeko-?tex|gots|bsci|sedex|smeta|iso ?9001|grs|wrap|amfori)/i.test(text) ||
      /\b(oeko-?tex|gots|bsci|sedex|smeta|iso ?9001|grs)\b[^\n.]{0,20}?\b(certified|approved|audited)\b/i.test(text))
  ) {
    violations.push("认证承诺（无认证数据）");
  }
  if (
    /(payment terms?|付款(?:条款|方式))[^\n.]{0,20}?(\d+\s?%|t\/t|l\/c|net \d+)/i.test(lower) ||
    /\d+\s?%\s?(deposit|advance|down payment|prepayment)|\bbalance (?:before|after|against|upon)\b|\bwe (?:can |will )?accept\b[^\n.]{0,30}(t\/t|l\/c|o\/a|d\/p|net \d+|deposit|open account|letter of credit)/i.test(lower) ||
    /\d+\s?%\s?(定金|预付)|(接受|可以).{0,6}(信用证|账期|赊账)/.test(text)
  ) {
    violations.push("付款条款承诺");
  }
  if (/(\d+\s?%\s?(discount|off)|折扣\s?\d+|\d+\s?折)/i.test(lower)) {
    violations.push("折扣承诺");
  }
  if (/\bfree (?:of charge )?samples?\b|\bsamples? (?:are |is |will be )?(?:free|free of charge|at no cost)\b|免费(?:提供)?样品|样品免费/i.test(text)) {
    violations.push("样品免费承诺（按样品政策确认）");
  }
  if (/\bexclusiv|\bsole (?:agent|distributor|supplier)\b|独家/i.test(text)) {
    violations.push("独家承诺");
  }
  if (/\b(match|beat)\b[^\n.]{0,20}\b(price|prices|quote|offer)\b|比.{0,6}(便宜|低)/i.test(text)) {
    violations.push("比价承诺");
  }
  if (/\bwe (?:can |will )?guarantee\b|\bguaranteed (?:delivery|price|quality)\b|保证(?:交期|价格|质量|按时)/i.test(text)) {
    violations.push("保证承诺");
  }
  if (/\b(compensat\w*|refund\w*|reimburs\w*)\b|赔偿|退款/i.test(text)) {
    violations.push("赔偿 / 退款承诺（转老板处理）");
  }
  if (/\blower (?:value|price|amount)\b[^\n.]{0,30}\binvoice|\binvoice\b[^\n.]{0,30}\blower (?:value|price|amount)|undervalu|低报|少报/i.test(text)) {
    violations.push("低报货值");
  }
  return [...new Set(violations)];
}

// ── 禁用词（B-3 草稿偏好） ─────────────────────────────────────

const CJK_RE = /[\u3400-\u9fff]/;

function bannedPhraseRe(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 含中文按子串；英文整词、不区分大小写（"inquiry" 不匹配 "inquiryForm"）
  return CJK_RE.test(phrase) ? new RegExp(escaped, "g") : new RegExp(`(^|[^A-Za-z0-9])(${escaped})(?=$|[^A-Za-z0-9])`, "gi");
}

/** 句子里的链接不替换（"catalog" 不能把 https://…/catalog 改坏） */
const URL_SPAN_SRC = String.raw`\b(?:[hH][tT][tT][pP][sS]?:\/\/|[wW][wW][wW]\.)\S+`;
/** 挡住片段用的私用区分隔符（偏好校验禁止它们出现在禁用词与替换词里） */
const HOLD_OPEN = "\uE000";
const HOLD_CLOSE = "\uE001";

function keepTermSrc(term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 拉丁字母开头 / 结尾的专名按词边界挡（专名 "Re" 不能挡住 "received" 的一部分）
  return `${/^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9])" : ""}${escaped}${/[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9])" : ""}`;
}

/**
 * 按列出顺序逐条替换；英文句首大写的词替换后保持首字母大写；替换成空串时合并多余空格。
 * 链接与 keepTerms（公司名、买家产品名、展会名、联系人名等嵌在模板句子里的专名）先一次性挡住，替换完再放回。
 * 替换用函数形式：替换词里的 "$" 不当成替换模式。
 */
export function replaceBannedPhrases(
  line: string,
  phrases: ReadonlyArray<{ phrase: string; replacement: string }>,
  keepTerms: readonly (string | null | undefined)[] = [],
): string {
  const terms = [...new Set(keepTerms.filter((t): t is string => !!t && t.length >= 2 && !t.includes(HOLD_OPEN) && !t.includes(HOLD_CLOSE)))].sort(
    (a, b) => b.length - a.length,
  );
  const held: string[] = [];
  // 一次扫描挡住全部片段：分隔符里的编号不会再被后面的专名（如款号 "10"）拆开
  const holdRe = new RegExp([URL_SPAN_SRC, ...terms.map(keepTermSrc)].join("|"), "g");
  const masked = line.replace(holdRe, (m) => `${HOLD_OPEN}${held.push(m) - 1}${HOLD_CLOSE}`);
  let out = masked;
  for (const { phrase, replacement } of phrases) {
    const re = bannedPhraseRe(phrase);
    out = CJK_RE.test(phrase)
      ? out.replace(re, () => replacement)
      : out.replace(re, (_m, pre: string, word: string) => {
          const cap = /^[A-Z]/.test(word) && /^[a-z]/.test(replacement) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
          return `${pre}${cap}`;
        });
  }
  if (out === masked) return line;
  out = out.replace(/ {2,}/g, " ").replace(/ +([,.;:!?，。；：！？])/g, "$1");
  if (!line.startsWith(" ")) out = out.replace(/^ +/, "");
  return out.replace(new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g"), (m, i: string) => held[Number(i)] ?? m);
}

/** 文本里禁用词出现的总次数（与替换同一匹配规则） */
export function countBannedPhrases(text: string, phrases: readonly string[]): number {
  return phrases.reduce((n, p) => n + (text.match(bannedPhraseRe(p))?.length ?? 0), 0);
}

/**
 * 保护行之外替换禁用词（首封与无回复跟进共用）。替换后比替换前多出守卫违规（替换前就有的不算）时，
 * 退回替换前的正文与违规，并逐条试出引起违规的禁用词键名；单条都不引起、组合才引起时记全部。
 */
export function applyBannedPhrasesSafely(input: {
  lines: readonly string[];
  phrases: ReadonlyArray<{ phrase: string; replacement: string; key?: string }>;
  kept: ReadonlySet<string>;
  keepTerms: readonly (string | null | undefined)[];
  violationsOf: (body: string) => string[];
}): { body: string; violations: string[]; skipped: string[] } {
  const apply = (phrases: ReadonlyArray<{ phrase: string; replacement: string }>) =>
    input.lines.map((l) => (input.kept.has(l) ? l : replaceBannedPhrases(l, phrases, input.keepTerms))).join("\n");
  const plainBody = input.lines.join("\n");
  const body = apply(input.phrases);
  const violations = input.violationsOf(body);
  if (body === plainBody) return { body, violations, skipped: [] };
  const plain = input.violationsOf(plainBody);
  const adds = (v: string[]) => v.some((x) => !plain.includes(x));
  if (!adds(violations)) return { body, violations, skipped: [] };
  const keyOf = (b: { key?: string }, i: number) => b.key ?? `bannedPhrases[${i}]`;
  const culprits = input.phrases.flatMap((b, i) => (adds(input.violationsOf(apply([b]))) ? [keyOf(b, i)] : []));
  return { body: plainBody, violations: plain, skipped: culprits.length ? culprits : input.phrases.map(keyOf) };
}

/** 去掉保护行后的文本（润色判定禁用词时只看模板自己的句子） */
function withoutLines(text: string, kept: ReadonlySet<string>): string {
  return text
    .split("\n")
    .filter((l) => !kept.has(l))
    .join("\n");
}

/** 整词 / 整短语包含（"m" 不算在 "blanket" 里） */
function containsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(haystack);
}

export function buildReplyDraft(input: ReplyDraftInput): ReplyDraft {
  const lang: "zh" | "en" = input.language === "zh" ? "zh" : "en";
  const { fields, knowledge } = input;
  const facts: Array<{ field: RfqField; value: string }> = [];
  // 展会参考款已在开头逐一列出，不再作为"产品名"重复确认；
  // 从参考款品类名里读出的材质等（如 Coral Fleece）是参考款的，不是买家的要求，也不请买家确认
  const styleNames = (input.tradeShow?.styles ?? []).map((st) => st.name?.toLowerCase()).filter((n): n is string => Boolean(n));
  for (const f of CONFIRM_FIELDS) {
    if (styleNames.length && f === "productName") continue;
    const v = fmtValue(f, fields, lang);
    if (!v) continue;
    if (styleNames.some((n) => containsPhrase(n, v.toLowerCase()))) continue;
    // 买家原话里的折扣、定金、索赔、品牌图案、给 AI 的指令等不复述（像是我方认可了），审核提醒里会单独列出
    if (checkDraftGuardrails(v).length || unsafeToRepeat(v)) continue;
    // 成分 / 克重已经包含在材质里（「Material: 100% cotton, 500gsm」）就不再列一遍
    if (f === "composition" && facts.some((x) => x.field === "material" && x.value.toLowerCase().includes(v.toLowerCase()))) continue;
    facts.push({ field: f, value: v });
  }
  const pending: string[] = [];
  if (knowledge.moq.status !== "available") pending.push("MOQ");
  if (knowledge.leadTime.status !== "available") pending.push(lang === "zh" ? "生产周期与交期" : "production lead time and delivery schedule");
  pending.push(lang === "zh" ? "价格" : "pricing");
  if (knowledge.certification.status !== "available" && fields.certification) pending.push(lang === "zh" ? "认证" : "certification");
  if (fields.sampleRequired && knowledge.samplePolicy.status !== "available") pending.push(lang === "zh" ? "样品安排" : "sample arrangement");

  const met = input.tradeShow ?? null;
  const atEventZh = met?.event ? (/^[A-Za-z0-9]/.test(met.event) ? `在 ${met.event} ` : `在${met.event}`) : "在展会上";
  const styles = allowedStyles(met?.styles ?? [], input.policy);
  const cf = input.policy.businessProfile.commercialFacts;
  // 英文邮件用对外英文公司名（组织名常是中文）；中文草稿仍用组织名
  const orgName = lang === "en" ? cf.buyerFacingName || input.orgName : input.orgName;
  const catalogOnly = Boolean(met && input.boothGrade === "C" && cf.gradeCCatalogOnly);
  // termLines：正文里渲染的条款原句；referenceLines：守卫白名单（条款原句 + 含数字的样品说明）
  const termLines = catalogOnly ? [] : buildReferenceLines(knowledge, input.policy, lang);
  const referenceLines = [...termLines];
  // 企业配置的样品说明（可能含天数）同样只能以原句出现
  const sampleLine = catalogOnly ? null : sampleLineFor(knowledge, fields, lang);
  if (sampleLine && /\d/.test(sampleLine)) referenceLines.push(sampleLine);
  const sig = signatureLines(input.policy, lang);
  const references = catalogOnly ? [] : referenceProgramLines(input.policy, fields, lang);
  const styleLabel = (st: { code: string; name: string | null }, zh: boolean) =>
    st.name ? (zh ? `${st.name}（参考款 ${st.code}）` : `${st.name} (ref. ${st.code})`) : st.code;
  const styleSubject = (zh: boolean) =>
    styles.length
      ? `${styles[0].name ?? styles[0].code}${styles.length > 1 ? (zh ? ` 等 ${styles.length} 款` : ` and ${styles.length - 1} more`) : ""}`
      : null;
  const product =
    fields.productName ??
    (met ? (lang === "zh" ? "您感兴趣的产品" : "the products we discussed") : lang === "zh" ? "您咨询的产品" : "the products you inquired about");
  const greetName = input.contactName ?? (lang === "zh" ? "您好" : "there");
  const prefs = input.preferences ?? null;
  // 偏好问候只在有联系人名时用（"Hi {name}," 没有名字就不成句）
  // 函数形式替换：联系人名是买家给的，里面的 "$" 不能当替换模式
  const prefGreeting = prefs && input.contactName && prefs.greeting[lang] ? prefs.greeting[lang]!.replace("{name}", () => input.contactName!) : null;
  const prefClosing = prefs?.closing[lang] ?? null;
  const prefValediction = prefs?.valediction[lang] ?? null;
  const questions = catalogOnly ? [] : input.questions.slice(0, input.policy.followUp.maxQuestionsPerReply);
  const confirmFacts = catalogOnly ? [] : facts;
  // 主题里的数量只用过了护栏的确认事实（单位里夹着折扣、价格、交期字样时，主题也不写）
  const subjectQty = facts.some((f) => f.field === "quantity") && fields.quantity ? fields.quantity : null;

  // "需内部确认"段：价格 / MOQ / 交期等永远写明需内部确认，偏好不能改它
  const pendingLine =
    lang === "zh"
      ? `关于${pending.join("、")}：${pending.length > 1 ? "以上均" : ""}需内部确认，我们会在收到上述信息后尽快给您正式答复。`
      : `Regarding ${joinEn(pending)}: our team will confirm ${pending.length > 1 ? "these" : "this"} internally once we have the details above and revert to you with a formal reply.`;

  /** 偏好实际用到的行：企业自己写的，不做禁用词替换；润色必须原样保留 */
  const preferenceLines = [prefGreeting, prefClosing, prefValediction].filter((l): l is string => Boolean(l));
  /**
   * 禁用词只替换模板自己的句子。原样保留：需求复述、参考款、参考项目、条款原句与样品说明、"需内部确认"段、署名块、偏好行
   * （复述改了就不是买家原意；条款原句必须一字不差，守卫靠它放行数字；需内部确认段不能被改成承诺）。
   * 模板句子里嵌着的专名（公司名、买家产品名、展会名、联系人名、参考款）与链接也不替换。
   */
  const kept = new Set<string>();
  const keepTerms = [orgName, input.orgName, input.companyName, fields.productName, met?.event, input.contactName, ...styles.flatMap((st) => [st.name, st.code])];
  /** 替换后多出守卫违规、这一封退回时，引起违规的禁用词键名 */
  let bannedPhrasesSkipped: string[] = [];
  const finishBody = (lines: string[], subjectLine: string): string => {
    if (!prefs?.bannedPhrases.length) return lines.join("\n");
    const zh = lang === "zh";
    for (const l of [
      ...confirmFacts.map((f) => `- ${RFQ_FIELD_LABELS[f.field][lang]}${zh ? "：" : ": "}${f.value}`),
      ...styles.map((st) => `- ${styleLabel(st, zh)}`),
      // main 上 referenceProgramLines 已按语言返回成句
      ...references,
      ...termLines,
      ...(sampleLine ? [sampleLine] : []),
      pendingLine,
      ...signOff(input.senderName, orgName, sig),
      ...preferenceLines,
    ])
      kept.add(l);
    // 替换后多出了守卫违规（如买家产品名 "samples kit" 遇上 "inquiry about → free" 拼成 "your free samples kit"）：这一封不做替换
    // （替换前就有的违规照常保留——不掩盖买家原文带来的问题；不让配置错误把每封草稿都拦在审批中心外）
    const r = applyBannedPhrasesSafely({
      lines,
      phrases: prefs.bannedPhrases,
      kept,
      keepTerms,
      violationsOf: (b) => checkDraftWithReferenceLines(`${subjectLine}\n${b}`, referenceLines),
    });
    bannedPhrasesSkipped = r.skipped;
    return r.body;
  };

  let subject: string;
  let body: string;
  if (lang === "zh") {
    const unitZh = fields.unit ? (/^[A-Za-z]/.test(fields.unit) ? ` ${fields.unit}` : fields.unit) : "件";
    const qty = subjectQty ? `（${subjectQty}${unitZh}）` : "";
    subject = met
      ? `感谢展位来访：${styleSubject(true) ?? product}${qty} — ${orgName}`
      : `回复：${product}${qty}询盘 — ${orgName}`;
    const lines: string[] = [];
    lines.push(prefGreeting ?? `${greetName}${input.contactName ? "，您好" : ""}：`);
    lines.push("");
    if (met && styles.length) {
      lines.push(`感谢您${atEventZh}莅临 ${orgName} 的展位，很高兴与您交流。`);
      lines.push("");
      lines.push("您在展位看过的参考款（我们以往做过的款式）：");
      for (const st of styles) lines.push(`- ${styleLabel(st, true)}`);
      lines.push("每一款都可以按您的规格定做：尺寸、面料、克重、颜色、品牌和包装。");
    } else {
      lines.push(
        met
          ? `感谢您${atEventZh}莅临 ${orgName} 的展位，很高兴与您交流。以下是关于${product}的跟进。`
          : `感谢您通过官网联系 ${orgName}，我们已收到您关于${product}的询盘。`,
      );
    }
    if (confirmFacts.length) {
      lines.push("");
      lines.push("我们对需求的理解如下，请确认：");
      for (const f of confirmFacts) lines.push(`- ${RFQ_FIELD_LABELS[f.field].zh}：${f.value}`);
    }
    if (questions.length) {
      lines.push("");
      lines.push("为便于准确核算并给您报价，请补充以下信息：");
      questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`));
    }
    lines.push("");
    if (catalogOnly) {
      lines.push(cf.catalogUrl ? `我们的产品目录在这里，供您参考：${cf.catalogUrl}` : "我们会另行把产品目录发给您，供您参考。");
      lines.push("如有任何感兴趣的款式，随时回复这封邮件即可。");
    } else {
      for (const r of references) lines.push(r);
      for (const l of termLines) lines.push(l);
      if (sampleLine) lines.push(sampleLine);
      lines.push(pendingLine);
    }
    lines.push("");
    lines.push(prefClosing ?? "期待您的回复。");
    lines.push("");
    if (prefValediction) lines.push(prefValediction);
    lines.push(...signOff(input.senderName, orgName, sig));
    body = finishBody(lines, subject);
  } else {
    const qty = subjectQty ? ` (${subjectQty}${fields.unit ? " " + fields.unit : " pcs"})` : "";
    subject = met
      ? `Great meeting you${met.event ? ` at ${met.event}` : ""} — ${styleSubject(false) ?? product}${qty} — ${orgName}`
      : `Re: Your inquiry${fields.productName ? ` about ${product}` : ""}${qty} — ${orgName}`;
    const lines: string[] = [];
    lines.push(prefGreeting ?? `Dear ${greetName},`);
    lines.push("");
    if (met && styles.length) {
      lines.push(`Thank you for visiting the ${orgName} booth${met.event ? ` at ${met.event}` : ""} — it was a pleasure meeting you.`);
      lines.push("");
      lines.push("You looked at these reference styles from our past production:");
      for (const st of styles) lines.push(`- ${styleLabel(st, false)}`);
      lines.push("Each of them can be made to your own specification — size, fabric, weight, colour, branding and packing.");
    } else {
      lines.push(
        met
          ? `Thank you for visiting the ${orgName} booth${met.event ? ` at ${met.event}` : ""} — it was a pleasure meeting you. Here is our follow-up on ${product}.`
          : `Thank you for contacting ${orgName}${input.companyName ? ` on behalf of ${input.companyName}` : ""}. We have received your inquiry${fields.productName ? ` about ${product}` : ""}.`,
      );
    }
    if (confirmFacts.length) {
      lines.push("");
      lines.push("Here is our understanding of your requirement — please confirm:");
      for (const f of confirmFacts) lines.push(`- ${RFQ_FIELD_LABELS[f.field].en}: ${f.value}`);
    }
    if (questions.length) {
      lines.push("");
      lines.push("To prepare an accurate quotation, could you please let us know:");
      questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`));
    }
    lines.push("");
    if (catalogOnly) {
      lines.push(cf.catalogUrl ? `You can find our product catalogue here: ${cf.catalogUrl}` : "We will send you our product catalogue separately for your reference.");
      lines.push("If any of the styles catch your interest, simply reply to this email.");
    } else {
      for (const r of references) lines.push(r);
      for (const l of termLines) lines.push(l);
      if (sampleLine) lines.push(sampleLine);
      lines.push(pendingLine);
    }
    lines.push("");
    lines.push(prefClosing ?? "We look forward to hearing from you.");
    lines.push("");
    lines.push(prefValediction ?? "Best regards,");
    lines.push(...signOff(input.senderName, orgName, sig));
    body = finishBody(lines, subject);
  }

  const violations = checkDraftWithReferenceLines(`${subject}\n${body}`, referenceLines);
  return {
    subject,
    body,
    language: lang,
    factsUsed: confirmFacts,
    pendingInternalConfirmation: catalogOnly ? [] : pending,
    guardrailViolations: violations,
    templateOnly: true,
    referenceLines,
    catalogOnly,
    ...(prefs
      ? {
          preferences: {
            lines: preferenceLines,
            bannedPhrases: prefs.bannedPhrases.map((b) => b.phrase),
            keptLines: [...kept],
            ...(bannedPhrasesSkipped.length ? { bannedPhrasesSkipped } : {}),
          },
        }
      : {}),
  };
}

/**
 * 可选 LLM 润色：只允许改措辞，不允许新增事实；润色后过守卫，失败回退模板。
 */
export async function polishReplyDraftWithLlm(
  draft: ReplyDraft,
  ctx: {
    orgId: string;
    userId: string;
    agentRunId?: string;
    timeoutMs?: number;
    /** 测试注入：替代真实 LLM（检验润色结果过守卫、失败回退模板） */
    complete?: (body: string) => Promise<string>;
  },
): Promise<ReplyDraft> {
  if (!ctx.complete && !isAIConfigured()) return draft;
  const prefLines = draft.preferences?.lines ?? [];
  const banned = draft.preferences?.bannedPhrases ?? [];
  // 只在传入了偏好时追加约束；不传时提示词逐字不变
  const preferencePrompt =
    prefLines.length || banned.length
      ? ` Copy these lines exactly as they are: ${prefLines.map((l) => JSON.stringify(l)).join(", ") || "(none)"}. Never use these phrases: ${banned.map((b) => JSON.stringify(b)).join(", ") || "(none)"}.`
      : "";
  try {
    const polished = ctx.complete ? await ctx.complete(draft.body) : await createCompletion({
      systemPrompt:
        "You are a professional B2B OEM sales writer. Rewrite the email body for tone and flow ONLY. " +
        "Do not add, remove or change any facts, numbers, questions or commitments. Never state MOQ, prices, lead times, certifications, payment terms or discounts " +
        "except where they already appear in the input — any sentence that starts with \"For reference\", \"供参考\", \"Regarding samples\" or \"关于样品\" and any \"Loading ports\" / \"装运港\" line must be copied verbatim, character for character. " +
        "Keep the sign-off lines (name, title, company, WhatsApp, website) exactly as they are. " +
        "Never promise free samples, exclusivity, price matching, compensation or refunds, and never mention brands or characters. " +
        "Keep the same language as the input. Output only the email body." +
        preferencePrompt,
      userPrompt: draft.body,
      mode: "fast",
      temperature: 0.3,
      maxTokens: 900,
      timeoutMs: ctx.timeoutMs ?? 20_000,
      orgId: ctx.orgId,
      userId: ctx.userId,
      agentRunId: ctx.agentRunId,
    });
    const body = polished.trim();
    if (!body || body.length < 80) return draft;
    const refs = draft.referenceLines ?? [];
    // 参考值原句必须一字不差保留；剔除原句后不得再出现任何数字承诺
    if (refs.some((l) => !body.includes(l))) return draft;
    const violations = checkDraftWithReferenceLines(body, refs);
    // 润色稿不过守卫：回退模板原样（保留模板自身的守卫结果，不清零）
    if (violations.length) return draft;
    // 问题数不得减少（润色不能吞掉问题）
    const questionCount = draft.body.split("\n").filter((l) => /^\d+\.\s/.test(l)).length;
    const polishedCount = body.split("\n").filter((l) => /^\d+\.\s/.test(l)).length;
    if (polishedCount < questionCount) return draft;
    // 偏好（B-3）：偏好行必须原样保留；去掉原样保留的保护行后，禁用词不得比模板草稿多
    // （LLM 改写了保护行，那一行就算进模板句子：把禁用词从复述行挪进模板句子也会被发现）
    if (prefLines.some((l) => !body.includes(l))) return draft;
    if (banned.length) {
      const kept = new Set(draft.preferences?.keptLines ?? []);
      if (countBannedPhrases(withoutLines(body, kept), banned) > countBannedPhrases(withoutLines(draft.body, kept), banned)) return draft;
    }
    return { ...draft, body, guardrailViolations: violations, templateOnly: false };
  } catch (err) {
    console.warn("[revenue-spine] draft polish failed:", err instanceof Error ? err.message : err);
    return draft;
  }
}
