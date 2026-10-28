import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import type { AuthUser } from "@/lib/auth";
import { loadProcessSpec, orderIssues, saveProcessSpec } from "@/lib/sunny-process/autogen";
import { blindsOrderAccess, canViewBlindsOrder, orderOrgId, processOrderDb } from "@/lib/sunny-process/server";

/**
 * GET /api/blinds-orders/[id]/spec —— 工艺单的非 Blinds 工艺参数（国内下单 / 窗帘 / Vinyl）+ 待核对清单
 * PUT /api/blinds-orders/[id]/spec —— 草稿状态下保存参数（追加新版本，读取取最新）；非草稿 409；
 *   PERM-3：需本单全部品类的出单修改权，否则 403
 */
async function loadVisible(id: string, user: AuthUser) {
  const order = await db.blindsOrder.findUnique({
    where: { id },
    include: { items: { orderBy: { itemNumber: "asc" } } },
  });
  if (!order || !(await canViewBlindsOrder(order, user))) return null;
  return order;
}

export const GET = withAuth(async (_request, ctx, user) => {
  const { id } = await ctx.params;
  const order = await loadVisible(id, user);
  if (!order) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  const spec = await loadProcessSpec(processOrderDb, id);
  return NextResponse.json({ spec, issues: orderIssues(order, spec) });
});

export const PUT = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const order = await loadVisible(id, user);
  if (!order) return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  const access = await blindsOrderAccess(id, user);
  if (!access?.edit.allowed) {
    return NextResponse.json(
      { error: "无权修改本单的工艺参数（缺少对应品类的出单权限）", code: "FULFILLMENT_CATEGORY_FORBIDDEN", missingCategories: access?.summary.missingCategories ?? [] },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "参数格式错误" }, { status: 400 });
  }
  const b = body as { spec?: unknown; baseVersion?: unknown };
  const res = await saveProcessSpec(
    processOrderDb,
    id,
    b.spec ?? body,
    { userId: user.id, orgId: await orderOrgId(order) },
    { baseVersion: typeof b.baseVersion === "number" ? b.baseVersion : null },
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ spec: res.spec, issues: orderIssues(order, res.spec) });
});
