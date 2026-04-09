import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseFileBuffer, isSupportedFileType } from "@/lib/files/parse-buffer";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "请上传文件" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "文件大小不能超过 10MB" }, { status: 400 });
  }

  if (!isSupportedFileType(file.name)) {
    return NextResponse.json(
      { error: "不支持的文件格式，支持 PDF、Word、Excel、CSV、TXT" },
      { status: 400 },
    );
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
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
}
