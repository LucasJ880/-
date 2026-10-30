/**
 * POST /api/trade/intelligence/[id]/run
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";
import { db } from "@/lib/db";
import { runIntelligenceCase } from "@/lib/trade/intelligence-service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const row = await db.tradeIntelligenceCase.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!row) return NextResponse.json({ error: "案例不存在" }, { status: 404 });

  const r = await runIntelligenceCase({ caseId: id, orgId: orgRes.orgId });
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 500 });
  }
  const fresh = await db.tradeIntelligenceCase.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  return NextResponse.json({ ok: true, case: fresh });
}
