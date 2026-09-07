/**
 * Revenue Spine — LLM RFQ 抽取（可选；无 OPENAI_API_KEY 或失败时返回 null）
 *
 * 证据纪律：LLM 必须为每个字段给出 evidence（源文本片段）；片段在源文本中找不到 → 置信度封顶 0.4，
 * 由合并层决定是否采纳。绝不让模型"记得"源文本没有的数量。
 */

import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import type { InquiryLanguage } from "../normalize";
import { emptyRfqFields, isRfqField, type RfqEvidence, type RfqExtraction, type RfqField, type RfqFields } from "./types";

export interface LlmExtractContext {
  orgId: string;
  userId: string;
  agentRunId?: string;
  productCategories: string[];
  language: InquiryLanguage;
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `You are an OEM textile sales assistant extracting a structured RFQ from a customer inquiry.
Rules:
- Only extract what the text explicitly states. Never guess or infer missing values.
- For EVERY extracted field provide "evidence": the exact substring of the inquiry that supports it.
- Output strict JSON: {"fields": {<field>: {"value": <string|number|boolean>, "confidence": <0..1>, "evidence": "<substring>"}}}
- Allowed fields: productCategory, productName, material, composition, size, quantity (number), unit, color, customLogo (boolean), customization, packaging, certification, sampleRequired (boolean), targetPrice (number), currency (ISO code), destinationCountry, destinationCity, incoterm, requiredDeliveryDate (YYYY-MM-DD), buyerType (distributor|hotel_group|hotel_supplier|importer|wholesaler|brand|retailer|contractor|ecommerce|sourcing_agent|individual), application.
- Omit fields not present. No prose.`;

function normalizeWs(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const v = JSON.parse(trimmed.slice(start, end + 1));
        return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 纯函数：把模型 JSON 转成带接地校验的抽取结果（可单测） */
export function parseLlmRfqOutput(raw: string, sourceText: string, language: InquiryLanguage): RfqExtraction | null {
  const parsed = parseJsonLoose(raw);
  if (!parsed) return null;
  const fieldsRaw = parsed.fields && typeof parsed.fields === "object" ? (parsed.fields as Record<string, unknown>) : null;
  if (!fieldsRaw) return null;
  const fields: RfqFields = emptyRfqFields();
  const evidence: RfqEvidence[] = [];
  const notes: string[] = [];
  const normSource = normalizeWs(sourceText);

  for (const [key, entry] of Object.entries(fieldsRaw)) {
    if (!isRfqField(key)) continue;
    const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : { value: entry };
    let value = e.value;
    if (value === null || value === undefined || value === "") continue;
    const evidenceText = typeof e.evidence === "string" ? e.evidence.trim() : "";
    let confidence = typeof e.confidence === "number" && Number.isFinite(e.confidence) ? Math.min(1, Math.max(0, e.confidence)) : 0.5;
    const grounded = evidenceText.length > 0 && normSource.includes(normalizeWs(evidenceText));
    if (!grounded) {
      confidence = Math.min(confidence, 0.4);
      notes.push(`llm:${key} 证据未在源文本中找到，置信度封顶 0.4`);
    }
    const field = key as RfqField;
    switch (field) {
      case "quantity":
      case "targetPrice": {
        const n = typeof value === "number" ? value : Number(String(value).replace(/[,，\s]/g, ""));
        if (!Number.isFinite(n) || n <= 0) continue;
        value = n;
        fields[field] = n;
        break;
      }
      case "customLogo":
      case "sampleRequired": {
        const b = typeof value === "boolean" ? value : /^(true|yes|y|是|需要)$/i.test(String(value));
        value = b;
        fields[field] = b;
        break;
      }
      case "requiredDeliveryDate": {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) continue;
        value = d;
        fields.requiredDeliveryDate = d;
        break;
      }
      default: {
        const s = String(value).trim().slice(0, 300);
        if (!s) continue;
        value = s;
        (fields as unknown as Record<string, unknown>)[field] = field === "incoterm" || field === "currency" ? s.toUpperCase() : s;
      }
    }
    evidence.push({
      field,
      value: value instanceof Date ? value.toISOString().slice(0, 10) : String(value),
      confidence,
      evidenceText: grounded ? evidenceText : evidenceText || "(no evidence)",
      extractedBy: "llm",
    });
  }
  return { fields, evidence, language, method: "llm", notes };
}

export async function extractRfqLlm(text: string, ctx: LlmExtractContext): Promise<RfqExtraction | null> {
  if (!isAIConfigured()) return null;
  try {
    const raw = await createCompletion({
      systemPrompt: SYSTEM_PROMPT + `\nFactory product categories: ${ctx.productCategories.join(", ") || "(unspecified)"}.`,
      userPrompt: `Inquiry (${ctx.language}):\n"""\n${text.slice(0, 6000)}\n"""`,
      mode: "fast",
      temperature: 0,
      maxTokens: 1200,
      timeoutMs: ctx.timeoutMs ?? 25_000,
      orgId: ctx.orgId,
      userId: ctx.userId,
      agentRunId: ctx.agentRunId,
    });
    return parseLlmRfqOutput(raw, text, ctx.language);
  } catch (err) {
    console.warn("[revenue-spine] llm rfq extraction failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
