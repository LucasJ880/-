/**
 * 套图模版：奶油拱形卧室床品（仿「薄荷宫廷」构图套路自建，非对方素材）
 * MVP：8 镜（场景 4 + 模特 4），可后续扩展
 */

import type { VisualTemplateSuite } from "./types";

const FIDELITY = [
  "PRIMARY IMAGE is the ground-truth bedding product photo. Preserve EXACT product identity with photoreal fidelity.",
  "Keep exact fabric color/colorway, lace/ruffle trim design, stitching, duvet and pillow construction from the primary photo.",
  "Do NOT invent a different colorway, lace pattern, embroidery logo, or swap to another bedding SKU.",
  "Prefer under-stylizing over inventing details. Lace scale, trim width and fabric sheen must match the primary photo closely.",
  "Only use product reference images from THIS job (front/side/detail/texture). Never mix another SKU.",
].join(" ");

const SCENE =
  "Scene mood (composition guide, not a brand clone): soft cream/beige bedroom, large recessed wall arch behind the bed, warm diffuse lighting, dark wood nightstands, thin candle floor lamps optional, sparse florals in a white vase, clean wooden floor. Calm premium home-textile e-commerce look.";

const EMBED =
  "Photoreal embedding: natural fabric weight and bedding drape, soft contact shadows on mattress and pillows, believable lace volume, correct scale/perspective, scene-matched lighting and color temperature. Must NOT look like a flat cutout pasted onto a background.";

const NO_TEXT =
  "CRITICAL: Do NOT add watermarks, UI overlays, marketplace branding, price tags, material callouts, or extra logos. However, if the primary product fabric already contains printed pattern text/graphics (e.g. words woven into the print), PRESERVE that exact fabric print — do not erase or rewrite it.";

export const MINT_PALACE_BEDDING_V1: VisualTemplateSuite = {
  id: "mint_palace_bedding_v1",
  name: "奶油拱形卧室 · 床品套图",
  category: "home_textile_bedding",
  description:
    "仿电商「拱形奶油卧室 + 蕾丝床品」构图套路自建的 8 镜套图：场景陈列 4 镜 + 模特生活方式 4 镜。产品颜色/蕾丝以主图为准，禁止叠字。",
  shotCount: 8,
  quality: "high",
  supportedAspectRatios: ["1:1", "3:4", "4:3", "9:16", "16:9"],
  supportedResolutions: ["1K", "2K"],
  uploadSlots: [
    {
      id: "product_front",
      label: "正面铺床",
      required: true,
      description: "床品整套/铺床主视角（必填）",
    },
    {
      id: "product_side",
      label: "侧面",
      required: false,
      description: "床侧或被褥垂坠补充视角",
    },
    {
      id: "product_detail",
      label: "细节",
      required: false,
      description: "蕾丝花边/滚边/缝线细节",
    },
    {
      id: "product_texture",
      label: "材质纹理",
      required: false,
      description: "面料特写，强化真实感",
    },
  ],
  fidelityRules: [
    "正面主图为唯一产品真相来源（颜色、蕾丝、被套构造）",
    "禁止不同 SKU / 色号混用参考",
    "禁止画面出现品牌字、平台名、材质卖点叠字",
    "场景为构图指引，不得改写产品本身的颜色与花边",
  ],
  shots: [
    {
      key: "scene_hero_arch_bed",
      label: "场景 · 拱形全景床景",
      styleGroup: "A_scene_display",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an Amazon-style home-textile catalog image of THIS exact bedding set made up on a bed.",
        FIDELITY,
        SCENE,
        "Composition: centered wide eye-level hero — full bed framed inside a large recessed wall arch; duvet and stacked lace-trimmed pillows clearly readable; nightstands and soft ambient lamps visible at sides; generous negative space, premium catalog stillness.",
        EMBED,
        NO_TEXT,
        "No people in this shot.",
      ].join(" "),
    },
    {
      key: "scene_angled_bed_layers",
      label: "场景 · 斜角中景层次",
      styleGroup: "A_scene_display",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an Amazon-style bedding lifestyle still of THIS exact bedding set.",
        FIDELITY,
        SCENE,
        "Composition: medium three-quarter angle from bed corner; show pillow layering, duvet fold lines and lace trim volume; slight downward tilt; cozy depth without clutter.",
        EMBED,
        NO_TEXT,
        "No people in this shot.",
      ].join(" "),
    },
    {
      key: "scene_lace_pillow_detail",
      label: "场景 · 蕾丝枕边特写",
      styleGroup: "A_scene_display",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create a close-up Amazon-style product detail image of THIS exact bedding.",
        FIDELITY,
        SCENE,
        "Composition: tight detail on lace/ruffle-trimmed pillow edge and adjacent duvet fabric; macro-readable weave and lace pattern; soft warm light; shallow depth of field.",
        EMBED,
        NO_TEXT,
        "No people, no logos on fabric corners.",
      ].join(" "),
    },
    {
      key: "scene_overhead_props",
      label: "场景 · 俯拍枕区道具",
      styleGroup: "A_scene_display",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an elevated Amazon-style bedding still of THIS exact product.",
        FIDELITY,
        SCENE,
        "Composition: high-angle / near top-down on pillow zone and upper duvet; optional quiet lifestyle props only — open book or small ceramic tray/plate; props must have ZERO printed text; lace and fabric color remain true to primary photo.",
        EMBED,
        NO_TEXT,
        "No people in this shot.",
      ].join(" "),
    },
    {
      key: "model_standing_pillow",
      label: "模特 · 站立抱枕",
      styleGroup: "B_model_lifestyle",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an Amazon-style lifestyle image with a real adult human model and THIS exact bedding product.",
        FIDELITY,
        SCENE,
        "Composition: model standing beside the made bed, holding one matching lace-trimmed pillow from THIS set toward camera; calm elegant pose; soft warm bedroom light; bedding on the bed must match the held pillow identity.",
        "Model wardrobe: simple light dress complementary to the scene — do NOT reprint product logos on clothing.",
        EMBED,
        NO_TEXT,
      ].join(" "),
    },
    {
      key: "model_sitting_reading",
      label: "模特 · 坐床阅读",
      styleGroup: "B_model_lifestyle",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an Amazon-style lifestyle image with a real adult human model using THIS exact bedding.",
        FIDELITY,
        SCENE,
        "Composition: model sitting on the bed edge or against pillows, reading a plain book (no readable cover text); duvet and lace pillows from THIS set surrounding the model; relaxed natural pose.",
        EMBED,
        NO_TEXT,
      ].join(" "),
    },
    {
      key: "model_lying_duvet",
      label: "模特 · 侧卧盖被",
      styleGroup: "B_model_lifestyle",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an Amazon-style lifestyle image with a real adult human model resting in THIS exact bedding.",
        FIDELITY,
        SCENE,
        "Composition: model lying on the bed under/with THIS duvet, lace-trimmed pillows visible; peaceful sleep/rest mood; fabric drape natural across body and mattress; face may be turned aside for privacy.",
        EMBED,
        NO_TEXT,
      ].join(" "),
    },
    {
      key: "model_adjusting_bedding",
      label: "模特 · 整理被褥",
      styleGroup: "B_model_lifestyle",
      mode: "STUDIO",
      styleRefs: "none",
      promptBody: [
        "Create an Amazon-style lifestyle image with a real adult human model interacting with THIS exact bedding.",
        FIDELITY,
        SCENE,
        "Composition: medium shot — model sitting or kneeling on bed gently adjusting the duvet fold or fluffing a lace pillow; hands and fabric interaction readable; product identity crisp on duvet and pillows.",
        EMBED,
        NO_TEXT,
      ].join(" "),
    },
  ],
};
