/**
 * Visualizer Mock 产品目录（MVP）
 *
 * 说明：
 * - MVP 阶段使用静态目录，id 固定，不写入数据库
 * - `VisualizerProductOption.productCatalogId` 指向这里的 id
 * - 升级到真产品表时，将本文件替换为 DB 查询，所有已保存的 productCatalogId 保留即可
 * - previewImageUrl 第一版允许 null，前端用 colorHex 纯色块占位
 */

export type VisualizerProductCategory =
  | "roller"
  | "solar"
  | "blackout_roller"
  | "zebra"
  | "sheer"
  | "drapery"
  | "dual"
  | "honeycomb"
  | "vertical"
  | "motorized";

export type VisualizerMountingType = "inside" | "outside";

export interface VisualizerProductColor {
  name: string;
  hex: string;
}

export interface VisualizerMockProduct {
  id: string;
  name: string;
  category: VisualizerProductCategory;
  categoryLabel: string; // 中文展示名
  previewImageUrl: string | null;
  textureUrl: string | null;
  defaultOpacity: number; // 0-1
  supportedColors: VisualizerProductColor[];
  mountingTypes: VisualizerMountingType[];
  notes: string;
}

const COLOR_NEUTRALS: VisualizerProductColor[] = [
  { name: "White", hex: "#F5F5F0" },
  { name: "Light Gray", hex: "#C9CBCC" },
  { name: "Beige", hex: "#D9CDB4" },
  { name: "Charcoal", hex: "#4A4A4A" },
];

const COLOR_SHEERS: VisualizerProductColor[] = [
  { name: "Off White", hex: "#FAF7EF" },
  { name: "Linen", hex: "#E9E2D0" },
  { name: "Sand", hex: "#D7C7A3" },
];

const COLOR_FABRIC: VisualizerProductColor[] = [
  { name: "Cream", hex: "#EDE4D3" },
  { name: "Taupe", hex: "#A89B87" },
  { name: "Navy", hex: "#2E3A59" },
  { name: "Forest", hex: "#3D5B48" },
  { name: "Blush", hex: "#D4A99A" },
];

export const VISUALIZER_MOCK_PRODUCTS: VisualizerMockProduct[] = [
  {
    id: "mock_roller_standard",
    name: "Roller Shade",
    category: "roller",
    categoryLabel: "卷帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.85,
    supportedColors: COLOR_NEUTRALS,
    mountingTypes: ["inside", "outside"],
    notes: "最常见的入门款卷帘，适合大部分窗型。",
  },
  {
    id: "mock_solar_screen",
    name: "Solar Shade",
    category: "solar",
    categoryLabel: "阳光帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.65,
    supportedColors: [
      { name: "Ivory", hex: "#EFE7D2" },
      { name: "Stone", hex: "#AFA995" },
      { name: "Graphite", hex: "#545454" },
    ],
    mountingTypes: ["inside", "outside"],
    notes: "5%/10% openness，防紫外线且保留外部景观。",
  },
  {
    id: "mock_roller_blackout",
    name: "Blackout Roller Shade",
    category: "blackout_roller",
    categoryLabel: "遮光卷帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.96,
    supportedColors: COLOR_NEUTRALS,
    mountingTypes: ["inside", "outside"],
    notes: "卧室/影音室常用，接近 100% 遮光。",
  },
  {
    id: "mock_zebra",
    name: "Zebra Blind",
    category: "zebra",
    categoryLabel: "斑马帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.75,
    supportedColors: COLOR_NEUTRALS,
    mountingTypes: ["inside", "outside"],
    notes: "透光/遮光可切换，北美销售主力款。",
  },
  {
    id: "mock_sheer_curtain",
    name: "Sheer Curtain",
    category: "sheer",
    categoryLabel: "纱帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.35,
    supportedColors: COLOR_SHEERS,
    mountingTypes: ["outside"],
    notes: "柔光效果，常与 Drapery 叠搭。",
  },
  {
    id: "mock_drapery",
    name: "Drapery",
    category: "drapery",
    categoryLabel: "布艺窗帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.9,
    supportedColors: COLOR_FABRIC,
    mountingTypes: ["outside"],
    notes: "中高端客户偏好，可做 Pinch Pleat / Ripple Fold。",
  },
  {
    id: "mock_dual_shade",
    name: "Dual Shade",
    category: "dual",
    categoryLabel: "双层帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.8,
    supportedColors: COLOR_NEUTRALS,
    mountingTypes: ["inside", "outside"],
    notes: "一杆双帘（遮光 + 阳光），灵活切换。",
  },
  {
    id: "mock_honeycomb",
    name: "Honeycomb Shade",
    category: "honeycomb",
    categoryLabel: "蜂巢帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.88,
    supportedColors: [
      { name: "White", hex: "#F6F3EB" },
      { name: "Greige", hex: "#C9BFAD" },
      { name: "Slate", hex: "#5A6470" },
    ],
    mountingTypes: ["inside", "outside"],
    notes: "保温隔热性能好，冬季客户关注度高。",
  },
  {
    id: "mock_vertical_blind",
    name: "Vertical Blind",
    category: "vertical",
    categoryLabel: "垂直帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.78,
    supportedColors: [
      { name: "White", hex: "#F2EDE3" },
      { name: "Cloud", hex: "#D9D3C7" },
      { name: "Graphite", hex: "#545454" },
    ],
    mountingTypes: ["inside", "outside"],
    notes: "大落地窗 / 推拉门首选。",
  },
  {
    id: "mock_motorized_curtain",
    name: "Motorized Curtain",
    category: "motorized",
    categoryLabel: "电动窗帘",
    previewImageUrl: null,
    textureUrl: null,
    defaultOpacity: 0.92,
    supportedColors: COLOR_FABRIC,
    mountingTypes: ["outside"],
    notes: "智能家居加分项，价格分水岭，利润点高。",
  },
];

/** 按 id 查产品（API/前端通用） */
export function findMockProductById(id: string): VisualizerMockProduct | null {
  return VISUALIZER_MOCK_PRODUCTS.find((p) => p.id === id) ?? null;
}

/** 公共 helper：给某产品构造一个默认 ProductOption 数据片段（供 PR #2/#3 使用） */
export function buildDefaultProductOption(product: VisualizerMockProduct) {
  const firstColor = product.supportedColors[0];
  return {
    productCatalogId: product.id,
    productName: product.name,
    productCategory: product.category,
    color: firstColor?.name ?? null,
    colorHex: firstColor?.hex ?? null,
    opacity: product.defaultOpacity,
    mountingType: product.mountingTypes[0] ?? null,
  };
}
