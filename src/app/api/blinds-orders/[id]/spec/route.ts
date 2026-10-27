import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { loadProcessSpec, orderIssues, saveProcessSpec } from "@/lib/sunny-process/autogen";
import { canViewBlindsOrder, orderOrgId, processOrderDb } from "@/lib/sunny-process/server";

/**
 * GET /api/blinds-orders/[id]/spec —— 工艺单的非 Blinds 工艺参数（国内下单 / 窗帘 / Vinyl）+ 待核对清单
 * PUT /api/blinds-orders/[id]/spec —— 草稿状态下保存参数（追加新版本，读取取最新）；非草稿 409
 */
async function loadVisible(id: string, user: { id: string; role: string }) {
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
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "参数格式错误" }, { status: 400 });
  }
  const res = await saveProcessSpec(processOrderDb, id, (body as { spec?: unknown }).spec ?? body, {
    userId: user.id,
    orgId: await orderOrgId(order),
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ spec: res.spec, issues: orderIssues(order, res.spec) });
});
