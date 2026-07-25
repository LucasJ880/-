/**
 * POST /api/visualizer/catalog/[id]/generate-template
 * 生成 AI 标准安装模板（同步执行 + Job 生命周期）
 */

import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import {
  CatalogTemplateError,
  generateCatalogInstallTemplate,
  isCatalogTemplateType,
  resolveTemplateRoomUrl,
} from "@/lib/visualizer/catalog-template";
import type { VisualizerCatalogTemplateType } from "@/lib/visualizer/types";

type Body = { templateType?: string };

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const body = await safeParseBody<Body>(request);
  if (!body || !isCatalogTemplateType(body.templateType)) {
    return NextResponse.json(
      {
        error:
          "templateType 必填：standard_floor_to_ceiling_day | modern_living_room_day",
      },
      { status: 400 },
    );
  }

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "无法确定组织" }, { status: 400 });
  }

  const templateType = body.templateType as VisualizerCatalogTemplateType;
  if (!resolveTemplateRoomUrl(templateType)) {
    return NextResponse.json(
      {
        error: "AI 标准场景底图尚未配置，请联系管理员。",
        code: "TEMPLATE_ROOM_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  try {
    const result = await generateCatalogInstallTemplate({
      productId: id,
      orgId,
      userId: user.id,
      templateType,
    });
    return NextResponse.json({
      product: result.product,
      jobId: result.jobId,
      assetId: result.assetId,
    });
  } catch (err) {
    if (err instanceof CatalogTemplateError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    throw err;
  }
});
