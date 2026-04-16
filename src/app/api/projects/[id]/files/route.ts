import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { canParseFileType } from "@/lib/files/parse-content";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "jpg", "jpeg", "png", "webp", "gif",
  "txt", "csv", "zip", "rar", "7z",
  "dwg", "dxf", "msg", "eml",
];

/**
 * GET /api/projects/:id/files
 * 获取项目文件列表
 *
 * Query:
 *   take (default 100, max 500)
 *   skip (default 0)
 */
export const GET = withAuth(async (request, ctx) => {
  const { id } = await ctx.params;

  const url = new URL(request.url);
  const take = Math.min(
    Math.max(parseInt(url.searchParams.get("take") ?? "100", 10) || 100, 1),
    500
  );
  const skip = Math.max(parseInt(url.searchParams.get("skip") ?? "0", 10) || 0, 0);

  const [documents, total] = await Promise.all([
    db.projectDocument.findMany({
      where: { projectId: id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take,
      skip,
    }),
    db.projectDocument.count({ where: { projectId: id } }),
  ]);

  return NextResponse.json({ documents, total, take, skip });
});

/**
 * POST /api/projects/:id/files
 * 上传文件到项目（multipart/form-data）
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求格式无效，需要 multipart/form-data" }, { status: 400 });
  }

  const files = formData.getAll("files");
  if (files.length === 0) {
    return NextResponse.json({ error: "未选择文件" }, { status: 400 });
  }

  const results: Array<{
    id: string;
    title: string;
    url: string;
    blobUrl: string;
    fileType: string;
    fileSize: number;
  }> = [];

  const errors: Array<{ name: string; reason: string }> = [];

  for (const entry of files) {
    if (!(entry instanceof File)) {
      errors.push({ name: "unknown", reason: "非文件对象" });
      continue;
    }

    const file = entry;

    const check = await validateUploadedFileAsync(file, {
      maxSize: MAX_FILE_SIZE,
      allowedExtensions: ALLOWED_EXTENSIONS,
      checkMagicBytes: true,
    });
    if (!check.ok) {
      errors.push({ name: file.name, reason: check.reason });
      continue;
    }

    const { ext, safeName, buffer, mime } = check;

    try {
      const timestamp = Date.now();
      const pathname = `projects/${projectId}/${timestamp}_${safeName}`;

      const blob = await put(pathname, buffer, {
        access: "public",
        contentType: mime,
      });

      const parsable = canParseFileType(ext);
      const doc = await db.projectDocument.create({
        data: {
          projectId,
          title: file.name,
          url: blob.url,
          blobUrl: blob.url,
          fileType: ext,
          fileSize: file.size,
          source: "upload",
          uploadedById: user.id,
          parseStatus: parsable ? "pending" : "done",
        },
      });

      results.push({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        blobUrl: blob.url,
        fileType: ext,
        fileSize: file.size,
      });
    } catch (err) {
      errors.push({
        name: file.name,
        reason: err instanceof Error ? err.message : "上传失败",
      });
    }
  }

  return NextResponse.json(
    { uploaded: results, errors, total: results.length },
    { status: results.length > 0 ? 201 : 400 }
  );
});
