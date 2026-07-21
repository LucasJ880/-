/**
 * 梦馨浴袍 — Amazon 风格重生成（真人模特 + 构图嵌入感 + 无文字）
 *
 * 两种风格 × 各 2 张 = 4 张：
 *   A 真人生活方式（浴室 / 卧室）— 参考用户上传模特图
 *   B 陈列构图嵌入（悬挂 / 折叠）— 参考用户上传陈列构图图
 *
 * 用法：
 *   PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_IMAGE_DRY_RUN=0 \
 *     npx tsx scripts/regen-mengxin-amazon-styles.ts
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

import { db } from "../src/lib/db";
import { putPrivateBlob } from "../src/lib/files/blob-access";
import { editProductImage } from "../src/lib/image-engine/client";
import { ProviderRouter } from "../src/lib/ai/model-registry";

const JOB_ID = "cmrtvxahx0001n1i5fzj9sphi";

const PRODUCT_DIR =
  "/Users/user/Desktop/梦馨家纺网站/2026 产品图片/浴袍 bathrobe/素色浴袍 SOLID BATHROBE";
const STYLE_MODEL =
  "/Users/user/.cursor/projects/Users-user-Desktop/assets/image-fcd36ea4-a5ce-4182-8dc3-7132b673d69a.png";
const STYLE_DISPLAY =
  "/Users/user/.cursor/projects/Users-user-Desktop/assets/0cd3aec610bab30e10d136bc10285fb4-54b694df-761a-4bba-b0a6-a996a031f9bb.png";

const OUT_DIR = "/Users/user/Desktop/梦馨浴袍生成图-Amazon重做";

const NO_TEXT =
  "CRITICAL: Absolutely NO text, NO letters, NO numbers, NO watermarks, NO logos, NO brand marks, NO Chinese characters, NO English words, NO Amazon branding, NO '亚马逊', NO labels, NO captions, NO graphic overlays anywhere in the image.";

const EMBED =
  "The bathrobe must look physically present in the scene: natural fabric weight, soft contact shadows where it touches surfaces, realistic folds, correct perspective scale, matching scene lighting and color temperature. Do NOT look like a cutout pasted onto a background.";

const IDENTITY =
  "Primary image is the REAL product photo. Keep the same bathrobe identity: solid color, shawl collar, long sleeves, front patch pockets, matching waist belt, fabric texture. Do not invent a different robe style or waffle weave unless the product already has it.";

type Shot = {
  key: string;
  style: "A_model_lifestyle" | "B_display_embed";
  sceneType: string;
  mode: "STUDIO" | "CREATIVE";
  prompt: string;
  useModelStyle: boolean;
  useDisplayStyle: boolean;
};

const SHOTS: Shot[] = [
  {
    key: "01-styleA-model-bathroom",
    style: "A_model_lifestyle",
    sceneType: "amazon_model_bathroom",
    mode: "STUDIO",
    useModelStyle: true,
    useDisplayStyle: false,
    prompt: [
      "Edit the product photo into an Amazon-style lifestyle product image with a real adult human model wearing THIS exact bathrobe.",
      IDENTITY,
      "Match the composition and natural product-embedding feel of the lifestyle style reference: a real person sitting casually in a bright modern bathroom / vanity area, looking natural, soft daylight, premium e-commerce photography.",
      "Model wears the bathrobe naturally tied at the waist; fabric drapes with real weight on the body; sleeves and collar sit correctly; no floating fabric.",
      EMBED,
      "Clean Amazon listing aesthetic: bright, airy, aspirational, sharp focus on the robe.",
      NO_TEXT,
      "Do not add extra bathrobes of other colors. Only this product.",
    ].join(" "),
  },
  {
    key: "02-styleA-model-bedroom",
    style: "A_model_lifestyle",
    sceneType: "amazon_model_bedroom",
    mode: "STUDIO",
    useModelStyle: true,
    useDisplayStyle: false,
    prompt: [
      "Edit the product photo into an Amazon-style lifestyle image with a real adult human model wearing THIS exact bathrobe in a bright modern bedroom.",
      IDENTITY,
      "Composition: model sitting on the edge of a neatly made bed or standing near a window, relaxed natural pose, soft morning light, hotel-home premium feel for Amazon A+ / main lifestyle slot.",
      "Robe must wrap the body naturally with believable folds, belt tied, pockets visible, fabric contacting the bed/floor with soft shadows.",
      EMBED,
      NO_TEXT,
      "No fake logos on the chest. No embroidered brand marks. No props with printed words.",
    ].join(" "),
  },
  {
    key: "03-styleB-hanging-display",
    style: "B_display_embed",
    sceneType: "amazon_hanging_display",
    mode: "STUDIO",
    useModelStyle: false,
    useDisplayStyle: true,
    prompt: [
      "Edit the product photo into an Amazon catalog display image mimicking the hanging composition and room embedding of the display style reference.",
      IDENTITY,
      "Composition inspired by the reference: bathrobe hanging on a wooden hanger from a minimal rack/rod against a clean modern interior wall (soft grey upper wall + darker lower paneling ok), natural drape and gravity folds.",
      "Optionally include one neatly folded matching robe on a nearby shelf or stool for embedding depth, but keep BOTH as the SAME product color/identity — do not invent pink/white/grey alternate SKUs.",
      EMBED,
      "Amazon clean commercial look, soft studio-natural light, gentle contact shadows behind hanging robe.",
      NO_TEXT,
      "Remove any marketing copy space text. Empty wall only.",
    ].join(" "),
  },
  {
    key: "04-styleB-model-plus-folded",
    style: "B_display_embed",
    sceneType: "amazon_model_with_folded",
    mode: "STUDIO",
    useModelStyle: true,
    useDisplayStyle: true,
    prompt: [
      "Create an Amazon-style hero lifestyle image combining: a real adult human model wearing THIS bathrobe (lifestyle embedding) AND a second view of the same robe neatly folded on furniture (display embedding), like premium Amazon main images.",
      IDENTITY,
      "Use the model style reference for natural human wear and pose quality; use the display style reference for folded-robe placement, shelf/stool contact, and scene depth.",
      "Modern bright interior (bathroom-adjacent lounge or bedroom). Soft daylight. Product must feel grounded in the room, not floating.",
      EMBED,
      NO_TEXT,
      "No brand logos, no Chinese/English overlays, no Amazon wording, no material callout text.",
    ].join(" "),
  },
];

async function putLocalFile(
  orgId: string,
  jobId: string,
  fileName: string,
  absPath: string,
): Promise<string> {
  const buf = fs.readFileSync(absPath);
  const lower = absPath.toLowerCase();
  const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
  const pathname = `product-content/${orgId}/${jobId}/style-refs/${fileName}`;
  await putPrivateBlob({ pathname, body: buf, contentType: mime });
  return pathname;
}

async function main() {
  console.log("Image model:", ProviderRouter.getProductContentImageModel());
  console.log("Pinned:", ProviderRouter.getImagePinnedModel());

  for (const p of [
    path.join(PRODUCT_DIR, "MX-BR-S202601.jpg"),
    STYLE_MODEL,
    STYLE_DISPLAY,
  ]) {
    if (!fs.existsSync(p)) throw new Error(`缺少文件: ${p}`);
  }

  const job = await db.productContentJob.findUnique({ where: { id: JOB_ID } });
  if (!job) throw new Error("Job 不存在");
  const orgId = job.orgId;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const primaryPath = await putLocalFile(
    orgId,
    JOB_ID,
    "primary-MX-BR-S202601.jpg",
    path.join(PRODUCT_DIR, "MX-BR-S202601.jpg"),
  );
  const detailPath = await putLocalFile(
    orgId,
    JOB_ID,
    "detail-MX-BR-S202602-1.jpg",
    path.join(PRODUCT_DIR, "MX-BR-S202602-1.jpg"),
  );
  const texturePath = await putLocalFile(
    orgId,
    JOB_ID,
    "texture-MX-BR-S202603-1.jpg",
    path.join(PRODUCT_DIR, "MX-BR-S202603-1.jpg"),
  );
  const styleModelPath = await putLocalFile(
    orgId,
    JOB_ID,
    "style-model-amazon.jpg",
    STYLE_MODEL,
  );
  const styleDisplayPath = await putLocalFile(
    orgId,
    JOB_ID,
    "style-display-composition.jpg",
    STYLE_DISPLAY,
  );

  const results: Array<Record<string, unknown>> = [];

  for (const shot of SHOTS) {
    console.log(`\n▸ Generating ${shot.key} ...`);
    const refs = [detailPath, texturePath];
    if (shot.useModelStyle) refs.push(styleModelPath);
    if (shot.useDisplayStyle) refs.push(styleDisplayPath);

    const started = Date.now();
    const result = await editProductImage({
      orgId,
      jobId: JOB_ID,
      mode: shot.mode,
      sceneType: shot.sceneType,
      primaryImagePath: primaryPath,
      referenceImagePaths: refs,
      dryRun: false,
      prompt: shot.prompt,
      protectionRules: {
        preserveLogo: false,
        preserveText: false,
        preservePattern: true,
        preserveColor: true,
        preserveShape: true,
        allowBackgroundChange: true,
        allowSceneProps: true,
      },
      geometryClass: "DEFORMABLE_SURFACE",
    });

    if (!result.buffer) {
      throw new Error(`${shot.key} 出图失败：空 buffer`);
    }

    const fileName = `${shot.key}.png`;
    const desktopPath = path.join(OUT_DIR, fileName);
    fs.writeFileSync(desktopPath, result.buffer);

    const visualJob = await db.visualGenerationJob.create({
      data: {
        orgId,
        jobId: JOB_ID,
        mode: shot.mode,
        sceneType: shot.sceneType,
        status: "done",
        prompt: shot.prompt.slice(0, 2000),
        provider: result.provider,
        model: result.model,
        costCents: 12,
      },
    });

    const blobPut = await putPrivateBlob({
      pathname: `product-content/${orgId}/${JOB_ID}/visuals/${visualJob.id}-${shot.sceneType}.png`,
      body: result.buffer,
      contentType: "image/png",
    });

    const output = await db.visualOutput.create({
      data: {
        orgId,
        visualJobId: visualJob.id,
        blobPathname: blobPut.pathname,
        provider: result.provider,
        model: result.model,
        status: "generated",
        metadata: {
          ...result.metadata,
          amazonStyleRegen: true,
          style: shot.style,
          key: shot.key,
          desktopPath,
          noTextRequested: true,
        },
      },
    });

    const row = {
      key: shot.key,
      style: shot.style,
      outputId: output.id,
      model: result.model,
      bytes: result.buffer.byteLength,
      latencyMs: Date.now() - started,
      desktopPath,
      blobPath: blobPut.pathname,
      resolvedModel: result.metadata.resolvedModel,
      providerErrorCode: result.metadata.providerErrorCode,
      fallbackReason: result.metadata.fallbackReason,
    };
    results.push(row);
    console.log("  OK", row);
  }

  const reportPath = path.join(OUT_DIR, "regen-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ jobId: JOB_ID, results }, null, 2));
  console.log("\nDone. Desktop folder:", OUT_DIR);
  console.log("Report:", reportPath);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
