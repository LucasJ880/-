import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { moveProcessOrderLines, orderIssues } from "@/lib/sunny-process/autogen";
import type { MoveRequest } from "@/lib/sunny-process/line-moves";
import { canViewBlindsOrder, orderOrgId, processOrderDb } from "@/lib/sunny-process/server";
import { readZebraRatios } from "@/lib/sunny-process/zebra-ratios";

/**
 * POST /api/blinds-orders/[id]/move-lines —— 草稿工艺单内挪行（不对外发送）
 *   { to: "domestic", itemIds: string[] | "all", baseVersion }   发给国内：自产行按销售写的原样进国内下单表
 *   { to: "in_house", domesticLines: number[], baseVersion }     退回自产：国内下单表里的卷帘 / 斑马帘 / 香格里拉回到自产行
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;
  const order = await db.blindsOrder.findUnique({
    where: { id },
    select: { id: true, projectId: true, creatorId: true, customerId: true, items: { select: { id: true } } },
  });
  if (!order || !(await canViewBlindsOrder(order, user))) {
    return NextResponse.json({ error: "工艺单不存在" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  let req: MoveRequest;
  if (body?.to === "domestic" && (body.itemIds === "all" || Array.isArray(body.itemIds))) {
    req = { to: "domestic", itemIds: body.itemIds === "all" ? order.items.map((i) => i.id) : (body.itemIds as unknown[]).filter((x): x is string => typeof x === "string") };
  } else if (body?.to === "in_house" && Array.isArray(body.domesticLines)) {
    req = { to: "in_house", domesticLines: body.domesticLines.filter((x): x is number => Number.isInteger(x)) };
  } else {
    return NextResponse.json({ error: "参数格式错误" }, { status: 400 });
  }
  const orgId = await orderOrgId(order);
  const org = orgId ? await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }) : null;
  const res = await moveProcessOrderLines(
    processOrderDb,
    id,
    req,
    { userId: user.id, orgId },
    { baseVersion: typeof body.baseVersion === "number" ? body.baseVersion : null, zebraRatios: readZebraRatios(org?.settingsJson ?? null).entries },
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const updated = await db.blindsOrder.findUnique({
    where: { id },
    include: {
      items: { orderBy: { itemNumber: "asc" } },
      project: { select: { id: true, name: true, color: true } },
      creator: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ order: updated, spec: res.spec, moved: res.moved, issues: updated ? orderIssues(updated, res.spec) : [] });
});
