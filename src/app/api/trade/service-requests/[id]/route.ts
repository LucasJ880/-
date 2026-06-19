/**
 * 外贸客户服务工单 — 详情
 *
 * GET /api/trade/service-requests/[id]
 *   - 客户 org（归属方）或处理方 org（fulfillmentOrgId）都可查看自己有权的工单。
 *   - 返回 view 标记当前角色视角。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import {
  getServiceRequestForOrg,
  getFulfillmentRequest,
} from "@/lib/trade/service-request";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await ctx.params;

  // 优先客户（归属）视角，其次处理方视角
  const owned = await getServiceRequestForOrg(id, orgRes.orgId);
  if (owned) {
    return NextResponse.json({ view: "client", request: owned });
  }

  const assigned = await getFulfillmentRequest(id, orgRes.orgId);
  if (assigned) {
    return NextResponse.json({ view: "fulfillment", request: assigned });
  }

  return NextResponse.json({ error: "工单不存在或无权访问" }, { status: 404 });
}
