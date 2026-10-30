/**
 * POST /api/trade/intelligence/[id]/convert-to-prospect
 */

import { NextRequest, NextResponse } from "next/server";
import {
  resolveTradeOrgId,
  TRADE_MANAGE_KEYS,
  requireTradePermission,
} from "@/lib/trade/access";
import { db } from "@/lib/db";
import { convertCaseToTradeProspect } from "@/lib/trade/intelligence-service";
import type { ConvertIntelligenceBody } from "@/lib/trade/intelligence-types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTradePermission(request, TRADE_MANAGE_KEYS);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as ConvertIntelligenceBody & { orgId?: string };
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const row = await db.tradeIntelligenceCase.findFirst({
    where: { id, orgId: orgRes.orgId },
  });
  if (!row) return NextResponse.json({ error: "案例不存在" }, { status: 404 });

  const result = await convertCaseToTradeProspect({
    caseRow: row,
    orgId: orgRes.orgId,
    userId: auth.user.id,
    body,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ ok: true, prospectId: result.prospectId });
}
