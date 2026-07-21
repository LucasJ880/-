/** AI 外贸产品内容总监 — 共享类型 */

export const PRODUCT_CONTENT_JOB_STATUSES = [
  "DRAFT",
  "INGESTING",
  "ANALYZING",
  "NEEDS_INPUT",
  "PLAN_READY",
  "AWAITING_APPROVAL",
  "GENERATING_VISUALS",
  "RUNNING_VISUAL_QA",
  "GENERATING_CONTENT",
  "GENERATING_DOCUMENTS",
  "READY_FOR_REVIEW",
  "REVISION_REQUESTED",
  "APPROVED",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
] as const;

export type ProductContentJobStatus =
  (typeof PRODUCT_CONTENT_JOB_STATUSES)[number];

export const EXECUTION_MODES = ["AUTOPILOT", "ALWAYS_ASK"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const APPROVAL_POLICIES = [
  "AUTO_ALLOW",
  "ASK_BEFORE",
  "MANUAL_ONLY",
] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const PRODUCT_ASSET_ROLES = [
  "primary",
  "front",
  "back",
  "side",
  "top",
  "bottom",
  "detail",
  "texture",
  "packaging",
  "label",
  "logo",
  "color_reference",
  "scene_reference",
  "competitor_reference",
  "unknown",
  /** @deprecated 兼容旧数据；intake 启发式仍可能写入，映射到 primary */
  "primary_product",
  "white_bg",
  "lifestyle",
  "marketing_layout",
  "reference",
] as const;
export type ProductAssetRole = (typeof PRODUCT_ASSET_ROLES)[number];

export const WEB_SOURCE_PURPOSES = [
  "own_product_source",
  "supplier_source",
  "competitor_reference",
  "visual_reference",
  "customer_requirement",
  "unknown",
  /** @deprecated 兼容早期取值 */
  "market_research",
  "supplier_page",
] as const;
export type WebSourcePurpose = (typeof WEB_SOURCE_PURPOSES)[number];

export const VISUAL_GENERATION_MODES = ["EXACT", "STUDIO", "CREATIVE"] as const;
export type VisualGenerationMode = (typeof VISUAL_GENERATION_MODES)[number];

export const PRODUCT_GEOMETRY_CLASSES = [
  "RIGID",
  "SEMI_RIGID",
  "DEFORMABLE_SURFACE",
  "INSTALLED_SURFACE",
  "WEARABLE",
  "UNKNOWN",
  /** @deprecated 兼容早期取值 */
  "RIGID_PRODUCT",
  "FLAT_TEXTILE",
  "COMPLEX_ASSEMBLY",
] as const;
export type ProductGeometryClass = (typeof PRODUCT_GEOMETRY_CLASSES)[number];

export const HOME_TEXTILE_CATEGORIES = [
  "blanket",
  "bedding_set",
  "bed_sheet",
  "duvet_cover",
  "pillow",
  "pillowcase",
  "towel",
  "bathrobe",
  "curtain",
  "fabric_panel",
  /** @deprecated 兼容早期取值 */
  "bedding",
  "cushion",
  "table_linen",
  "bath_mat",
  "other",
] as const;
export type HomeTextileCategory = (typeof HOME_TEXTILE_CATEGORIES)[number];

export const FACT_SOURCE_TYPES = [
  "confirmed_human",
  "approved_product",
  "user_statement",
  "supplier_spec",
  "excel",
  "pdf",
  "website",
  "competitor",
  "ai_inference",
  "image_heuristic",
  "voice_transcript",
] as const;
export type FactSourceType = (typeof FACT_SOURCE_TYPES)[number];

export const QA_RECOMMENDED_STATUSES = ["APPROVE", "REVIEW", "REJECT"] as const;
export type QaRecommendedStatus = (typeof QA_RECOMMENDED_STATUSES)[number];

export interface ProductFidelityDetectedChange {
  category:
    | "shape"
    | "color"
    | "pattern"
    | "texture"
    | "logo"
    | "text"
    | "accessory"
    | "unknown";
  severity: "low" | "medium" | "high";
  description: string;
}

export interface ProductFidelityQaResult {
  overallScore: number;
  shapeScore: number;
  colorScore: number;
  patternScore?: number;
  textureScore?: number;
  logoScore?: number;
  textScore?: number;
  accessoryScore?: number;
  detectedChanges: ProductFidelityDetectedChange[];
  recommendedStatus: QaRecommendedStatus;
  rawJson?: Record<string, unknown>;
}

export interface MultimodalFidelityQaResult {
  overallScore: number;
  shapeScore: number;
  colorScore: number;
  patternScore?: number;
  textureScore?: number;
  logoScore?: number;
  textScore?: number;
  detectedChanges: ProductFidelityDetectedChange[];
  recommendedStatus: QaRecommendedStatus;
}

export const DOCUMENT_PURPOSES = [
  "INTERNAL_DRAFT",
  "CUSTOMER_REVIEW",
  "FORMAL_EXTERNAL",
] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

export interface IndustryFieldDefinition {
  key: string;
  label: string;
  labelEn?: string;
  group: string;
  required: boolean;
  sensitiveClaim?: boolean;
  description?: string;
  example?: string;
}

export interface ImageEditRequest {
  orgId: string;
  jobId: string;
  mode: VisualGenerationMode;
  sceneType: string;
  primaryImagePath: string;
  referenceImagePaths?: string[];
  prompt: string;
  geometryClass?: ProductGeometryClass;
  dryRun?: boolean;
  protectionRules?: ProductProtectionRules;
}

export interface ProductProtectionRules {
  preserveLogo: boolean;
  preserveText: boolean;
  preservePattern: boolean;
  preserveColor: boolean;
  preserveShape: boolean;
  allowBackgroundChange: boolean;
  allowSceneProps: boolean;
}

export type ApprovalActionKey =
  | "analyze_files"
  | "create_product_draft"
  | "generate_low_cost_visuals"
  | "run_fidelity_qa"
  | "generate_copy_draft"
  | "generate_formal_pdf"
  | "generate_formal_zip"
  | "high_cost_model"
  | "creative_mode"
  | "overwrite_approved"
  | "external_send"
  | "publish"
  | "modify_price"
  | "modify_certification";

export interface ExecutionPlanVisual {
  mode: VisualGenerationMode;
  sceneType: string;
  count: number;
}

export interface ExecutionPlan {
  visuals: ExecutionPlanVisual[];
  missingFields: string[];
  notes?: string[];
  approvedAt?: string;
  approvedById?: string;
}

export interface ExtractedFact {
  fieldKey: string;
  value: unknown;
  sourceType: FactSourceType;
  sourceId?: string;
  sourceLocation?: string;
  confidence?: number;
}
