/**
 * Revenue Spine — 首次回复草稿（PART 6 / 14）
 *
 * 硬约束：
 * - 草稿只陈述 RFQ 已确认事实与 Factory Knowledge 中 status=available 的事实
 * - MOQ / 价格 / 生产周期 / 认证 / 交期 / 样品时效 / 付款条款 / 折扣：无数据时一律写"需内部确认"
 * - checkDraftGuardrails 在任何 LLM 润色之后再跑一次；违规回退到模板
 * - 企业在 commercialFacts 里确认过的参考值（MOQ / 大货周期）只能以模板生成的原句出现：
 *   守卫先剔除这些原句再按最严规则检查，润色后原句必须一字不差保留，否则回退模板
 * - 本模块只产出草稿，不发送
 */

import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import type { FactoryKnowledgeBundle } from "./factory-knowledge";
import { unsafeToRepeat } from "./inquiry-risks";
import type { InquiryLanguage } from "./normalize";
import type { RevenueSpinePolicy } from "./policy";
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
}

/** 剔除获准原句后按最严规则检查（原句以外不得出现任何数字承诺） */
export function checkDraftWithReferenceLines(body: string, referenceLines: readonly string[] = []): string[] {
  let stripped = body;
  for (const line of referenceLines) {
    if (line) stripped = stripped.split(line).join("");
  }
  return checkDraftGuardrails(stripped, {});
}

/** 参考值原句（MOQ / 大货周期 / 装运港）；只用企业配置的数字，不读买家来信 */
export function buildReferenceLines(knowledge: FactoryKnowledgeBundle, policy: RevenueSpinePolicy, lang: "en" | "zh"): string[] {
  const lines: string[] = [];
  const facts = policy.businessProfile.commercialFacts;
  const moq = knowledge.moq.status === "available" ? knowledge.moq.value : null;
  const lt = knowledge.leadTime.status === "available" ? knowledge.leadTime.value : null;
  const fmtQty = (n: number) => n.toLocaleString("en-US");
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
    if (facts?.loadingPorts?.length && parts.length) lines.push(`装运港可选：${facts.loadingPorts.join("、")}。`);
  } else {
    const parts: string[] = [];
    if (moq) parts.push(`our MOQ is typically ${fmtQty(moq.quantity)} ${moq.unit} per ${moq.per ?? "style"}`);
    if (lt?.productionDays) {
      parts.push(`bulk production usually takes ${range(lt.productionDays, lt.productionDaysMax)} days after ${lt.productionStartsFrom ?? "pre-production sample approval"}`);
    }
    if (parts.length) lines.push(`For reference, ${parts.join(", and ")}. Both are confirmed for your project in our quotation.`);
    if (facts?.loadingPorts?.length && parts.length) lines.push(`Loading ports: ${facts.loadingPorts.join(" or ")}.`);
  }
  return lines;
}

/** 落款附加行（职位 / WhatsApp / 网站） */
export function signatureLines(policy: RevenueSpinePolicy, lang: "en" | "zh"): { afterName: string[]; afterOrg: string[] } {
  const sig = policy.businessProfile.commercialFacts?.signature ?? null;
  if (!sig) return { afterName: [], afterOrg: [] };
  const afterOrg: string[] = [];
  if (sig.whatsapp) afterOrg.push(`WhatsApp ${sig.whatsapp}`);
  if (sig.website) afterOrg.push(sig.website);
  return { afterName: sig.title ? [sig.title] : [], afterOrg: lang === "zh" ? afterOrg : afterOrg };
}

const normStyle = (v: string) => v.replace(/\s+/g, "").replace(/[–—_]/g, "-").toUpperCase();

/** 去掉企业禁止外发的款号（展会卡上记了也不写进邮件） */
export function allowedStyles<T extends { code: string }>(styles: readonly T[], policy: RevenueSpinePolicy): T[] {
  const blocked = new Set((policy.businessProfile.commercialFacts?.blockedStyleCodes ?? []).map(normStyle));
  return styles.filter((st) => !blocked.has(normStyle(st.code)));
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

function fmtValue(field: RfqField, fields: RfqFields): string | null {
  const v = fields[field];
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "yes" : "no";
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
    const v = fmtValue(f, fields);
    if (!v) continue;
    if (styleNames.some((n) => containsPhrase(n, v.toLowerCase()))) continue;
    // 买家原话里的折扣、定金、索赔、品牌图案、给 AI 的指令等不复述（像是我方认可了），审核提醒里会单独列出
    if (checkDraftGuardrails(v).length || unsafeToRepeat(v)) continue;
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
  const orgName = lang === "en" ? cf?.buyerFacingName || input.orgName : input.orgName;
  const catalogOnly = Boolean(met && input.boothGrade === "C" && cf?.gradeCCatalogOnly);
  // termLines：正文里渲染的条款原句；referenceLines：守卫白名单（条款原句 + 含数字的样品说明）
  const termLines = catalogOnly ? [] : buildReferenceLines(knowledge, input.policy, lang);
  const referenceLines = [...termLines];
  // 企业配置的样品说明（可能含天数）同样只能以原句出现
  const sampleLine =
    !catalogOnly && knowledge.samplePolicy.status === "available" && fields.sampleRequired
      ? lang === "zh"
        ? `关于样品：${knowledge.samplePolicy.value.note || (knowledge.samplePolicy.value.available ? "我们可以安排样品，具体方式待确认。" : "样品安排需内部确认。")}`
        : `Regarding samples: ${knowledge.samplePolicy.value.note || (knowledge.samplePolicy.value.available ? "we can arrange samples; details to be confirmed." : "sample arrangements are subject to internal confirmation.")}`
      : null;
  if (sampleLine && /\d/.test(sampleLine)) referenceLines.push(sampleLine);
  const sig = signatureLines(input.policy, lang);
  const references = catalogOnly
    ? []
    : (cf?.referencePrograms ?? []).filter((r) => r.category && fields.productCategory && r.category === fields.productCategory).slice(0, 1);
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
  const questions = catalogOnly ? [] : input.questions.slice(0, input.policy.followUp.maxQuestionsPerReply);
  const confirmFacts = catalogOnly ? [] : facts;

  let subject: string;
  let body: string;
  if (lang === "zh") {
    const qty = fields.quantity ? `（${fields.quantity}${fields.unit ?? "件"}）` : "";
    subject = met
      ? `感谢展位来访：${styleSubject(true) ?? product}${qty} — ${orgName}`
      : `回复：${product}${qty}询盘 — ${orgName}`;
    const lines: string[] = [];
    lines.push(`${greetName}${input.contactName ? "，您好" : ""}：`);
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
      lines.push(cf?.catalogUrl ? `我们的产品目录在这里，供您参考：${cf.catalogUrl}` : "我们会另行把产品目录发给您，供您参考。");
      lines.push("如有任何感兴趣的款式，随时回复这封邮件即可。");
    } else {
      for (const r of references) lines.push(r.summaryZh);
      for (const l of termLines) lines.push(l);
      if (sampleLine) lines.push(sampleLine);
      lines.push(`关于${pending.join("、")}：${pending.length > 1 ? "以上均" : ""}需内部确认，我们会在收到上述信息后尽快给您正式答复。`);
    }
    lines.push("");
    lines.push("期待您的回复。");
    lines.push("");
    lines.push(`${input.senderName}`);
    for (const l of sig.afterName) lines.push(l);
    lines.push(`${orgName}`);
    for (const l of sig.afterOrg) lines.push(l);
    body = lines.join("\n");
  } else {
    const qty = fields.quantity ? ` (${fields.quantity}${fields.unit ? " " + fields.unit : " pcs"})` : "";
    subject = met
      ? `Great meeting you${met.event ? ` at ${met.event}` : ""} — ${styleSubject(false) ?? product}${qty} — ${orgName}`
      : `Re: Your inquiry${fields.productName ? ` about ${product}` : ""}${qty} — ${orgName}`;
    const lines: string[] = [];
    lines.push(`Dear ${greetName},`);
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
      lines.push(cf?.catalogUrl ? `You can find our product catalogue here: ${cf.catalogUrl}` : "We will send you our product catalogue separately for your reference.");
      lines.push("If any of the styles catch your interest, simply reply to this email.");
    } else {
      for (const r of references) lines.push(r.summaryEn);
      for (const l of termLines) lines.push(l);
      if (sampleLine) lines.push(sampleLine);
      lines.push(`Regarding ${pending.join(", ")}: our team will confirm ${pending.length > 1 ? "these" : "this"} internally once we have the details above and revert to you with a formal reply.`);
    }
    lines.push("");
    lines.push("We look forward to hearing from you.");
    lines.push("");
    lines.push("Best regards,");
    lines.push(input.senderName);
    for (const l of sig.afterName) lines.push(l);
    lines.push(orgName);
    for (const l of sig.afterOrg) lines.push(l);
    body = lines.join("\n");
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
  try {
    const polished = ctx.complete ? await ctx.complete(draft.body) : await createCompletion({
      systemPrompt:
        "You are a professional B2B OEM sales writer. Rewrite the email body for tone and flow ONLY. " +
        "Do not add, remove or change any facts, numbers, questions or commitments. Never state MOQ, prices, lead times, certifications, payment terms or discounts " +
        "except where they already appear in the input — any sentence that starts with \"For reference\", \"供参考\", \"Regarding samples\" or \"关于样品\" and any \"Loading ports\" / \"装运港\" line must be copied verbatim, character for character. " +
        "Keep the sign-off lines (name, title, company, WhatsApp, website) exactly as they are. " +
        "Never promise free samples, exclusivity, price matching, compensation or refunds, and never mention brands or characters. " +
        "Keep the same language as the input. Output only the email body.",
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
    return { ...draft, body, guardrailViolations: violations, templateOnly: false };
  } catch (err) {
    console.warn("[revenue-spine] draft polish failed:", err instanceof Error ? err.message : err);
    return draft;
  }
}
