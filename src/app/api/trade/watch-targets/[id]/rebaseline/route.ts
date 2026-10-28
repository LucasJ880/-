/**
 * POST /api/trade/watch-targets/[id]/rebaseline?orgId=
 * 仅重建内容指纹基线，不产生 TradeSignal，不修改 lastChangedAt。
 */

import { NextRequest, NextResponse } from "next/server";
import { runRebaselineForTarget } from "@/lib/trade/watch-service";
import { db } from "@/lib/db";
import {
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;

  const t = await db.tradeWatchTarget.findFirst({
    where: { id, orgId: orgRes.orgId },
    select: { id: true },
  });
  if (!t) {
    return NextResponse.json({ error: "监控目标不存在" }, { status: 404 });
  }

  const rebaseline = await runRebaselineForTarget(id);
  const item = await db.tradeWatchTarget.findUnique({ where: { id } });
  return NextResponse.json({ rebaseline, item });
}
