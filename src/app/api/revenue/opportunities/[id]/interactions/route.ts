/**
 * POST /api/revenue/opportunities/[id]/interactions  body: { direction, channel, content, summary?, occurredAt?, runFde? }
 * 人工记录客户来信 / 我方外发（邮件回复等）；inbound 触发 CUSTOMER_REPLIED + 可选重跑 FDE
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { runInboundSalesFde } from "@/lib/revenue-spine/fde/inbound-sales";
import { logRevenueInteraction } from "@/lib/revenue-spine/interactions";
import { db } from "@/lib/db";

export const maxDuration = 120;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const { id } = await ctx.params;
  const direction = body.direction === "outbound" ? "outbound" : body.direction === "inbound" ? "inbound" : null;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!direction) return NextResponse.json({ error: "direction 必须为 inbound / outbound" }, { status: 400 });
  if (!content) return NextResponse.json({ error: "content 不能为空" }, { status: 400 });
  const exists = await db.salesOpportunity.findFirst({ where: { id, orgId: access.orgId }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "商机不存在" }, { status: 404 });
  const channel = typeof body.channel === "string" && body.channel.trim() ? body.channel.trim().slice(0, 40) : "email";
  const occurredAt = typeof body.occurredAt === "string" && !Number.isNaN(new Date(body.occurredAt).getTime()) ? new Date(body.occurredAt) : undefined;
  const logged = await logRevenueInteraction({
    orgId: access.orgId,
    opportunityId: id,
    direction,
    channel,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    content,
    actorUserId: access.auth.user.id,
    occurredAt,
    source: "manual_log",
  });
  let fde: unknown = null;
  if (direction === "inbound" && body.runFde !== false) {
    fde = await runInboundSalesFde({ orgId: access.orgId, opportunityId: id, trigger: "customer_reply", actorUserId: access.auth.user.id });
  }
  return NextResponse.json({ ...logged, fde });
}
