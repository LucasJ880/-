/**
 * 梦馨印花浴袍 MX-BR-P202601 — Amazon 风格 4 图（强调产品真实感）
 *
 * 素材：桌面/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/印花浴袍PRINT BATHROBE
 * 主产品：印花双面绒浴袍MX-BR-P202601.jpg（蓝格纹）
 * 不用同目录其他 SKU 作参考，避免印花串图。
 *
 * 用法：
 *   PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_IMAGE_DRY_RUN=0 \
 *     npx tsx scripts/regen-mengxin-print-amazon.ts
 */

import fs from "fs";
import path from "path";

function loadEnvFile(rel: string) {
  const abs = path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) return;
  for (const line of fs.readFileSync(abs, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

process.env.PRODUCT_CONTENT_LOCAL_STORE = "1";
process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN = "0";
process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED = "1";

import { ProviderRouter } from "../src/lib/ai/model-registry";
import {
  runImageEditDetailed,
} from "../src/lib/visualizer/image-ai";
import {
  classifyImageProviderError,
  shouldRetryWithPinnedModel,
} from "../src/lib/image-engine/errors";

const PRODUCT_DIR =
  "/Users/user/Desktop/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/印花浴袍PRINT BATHROBE";
const PRIMARY = path.join(PRODUCT_DIR, "印花双面绒浴袍MX-BR-P202601.jpg");

const STYLE_MODEL =
  "/Users/user/.cursor/projects/Users-user-Desktop/assets/image-fcd36ea4-a5ce-4182-8dc3-7132b673d69a.png";
const STYLE_DISPLAY =
  "/Users/user/.cursor/projects/Users-user-Desktop/assets/0cd3aec610bab30e10d136bc10285fb4-54b694df-761a-4bba-b0a6-a996a031f9bb.png";

const OUT_DIR = "/Users/user/Desktop/梦馨印花浴袍-Amazon重做-P202601";

const FIDELITY = [
  "PRIMARY IMAGE is the ground-truth product photo of a blue plaid bathrobe (SKU MX-BR-P202601).",
  "Preserve EXACT product identity with photoreal fidelity:",
  "- Pattern: traditional blue tartan/plaid with navy and medium-blue checks, thin white/light lines — do NOT invent leopard, geometric, floral, or solid colors.",
  "- Collar: solid muted medium-blue shawl collar (contrasts with plaid body) — keep exact color and thickness.",
  "- Belt: matching solid medium-blue fabric belt with side belt loops.",
  "- Pockets: two large front patch pockets in the SAME plaid, pattern alignment consistent.",
  "- Fabric: soft plush double-sided fleece / coral-velvet handfeel; visible pile texture, not plastic or painted-on print.",
  "- Cut: wrap bathrobe, long sleeves, realistic length.",
  "Pattern scale, spacing and colors must match the primary photo closely. Prefer under-stylizing over inventing details.",
].join(" ");

const EMBED =
  "Photoreal embedding: natural fabric weight, soft contact shadows, believable folds, correct scale/perspective, scene-matched lighting and color temperature. Must NOT look like a flat cutout pasted onto a background.";

const NO_TEXT =
  "CRITICAL: Absolutely NO text, letters, numbers, watermarks, logos, brand marks, Chinese/English overlays, Amazon wording, or material callouts anywhere.";

type Shot = {
  key: string;
  style: "A_model_lifestyle" | "B_display_embed";
  prompt: string;
  refs: "model" | "display" | "both";
};

const SHOTS: Shot[] = [
  {
    key: "01-styleA-model-bathroom",
    style: "A_model_lifestyle",
    refs: "model",
    prompt: [
      "Edit the primary product photo into an Amazon-style lifestyle image with a real adult human model wearing THIS exact blue plaid bathrobe.",
      FIDELITY,
      "Match the composition and natural wear of the lifestyle style reference: person sitting casually in a bright modern bathroom/vanity, soft daylight, premium e-commerce look.",
      "Robe tied at waist; plaid wraps the body with real drape; solid blue collar and belt clearly visible; fleece texture readable in close areas.",
      EMBED,
      NO_TEXT,
      "Do not add other robe colors or extra printed robes.",
    ].join(" "),
  },
  {
    key: "02-styleA-model-bedroom",
    style: "A_model_lifestyle",
    refs: "model",
    prompt: [
      "Edit the primary product photo into an Amazon-style lifestyle image with a real adult human model wearing THIS exact blue plaid bathrobe in a bright modern bedroom.",
      FIDELITY,
      "Composition: model sitting on bed edge or standing by a window, relaxed natural pose, soft morning light, hotel-home Amazon aesthetic.",
      "Show true fabric thickness and plaid continuity across sleeves, body and pockets; no warped or melted pattern.",
      EMBED,
      NO_TEXT,
      "No embroidered chest logos. No props with printed words.",
    ].join(" "),
  },
  {
    key: "03-styleB-hanging-display",
    style: "B_display_embed",
    refs: "display",
    prompt: [
      "Edit the primary product photo into an Amazon catalog display image mimicking the hanging composition and room embedding of the display style reference.",
      FIDELITY,
      "Composition: THIS blue plaid bathrobe hanging on a wooden hanger from a minimal rod against a clean modern interior wall; natural gravity folds; soft contact shadow on the wall.",
      "Optional: one neatly folded view of the SAME blue plaid robe on a nearby shelf/stool — same pattern/collar/belt identity only. Do NOT invent pink/white/grey alternate robes.",
      EMBED,
      NO_TEXT,
      "Empty wall — no marketing copy.",
    ].join(" "),
  },
  {
    key: "04-styleB-model-plus-folded",
    style: "B_display_embed",
    refs: "both",
    prompt: [
      "Create an Amazon-style hero image: a real adult human model wearing THIS exact blue plaid bathrobe, plus the same robe neatly folded on nearby furniture for depth.",
      FIDELITY,
      "Use model style reference for natural human wear; use display style reference for folded-robe placement and scene embedding.",
      "Bright modern interior (bathroom-adjacent lounge or bedroom). Soft daylight. Pattern must stay crisp and true to primary photo on both worn and folded presentations.",
      EMBED,
      NO_TEXT,
    ].join(" "),
  },
];

async function editWithFallback(args: {
  imageBuffer: Buffer;
  imageMime: string;
  prompt: string;
  referenceImages: Array<{ buffer: Buffer; mime: string; fileName?: string }>;
}) {
  const primary = ProviderRouter.getProductContentImageModel();
  const pinned = ProviderRouter.getImagePinnedModel();
  const candidates = [primary, pinned].filter(
    (m, i, arr) => Boolean(m) && arr.indexOf(m) === i,
  );

  let lastErr = "";
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const detailed = await runImageEditDetailed({
      ...args,
      model,
      quality: "high",
      attemptNumber: i + 1,
    });
    if (detailed.buffer) {
      return {
        buffer: detailed.buffer,
        model,
        execution: detailed.execution,
        fellBack: i > 0,
      };
    }
    const code =
      detailed.providerErrorCode ||
      classifyImageProviderError({
        httpStatus: detailed.httpStatus,
        body: detailed.errorBody,
      });
    lastErr = `${model}:${code}:${detailed.httpStatus}`;
    console.warn("  model failed", lastErr);
    if (!shouldRetryWithPinnedModel(code)) break;
  }
  throw new Error(`出图失败 ${lastErr}`);
}

async function main() {
  for (const p of [PRIMARY, STYLE_MODEL, STYLE_DISPLAY]) {
    if (!fs.existsSync(p)) throw new Error(`缺少文件: ${p}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const primaryBuf = fs.readFileSync(PRIMARY);
  const styleModelBuf = fs.readFileSync(STYLE_MODEL);
  const styleDisplayBuf = fs.readFileSync(STYLE_DISPLAY);

  console.log("Primary:", PRIMARY);
  console.log("Model:", ProviderRouter.getProductContentImageModel());
  console.log("Out:", OUT_DIR);

  const results: Array<Record<string, unknown>> = [];

  for (const shot of SHOTS) {
    console.log(`\n▸ ${shot.key}`);
    const referenceImages: Array<{
      buffer: Buffer;
      mime: string;
      fileName?: string;
    }> = [];
    // 再附一份主图作细节参考，强化印花真实感（同一 SKU）
    referenceImages.push({
      buffer: primaryBuf,
      mime: "image/jpeg",
      fileName: "product-detail-same-sku.jpg",
    });
    if (shot.refs === "model" || shot.refs === "both") {
      referenceImages.push({
        buffer: styleModelBuf,
        mime: "image/jpeg",
        fileName: "style-model.jpg",
      });
    }
    if (shot.refs === "display" || shot.refs === "both") {
      referenceImages.push({
        buffer: styleDisplayBuf,
        mime: "image/jpeg",
        fileName: "style-display.jpg",
      });
    }

    const started = Date.now();
    const out = await editWithFallback({
      imageBuffer: primaryBuf,
      imageMime: "image/jpeg",
      prompt: shot.prompt,
      referenceImages,
    });

    const desktopPath = path.join(OUT_DIR, `${shot.key}.png`);
    fs.writeFileSync(desktopPath, out.buffer);
    const row = {
      key: shot.key,
      style: shot.style,
      model: out.model,
      fellBack: out.fellBack,
      bytes: out.buffer.byteLength,
      latencyMs: Date.now() - started,
      desktopPath,
    };
    results.push(row);
    console.log("  OK", row);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "regen-report.json"),
    JSON.stringify(
      {
        sku: "MX-BR-P202601",
        productName: "印花双面绒浴袍",
        primary: PRIMARY,
        note: "同目录 MX-BR-P202602/P202603 为不同印花 SKU，本轮未混用作参考以免串花",
        results,
      },
      null,
      2,
    ),
  );
  console.log("\nDone:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
