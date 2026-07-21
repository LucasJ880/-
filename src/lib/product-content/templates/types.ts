/**
 * 产品套图模版库类型（可扩展注册多套 VisualTemplateSuite）
 */

export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type Resolution = "1K" | "2K";

export type ProductUploadSlotId =
  | "product_front"
  | "product_side"
  | "product_detail"
  | "product_texture";

export type StyleRefKind = "model" | "display" | "both" | "none";

export interface ProductUploadSlot {
  id: ProductUploadSlotId;
  label: string;
  required: boolean;
  description?: string;
}

export interface VisualTemplateShot {
  key: string;
  label: string;
  styleGroup: string;
  mode: "EXACT" | "STUDIO" | "CREATIVE";
  /** 风格参考：模特图 / 陈列构图图 */
  styleRefs: StyleRefKind;
  /** 相对模板的 prompt 主体（不含比例/分辨率后缀） */
  promptBody: string;
}

export interface VisualTemplateSuite {
  id: string;
  name: string;
  category: string;
  description: string;
  shotCount: number;
  shots: VisualTemplateShot[];
  uploadSlots: ProductUploadSlot[];
  fidelityRules: string[];
  supportedAspectRatios: AspectRatio[];
  supportedResolutions: Resolution[];
  /** 公共路径预览图，如 /product-content-templates/... */
  previewImage?: string;
  /** 模板内置风格参考（相对 public/） */
  styleAssetPaths?: {
    model?: string;
    display?: string;
  };
  quality: "low" | "medium" | "high" | "auto";
}

export const PRODUCT_SLOT_PURPOSES: ProductUploadSlotId[] = [
  "product_front",
  "product_side",
  "product_detail",
  "product_texture",
];
