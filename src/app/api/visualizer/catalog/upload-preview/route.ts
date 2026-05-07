/**
 * POST /api/visualizer/catalog/upload-preview
 *
 * multipart/form-data
 *   - file: 图片（image/jpeg | image/png | image/webp，≤ 5MB）
 *
 * 返回 { url }，前端拿到后填入「添加产品」弹窗的 previewImageUrl 字段。
 *
 * 权限：登录用户 + 已解析当前组织（任意有权销售模块的用户均可上传，因为预览图只是装饰）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import {
  VISUALIZER_ALLOWED_IMAGE_EXTS,
  VISUALIZER_ALLOWED_MIME,
  VISUALIZER_MAX_IMAGE_SIZE,
  putVisualizerCatalogPreview,
} from "@/lib/visualizer/upload";
import { logger } from "@/lib/common/logger";

export const POST = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) {
    return orgRes.response;
  }
  const orgId = orgRes.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "无法确定组织" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "请求格式无效，需要 multipart/form-data" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "未上传文件" }, { status: 400 });
  }

  const check = await validateUploadedFileAsync(file, {
    maxSize: VISUALIZER_MAX_IMAGE_SIZE,
    allowedExtensions: [...VISUALIZER_ALLOWED_IMAGE_EXTS],
    allowedMimeTypes: VISUALIZER_ALLOWED_MIME,
    checkMagicBytes: true,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  try {
    const blob = await putVisualizerCatalogPreview({
      orgId,
      safeName: check.safeName,
      buffer: check.buffer,
      contentType: check.mime,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    logger.error("visualizer.catalog.upload_failed", { err, orgId });
    return NextResponse.json({ error: "上传失败，请稍后重试" }, { status: 500 });
  }
});
