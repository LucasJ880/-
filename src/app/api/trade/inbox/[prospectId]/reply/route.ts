/**
 * POST /api/trade/inbox/[prospectId]/reply
 * 采用/编辑后的回复草稿 → 发送（Resend）或标记已在系统外发送。
 * body: { orgId?, subject, body, mode: "send" | "mark_sent" }
 * 任何情况下都写一条 outbound 消息到时间线（收件箱据此判定已回复），并安排 3 天后跟进。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { createMessage, updateProspect } from "@/lib/trade/service";
import { sendEmail } from "@/lib/trade/email";
import { stageAtLeastContacted } from "@/lib/trade/stage";
import { syncTradeOutboundToRevenueSpine } from "@/lib/trade/outbound-sync";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ prospectId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { prospectId } = await params;
  const loaded = await loadTradeProspectForOrg(prospectId, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { prospect } = loaded;

  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 8000) : "";
  const mode = body.mode === "send" ? "send" : "mark_sent";
  if (!text) return NextResponse.json({ error: "回复内容不能为空" }, { status: 400 });

  let emailMessageId: string | null = null;
  if (mode === "send") {
    if (!prospect.contactEmail) {
      return NextResponse.json({ error: "该线索没有邮箱，请改为「标记已发送」并在原渠道回复", code: "NO_EMAIL" }, { status: 400 });
    }
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "邮件发送未配置（RESEND_API_KEY），请复制草稿到邮箱发送后标记", code: "RESEND_NOT_CONFIGURED" }, { status: 400 });
    }
    const result = await sendEmail({ to: prospect.contactEmail, subject: subject || "Re: your inquiry", body: text });
    if (!result.success) {
      return NextResponse.json({ error: `发送失败: ${result.error}` }, { status: 502 });
    }
    emailMessageId = result.messageId ?? null;
  }

  const message = await createMessage({
    prospectId,
    direction: "outbound",
    channel: "email",
    subject: subject || undefined,
    content: mode === "send" ? text : `${text}\n\n（已在系统外发送，此处留底）`,
    aiDraft: true,
  });

  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 3);
  await updateProspect(prospectId, {
    stage: stageAtLeastContacted(prospect.stage),
    lastContactAt: now,
    nextFollowUpAt: next,
  });

  // Revenue Spine 镜像：真实外发已持久化后执行；失败只记录，不影响本次回复
  const revenueSync = await syncTradeOutboundToRevenueSpine({
    orgId: orgRes.orgId,
    prospectId,
    tradeMessageId: message.id,
    actorUserId: auth.user.id,
    actorRole: auth.user.role,
    source: mode === "send" ? "trade_inbox.reply" : "trade_inbox.mark_sent",
    channel: "email",
    subject: subject || null,
    content: text,
    emailMessageId,
    occurredAt: now,
  });

  return NextResponse.json({ ok: true, mode, messageId: message.id, nextFollowUpAt: next.toISOString(), revenueSync });
}
