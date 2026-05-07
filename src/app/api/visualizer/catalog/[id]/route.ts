/**
 * Visualizer 产品库 — 编辑 / 软删
 *
 * PATCH  /api/visualizer/catalog/[id]
 *  - 仅本组织私有产品可编辑（orgId 必须 === 当前组织）
 *  - 平台预置（orgId IS NULL）：403
 *
 * DELETE /api/visualizer/catalog/[id]
 *  - 软删（archived=true）；不真正删除，避免历史 productCatalogId 失效
 *  - 平台预置：403
 */

import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import {
  categoryLabelFor,
  isValidCategory,
  sanitizeColors,
  sanitizeMountings,
  sanitizeOpacity,
  toCatalogDetail,
} from "@/lib/visualizer/catalog";
import type { UpdateVisualizerCatalogRequest } from "@/lib/visualizer/types";

const NAME_MAX = 120;
const NOTES_MAX = 2000;

async function loadAndAssertOrg(id: string, orgId: string) {
  const row = await db.visualizerCatalogProduct.findUnique({ where: { id } });
  if (!row) return { ok: false as const, status: 404, reason: "产品不存在" };
  if (row.orgId === null) {
    return { ok: false as const, status: 403, reason: "平台预置产品不可修改" };
  }
  if (row.orgId !== orgId) {
    return { ok: false as const, status: 403, reason: "该产品不属于当前组织" };
  }
  return { ok: true as const, row };
}

export const PATCH = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const body = await safeParseBody<UpdateVisualizerCatalogRequest>(request);
  if (!body) {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) {
    return orgRes.response;
  }
  const orgId = orgRes.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "无法确定组织" }, { status: 400 });
  }

  const guard = await loadAndAssertOrg(id, orgId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }

  const data: Prisma.VisualizerCatalogProductUpdateInput = {};

  if (body.name !== undefined) {
    const v = (body.name ?? "").trim().slice(0, NAME_MAX);
    if (!v) return NextResponse.json({ error: "名称不可为空" }, { status: 400 });
    data.name = v;
  }
  if (body.category !== undefined) {
    const v = (body.category ?? "").trim();
    if (!v || !isValidCategory(v)) {
      return NextResponse.json({ error: "类别非法" }, { status: 400 });
    }
    data.category = v;
    if (body.categoryLabel === undefined) {
      data.categoryLabel = categoryLabelFor(v);
    }
  }
  if (body.categoryLabel !== undefined) {
    const v = (body.categoryLabel ?? "").trim().slice(0, 60);
    if (!v) return NextResponse.json({ error: "类别名不可为空" }, { status: 400 });
    data.categoryLabel = v;
  }
  if (body.previewImageUrl !== undefined) {
    data.previewImageUrl =
      typeof body.previewImageUrl === "string" && body.previewImageUrl.trim()
        ? body.previewImageUrl.trim().slice(0, 2000)
        : null;
  }
  if (body.textureUrl !== undefined) {
    data.textureUrl =
      typeof body.textureUrl === "string" && body.textureUrl.trim()
        ? body.textureUrl.trim().slice(0, 2000)
        : null;
  }
  if (body.defaultOpacity !== undefined) {
    data.defaultOpacity = sanitizeOpacity(body.defaultOpacity, guard.row.defaultOpacity);
  }
  if (body.colors !== undefined) {
    const colors = sanitizeColors(body.colors);
    if (colors.length === 0) {
      return NextResponse.json(
        { error: "至少需要一个颜色（含 name 与 #RRGGBB）" },
        { status: 400 },
      );
    }
    data.colorsJson = colors as unknown as object;
  }
  if (body.mountings !== undefined) {
    const mountings = sanitizeMountings(body.mountings);
    if (mountings.length === 0) {
      return NextResponse.json({ error: "至少需要选择一种安装方式" }, { status: 400 });
    }
    data.mountingsJson = mountings as unknown as object;
  }
  if (body.pricingProductName !== undefined) {
    data.pricingProductName =
      typeof body.pricingProductName === "string" && body.pricingProductName.trim()
        ? body.pricingProductName.trim().slice(0, 120)
        : null;
  }
  if (body.notes !== undefined) {
    data.notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim().slice(0, NOTES_MAX)
        : null;
  }
  if (body.archived !== undefined) {
    data.archived = !!body.archived;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const updated = await db.visualizerCatalogProduct.update({ where: { id }, data });
  return NextResponse.json({ product: toCatalogDetail(updated, { currentOrgId: orgId }) });
});

export const DELETE = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) {
    return orgRes.response;
  }
  const orgId = orgRes.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "无法确定组织" }, { status: 400 });
  }

  const guard = await loadAndAssertOrg(id, orgId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }

  await db.visualizerCatalogProduct.update({
    where: { id },
    data: { archived: true },
  });
  return NextResponse.json({ ok: true });
});
