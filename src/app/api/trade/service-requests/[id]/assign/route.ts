/**
 * 外贸客户服务工单 — 指派给处理方（受控跨组织 relay）
 *
 * POST /api/trade/service-requests/[id]/assign
 *   body: { fulfillmentOrgId, assigneeId? }
 *
 * 调用方须为工单归属客户 org 的 trade/admin。底层走唯一 relay assignToFulfillment。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { assignToFulfillment } from "@/lib/trade/service-request";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: (body.orgId as string | undefined) ?? null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await ctx.params;
  const fulfillmentOrgId = (body.fulfillmentOrgId as string | undefined)?.trim();
  if (!fulfillmentOrgId) {
    return NextResponse.json({ error: "缺少 fulfillmentOrgId" }, { status: 400 });
  }

  try {
    const updated = await assignToFulfillment({
      requestId: id,
      ownerOrgId: orgRes.orgId,
      fulfillmentOrgId,
      assigneeId: (body.assigneeId as string | undefined) ?? null,
    });
    return NextResponse.json({ ok: true, request: updated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "指派失败" },
      { status: 400 },
    );
  }
}
