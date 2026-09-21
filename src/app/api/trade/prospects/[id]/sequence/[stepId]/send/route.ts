/**
 * POST /api/trade/prospects/[id]/sequence/[stepId]/send
 * 人审发送或标记已发送。禁止自动群发。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { db } from "@/lib/db";
import { isSequenceDayOffset, sendSequenceStep } from "@/lib/trade/outreach-sequence";
import { syncTradeOutboundToRevenueSpine } from "@/lib/trade/outbound-sync";

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

  const mode = body.mode === "send" ? "send" : "mark_sent";
  const result = await sendSequenceStep({
    orgId: orgRes.orgId,
    prospectId: id,
    dayOffset: step.dayOffset,
    mode,
    replyTo: typeof body.replyTo === "string" ? body.replyTo : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  if (step.subject && step.body) {
    const outbound = await db.tradeMessage.findFirst({
      where: { prospectId: id, subject: step.subject, content: step.body, direction: "outbound" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (outbound) {
      await syncTradeOutboundToRevenueSpine({
        orgId: orgRes.orgId,
        prospectId: id,
        tradeMessageId: outbound.id,
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        source: mode === "send" ? "trade_outreach.send" : "trade_outreach.mark_sent",
        channel: "email",
        subject: step.subject,
        content: step.body,
        occurredAt: new Date(),
      });
    }
  }

  return NextResponse.json({ ok: true, mode });
}
