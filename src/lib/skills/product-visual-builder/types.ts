/**
 * product-visual-builder — 类型契约（Phase 1A，仅类型，无运行逻辑）
 *
 * 约束：
 * - 第一版只做 TypeScript 类型，不引入 Zod。
 * - 真实产品照片是唯一事实来源；缺失字段在 prompt 中标注 not provided。
 */

export type ProductType = "blanket" | "bathrobe" | "pillow" | "other";

export type VisualUseCase =
  | "website"
  | "catalog"
  | "quote_attachment"
  | "whatsapp_sales"
  | "internal_review";

export type VisualStyle =
  | "warm_home"
  | "hotel"
  | "white_background"
  | "spec_sheet"
  | "ecommerce";

export type VisualLanguage = "en" | "zh" | "bilingual";

export type SourceImageRole =
  | "front"
  | "back"
  | "side"
  | "detail"
  | "texture"
  | "packaging"
  | "label"
  | "color_options"
  | "scene"
  | "other";

/** 产品事实（全部可选；缺失即 not provided，禁止脑补）。值用 string | string[] 保持灵活。 */
export interface VisualProductFacts {
  material?: string | string[];
  sizes?: string | string[];
  colors?: string | string[];
  structure?: string | string[];
  texture?: string | string[];
  packaging?: string | string[];
  labelLogoOptions?: string | string[];
  careInstructions?: string | string[];
}

/** 认证信息（仅按用户提供原文展示，最终以官方证书为准）。 */
export interface VisualCertification {
  name: string;
  issuer?: string;
  number?: string;
  note?: string;
}

/** 硬约束。 */
export interface VisualConstraints {
  mustKeep?: string[];
  mustNotAdd?: string[];
  forbiddenClaims?: string[];
  certificationRules?: string;
}

export interface VisualBuilderInput {
  orgId: string;
  userId: string;
  customerId?: string;
  projectId?: string;
  productType: ProductType;
  productName: string;
  useCase: VisualUseCase;
  style: VisualStyle;
  sourceImageUrls: string[];
  sourceImageRoles?: SourceImageRole[];
  productFacts?: VisualProductFacts;
  certifications?: VisualCertification[];
  constraints?: VisualConstraints;
  departmentTag?: string;
  language: VisualLanguage;
}

export type VisualBuilderStatus = "completed" | "failed";

export interface VisualBuilderOutput {
  executionId?: string;
  status: VisualBuilderStatus;
  outputImageUrls: string[];
  finalPrompt: string;
  model?: string;
  warnings: string[];
  productFactsUsed: Record<string, unknown>;
  suggestedUsage?: string;
  websitePathSuggestions: string[];
  assetNamingSuggestions: string[];
  humanReviewRequired: boolean;
  createdAt: string;
}
