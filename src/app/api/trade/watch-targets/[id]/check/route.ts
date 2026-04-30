/**
 * POST /api/trade/watch-targets/[id]/check?orgId=
 * 手动触发一次检查（测试 / 即时拉取）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { runCheckForTarget } from "@/lib/trade/watch-service";
import { db } from "@/lib/db";
import { resolveTradeOrgId } from "@/lib/trade/access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
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

  const result = await runCheckForTarget(id);
  const item = await db.tradeWatchTarget.findUnique({ where: { id } });
  return NextResponse.json({ result, item });
}
