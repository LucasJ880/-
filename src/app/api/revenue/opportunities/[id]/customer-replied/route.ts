/**
 * POST /api/revenue/opportunities/[id]/customer-replied  body: { channel, alsoReplied?, note? }
 * 买家在青砚之外回了信（邮件到业务员邮箱、WhatsApp、电话、当面）：记来信、作废未批草稿、此后不再自动跟进。
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { REVENUE_MANAGE_KEYS, resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { isOutsideReplyChannel, markCustomerRepliedOutside } from "@/lib/revenue-spine/customer-replied";
import { db } from "@/lib/db";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, REVENUE_MANAGE_KEYS, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  if (!isOutsideReplyChannel(body.channel)) {
    return NextResponse.json({ error: "channel 必须为 email / whatsapp / phone / in_person" }, { status: 400 });
  }
  const exists = await db.salesOpportunity.findFirst({ where: { id, orgId: access.orgId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "商机不存在" }, { status: 404 });

  const r = await markCustomerRepliedOutside({
    orgId: access.orgId,
    opportunityId: id,
    channel: body.channel,
    alsoReplied: body.alsoReplied === true,
    note: typeof body.note === "string" ? body.note : null,
    actorUserId: access.auth.user.id,
  });
  return NextResponse.json({ ok: true, ...r });
}
