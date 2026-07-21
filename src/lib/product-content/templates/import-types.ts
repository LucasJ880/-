/**
 * 授权模版导入清单（人工采集后填写）
 *
 * 工作目录约定：
 *   content/visual-template-imports/<suite-id>/manifest.json
 *   content/visual-template-imports/<suite-id>/preview.(jpg|png)
 *   content/visual-template-imports/<suite-id>/style-model.(jpg|png)
 *   content/visual-template-imports/<suite-id>/style-display.(jpg|png)
 *
 * 导入后写入：
 *   public/product-content-templates/<suite-id>/...
 *   public/product-content-templates/<suite-id>/suite.json
 */

import type {
  AspectRatio,
  ProductUploadSlot,
  Resolution,
  StyleRefKind,
} from "./types";

export interface ImportedShotDraft {
  /** 稳定 key，英文蛇形，如 bathroom_model */
  key: string;
  /** 中文标签 */
  label: string;
  /** 分组，如 A_model_lifestyle */
  styleGroup?: string;
  mode?: "EXACT" | "STUDIO" | "CREATIVE";
  styleRefs?: StyleRefKind;
  /**
   * 构图说明（中文/英文均可）。
   * 导入时会叠加热感规则与禁文字规则，生成 promptBody。
   */
  compositionNotes: string;
  /** 额外提示（可选） */
  extraPrompt?: string;
}

export interface VisualTemplateImportManifest {
  /** 稳定 id：小写字母数字下划线，如 loom_soft_white_towel_v1 */
  id: string;
  name: string;
  category: string;
  description: string;
  /** 来源备注，便于审计 */
  source?: {
    vendor?: string;
    externalName?: string;
    licenseNote?: string;
    collectedAt?: string;
    collectedBy?: string;
  };
  quality?: "low" | "medium" | "high" | "auto";
  supportedAspectRatios?: AspectRatio[];
  supportedResolutions?: Resolution[];
  /** 不填则使用默认四槽 */
  uploadSlots?: ProductUploadSlot[];
  fidelityRules?: string[];
  /** 本地相对文件名（相对该套图目录） */
  files?: {
    preview?: string;
    styleModel?: string;
    styleDisplay?: string;
  };
  shots: ImportedShotDraft[];
}

export const DEFAULT_IMPORT_UPLOAD_SLOTS: ProductUploadSlot[] = [
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
];

export const DEFAULT_IMPORT_FIDELITY_RULES = [
  "正面主图为唯一产品真相来源",
  "禁止不同 SKU 印花混用参考",
  "禁止画面出现品牌字 / 平台名 / 材质卖点叠字",
  "印花、颜色、领型、腰带、口袋必须跟随正面主图",
];
