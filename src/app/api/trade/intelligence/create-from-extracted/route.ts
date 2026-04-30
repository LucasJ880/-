/**
 * POST /api/trade/intelligence/create-from-extracted
 *
 * JSON: orgId, assetId?, assetType, extractedFields, editedFields, notes?, extractedSummary?
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/trade/activity-log";
import { buildCasePayloadFromLabelFields } from "@/lib/trade/intelligence-label-case-build";
import { mergeUserEditedLabelFields } from "@/lib/trade/intelligence-label-user-merge";
import {
  labelExtractedFieldsFromClientJson,
  mergeVisionWarnings,
  overallConfidenceFromFields,
  sanitizeLabelExtractedFields,
} from "@/lib/trade/intelligence-label-vision";

const ASSET_TYPES = new Set([
  "tag_image",
  "carton_label",
  "package_image",
  "screenshot",
  "receipt",
]);

type Body = {
  orgId?: string;
  assetId?: string | null;
  assetType?: string;
  extractedFields?: unknown;
  editedFields?: unknown;
  notes?: string | null;
  extractedSummary?: string | null;
};

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "需要 JSON body" }, { status: 400 });
  }

  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const orgId = orgRes.orgId;
  const assetType = typeof body.assetType === "string" ? body.assetType.trim() : "";
  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json(
      { error: "无效的 assetType（tag_image|carton_label|package_image|screenshot|receipt）" },
      { status: 400 },
    );
  }

  const base = labelExtractedFieldsFromClientJson(body.extractedFields);
  const mergedRaw = mergeUserEditedLabelFields(base, body.editedFields);
  const { fields, warnings: sanitizeWarnings } = sanitizeLabelExtractedFields(mergedRaw);
  const warnings = [...sanitizeWarnings, ...mergeVisionWarnings([], fields)];
  const confidence = overallConfidenceFromFields(fields);

  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const extractedSummary =
    typeof body.extractedSummary === "string" ? body.extractedSummary.trim().slice(0, 800) : "";

  let safeFileName = "confirmed_no_image";
  let asset:
    | { id: string; orgId: string; caseId: string | null; fileName: string }
    | null = null;

  if (body.assetId && typeof body.assetId === "string" && body.assetId.trim()) {
    const aid = body.assetId.trim();
    const row = await db.tradeIntelligenceAsset.findFirst({
      where: { id: aid, orgId },
      select: { id: true, orgId: true, caseId: true, fileName: true },
    });
    if (!row) {
      return NextResponse.json({ error: "未找到 asset 或不属于当前组织" }, { status: 404 });
    }
    if (row.caseId !== null) {
      return NextResponse.json({ error: "该图片资源已关联案例，请重新提取" }, { status: 409 });
    }
    asset = row;
    safeFileName = row.fileName;
  }

  const payload = buildCasePayloadFromLabelFields({
    extractedFields: fields,
    assetType,
    safeFileName,
    userNotes: notes || null,
    extractedSummary: extractedSummary || null,
  });

  const result = await db.$transaction(async (tx) => {
    const c = await tx.tradeIntelligenceCase.create({
      data: {
        orgId,
        title: payload.title,
        status: "new",
        sourceType: "image",
        productName: payload.productName,
        brand: payload.brand,
        upc: payload.upc,
        gtin: payload.gtin,
        sku: payload.sku,
        mpn: payload.mpn,
        retailerName: payload.retailerName,
        material: payload.material,
        size: payload.size,
        color: payload.color,
        countryOfOrigin: payload.countryOfOrigin,
        notes: payload.notes,
        structuredProduct: payload.structuredProduct as object,
        createdById: auth.user.id,
      },
    });

    if (asset) {
      await tx.tradeIntelligenceAsset.update({
        where: { id: asset.id },
        data: {
          caseId: c.id,
          extractedFields: fields as object,
          confidence,
          warnings: warnings as object,
        },
      });
    }

    return c;
  });

  await logActivity({
    orgId,
    action: "trade_intelligence_create_from_extracted",
    detail: `case=${result.id}${asset ? ` asset=${asset.id}` : ""}`,
    meta: { caseId: result.id, assetId: asset?.id ?? null },
  });

  return NextResponse.json(
    {
      caseId: result.id,
      assetId: asset?.id ?? null,
      extractedFields: fields,
      warnings,
      confidence,
    },
    { status: 201 },
  );
}
