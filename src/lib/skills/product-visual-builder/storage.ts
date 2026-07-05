/**
 * product-visual-builder — 图片存储约定与校验（Phase 1D-Storage）
 *
 * 职责（本阶段仅做存储约定，不接 gpt-image-2、不调用图片模型）：
 * - 统一 Blob 路径规范：visual-builder/{orgId}/{yyyy}/{mm}/{executionId}/{assetRole}-{index}.{ext}
 * - orgId / executionId 路径隔离与注入防护（优先拒绝，不悄悄修正危险路径）
 * - 图片 MIME / 文件大小校验
 * - @vercel/blob 上传封装，支持 dryRun（不真正上传）
 *
 * 复用现有约定（参考 src/lib/visualizer/upload.ts）：
 * - 允许扩展名 png / jpg / jpeg / webp
 * - 允许 MIME image/png、image/jpeg、image/webp
 * - 上传走统一 blob-access 私有上传，返回 /api/files 代理 URL（B2 私有化）
 */

import { putPrivateBlob } from "@/lib/files/blob-access";

export const VISUAL_BUILDER_BLOB_PREFIX = "visual-builder";

export const VISUAL_BUILDER_ALLOWED_EXTS = ["png", "jpg", "jpeg", "webp"] as const;
export type VisualBuilderExt = (typeof VISUAL_BUILDER_ALLOWED_EXTS)[number];

export const VISUAL_BUILDER_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export type VisualBuilderMime = (typeof VISUAL_BUILDER_ALLOWED_MIME)[number];

export const VISUAL_BUILDER_ASSET_ROLES = [
  "source",
  "generated",
  "spec-sheet",
  "white-bg",
  "lifestyle",
  "detail",
] as const;
export type VisualAssetRole = (typeof VISUAL_BUILDER_ASSET_ROLES)[number];

/** source 图（用户上传）上限 5MB；其余（生成类）上限 10MB。 */
export const VISUAL_BUILDER_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const VISUAL_BUILDER_MAX_GENERATED_BYTES = 10 * 1024 * 1024;

/** 存储模式提示常量（供调用方在 UI / 日志中复用）。 */
export const VISUAL_BUILDER_PUBLIC_BLOB_NOTICE =
  "图片以私有 Blob 存储，仅组织成员可经鉴权代理访问；请仍避免上传客户隐私、合同或敏感标签的图片。";

/** 安全路径段：仅允许字母/数字/下划线/连字符，天然排除空格、中文、/、\\、.、?、..。 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
/** 安全文件名：允许 . 但禁止 .. 与路径分隔/查询串。 */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} 不能为空`);
  }
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(
      `${field} 含非法字符（仅允许字母/数字/_/-，禁止空格、中文、/、..、? 等）：${value}`,
    );
  }
  return value;
}

function maxBytesForRole(assetRole: VisualAssetRole): number {
  return assetRole === "source"
    ? VISUAL_BUILDER_MAX_SOURCE_BYTES
    : VISUAL_BUILDER_MAX_GENERATED_BYTES;
}

export interface BuildBlobPathParams {
  orgId: string;
  executionId: string;
  assetRole: VisualAssetRole;
  index: number;
  ext: string;
  /** 可选，默认当前时间；按 UTC 取 yyyy/mm，保证可测试与跨时区一致。 */
  date?: Date;
}

/**
 * 构建 visual-builder Blob 路径。
 * 任意参数非法时抛错（优先拒绝，不 sanitize 危险路径）。
 */
export function buildVisualBuilderBlobPath(params: BuildBlobPathParams): string {
  const orgId = assertSafeSegment(params.orgId, "orgId");
  const executionId = assertSafeSegment(params.executionId, "executionId");

  if (!VISUAL_BUILDER_ASSET_ROLES.includes(params.assetRole)) {
    throw new Error(
      `非法 assetRole：${String(params.assetRole)}（允许：${VISUAL_BUILDER_ASSET_ROLES.join(" / ")}）`,
    );
  }

  if (
    typeof params.index !== "number" ||
    !Number.isInteger(params.index) ||
    params.index < 0
  ) {
    throw new Error(`index 必须是非负整数：${String(params.index)}`);
  }

  const ext = typeof params.ext === "string" ? params.ext.toLowerCase() : "";
  if (!VISUAL_BUILDER_ALLOWED_EXTS.includes(ext as VisualBuilderExt)) {
    throw new Error(
      `非法扩展名：${String(params.ext)}（允许：${VISUAL_BUILDER_ALLOWED_EXTS.join(" / ")}）`,
    );
  }

  const date = params.date ?? new Date();
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");

  const pathname = `${VISUAL_BUILDER_BLOB_PREFIX}/${orgId}/${yyyy}/${mm}/${executionId}/${params.assetRole}-${params.index}.${ext}`;

  // 纵深防御：组装后再整体校验，确保无空格 / 中文 / .. / 查询串。
  if (!/^[A-Za-z0-9/_.-]+$/.test(pathname) || pathname.includes("..")) {
    throw new Error(`生成的路径不安全：${pathname}`);
  }

  return pathname;
}

export interface ValidateImageParams {
  sizeBytes: number;
  mimeType: string;
  assetRole: VisualAssetRole;
  filename?: string;
}

export type ValidateImageResult = { ok: true } | { ok: false; error: string };

/** 校验图片 MIME / 大小 / 文件名安全性。 */
export function validateVisualBuilderImageFile(
  params: ValidateImageParams,
): ValidateImageResult {
  if (!VISUAL_BUILDER_ALLOWED_MIME.includes(params.mimeType as VisualBuilderMime)) {
    return {
      ok: false,
      error: `不支持的图片类型：${String(params.mimeType)}（仅允许 ${VISUAL_BUILDER_ALLOWED_MIME.join(" / ")}）`,
    };
  }

  if (!VISUAL_BUILDER_ASSET_ROLES.includes(params.assetRole)) {
    return { ok: false, error: `非法 assetRole：${String(params.assetRole)}` };
  }

  if (
    typeof params.sizeBytes !== "number" ||
    !Number.isFinite(params.sizeBytes) ||
    params.sizeBytes <= 0
  ) {
    return { ok: false, error: "图片大小无效（sizeBytes 必须为正数）" };
  }

  const max = maxBytesForRole(params.assetRole);
  if (params.sizeBytes > max) {
    const limitMb = Math.round(max / (1024 * 1024));
    return {
      ok: false,
      error: `图片过大：${params.sizeBytes} 字节，超过 ${params.assetRole === "source" ? "source" : "generated"} 上限 ${limitMb}MB`,
    };
  }

  if (params.filename !== undefined) {
    if (
      typeof params.filename !== "string" ||
      params.filename.length === 0 ||
      params.filename.includes("..") ||
      !SAFE_FILENAME.test(params.filename)
    ) {
      return {
        ok: false,
        error: `非法文件名（禁止空格、中文、/、..、? 等）：${String(params.filename)}`,
      };
    }
  }

  return { ok: true };
}

export interface UploadImageParams {
  orgId: string;
  executionId: string;
  assetRole: VisualAssetRole;
  index: number;
  ext: string;
  mimeType: string;
  /** 图片字节内容（dryRun 时可省略）。 */
  buffer?: Buffer;
  filename?: string;
  date?: Date;
  /** true 时不真正上传，仅返回将要使用的 pathname。 */
  dryRun?: boolean;
}

export interface UploadImageResult {
  url: string;
  pathname: string;
  contentType: string;
  sizeBytes?: number;
  dryRun: boolean;
  accessMode: "private";
}

/**
 * 上传 visual-builder 图片（私有 Blob，返回 /api/files 代理 URL）。
 * - 先构建并校验路径，再校验文件，最后上传。
 * - 不写数据库 / 不写 SkillExecution / 不写 AuditLog / 不调用 AI。
 */
export async function uploadVisualBuilderImage(
  params: UploadImageParams,
): Promise<UploadImageResult> {
  const pathname = buildVisualBuilderBlobPath({
    orgId: params.orgId,
    executionId: params.executionId,
    assetRole: params.assetRole,
    index: params.index,
    ext: params.ext,
    date: params.date,
  });

  const sizeBytes = params.buffer?.length;

  // MIME 始终校验；有 buffer 时连同大小一起校验。
  const validation = validateVisualBuilderImageFile({
    sizeBytes: sizeBytes ?? 1, // 无 buffer（dryRun）时跳过真实大小，用占位通过大小检查
    mimeType: params.mimeType,
    assetRole: params.assetRole,
    filename: params.filename,
  });
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  if (params.dryRun) {
    return {
      url: "",
      pathname,
      contentType: params.mimeType,
      sizeBytes,
      dryRun: true,
      accessMode: "private",
    };
  }

  if (!params.buffer) {
    throw new Error("缺少图片内容（非 dryRun 时必须提供 buffer）");
  }

  const blob = await putPrivateBlob({
    pathname,
    body: params.buffer,
    contentType: params.mimeType,
  });

  return {
    url: blob.proxyUrl,
    pathname,
    contentType: params.mimeType,
    sizeBytes,
    dryRun: false,
    accessMode: "private",
  };
}
