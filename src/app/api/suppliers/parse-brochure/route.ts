import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireAuth } from "@/lib/auth/guards";
import { parseBrochure } from "@/lib/supplier/brochure-parser";
import {
  MAX_BROCHURE_SIZE,
  ALLOWED_BROCHURE_TYPE,
  TEMP_BLOB_PREFIX,
  type BrochureParseResponse,
} from "@/lib/supplier/brochure-types";

function errorJson(error: string, status: number) {
  const body: BrochureParseResponse = { success: false, brochureUrl: null, result: null, error };
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorJson("请求格式无效，需要 multipart/form-data", 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return errorJson("未上传文件", 400);
  }

  if (file.type !== ALLOWED_BROCHURE_TYPE) {
    return errorJson("仅支持 PDF 文件", 400);
  }

  if (file.size > MAX_BROCHURE_SIZE) {
    return errorJson(`文件过大，最大支持 ${MAX_BROCHURE_SIZE / 1024 / 1024}MB`, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let brochureUrl: string | null = null;
  try {
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const pathname = `${TEMP_BLOB_PREFIX}${timestamp}_${safeName}`;

    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: ALLOWED_BROCHURE_TYPE,
    });
    brochureUrl = blob.url;
  } catch (err) {
    console.error("[parse-brochure] Blob upload failed:", err);
    return errorJson("文件上传失败，请稍后重试", 500);
  }

  try {
    const result = await parseBrochure(buffer);

    const response: BrochureParseResponse = {
      success: true,
      brochureUrl,
      result,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[parse-brochure] Parse failed:", err);
    const response: BrochureParseResponse = {
      success: false,
      brochureUrl,
      result: null,
      error: "PDF 解析失败，请尝试手动填写",
    };
    return NextResponse.json(response, { status: 500 });
  }
}
