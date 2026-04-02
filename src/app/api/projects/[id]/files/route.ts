import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-rar-compressed",
]);

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "file";
}

/**
 * GET /api/projects/:id/files
 * 获取项目文件列表
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;

  const documents = await db.projectDocument.findMany({
    where: { projectId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ documents });
}

/**
 * POST /api/projects/:id/files
 * 上传文件到项目（multipart/form-data）
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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

    const ext = getFileExtension(file.name);
    const ALLOWED_EXTENSIONS = new Set([
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
      "jpg", "jpeg", "png", "webp", "gif",
      "txt", "csv", "zip", "rar", "7z",
      "dwg", "dxf", "msg", "eml",
    ]);
    if (file.type && !ALLOWED_TYPES.has(file.type) && !ALLOWED_EXTENSIONS.has(ext)) {
      errors.push({ name: file.name, reason: `不支持的文件类型: ${file.type || ext}` });
      continue;
    }

    if (file.size > MAX_FILE_SIZE) {
      errors.push({ name: file.name, reason: `文件过大，最大支持 20MB` });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const pathname = `projects/${projectId}/${timestamp}_${safeName}`;

      const blob = await put(pathname, buffer, {
        access: "public",
        contentType: file.type || "application/octet-stream",
      });

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
}
