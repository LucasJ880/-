/**
 * product-visual-builder — 统一导出（Phase 1A）
 */

export * from "./types";
export { buildProductVisualPrompt, FIXED_WARNINGS } from "./prompt";
export {
  runProductVisualBuilderDryRun,
  runProductVisualBuilder,
  PRODUCT_VISUAL_BUILDER_SLUG,
  HUMAN_REVIEW_WARNING,
  VPB_ERRORS,
  defaultDeps,
} from "./service";
export type {
  VisualBuilderDeps,
  SkillExecutionRecord,
  VisualBuilderRunOptions,
  ImageGenResult,
} from "./service";
export {
  buildVisualBuilderBlobPath,
  validateVisualBuilderImageFile,
  uploadVisualBuilderImage,
  VISUAL_BUILDER_BLOB_PREFIX,
  VISUAL_BUILDER_ALLOWED_EXTS,
  VISUAL_BUILDER_ALLOWED_MIME,
  VISUAL_BUILDER_ASSET_ROLES,
  VISUAL_BUILDER_MAX_SOURCE_BYTES,
  VISUAL_BUILDER_MAX_GENERATED_BYTES,
  VISUAL_BUILDER_PUBLIC_BLOB_NOTICE,
} from "./storage";
export type {
  VisualAssetRole,
  VisualBuilderExt,
  VisualBuilderMime,
  BuildBlobPathParams,
  ValidateImageParams,
  ValidateImageResult,
  UploadImageParams,
  UploadImageResult,
} from "./storage";
export {
  generateProductVisualImage,
  defaultImageClientDeps,
  SOURCE_IMAGES_NOT_USED_WARNING,
  DRY_RUN_WARNING,
  DISABLED_WARNING,
} from "./image-client";
export type {
  GenerateProductVisualImageParams,
  GenerateProductVisualImageResult,
  GeneratedImage,
  ImageClientDeps,
  VisualImageSize,
} from "./image-client";
