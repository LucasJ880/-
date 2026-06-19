/**
 * 外贸客户服务工单 — 交付回传
 *
 * POST /api/trade/service-requests/[id]/deliver
 *   body: { deliverableAssetId?, message? }
 *
 * 调用方须为工单的处理方 org（fulfillmentOrgId）。
 * 把交付物经客户专属通道回传给客户微信，并把工单标记为 delivered。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { deliverRequestToClient } from "@/lib/trade/fulfillment";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // 允许空体
  }

  const { id } = await ctx.params;

  try {
    const result = await deliverRequestToClient({
      requestId: id,
      fulfillmentOrgId: orgRes.orgId,
      deliverableAssetId: (body.deliverableAssetId as string | undefined) ?? null,
      message: (body.message as string | undefined) ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "交付失败" },
      { status: 400 },
    );
  }
}
