/**
 * 询盘自动分析 — 编排层（第二刀）
 *
 * 进线消息落库后触发：LLM 抽取需求 → 规则合规提示 → 规则红旗 → 落 TradeInquiryAnalysis
 * → 可选触发买家研究（需 SERPER）。全程失败只记 status=failed，不影响进线主链。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import {
  complianceHints,
  normalizeExtraction,
  redFlags,
  riskLevel,
  type ExtractedInquiry,
} from "@/lib/trade/inquiry-rules";

export interface AnalyzeInquiryInput {
  orgId: string;
  prospectId: string;
  messageId: string;
  content: string;
  channel: string;
  meta?: {
    email?: string | null;
    companyName?: string | null;
    phone?: string | null;
    country?: string | null;
    website?: string | null;
  };
}

const SYSTEM_PROMPT = `You are an export-sales analyst for a Chinese home-textile factory (bathrobes, blankets, towels).
Read one inbound buyer inquiry and return ONLY a JSON object with these keys:
{
 "products": string[],            // e.g. ["coral fleece bathrobe"]
 "quantity": string|null,         // as written, e.g. "500 pcs" or "2 x 40HQ"
 "specs": {"material"?:string,"gsm"?:string,"size"?:string,"color"?:string,"packaging"?:string},
 "targetPrice": string|null,
 "incotermHint": string|null,     // FOB/CIF/DDP/EXW if mentioned
 "leadTimeAsk": string|null,
 "certificationsAsked": string[], // OEKO-TEX, GOTS, GRS, BSCI, 16 CFR 1610 ...
 "destinationCountry": string|null,
 "isChildren": boolean,           // kids/baby/infant product
 "language": string|null,         // language of the inquiry, e.g. "en", "es"
 "buyerType": "importer"|"brand"|"hotel"|"retailer"|"agent"|"individual"|"unknown",
 "intent": "rfq"|"sample"|"info"|"partnership"|"spam"|"unclear",
 "missingInfo": string[],         // what to ask back before quoting (max 5, Chinese)
 "summary": string                // one Chinese sentence for the salesperson
}
Rules: never invent numbers; use null when absent; keep strings short; output JSON only.`;

function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function extractInquiry(content: string, meta?: AnalyzeInquiryInput["meta"]): Promise<ExtractedInquiry> {
  const context = [
    meta?.companyName ? `Company: ${meta.companyName}` : "",
    meta?.email ? `Email: ${meta.email}` : "",
    meta?.country ? `Country (from form): ${meta.country}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const raw = await createCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `${context ? context + "\n\n" : ""}Inquiry:\n${content.slice(0, 6000)}`,
    mode: "structured",
    temperature: 0.1,
    maxTokens: 900,
  });
  return normalizeExtraction(parseJsonLoose(raw));
}

function domainFromEmail(email?: string | null): string | null {
  const d = email?.split("@")[1]?.toLowerCase();
  if (!d) return null;
  if (/^(gmail|yahoo|hotmail|outlook|live|icloud|aol|protonmail|proton|qq|163|126|yandex|gmx)\./.test(d)) return null;
  return d;
}

export async function analyzeInquiry(input: AnalyzeInquiryInput): Promise<void> {
  const { orgId, prospectId, messageId } = input;
  await db.tradeInquiryAnalysis.upsert({
    where: { messageId },
    create: { orgId, prospectId, messageId, status: "pending" },
    update: { status: "pending", error: null },
  });

  try {
    const meta = input.meta ?? {};
    const extracted = await extractInquiry(input.content, meta);
    const hints = complianceHints(extracted, `${input.content} ${meta.country ?? ""}`);
    const flags = redFlags(extracted, {
      email: meta.email,
      companyName: meta.companyName,
      phone: meta.phone,
      freeText: input.content,
    });

    // 自动研究：有可研究的域名且配置了检索 key 才触发；结果异步写回线索（研究管线自己落库）
    let researchStatus = "skipped_no_domain";
    const domain = meta.website?.trim() || domainFromEmail(meta.email);
    if (domain) {
      if (!process.env.SERPER_API_KEY?.trim()) {
        researchStatus = "skipped_no_serper";
      } else {
        researchStatus = "triggered";
        import("@/lib/trade/research-service")
          .then(({ runProspectResearch }) =>
            runProspectResearch(
              { prospectId, orgId, websiteOverride: meta.website?.trim() || null },
              { incrementCampaignQualifiedIfQualified: true },
            ),
          )
          .catch((err) => console.warn("[inquiry-analysis] research failed:", err));
      }
    }

    const level = riskLevel(flags);
    const summaryParts = [
      extracted.summary,
      hints.some((h) => h.severity === "critical") ? "⚠ 有一票否决级合规风险" : "",
      level === "high" ? "⚠ 高风险红旗，谨慎跟进" : "",
      extracted.missingInfo.length ? `待追问：${extracted.missingInfo.join("；")}` : "",
    ].filter(Boolean);

    await db.tradeInquiryAnalysis.update({
      where: { messageId },
      data: {
        status: "done",
        intent: extracted.intent,
        buyerType: extracted.buyerType,
        language: extracted.language,
        extracted: extracted as unknown as object,
        compliance: hints as unknown as object,
        redFlags: flags as unknown as object,
        summary: summaryParts.join("\n"),
        researchStatus,
        error: null,
      },
    });

    await db.tradeMessage
      .update({ where: { id: messageId }, data: { intent: mapIntentToMessageIntent(extracted.intent) } })
      .catch(() => {});

    // 第三刀：分析完成 → 设计段（回复草稿 / 报价建议 / 寄样建议），失败只记 designStatus
    try {
      const { designInquiryResponse } = await import("@/lib/trade/inquiry-design");
      await designInquiryResponse(messageId);
    } catch (err) {
      console.warn("[inquiry-analysis] design step failed:", err);
    }
  } catch (err) {
    await db.tradeInquiryAnalysis
      .update({
        where: { messageId },
        data: { status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 1000) },
      })
      .catch(() => {});
  }
}

/** TradeMessage.intent 现有词表：interested / objection / not_interested / ooo / question / request_sample / unclear */
function mapIntentToMessageIntent(intent: ExtractedInquiry["intent"]): string {
  switch (intent) {
    case "rfq":
      return "interested";
    case "sample":
      return "request_sample";
    case "info":
    case "partnership":
      return "question";
    case "spam":
      return "not_interested";
    default:
      return "unclear";
  }
}

/**
 * 在请求上下文里用 after() 挂到响应之后执行；不在请求上下文（脚本/测试）则直接 await。
 */
export async function scheduleInquiryAnalysis(input: AnalyzeInquiryInput): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(async () => {
      await analyzeInquiry(input);
    });
  } catch {
    await analyzeInquiry(input).catch((err) =>
      console.warn("[inquiry-analysis] direct run failed:", err),
    );
  }
}

/** 收件箱用：按线索取最新一份分析（只取展示字段） */
export async function loadLatestAnalyses(prospectIds: string[]) {
  if (prospectIds.length === 0) return new Map<string, InquiryAnalysisSummary>();
  const rows = await db.tradeInquiryAnalysis.findMany({
    where: { prospectId: { in: prospectIds } },
    orderBy: { createdAt: "desc" },
    select: {
      prospectId: true,
      status: true,
      intent: true,
      buyerType: true,
      summary: true,
      extracted: true,
      compliance: true,
      redFlags: true,
      researchStatus: true,
      replyDraft: true,
      quoteSuggestion: true,
      sampleAdvice: true,
      designStatus: true,
    },
  });
  const map = new Map<string, InquiryAnalysisSummary>();
  for (const r of rows) {
    if (map.has(r.prospectId)) continue;
    const extracted = (r.extracted ?? {}) as Partial<ExtractedInquiry>;
    const hints = (Array.isArray(r.compliance) ? r.compliance : []) as { severity: string; title: string; code: string }[];
    const flags = (Array.isArray(r.redFlags) ? r.redFlags : []) as { severity: string; title: string; code: string }[];
    map.set(r.prospectId, {
      status: r.status,
      intent: r.intent,
      buyerType: r.buyerType,
      summary: r.summary,
      products: extracted.products ?? [],
      quantity: extracted.quantity ?? null,
      missingInfo: extracted.missingInfo ?? [],
      compliance: hints.map((h) => ({ code: h.code, title: h.title, severity: h.severity })),
      redFlags: flags.map((f) => ({ code: f.code, title: f.title, severity: f.severity })),
      researchStatus: r.researchStatus,
      designStatus: r.designStatus,
      replyDraft: (r.replyDraft as InquiryAnalysisSummary["replyDraft"]) ?? null,
      quoteSuggestion: (r.quoteSuggestion as InquiryAnalysisSummary["quoteSuggestion"]) ?? null,
      sampleAdvice: (r.sampleAdvice as InquiryAnalysisSummary["sampleAdvice"]) ?? null,
    });
  }
  return map;
}

export interface InquiryAnalysisSummary {
  status: string;
  intent: string | null;
  buyerType: string | null;
  summary: string | null;
  products: string[];
  quantity: string | null;
  missingInfo: string[];
  compliance: { code: string; title: string; severity: string }[];
  redFlags: { code: string; title: string; severity: string }[];
  researchStatus: string | null;
  designStatus: string | null;
  replyDraft: { subject: string; body: string; subjectZh: string; bodyZh: string; language: string; askedQuestions: string[] } | null;
  quoteSuggestion: {
    items: { productName: string; specification: string; unit: string; quantity: number; unitPriceSuggested: number | null; basis: string; matchedSku: string | null }[];
    moq: string | null;
    leadTimeDays: number | null;
    incoterm: string;
    notes: string;
    matchedSkus: string[];
  } | null;
  sampleAdvice: { recommend: boolean; mode: string; reasons: string[]; suggestedFeeUsd: number | null } | null;
}
