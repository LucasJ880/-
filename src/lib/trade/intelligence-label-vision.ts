/**
 * Trade Intelligence — 吊牌/包装图 Vision 提取（OpenAI）
 */

import { stripJsonFence } from "@/lib/visualizer/ai-detect";
import type {
  LabelExtractedFields,
  LabelFieldSlot,
  LabelFieldSource,
  LabelVisionFieldKey,
} from "@/lib/trade/intelligence-label-types";
import { LABEL_VISION_FIELD_KEYS } from "@/lib/trade/intelligence-label-types";

const IDENTITY_KEYS = new Set<LabelVisionFieldKey>([
  "productName",
  "brand",
  "upc",
  "gtin",
  "sku",
  "mpn",
  "styleNumber",
  "itemNumber",
  "barcodeDigits",
]);

const ALLOWED_SOURCES_FOR_IDENTITY = new Set<LabelFieldSource>([
  "visible_text",
  "barcode_digits",
  "user_confirmed",
]);

const INFERENCE_ALLOWED_KEYS = new Set<LabelVisionFieldKey>(["language", "marketRegion", "notes"]);

function emptySlot(): LabelFieldSlot {
  return { value: null, confidence: 0, evidence: "", source: "unknown" };
}

export function labelFieldSlotFromUnknown(raw: unknown): LabelFieldSlot {
  if (!raw || typeof raw !== "object") return emptySlot();
  const o = raw as Record<string, unknown>;
  const value = typeof o.value === "string" ? o.value.trim() || null : null;
  let confidence = typeof o.confidence === "number" && Number.isFinite(o.confidence) ? o.confidence : 0;
  confidence = Math.max(0, Math.min(1, confidence));
  const evidence = typeof o.evidence === "string" ? o.evidence.slice(0, 2000) : "";
  const src = typeof o.source === "string" ? o.source : "unknown";
  const source: LabelFieldSource =
    src === "visible_text" ||
    src === "barcode_digits" ||
    src === "inferred_from_label" ||
    src === "user_confirmed" ||
    src === "unknown"
      ? src
      : "unknown";
  return { value, confidence, evidence, source };
}

function asSlot(raw: unknown): LabelFieldSlot {
  return labelFieldSlotFromUnknown(raw);
}

/**
 * 身份类字段：仅保留 visible_text / barcode_digits；禁止 inferred/unknown 充当「读数」。
 */
export function sanitizeLabelExtractedFields(fields: LabelExtractedFields): {
  fields: LabelExtractedFields;
  warnings: string[];
} {
  const warnings: string[] = [];
  const out: LabelExtractedFields = { ...fields };

  for (const key of LABEL_VISION_FIELD_KEYS) {
    const slot = out[key];
    if (!slot) continue;

    if (IDENTITY_KEYS.has(key)) {
      if (slot.value && !ALLOWED_SOURCES_FOR_IDENTITY.has(slot.source)) {
        warnings.push(
          `${key}: 已丢弃非可见来源的值（source=${slot.source}），避免将推断当作吊牌读数。`,
        );
        out[key] = {
          value: null,
          confidence: Math.min(slot.confidence, 0.4),
          evidence: slot.evidence,
          source: "unknown",
        };
      }
      const cur = out[key]!;
      if (cur.value && cur.confidence < 0.45) {
        warnings.push(`${key}: 置信度偏低（${cur.confidence.toFixed(2)}），请人工核对。`);
      }
    }

    const s = out[key]!;
    if (s.source === "inferred_from_label" && !INFERENCE_ALLOWED_KEYS.has(key) && s.value) {
      if (!IDENTITY_KEYS.has(key)) {
        warnings.push(`${key}: 含 inferred_from_label，仅作参考。`);
        out[key] = { ...s, confidence: Math.min(s.confidence, 0.55) };
      }
    }
  }

  return { fields: out, warnings };
}

export function overallConfidenceFromFields(fields: LabelExtractedFields): number {
  const vals: number[] = [];
  for (const k of LABEL_VISION_FIELD_KEYS) {
    const s = fields[k];
    if (s?.value) vals.push(s.confidence);
  }
  if (vals.length === 0) return 0.15;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
}

const VISION_SYSTEM = `你是供应链吊牌/包装标签 OCR 助手。只根据图片中肉眼可读的文字与条码数字回答。

硬性规则（违反则输出无效）：
1) 不得编造图片中不存在的数字、品牌、地址、联系人、邮箱、电话。
2) UPC/EAN/GTIN、MPN、品牌、产品名：只能来自清晰可见的印刷文字或条码数字（source 只能是 visible_text 或 barcode_digits）。若看不清，必须 value=null、confidence<=0.35。
3) source=inferred_from_label 仅允许用于 language、marketRegion、notes 三个字段；其它字段禁止使用 inferred_from_label。
4) 每个非空字段必须写 evidence：引用图中短语或说明在标签上的位置（如「背面左下角」），简短中文或英文均可。
5) 输出单一 JSON 对象，不要 markdown 围栏，不要解释文字。

JSON 结构：顶层键 fields，值为各字段对象：
{ "value": string|null, "confidence": 0-1, "evidence": string, "source": "visible_text"|"barcode_digits"|"inferred_from_label"|"unknown" }

必须包含的字段键（无则 null）：
${LABEL_VISION_FIELD_KEYS.join(", ")}

顶层还可包含 "extractedSummary"：一句中文概括图中可见的产品身份线索（不得包含联系人信息）。`;

export async function extractTradeLabelFromImageUrl(params: {
  imageUrl: string;
  assetType: string;
  notes?: string | null;
}): Promise<{
  extractedFields: LabelExtractedFields;
  extractedSummary: string;
  rawSnippet: string;
  warnings: string[];
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPENAI_API_KEY 未配置");
  }
  const model =
    process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const userText = `assetType（用户选择）: ${params.assetType}
用户备注（可能为空）: ${params.notes?.trim() || "（无）"}

请读取图片，输出 JSON：
{
  "fields": { ...各字段... },
  "extractedSummary": "..."
}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.05,
      max_completion_tokens: 3500,
      messages: [
        { role: "system", content: VISION_SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: params.imageUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Vision 请求失败 ${res.status}: ${t.slice(0, 400)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = String(data.choices?.[0]?.message?.content ?? "");
  const rawSnippet = content.slice(0, 4000);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(content)) as Record<string, unknown>;
  } catch {
    throw new Error("Vision 返回非 JSON");
  }

  const rawFields = (parsed.fields && typeof parsed.fields === "object"
    ? parsed.fields
    : parsed) as Record<string, unknown>;

  const extractedFields: LabelExtractedFields = {};
  for (const k of LABEL_VISION_FIELD_KEYS) {
    extractedFields[k] = asSlot(rawFields[k]);
  }

  const extractedSummary =
    typeof parsed.extractedSummary === "string" ? parsed.extractedSummary.slice(0, 800) : "";

  const { fields, warnings: guardWarnings } = sanitizeLabelExtractedFields(extractedFields);
  const lowConf = mergeVisionWarnings([], fields);
  return {
    extractedFields: fields,
    extractedSummary,
    rawSnippet,
    warnings: [...guardWarnings, ...lowConf],
  };
}

export function pickUpcForCase(fields: LabelExtractedFields): string | null {
  const upc = fields.upc?.value?.replace(/\s/g, "") ?? "";
  if (upc) return upc.slice(0, 32);
  const bc = fields.barcodeDigits?.value?.replace(/\D/g, "") ?? "";
  if (bc.length >= 8 && bc.length <= 14) return bc;
  if (fields.barcodeDigits?.value?.trim()) return fields.barcodeDigits.value.trim().slice(0, 32);
  return null;
}

export function pickMpnForCase(fields: LabelExtractedFields): string | null {
  const candidates: { v: string; c: number }[] = [];
  for (const key of ["mpn", "itemNumber", "styleNumber"] as const) {
    const s = fields[key];
    if (!s) continue;
    const v = s.value?.trim();
    if (!v) continue;
    if (!ALLOWED_SOURCES_FOR_IDENTITY.has(s.source)) continue;
    candidates.push({ v, c: s.confidence ?? 0 });
  }
  candidates.sort((a, b) => b.c - a.c);
  return candidates[0]?.v?.slice(0, 64) ?? null;
}

export function mergeVisionWarnings(
  base: string[],
  fields: LabelExtractedFields,
): string[] {
  const w = [...base];
  for (const k of LABEL_VISION_FIELD_KEYS) {
    const s = fields[k];
    if (!s?.value) continue;
    if (s.confidence < 0.5) w.push(`${k} 置信度偏低(${s.confidence.toFixed(2)})`);
  }
  return w;
}

/** 解析前端回传的 extractedFields（仅处理出现的键） */
export function labelExtractedFieldsFromClientJson(raw: unknown): LabelExtractedFields {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: LabelExtractedFields = {};
  for (const k of LABEL_VISION_FIELD_KEYS) {
    if (o[k] === undefined) continue;
    out[k] = labelFieldSlotFromUnknown(o[k]);
  }
  return out;
}
