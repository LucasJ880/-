/**
 * Visualizer 产品库 — 列表 / 创建
 *
 * GET  /api/visualizer/catalog?orgId=...
 *  - 返回 { platform, org, orgId }
 *  - orgId 多组织时必填（与销售模块一致）；单组织自动解析
 *  - 平台预置 (orgId IS NULL) 始终返回；archived=true 不返回
 *
 * POST /api/visualizer/catalog
 *  - body: CreateVisualizerCatalogRequest（必带 orgId、name、category、colors）
 *  - 强制写 orgId = 解析出的当前组织（不允许创建平台预置）
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import {
  categoryLabelFor,
  isValidCategory,
  listCatalogForOrg,
  sanitizeColors,
  sanitizeMountings,
  sanitizeOpacity,
  toCatalogDetail,
} from "@/lib/visualizer/catalog";
import type {
  CreateVisualizerCatalogRequest,
  VisualizerCatalogListResponse,
} from "@/lib/visualizer/types";

const NAME_MAX = 120;
const NOTES_MAX = 2000;

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) {
    return NextResponse.json({ error: orgRes.reason }, { status: orgRes.status });
  }
  const orgId = orgRes.orgId;

  const { platform, org } = await listCatalogForOrg({ orgId });
  const body: VisualizerCatalogListResponse = { platform, org, orgId };
  return NextResponse.json(body);
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await safeParseBody<CreateVisualizerCatalogRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: body.orgId,
  });
  if (!orgRes.ok) {
    return NextResponse.json({ error: orgRes.reason }, { status: orgRes.status });
  }
  const orgId = orgRes.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "无法确定组织" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, NAME_MAX);
  if (!name) {
    return NextResponse.json({ error: "名称必填" }, { status: 400 });
  }

  const category = (body.category ?? "").trim();
  if (!category || !isValidCategory(category)) {
    return NextResponse.json({ error: "类别非法" }, { status: 400 });
  }

  const colors = sanitizeColors(body.colors);
  if (colors.length === 0) {
    return NextResponse.json(
      { error: "至少需要一个颜色（含 name 与 #RRGGBB）" },
      { status: 400 },
    );
  }
  const mountings = sanitizeMountings(body.mountings ?? ["inside", "outside"]);
  if (mountings.length === 0) {
    return NextResponse.json(
      { error: "至少需要选择一种安装方式" },
      { status: 400 },
    );
  }
  const defaultOpacity = sanitizeOpacity(body.defaultOpacity);
  const categoryLabel =
    typeof body.categoryLabel === "string" && body.categoryLabel.trim()
      ? body.categoryLabel.trim().slice(0, 60)
      : categoryLabelFor(category);

  const previewImageUrl =
    typeof body.previewImageUrl === "string" && body.previewImageUrl.trim()
      ? body.previewImageUrl.trim().slice(0, 2000)
      : null;
  const textureUrl =
    typeof body.textureUrl === "string" && body.textureUrl.trim()
      ? body.textureUrl.trim().slice(0, 2000)
      : null;
  const pricingProductName =
    typeof body.pricingProductName === "string" && body.pricingProductName.trim()
      ? body.pricingProductName.trim().slice(0, 120)
      : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, NOTES_MAX)
      : null;

  const created = await db.visualizerCatalogProduct.create({
    data: {
      orgId,
      name,
      category,
      categoryLabel,
      previewImageUrl,
      textureUrl,
      defaultOpacity,
      colorsJson: colors as unknown as object,
      mountingsJson: mountings as unknown as object,
      pricingProductName,
      notes,
      archived: false,
      createdById: user.id,
    },
  });

  return NextResponse.json(
    { product: toCatalogDetail(created, { currentOrgId: orgId }) },
    { status: 201 },
  );
});
