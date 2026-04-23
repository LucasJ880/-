/**
 * POST /api/trade/watch-targets/[id]/rebaseline?orgId=
 * 仅重建内容指纹基线，不产生 TradeSignal，不修改 lastChangedAt。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { runRebaselineForTarget } from "@/lib/trade/watch-service";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "缺少 orgId" }, { status: 400 });
  }

  const t = await db.tradeWatchTarget.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!t) {
    return NextResponse.json({ error: "监控目标不存在" }, { status: 404 });
  }

  const rebaseline = await runRebaselineForTarget(id);
  const item = await db.tradeWatchTarget.findUnique({ where: { id } });
  return NextResponse.json({ rebaseline, item });
}
