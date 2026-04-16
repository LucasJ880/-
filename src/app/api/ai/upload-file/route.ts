import { NextResponse } from "next/server";
import { parseFileBuffer } from "@/lib/files/parse-buffer";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const AI_UPLOAD_ALLOWED_EXT = [
  "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt",
];

const UPLOAD_RATE_LIMIT = {
  name: "ai-upload-file",
  windowMs: 60_000,
  maxRequests: 10,
} as const;

export const POST = withAuth(async (request, _ctx, user) => {
  const rl = await checkRateLimitAsync(UPLOAD_RATE_LIMIT, user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "上传过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "请上传文件" }, { status: 400 });
  }

  const check = await validateUploadedFileAsync(file, {
    maxSize: MAX_FILE_SIZE,
    allowedExtensions: AI_UPLOAD_ALLOWED_EXT,
    checkMagicBytes: true,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  try {
    const { buffer } = check;
    const result = await parseFileBuffer(buffer, file.name);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      fileName: file.name,
      fileSize: file.size,
      textLength: result.text.length,
      textPreview: result.text.slice(0, 500),
      text: result.text,
    });
  } catch (err) {
    console.error("[ai/upload-file] Error:", err);
    return NextResponse.json({ error: "文件解析失败" }, { status: 500 });
  }
});
