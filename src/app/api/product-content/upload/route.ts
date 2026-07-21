/**
 * POST /api/product-content/upload — 产品内容任务资料上传（私有 Blob）
 *
 * form-data:
 * - file: 文件（图片 / pdf / excel / 音频）
 * - orgId?: 多组织时显式选择
 * - jobId?: 可选，用于路径分桶
 * - inputType?: image | excel | pdf | voice | other
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { resolveProductContentOrg } from "@/lib/product-content/api-route-helpers";

const SAFE_SEG = /^[A-Za-z0-9_-]+$/;
const MAX_BYTES = 15 * 1024 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "bin";
}

function guessInputType(mime: string, ext: string): string {
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext)) {
    return "image";
  }
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (
    mime.includes("sheet") ||
    mime.includes("excel") ||
    ["xls", "xlsx", "csv"].includes(ext)
  ) {
    return "excel";
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "webm", "ogg"].includes(ext)) {
    return "voice";
  }
  return "other";
}

export const POST = withAuth(async (request, _ctx, user) => {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "请使用 multipart/form-data 上传文件" },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const orgIdRaw = form.get("orgId");
  const jobIdRaw = form.get("jobId");
  const inputTypeHint = form.get("inputType");

  const requestedOrgId =
    typeof orgIdRaw === "string" && orgIdRaw.trim() ? orgIdRaw.trim() : null;
  const resolved = await resolveProductContentOrg(user, requestedOrgId);
  if (!resolved.ok) return resolved.response;
  const orgId = resolved.orgId;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未提供文件" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `文件大小须在 1B–${MAX_BYTES} 字节之间` },
      { status: 400 },
    );
  }

  const jobId =
    typeof jobIdRaw === "string" && SAFE_SEG.test(jobIdRaw)
      ? jobIdRaw
      : `upload_${Date.now()}`;
  const ext = extOf(file.name).replace(/[^a-z0-9]/g, "") || "bin";
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const pathname = `product-content/${orgId}/${jobId}/01_Source/${Date.now()}-${safeName || `file.${ext}`}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await putPrivateBlob({
    pathname,
    body: buffer,
    contentType: file.type || undefined,
  });

  const inputType =
    typeof inputTypeHint === "string" && inputTypeHint.trim()
      ? inputTypeHint.trim()
      : guessInputType(file.type || "", ext);

  return NextResponse.json({
    success: true,
    pathname: uploaded.pathname,
    proxyUrl: uploaded.proxyUrl,
    mimeType: file.type || null,
    fileName: file.name,
    sizeBytes: file.size,
    inputType,
    orgId,
    jobId,
  });
});
