/**
 * 供应商画册 PDF 解析服务
 *
 * 职责：
 *   1. 从 PDF buffer 提取文本（pdf-parse）
 *   2. 智能截取关键段落（不是简单头部截断）
 *   3. 调用 GPT 返回结构化供应商信息
 *
 * 可扩展点：V2 可替换 extractText() 为 OCR / 多模态方案
 */

import { PDFParse } from "pdf-parse";
import { createCompletion } from "@/lib/ai/client";
import type {
  BrochureParseResult,
  BrochureSupplierFields,
  BrochureAnalysis,
  BrochureParseMeta,
} from "./brochure-types";

// ── 文本提取 ────────────────────────────────────────────────

const MIN_TEXT_LENGTH = 50;

async function extractText(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  const pages = result.pages?.length ?? 0;
  const text = result.text ?? "";
  await parser.destroy().catch(() => {});
  return { text, pages };
}

// ── 智能截取 ────────────────────────────────────────────────

const CONTACT_KEYWORDS = [
  "contact", "email", "phone", "tel", "fax", "address", "website", "www", "http",
  "联系", "地址", "电话", "邮箱", "传真", "网址", "官网",
];

const PRODUCT_KEYWORDS = [
  "product", "service", "certification", "iso", "catalog", "solution",
  "产品", "服务", "认证", "资质", "方案", "业务", "主营",
];

const MAX_CONTEXT_CHARS = 8000;
const HEAD_BUDGET = 3000;

function smartTruncate(fullText: string): string {
  if (fullText.length <= MAX_CONTEXT_CHARS) return fullText;

  const sections = fullText.split(/\n{2,}|\f/);
  const head = fullText.slice(0, HEAD_BUDGET);

  const contactSections: string[] = [];
  const productSections: string[] = [];
  let contactBudget = 2500;
  let productBudget = 2500;

  for (const section of sections) {
    if (section.length < 10) continue;
    const lower = section.toLowerCase();

    const isContact = CONTACT_KEYWORDS.some((kw) => lower.includes(kw));
    const isProduct = PRODUCT_KEYWORDS.some((kw) => lower.includes(kw));

    if (isContact && contactBudget > 0) {
      const chunk = section.slice(0, contactBudget);
      contactSections.push(chunk);
      contactBudget -= chunk.length;
    } else if (isProduct && productBudget > 0) {
      const chunk = section.slice(0, productBudget);
      productSections.push(chunk);
      productBudget -= chunk.length;
    }
  }

  const parts = [head];
  if (contactSections.length > 0) {
    parts.push("\n--- 联系信息区域 ---\n" + contactSections.join("\n"));
  }
  if (productSections.length > 0) {
    parts.push("\n--- 产品/服务区域 ---\n" + productSections.join("\n"));
  }

  return parts.join("\n").slice(0, MAX_CONTEXT_CHARS);
}

// ── AI 解析 ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个供应商建档助手。用户会给你一段从供应商产品画册/宣传册中提取的文本，请从中提取结构化的供应商信息。

**你必须返回严格的 JSON**，格式如下（不要加任何解释、markdown 标记或注释）：

{
  "supplier": {
    "name": "公司名称 或 null",
    "contactName": "联系人姓名 或 null",
    "contactEmail": "邮箱 或 null",
    "contactPhone": "电话号码 或 null",
    "region": "所在地区/城市 或 null",
    "website": "官网URL 或 null"
  },
  "analysis": {
    "summary": "一段简短的公司介绍（2-3句话）或 null",
    "categories": ["主营品类1", "品类2"],
    "mainProducts": ["主要产品/服务1", "产品2", "产品3"],
    "tags": ["标签1", "标签2"],
    "certifications": ["ISO 9001", "其他认证"],
    "targetMarkets": ["目标市场1", "市场2"],
    "notes": "其他值得记录的信息 或 null"
  },
  "meta": {
    "confidence": "low 或 medium 或 high",
    "missingFields": ["未能识别的字段名列表"]
  }
}

规则：
- 找不到的信息返回 null 或空数组，绝不编造
- categories 用简短品类名，如"建材""电气设备""IT服务""清洁用品"
- tags 提取关键特征词，如"环保""进口""本地""批发"
- confidence: "high" = 大部分关键信息都能识别, "medium" = 部分信息缺失, "low" = 文本质量差或信息极少
- missingFields: 列出无法识别的字段，如 ["contactEmail", "region"]
- 只输出 JSON，不要任何其他文字`;

function buildUserPrompt(text: string): string {
  return `以下是从供应商画册 PDF 中提取的文本内容，请分析并提取供应商信息：

---
${text}
---`;
}

function validateAndNormalize(raw: unknown): { supplier: BrochureSupplierFields; analysis: BrochureAnalysis; missingFields: string[]; confidence: string } {
  const obj = raw as Record<string, unknown>;
  const s = (obj.supplier ?? {}) as Record<string, unknown>;
  const a = (obj.analysis ?? {}) as Record<string, unknown>;
  const m = (obj.meta ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  return {
    supplier: {
      name: str(s.name),
      contactName: str(s.contactName),
      contactEmail: str(s.contactEmail),
      contactPhone: str(s.contactPhone),
      region: str(s.region),
      website: str(s.website),
    },
    analysis: {
      summary: str(a.summary),
      categories: arr(a.categories),
      mainProducts: arr(a.mainProducts),
      tags: arr(a.tags),
      certifications: arr(a.certifications),
      targetMarkets: arr(a.targetMarkets),
      notes: str(a.notes),
    },
    missingFields: arr(m.missingFields),
    confidence: typeof m.confidence === "string" ? m.confidence : "low",
  };
}

// ── 公开 API ────────────────────────────────────────────────

export async function parseBrochure(pdfBuffer: Buffer): Promise<BrochureParseResult> {
  let text: string;
  let pages: number;

  try {
    const extracted = await extractText(pdfBuffer);
    text = extracted.text;
    pages = extracted.pages;
  } catch {
    return makeFailedResult("PDF 文本提取失败，文件可能已损坏");
  }

  if (text.length < MIN_TEXT_LENGTH) {
    return {
      supplier: emptySupplier(),
      analysis: emptyAnalysis(),
      meta: {
        confidence: "low",
        missingFields: ["name", "contactName", "contactEmail", "contactPhone", "region"],
        parseStatus: "needs_manual_review",
        parseWarning: `该 PDF（${pages} 页）可能为扫描件、图片型画册或文本提取质量较差（仅提取到 ${text.length} 字符），AI 预填结果可能不完整。`,
      },
    };
  }

  const truncated = smartTruncate(text);

  let aiResponse: string;
  try {
    aiResponse = await createCompletion({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(truncated),
      mode: "normal",
      temperature: 0.2,
      maxTokens: 4096,
    });
  } catch {
    return makeFailedResult("AI 分析调用失败，请稍后重试");
  }

  let parsed: unknown;
  try {
    const jsonStr = aiResponse.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    return makeFailedResult("AI 返回内容解析失败（非合法 JSON）");
  }

  const { supplier, analysis, missingFields, confidence } = validateAndNormalize(parsed);

  const validConfidence = (["low", "medium", "high"] as const).includes(confidence as "low" | "medium" | "high")
    ? (confidence as "low" | "medium" | "high")
    : "medium";

  const meta: BrochureParseMeta = {
    confidence: validConfidence,
    missingFields,
    parseStatus: "parsed",
    parseWarning: validConfidence === "low"
      ? "AI 置信度较低，提取的信息可能不完整，请仔细核实"
      : null,
  };

  return { supplier, analysis, meta };
}

// ── 工具函数 ────────────────────────────────────────────────

function emptySupplier(): BrochureSupplierFields {
  return { name: null, contactName: null, contactEmail: null, contactPhone: null, region: null, website: null };
}

function emptyAnalysis(): BrochureAnalysis {
  return { summary: null, categories: [], mainProducts: [], tags: [], certifications: [], targetMarkets: [], notes: null };
}

function makeFailedResult(warning: string): BrochureParseResult {
  return {
    supplier: emptySupplier(),
    analysis: emptyAnalysis(),
    meta: {
      confidence: "low",
      missingFields: [],
      parseStatus: "failed",
      parseWarning: warning,
    },
  };
}
