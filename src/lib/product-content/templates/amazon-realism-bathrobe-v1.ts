/**
 * 首套套图模板：Amazon 真实感浴袍（可扩展模版库中的第一套，非唯一）
 */

import type { VisualTemplateSuite } from "./types";

const FIDELITY = [
  "PRIMARY IMAGE is the ground-truth product photo. Preserve EXACT product identity with photoreal fidelity.",
  "Keep exact pattern/print, colors, collar style/color, belt, pockets, sleeve length and fabric texture from the primary photo.",
  "Do NOT invent a different print (no leopard/geometric/floral swap), do NOT change solid vs patterned regions, do NOT invent logos.",
  "Prefer under-stylizing over inventing details. Pattern scale and spacing must match the primary photo closely.",
  "Only use product reference images from THIS job (front/side/detail/texture). Never mix another SKU.",
].join(" ");

const EMBED =
  "Photoreal embedding: natural fabric weight, soft contact shadows, believable folds, correct scale/perspective, scene-matched lighting and color temperature. Must NOT look like a flat cutout pasted onto a background.";

const NO_TEXT =
  "CRITICAL: Absolutely NO text, letters, numbers, watermarks, logos, brand marks, Chinese/English overlays, Amazon wording, or material callouts anywhere.";

export const AMAZON_REALISM_BATHROBE_V1: VisualTemplateSuite = {
  id: "amazon_realism_bathrobe_v1",
  name: "Amazon 真实感浴袍套图",
  category: "home_textile_bathrobe",
  description:
    "真人模特 + 陈列嵌入的 Amazon 电商风格四图套装。强调产品真实感，禁止叠字与虚构品牌。",
  shotCount: 4,
  quality: "high",
  previewImage:
    "/product-content-templates/amazon-realism-bathrobe-v1/style-model.jpg",
  styleAssetPaths: {
    model: "/product-content-templates/amazon-realism-bathrobe-v1/style-model.jpg",
    display:
      "/product-content-templates/amazon-realism-bathrobe-v1/style-display.jpg",
  },
  supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
  supportedResolutions: ["1K", "2K"],
  uploadSlots: [
    {
      id: "product_front",
      label: "正面",
      required: true,
      description: "商品主视角（必填）",
    },
    {
      id: "product_side",
      label: "侧面",
      required: false,
      description: "补充侧面视角",
    },
    {
      id: "product_detail",
      label: "细节",
      required: false,
      description: "领口/口袋/腰带等细节",
    },
    {
      id: "product_texture",
      label: "材质纹理",
      required: false,
      description: "面料特写，强化真实感",
    },
  ],
  fidelityRules: [
    "正面主图为唯一产品真相来源",
    "禁止不同 SKU 印花混用参考",
    "禁止画面出现品牌字 / 亚马逊 / 材质卖点叠字",
    "印花、颜色、领型、腰带、口袋必须跟随正面主图",
  ],
  shots: [
    {
      key: "styleA_model_bathroom",
      label: "模特 · 浴室生活方式",
      styleGroup: "A_model_lifestyle",
      mode: "STUDIO",
      styleRefs: "model",
      promptBody: [
        "Edit the primary product photo into an Amazon-style lifestyle image with a real adult human model wearing THIS exact product bathrobe.",
        FIDELITY,
        "Match the composition and natural wear of the lifestyle style reference: person sitting casually in a bright modern bathroom/vanity, soft daylight, premium e-commerce look.",
        "Robe tied at waist; fabric wraps the body with real drape; collar, belt and pockets clearly visible; texture readable in close areas.",
        EMBED,
        NO_TEXT,
        "Do not add other robe colors or extra printed robes.",
      ].join(" "),
    },
    {
      key: "styleA_model_bedroom",
      label: "模特 · 卧室生活方式",
      styleGroup: "A_model_lifestyle",
      mode: "STUDIO",
      styleRefs: "model",
      promptBody: [
        "Edit the primary product photo into an Amazon-style lifestyle image with a real adult human model wearing THIS exact product bathrobe in a bright modern bedroom.",
        FIDELITY,
        "Composition: model sitting on bed edge or standing by a window, relaxed natural pose, soft morning light, hotel-home Amazon aesthetic.",
        "Show true fabric thickness and print/pattern continuity across sleeves, body and pockets; no warped or melted pattern.",
        EMBED,
        NO_TEXT,
        "No embroidered chest logos. No props with printed words.",
      ].join(" "),
    },
    {
      key: "styleB_hanging_display",
      label: "悬挂陈列嵌入",
      styleGroup: "B_display_embed",
      mode: "STUDIO",
      styleRefs: "display",
      promptBody: [
        "Edit the primary product photo into an Amazon catalog display image mimicking the hanging composition and room embedding of the display style reference.",
        FIDELITY,
        "Composition: THIS bathrobe hanging on a wooden hanger from a minimal rod against a clean modern interior wall; natural gravity folds; soft contact shadow on the wall.",
        "Optional: one neatly folded view of the SAME robe on a nearby shelf/stool — same identity only. Do NOT invent alternate colors/SKUs.",
        EMBED,
        NO_TEXT,
        "Empty wall — no marketing copy.",
      ].join(" "),
    },
    {
      key: "styleB_model_plus_folded",
      label: "模特穿着 + 折叠陈列",
      styleGroup: "B_display_embed",
      mode: "STUDIO",
      styleRefs: "both",
      promptBody: [
        "Create an Amazon-style hero image: a real adult human model wearing THIS exact bathrobe, plus the same robe neatly folded on nearby furniture for depth.",
        FIDELITY,
        "Use model style reference for natural human wear; use display style reference for folded-robe placement and scene embedding.",
        "Bright modern interior (bathroom-adjacent lounge or bedroom). Soft daylight. Pattern/color must stay crisp and true to primary photo on both worn and folded presentations.",
        EMBED,
        NO_TEXT,
      ].join(" "),
    },
  ],
};
