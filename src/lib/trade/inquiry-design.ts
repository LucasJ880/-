/**
 * 询盘 AI 设计段 — 编排层（第三刀）
 *
 * 在分析（第二刀）完成后运行：
 *   规则 → 寄样建议 / 报价建议（匹配产品库，价格只用档案 FOB 价，不臆造）
 *   LLM  → 首封回复草稿（买家语言 + 中文镜像），引用知识库合规事实
 * 全部只落草稿；发送 / 建报价单都要人在收件箱点确认。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { searchKnowledge } from "@/lib/trade/knowledge-service";
import { normalizeExtraction, type ComplianceHint, type RedFlag } from "@/lib/trade/inquiry-rules";
import {
  buildQuoteSuggestion,
  buildReplyBrief,
  decideSampleAdvice,
  type ProductCandidate,
  type QuoteSuggestion,
  type SampleAdvice,
} from "@/lib/trade/inquiry-design-rules";

export interface ReplyDraft {
  subject: string;
  body: string;
  subjectZh: string;
  bodyZh: string;
  language: string;
  askedQuestions: string[];
}

export async function loadProductCandidates(orgId: string): Promise<ProductCandidate[]> {
  const products = await db.tradeProduct.findMany({
    where: { orgId, status: { in: ["active", "draft"] } },
    select: {
      sku: true,
      name: true,
      nameEn: true,
      category: true,
      facts: {
        where: { status: { in: ["confirmed", "extracted", "needs_review"] } },
        select: { fieldKey: true, value: true, status: true },
      },
    },
    take: 300,
  });
  return products.map((p) => {
    const facts: Record<string, string> = {};
    // confirmed 优先覆盖同键的 extracted
    const sorted = [...p.facts].sort((a, b) => (a.status === "confirmed" ? 1 : 0) - (b.status === "confirmed" ? 1 : 0));
    for (const f of sorted) {
      const v = f.value;
      const text = typeof v === "string" ? v : typeof v === "number" ? String(v) : v && typeof v === "object" ? JSON.stringify(v) : "";
      if (text) facts[f.fieldKey] = text;
    }
    return { sku: p.sku, name: p.name, nameEn: p.nameEn, category: p.category, facts };
  });
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(cleaned.slice(s, e + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const LANG_NAME: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  ru: "Russian",
  zh: "Chinese",
};

export async function draftReply(input: {
  orgName: string;
  senderName: string;
  buyer: { companyName: string; contactName: string | null; country: string | null };
  inquiry: string;
  brief: ReturnType<typeof buildReplyBrief>;
  knowledgeContext: string;
}): Promise<ReplyDraft> {
  const langCode = (input.brief.language || "en").toLowerCase().slice(0, 2);
  const langName = LANG_NAME[langCode] ?? "English";
  const system = `You write first replies to inbound B2B inquiries for ${input.orgName}, a Chinese home-textile factory (bathrobes, blankets, towels; OEM/ODM).
Tone: warm, concise, professional; 120–180 words; no hype; never invent prices, certificates or lead times that are not in the brief/context.
Return ONLY JSON: {"subject": string, "body": string, "subjectZh": string, "bodyZh": string, "askedQuestions": string[]}.
"body" is in ${langName}; "bodyZh" is a faithful Chinese rendering for the salesperson. Sign as ${input.senderName}, ${input.orgName}.`;
  const user = `Buyer: ${input.buyer.companyName}${input.buyer.contactName ? ` (${input.buyer.contactName})` : ""}${input.buyer.country ? `, ${input.buyer.country}` : ""}
Inquiry:
${input.inquiry.slice(0, 4000)}

What we can confirm: ${input.brief.answer.join("; ") || "(nothing specific yet)"}
Questions to ask (must include, naturally): ${input.brief.ask.join("; ") || "(none)"}
Compliance/certification points to mention briefly: ${input.brief.mention.join("; ") || "(none)"}
Next step to propose: ${input.brief.nextStep}
Factory knowledge (facts you may cite, do not exceed):
${input.knowledgeContext.slice(0, 3000) || "(none)"}`;
  const raw = await createCompletion({ systemPrompt: system, userPrompt: user, mode: "chat", temperature: 0.4, maxTokens: 1200 });
  const j = parseJsonLoose(raw) ?? {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return {
    subject: str(j.subject, 200) || `Re: your inquiry — ${input.orgName}`,
    body: str(j.body, 4000) || raw.slice(0, 4000),
    subjectZh: str(j.subjectZh, 200),
    bodyZh: str(j.bodyZh, 4000),
    language: langCode,
    askedQuestions: Array.isArray(j.askedQuestions) ? j.askedQuestions.map((x) => str(x, 200)).filter(Boolean).slice(0, 6) : input.brief.ask,
  };
}

/** 对某条进线的分析记录运行设计段（幂等：重跑覆盖） */
export async function designInquiryResponse(messageId: string): Promise<void> {
  const analysis = await db.tradeInquiryAnalysis.findUnique({ where: { messageId } });
  if (!analysis || analysis.status !== "done") return;

  await db.tradeInquiryAnalysis.update({
    where: { messageId },
    data: { designStatus: "pending", designError: null },
  });

  try {
    const [prospect, message, org] = await Promise.all([
      db.tradeProspect.findUnique({
        where: { id: analysis.prospectId },
        select: { companyName: true, contactName: true, country: true, owner: { select: { name: true } } },
      }),
      db.tradeMessage.findUnique({ where: { id: messageId }, select: { content: true } }),
      db.organization.findUnique({ where: { id: analysis.orgId }, select: { name: true } }),
    ]);
    if (!prospect || !message) throw new Error("线索或消息不存在");

    const extracted = normalizeExtraction(analysis.extracted);
    const hints = (Array.isArray(analysis.compliance) ? analysis.compliance : []) as unknown as ComplianceHint[];
    const flags = (Array.isArray(analysis.redFlags) ? analysis.redFlags : []) as unknown as RedFlag[];

    const candidates = await loadProductCandidates(analysis.orgId);
    const quote: QuoteSuggestion = buildQuoteSuggestion(extracted, candidates);
    const sample: SampleAdvice = decideSampleAdvice(extracted, flags);
    const brief = buildReplyBrief(extracted, hints, sample, quote);

    const knowledgeQuery = [
      ...extracted.products,
      extracted.destinationCountry ?? "",
      ...extracted.certificationsAsked,
      ...hints.slice(0, 2).map((h) => h.knowledgeTitle),
      "MOQ 交期 认证",
    ].join(" ");
    const knowledgeContext = await searchKnowledge(analysis.orgId, knowledgeQuery, { limit: 4 }).catch(() => "");

    const reply = await draftReply({
      orgName: org?.name ?? "our factory",
      senderName: prospect.owner?.name ?? "Sales Team",
      buyer: { companyName: prospect.companyName, contactName: prospect.contactName, country: prospect.country },
      inquiry: message.content,
      brief,
      knowledgeContext,
    });

    await db.tradeInquiryAnalysis.update({
      where: { messageId },
      data: {
        replyDraft: reply as unknown as object,
        quoteSuggestion: quote as unknown as object,
        sampleAdvice: sample as unknown as object,
        designStatus: "done",
        designError: null,
        designedAt: new Date(),
      },
    });
  } catch (err) {
    await db.tradeInquiryAnalysis
      .update({
        where: { messageId },
        data: { designStatus: "failed", designError: (err instanceof Error ? err.message : String(err)).slice(0, 1000) },
      })
      .catch(() => {});
  }
}

/** 线索最新一条已分析的进线 → 跑设计（收件箱「重新生成」用） */
export async function designLatestForProspect(orgId: string, prospectId: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const latest = await db.tradeInquiryAnalysis.findFirst({
    where: { orgId, prospectId, status: "done" },
    orderBy: { createdAt: "desc" },
    select: { messageId: true },
  });
  if (!latest) return { ok: false, error: "该线索还没有完成分析的进线" };
  await designInquiryResponse(latest.messageId);
  return { ok: true, messageId: latest.messageId };
}
