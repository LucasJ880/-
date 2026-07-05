/**
 * POST /api/skills/product-visual-builder/upload — source image 上传（Phase 1E）
 *
 * 链路：auth → active org → MIME/大小/文件名校验 → uploadVisualBuilderImage → public Blob
 *      → 返回 sourceImageUrls（供后续 POST /api/skills/product-visual-builder dry-run 使用）。
 *
 * 本阶段不接 gpt-image-2、不生成 outputImageUrls、不写 SkillExecution / AuditLog、不做前端。
 *
 * 鉴权复用 Phase 1C：withAuth（401/停用/500 统一处理）+ 取用户首个 active org。
 * orgId 一律来自 server session 解析，绝不信任客户端传入；路径强制使用可信 orgId。
 *
 * ⚠️ 上传为 public blob，URL 泄露即可访问；response 带 publicBlobNotice 提醒。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  uploadVisualBuilderImage,
  validateVisualBuilderImageFile,
  VISUAL_BUILDER_ALLOWED_EXTS,
  VISUAL_BUILDER_PUBLIC_BLOB_NOTICE,
  type VisualBuilderExt,
  type UploadImageParams,
  type UploadImageResult,
} from "@/lib/skills/product-visual-builder/storage";

/** 仅接受 source 角色（不允许客户端上传 generated/spec-sheet 等）。 */
const ALLOWED_UPLOAD_ROLE = "source" as const;
/** executionId / uploadBatchId 安全段：字母/数字/_/-。 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** 上传文件的最小结构（Web File 满足；测试用普通对象注入）。 */
interface UploadFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

interface UploadInputs {
  files: UploadFile[];
  executionId?: string;
  assetRole?: string;
}

interface UploadRouteDeps {
  resolveOrgId: (userId: string) => Promise<string | null>;
  uploadImage: (params: UploadImageParams) => Promise<UploadImageResult>;
}

const realDeps: UploadRouteDeps = {
  resolveOrgId: async (userId) => {
    const m = await db.organizationMember.findFirst({
      where: { userId, status: "active" },
      select: { orgId: true },
    });
    return m?.orgId ?? null;
  },
  // 正式 route 真实上传（dryRun 默认 false）。
  uploadImage: (params) => uploadVisualBuilderImage(params),
};

function extOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

function generateUploadBatchId(): string {
  return `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function bad(error: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error }, { status });
}

/** 核心处理（已通过 withAuth 拿到可信 user）。纯业务分支，便于单测注入。 */
async function handleUpload(
  user: AuthUser,
  inputs: UploadInputs,
  deps: UploadRouteDeps,
): Promise<NextResponse> {
  const orgId = await deps.resolveOrgId(user.id);
  if (!orgId) {
    return bad("无组织：当前账号未加入任何组织", 403);
  }

  // assetRole 固定为 source；显式传非 source 直接拒绝。
  if (inputs.assetRole !== undefined && inputs.assetRole !== ALLOWED_UPLOAD_ROLE) {
    return bad(`assetRole 仅允许 ${ALLOWED_UPLOAD_ROLE}（上传 API 不接受 ${inputs.assetRole}）`);
  }

  if (!Array.isArray(inputs.files) || inputs.files.length === 0) {
    return bad("未提供文件");
  }

  // executionId：客户端可不传，route 生成 uploadBatchId（非 SkillExecution.id）。
  let batchId: string;
  if (inputs.executionId !== undefined) {
    if (!SAFE_ID.test(inputs.executionId)) {
      return bad("executionId 非法（仅允许字母/数字/_/-）");
    }
    batchId = inputs.executionId;
  } else {
    batchId = generateUploadBatchId();
  }

  const assets: Array<{
    url: string;
    pathname: string;
    assetRole: string;
    contentType: string;
    sizeBytes?: number;
  }> = [];

  for (let index = 0; index < inputs.files.length; index++) {
    const file = inputs.files[index];

    if (!file || typeof file.size !== "number" || file.size <= 0) {
      return bad(`第 ${index + 1} 个文件为空或无效`);
    }

    const ext = extOf(file.name ?? "");
    if (!ext || !VISUAL_BUILDER_ALLOWED_EXTS.includes(ext as VisualBuilderExt)) {
      return bad(
        `第 ${index + 1} 个文件扩展名非法（仅允许 ${VISUAL_BUILDER_ALLOWED_EXTS.join(" / ")}）`,
      );
    }

    const validation = validateVisualBuilderImageFile({
      sizeBytes: file.size,
      mimeType: file.type,
      assetRole: ALLOWED_UPLOAD_ROLE,
      filename: file.name,
    });
    if (!validation.ok) {
      return bad(`第 ${index + 1} 个文件：${validation.error}`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await deps.uploadImage({
      orgId,
      executionId: batchId,
      assetRole: ALLOWED_UPLOAD_ROLE,
      index,
      ext,
      mimeType: file.type,
      buffer,
      filename: file.name,
    });

    assets.push({
      url: result.url,
      pathname: result.pathname,
      assetRole: ALLOWED_UPLOAD_ROLE,
      contentType: result.contentType,
      sizeBytes: result.sizeBytes,
    });
  }

  return NextResponse.json({
    success: true,
    uploadBatchId: batchId,
    sourceImageUrls: assets.map((a) => a.url),
    assets,
    publicBlobNotice: VISUAL_BUILDER_PUBLIC_BLOB_NOTICE,
  });
}

export const POST = withAuth(async (request, _ctx, user) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("请求需为 multipart/form-data");
  }

  const raw = [...form.getAll("files"), ...form.getAll("file")];
  const files = raw.filter((f): f is File => f instanceof File);
  const executionId = (() => {
    const v = form.get("executionId");
    return typeof v === "string" && v.length > 0 ? v : undefined;
  })();
  const assetRole = (() => {
    const v = form.get("assetRole");
    return typeof v === "string" && v.length > 0 ? v : undefined;
  })();

  return handleUpload(user, { files, executionId, assetRole }, realDeps);
});

// 仅非生产环境暴露内部函数给单元测试（生产/构建时 NODE_ENV=production，不挂载，零泄露）。
if (process.env.NODE_ENV !== "production") {
  (globalThis as { __pvbUploadRouteInternals?: unknown }).__pvbUploadRouteInternals = {
    handleUpload,
  };
}
