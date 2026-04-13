/**
 * AI 报价解析器
 *
 * 将自然语言 / 语音转写 / 截图 OCR 文本解析为结构化的报价行项。
 * 后端优先使用 GPT，降级到本地正则。
 *
 * 迁移自 SUNNY_QUOTE_MARCH_AI_voice.html 的 AI 解析逻辑。
 */

import { ALL_PRODUCTS, getAvailableFabrics } from "@/lib/blinds/pricing-data";
import type { ProductName, QuoteItemInput, QuoteAddonInput } from "@/lib/blinds/pricing-types";
import { ADDON_CATALOG } from "@/lib/blinds/pricing-addons";

export interface AiQuotePlan {
  items: QuoteItemInput[];
  addons: QuoteAddonInput[];
  installMode?: "default" | "pickup";
  notes?: string;
  parseMethod: "gpt" | "local";
}

interface GptQuoteAction {
  product: string;
  fabric?: string;
  width: string;
  height: string;
  location?: string;
}

interface GptQuotePlan {
  actions: GptQuoteAction[];
  addons?: { key: string; qty: number }[];
  install_mode?: string;
  notes?: string;
}

const PRODUCT_ALIASES: Record<string, ProductName> = {
  zebra: "Zebra",
  roller: "Roller",
  drapery: "Drapery",
  drape: "Drapery",
  sheer: "Sheer",
  shutters: "Shutters",
  shutter: "Shutters",
  shangrila: "SHANGRILA",
  "shangri-la": "SHANGRILA",
  cellular: "Cordless Cellular",
  "cordless cellular": "Cordless Cellular",
  honeycomb: "SkylightHoneycomb",
  skylight: "SkylightHoneycomb",
  "skylight honeycomb": "SkylightHoneycomb",
};

const FABRIC_ALIASES: Record<string, Record<string, string>> = {
  Zebra: {
    lf: "Light Filtering",
    "light filtering": "Light Filtering",
    bo: "Blackout",
    blackout: "Blackout",
  },
  Roller: {
    "lf open": "Light Filtering (Open Roll)",
    "lf cassette": "Light Filtering w Cassette",
    "bo open": "Blackout (Open Roll)",
    "bo cassette": "Blackout w Cassette",
    "light filtering": "Light Filtering (Open Roll)",
    blackout: "Blackout (Open Roll)",
  },
  Drapery: {
    lf: "Without liner (Light filtering)",
    "light filtering": "Without liner (Light filtering)",
    "without liner": "Without liner (Light filtering)",
    bo: "With liner (Black out)",
    blackout: "With liner (Black out)",
    "with liner": "With liner (Black out)",
  },
  Sheer: {
    lf: "Light Filtering",
    "light filtering": "Light Filtering",
    prime: "LF Prime",
    "lf prime": "LF Prime",
    "door screen": "Door Screen Sheer",
  },
};

function resolveProduct(text: string): ProductName | null {
  const lower = text.toLowerCase().trim();
  if (PRODUCT_ALIASES[lower]) return PRODUCT_ALIASES[lower];
  for (const p of ALL_PRODUCTS) {
    if (p.toLowerCase() === lower) return p;
  }
  return null;
}

function resolveFabric(product: ProductName, text: string): string {
  const lower = text.toLowerCase().trim();
  const aliases = FABRIC_ALIASES[product];
  if (aliases?.[lower]) return aliases[lower];
  const available = getAvailableFabrics(product);
  const match = available.find((f) => f.toLowerCase() === lower);
  if (match) return match;
  return available[0] ?? text;
}

/**
 * 解析分数英寸字符串 "39 1/2" -> 39.5
 */
function parseFractionalInches(text: string): number {
  const cleaned = text.replace(/["""]/g, "").trim();
  const parts = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (parts) {
    return parseInt(parts[1]) + parseInt(parts[2]) / parseInt(parts[3]);
  }
  const fractionOnly = cleaned.match(/^(\d+)\/(\d+)$/);
  if (fractionOnly) {
    return parseInt(fractionOnly[1]) / parseInt(fractionOnly[2]);
  }
  return parseFloat(cleaned) || 0;
}

/**
 * 本地正则解析 — 从自然语言提取报价行项
 * 支持格式：
 *   "3 zebra blackout: 39 1/2 x 55, 42 x 60"
 *   "roller lf 48x72"
 *   "2 sheer lf prime 60x108, 75x108"
 */
export function parseLocalQuotePlan(text: string): AiQuotePlan {
  const items: QuoteItemInput[] = [];
  const addons: QuoteAddonInput[] = [];
  let installMode: "default" | "pickup" = "default";
  const notes: string[] = [];

  if (/pickup\s*only|自提|self.?pick/i.test(text)) {
    installMode = "pickup";
  }

  for (const addon of ADDON_CATALOG) {
    const addonPattern = new RegExp(
      `(\\d+)?\\s*${addon.key}s?|add\\s+(\\d+)?\\s*${addon.key}s?`,
      "gi",
    );
    const addonMatch = addonPattern.exec(text);
    if (addonMatch) {
      const qty = parseInt(addonMatch[1] || addonMatch[2] || "1");
      addons.push({ addonKey: addon.key, qty });
    }
  }

  for (const trackMatch of text.matchAll(/track\s*(\d+)\s*(?:ft)?\s*(?:x\s*(\d+))?/gi)) {
    const ft = parseInt(trackMatch[1]);
    const qty = parseInt(trackMatch[2] || "1");
    const trackKey = `track${ft}`;
    if (ADDON_CATALOG.some((a) => a.key === trackKey) && !addons.some((a) => a.addonKey === trackKey)) {
      addons.push({ addonKey: trackKey, qty });
    }
  }

  const linePattern = /(\d+)?\s*(zebra|roller|drapery|drape|sheer|shutters?|shangrila|shangri-la|cellular|cordless\s+cellular|honeycomb|skylight)\s*(blackout|bo|lf|light\s+filtering|lf\s+prime|prime|door\s+screen|without\s+liner|with\s+liner|lf\s+open|lf\s+cassette|bo\s+open|bo\s+cassette|standard|vinyl)?[:\s]*([^;\n]+)/gi;

  for (const m of text.matchAll(linePattern)) {
    const count = parseInt(m[1] || "0");
    const productRaw = m[2];
    const fabricRaw = m[3] || "";
    const sizesStr = m[4];

    const product = resolveProduct(productRaw);
    if (!product) continue;
    const fabric = fabricRaw ? resolveFabric(product, fabricRaw) : getAvailableFabrics(product)[0];

    const sizePattern = /(\d+(?:\s+\d+\/\d+)?)\s*[xX×]\s*(\d+(?:\s+\d+\/\d+)?)/g;
    const sizes: { w: number; h: number }[] = [];

    for (const sm of sizesStr.matchAll(sizePattern)) {
      sizes.push({
        w: parseFractionalInches(sm[1]),
        h: parseFractionalInches(sm[2]),
      });
    }

    if (sizes.length === 0 && count > 0) continue;

    if (count > 0 && sizes.length === 1) {
      for (let i = 0; i < count; i++) {
        items.push({
          product,
          fabric,
          widthIn: sizes[0].w,
          heightIn: sizes[0].h,
        });
      }
    } else {
      for (const size of sizes) {
        items.push({
          product,
          fabric,
          widthIn: size.w,
          heightIn: size.h,
        });
      }
    }
  }

  return {
    items,
    addons,
    installMode,
    notes: notes.length > 0 ? notes.join("; ") : undefined,
    parseMethod: "local",
  };
}

/**
 * GPT 解析 — 使用 OpenAI 将自然语言解析为结构化报价
 */
export async function parseGptQuotePlan(
  prompt: string,
  options?: {
    imageDataUrl?: string;
    currentProduct?: string;
    currentFabric?: string;
  },
): Promise<AiQuotePlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return parseLocalQuotePlan(prompt);
  }

  const productList = ALL_PRODUCTS.map((p) => `${p}: [${getAvailableFabrics(p).join(", ")}]`).join("\n");
  const addonList = ADDON_CATALOG.map((a) => `${a.key}: ${a.displayName} ($${a.unitPrice})`).join("\n");

  const systemPrompt = `You are a window covering quote assistant for Sunny Shutter. Parse user input into structured quote actions.

Available products and fabrics:
${productList}

Available add-ons:
${addonList}

Rules:
- Width and height are in inches. Parse fractional inches like "39 1/2" as 39.5.
- If user says "pickup only" or "self pickup", set install_mode to "pickup".
- If product is not specified, use "${options?.currentProduct || "Zebra"}".
- If fabric is not specified, use the first available fabric for the product.
- Recognize add-ons from natural language (e.g., "add 1 hub", "2 remotes", "track 12ft x2").
- Each size pair creates one item action.

Return ONLY valid JSON (no markdown):
{
  "actions": [
    {"product": "Zebra", "fabric": "Blackout", "width": "39.5", "height": "55", "location": "Living Room"}
  ],
  "addons": [{"key": "hub", "qty": 1}],
  "install_mode": "default",
  "notes": ""
}`;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: systemPrompt },
  ];

  if (options?.imageDataUrl) {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `Extract window sizes from this image. ${prompt || "Parse all sizes you can find."}`,
        },
        {
          type: "image_url",
          image_url: { url: options.imageDataUrl, detail: "high" },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  try {
    const model = options?.imageDataUrl ? "gpt-4o" : "gpt-4o-mini";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        max_tokens: 2000,
      }),
    });

    if (!res.ok) {
      console.error("GPT quote parse failed:", res.status);
      return parseLocalQuotePlan(prompt);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonStr = content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const plan: GptQuotePlan = JSON.parse(jsonStr);

    const items: QuoteItemInput[] = (plan.actions ?? []).map((a) => {
      const product = resolveProduct(a.product) ?? (options?.currentProduct as ProductName) ?? "Zebra";
      return {
        product,
        fabric: a.fabric ? resolveFabric(product, a.fabric) : getAvailableFabrics(product)[0],
        widthIn: parseFractionalInches(a.width),
        heightIn: parseFractionalInches(a.height),
        location: a.location,
      };
    });

    const planAddons: QuoteAddonInput[] = (plan.addons ?? []).map((a) => ({
      addonKey: a.key,
      qty: a.qty || 1,
    }));

    return {
      items,
      addons: planAddons,
      installMode: plan.install_mode === "pickup" ? "pickup" : "default",
      notes: plan.notes,
      parseMethod: "gpt",
    };
  } catch (err) {
    console.error("GPT quote parse error:", err);
    return parseLocalQuotePlan(prompt);
  }
}

/**
 * 语音转写 — 使用 Whisper API
 */
export async function transcribeVoice(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp4") ? "mp4" : "wav";
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
  formData.append("model", "whisper-1");
  formData.append("language", "en");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Whisper API error: ${res.status}`);
  }

  const data = await res.json();
  return data.text ?? "";
}
