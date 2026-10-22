/**
 * Revenue Spine — 首次回复草稿（PART 6 / 14）
 *
 * 硬约束：
 * - 草稿只陈述 RFQ 已确认事实与 Factory Knowledge 中 status=available 的事实
 * - MOQ / 价格 / 生产周期 / 认证 / 交期 / 样品时效 / 付款条款 / 折扣：无数据时一律写"需内部确认"
 * - checkDraftGuardrails 在任何 LLM 润色之后再跑一次；违规回退到模板
 * - 本模块只产出草稿，不发送
 */

import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import type { FactoryKnowledgeBundle } from "./factory-knowledge";
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
  "targetPrice",
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
  if (!allowed.moq && /\b(moq|minimum order(?: quantity)?|起订量|最小起订)\b[^\n.]{0,20}?(\d[\d,]*)/i.test(text)) {
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
  if (!allowed.certification?.length && /(we (?:are|hold|have)|certified (?:by|with)|已通过|持有)[^\n.]{0,20}?(oeko-tex|gots|bsci|sedex|iso ?9001|grs)/i.test(text)) {
    violations.push("认证承诺（无认证数据）");
  }
  if (/(payment terms?|付款(?:条款|方式))[^\n.]{0,20}?(\d+\s?%|t\/t|l\/c|net \d+)/i.test(lower)) {
    violations.push("付款条款承诺");
  }
  if (/(\d+\s?%\s?(discount|off)|折扣\s?\d+|\d+\s?折)/i.test(lower)) {
    violations.push("折扣承诺");
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
  const styles = met?.styles ?? [];
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
  const questions = input.questions.slice(0, input.policy.followUp.maxQuestionsPerReply);

  let subject: string;
  let body: string;
  if (lang === "zh") {
    const qty = fields.quantity ? `（${fields.quantity}${fields.unit ?? "件"}）` : "";
    subject = met
      ? `感谢展位来访：${styleSubject(true) ?? product}${qty} — ${input.orgName}`
      : `回复：${product}${qty}询盘 — ${input.orgName}`;
    const lines: string[] = [];
    lines.push(`${greetName}${input.contactName ? "，您好" : ""}：`);
    lines.push("");
    if (met && styles.length) {
      lines.push(`感谢您${atEventZh}莅临 ${input.orgName} 的展位，很高兴与您交流。`);
      lines.push("");
      lines.push("您在展位看过的参考款（我们以往做过的款式）：");
      for (const st of styles) lines.push(`- ${styleLabel(st, true)}`);
      lines.push("每一款都可以按您的规格定做：尺寸、面料、克重、颜色、品牌和包装。");
    } else {
      lines.push(
        met
          ? `感谢您${atEventZh}莅临 ${input.orgName} 的展位，很高兴与您交流。以下是关于${product}的跟进。`
          : `感谢您通过官网联系 ${input.orgName}，我们已收到您关于${product}的询盘。`,
      );
    }
    if (facts.length) {
      lines.push("");
      lines.push("我们对需求的理解如下，请确认：");
      for (const f of facts) lines.push(`- ${RFQ_FIELD_LABELS[f.field].zh}：${f.value}`);
    }
    if (questions.length) {
      lines.push("");
      lines.push("为便于准确核算并给您报价，请补充以下信息：");
      questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`));
    }
    lines.push("");
    if (knowledge.samplePolicy.status === "available" && fields.sampleRequired) {
      lines.push(`关于样品：${knowledge.samplePolicy.value.note || (knowledge.samplePolicy.value.available ? "我们可以安排样品，具体方式待确认。" : "样品安排需内部确认。")}`);
    }
    lines.push(`关于${pending.join("、")}：以上均需内部确认，我们会在收到上述信息后尽快给您正式答复。`);
    lines.push("");
    lines.push("期待您的回复。");
    lines.push("");
    lines.push(`${input.senderName}`);
    lines.push(`${input.orgName}`);
    body = lines.join("\n");
  } else {
    const qty = fields.quantity ? ` (${fields.quantity}${fields.unit ? " " + fields.unit : " pcs"})` : "";
    subject = met
      ? `Great meeting you${met.event ? ` at ${met.event}` : ""} — ${styleSubject(false) ?? product}${qty} — ${input.orgName}`
      : `Re: Your inquiry about ${product}${qty} — ${input.orgName}`;
    const lines: string[] = [];
    lines.push(`Dear ${greetName},`);
    lines.push("");
    if (met && styles.length) {
      lines.push(`Thank you for visiting the ${input.orgName} booth${met.event ? ` at ${met.event}` : ""} — it was a pleasure meeting you.`);
      lines.push("");
      lines.push("You looked at these reference styles from our past production:");
      for (const st of styles) lines.push(`- ${styleLabel(st, false)}`);
      lines.push("Each of them can be made to your own specification — size, fabric, weight, colour, branding and packing.");
    } else {
      lines.push(
        met
          ? `Thank you for visiting the ${input.orgName} booth${met.event ? ` at ${met.event}` : ""} — it was a pleasure meeting you. Here is our follow-up on ${product}.`
          : `Thank you for contacting ${input.orgName}${input.companyName ? ` on behalf of ${input.companyName}` : ""}. We have received your inquiry about ${product}.`,
      );
    }
    if (facts.length) {
      lines.push("");
      lines.push("Here is our understanding of your requirement — please confirm:");
      for (const f of facts) lines.push(`- ${RFQ_FIELD_LABELS[f.field].en}: ${f.value}`);
    }
    if (questions.length) {
      lines.push("");
      lines.push("To prepare an accurate quotation, could you please let us know:");
      questions.forEach((q, i) => lines.push(`${i + 1}. ${q.question}`));
    }
    lines.push("");
    if (knowledge.samplePolicy.status === "available" && fields.sampleRequired) {
      lines.push(`Regarding samples: ${knowledge.samplePolicy.value.note || (knowledge.samplePolicy.value.available ? "we can arrange samples; details to be confirmed." : "sample arrangements are subject to internal confirmation.")}`);
    }
    lines.push(`Regarding ${pending.join(", ")}: our team will confirm these internally once we have the details above and revert to you with a formal reply.`);
    lines.push("");
    lines.push("We look forward to hearing from you.");
    lines.push("");
    lines.push("Best regards,");
    lines.push(input.senderName);
    lines.push(input.orgName);
    body = lines.join("\n");
  }

  const violations = checkDraftGuardrails(body, {});
  return {
    subject,
    body,
    language: lang,
    factsUsed: facts,
    pendingInternalConfirmation: pending,
    guardrailViolations: violations,
    templateOnly: true,
  };
}

/**
 * 可选 LLM 润色：只允许改措辞，不允许新增事实；润色后过守卫，失败回退模板。
 */
export async function polishReplyDraftWithLlm(
  draft: ReplyDraft,
  ctx: { orgId: string; userId: string; agentRunId?: string; timeoutMs?: number },
): Promise<ReplyDraft> {
  if (!isAIConfigured()) return draft;
  try {
    const polished = await createCompletion({
      systemPrompt:
        "You are a professional B2B OEM sales writer. Rewrite the email body for tone and flow ONLY. " +
        "Do not add, remove or change any facts, numbers, questions or commitments. Never state MOQ, prices, lead times, certifications, payment terms or discounts. " +
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
    const violations = checkDraftGuardrails(body, {});
    if (violations.length) {
      return { ...draft, guardrailViolations: [], templateOnly: true };
    }
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
