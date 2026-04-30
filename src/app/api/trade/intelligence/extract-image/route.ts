/**
 * POST /api/trade/intelligence/extract-image
 *
 * multipart: orgId, assetType, notes?, image (file)
 * 仅上传 + Vision 提取，创建未关联案例的 TradeIntelligenceAsset（caseId=null）
 */

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import { logActivity } from "@/lib/trade/activity-log";
import {
  extractTradeLabelFromImageUrl,
  overallConfidenceFromFields,
} from "@/lib/trade/intelligence-label-vision";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp"];
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

const ASSET_TYPES = new Set([
  "tag_image",
  "carton_label",
  "package_image",
  "screenshot",
  "receipt",
]);

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }

  const orgIdField = form.get("orgId");
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof orgIdField === "string" ? orgIdField : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const orgId = orgRes.orgId;
  const assetTypeRaw = form.get("assetType");
  const assetType = typeof assetTypeRaw === "string" ? assetTypeRaw.trim() : "";
  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json(
      { error: "无效的 assetType（tag_image|carton_label|package_image|screenshot|receipt）" },
      { status: 400 },
    );
  }

  const notesField = form.get("notes");
  const userNotes = typeof notesField === "string" ? notesField.trim() : "";

  const fileEntry = form.get("image");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: "请上传 image 文件字段" }, { status: 400 });
  }

  const check = await validateUploadedFileAsync(fileEntry, {
    maxSize: MAX_IMAGE_BYTES,
    allowedExtensions: ALLOWED_EXT,
    allowedMimeTypes: ALLOWED_MIME,
    checkMagicBytes: true,
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(check.mime)) {
    return NextResponse.json({ error: `不支持的图片 MIME：${check.mime}` }, { status: 400 });
  }

  const pathname = `trade/intelligence/${orgId}/${Date.now()}_${check.safeName}`;
  let fileUrl: string;
  try {
    const blob = await put(pathname, check.buffer, {
      access: "public",
      contentType: check.mime,
    });
    fileUrl = blob.url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "上传失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  let vision: Awaited<ReturnType<typeof extractTradeLabelFromImageUrl>>;
  try {
    vision = await extractTradeLabelFromImageUrl({
      imageUrl: fileUrl,
      assetType,
      notes: userNotes || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const { extractedFields, extractedSummary, rawSnippet, warnings } = vision;
  const overallConf = overallConfidenceFromFields(extractedFields);

  const asset = await db.tradeIntelligenceAsset.create({
    data: {
      orgId,
      caseId: null,
      fileUrl,
      fileName: check.safeName,
      fileType: check.mime,
      assetType,
      extractedText: { rawSnippet, extractedSummary } as object,
      extractedFields: extractedFields as object,
      confidence: overallConf,
      warnings: warnings as object,
      createdById: auth.user.id,
    },
  });

  await logActivity({
    orgId,
    action: "trade_intelligence_extract_image",
    detail: `asset=${asset.id} (pending case)`,
    meta: { assetId: asset.id },
  });

  return NextResponse.json(
    {
      assetId: asset.id,
      imageBlobUrl: fileUrl,
      extractedFields,
      confidence: overallConf,
      warnings,
      rawVisionResult: {
        rawSnippet,
        extractedSummary,
      },
    },
    { status: 201 },
  );
}
