/**
 * POST /api/trade/prospects/[id]/sequence/[stepId]/draft
 * 只起草，不发送。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";
import { draftSequenceStep, isSequenceDayOffset } from "@/lib/trade/outreach-sequence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id, stepId } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const step = await db.tradeOutreachStep.findFirst({
    where: { id: stepId, orgId: orgRes.orgId, prospectId: id },
  });
  if (!step || !isSequenceDayOffset(step.dayOffset)) {
    return NextResponse.json({ error: "序列步骤不存在" }, { status: 404 });
  }

  const result = await draftSequenceStep({
    orgId: orgRes.orgId,
    prospectId: id,
    dayOffset: step.dayOffset,
    senderName: typeof body.senderName === "string" ? body.senderName : auth.user.name,
    senderCompany: typeof body.senderCompany === "string" ? body.senderCompany : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return NextResponse.json({ draft: result.draft });
}
