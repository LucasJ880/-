/**
 * sales.send_inquiry_reply — 询盘回复发送执行器（Revenue Spine）
 *
 * 唯一发送路径：只有人工批准后由 executor 调用本函数；FDE 本身永不发送。
 * 发送通道：审批人 Gmail（OAuth compose）→ 组织 Resend（RESEND_API_KEY）→ 都没有则 fail-closed（NO_EMAIL_PROVIDER）。
 * 成功后：CustomerInteraction(outbound) + lastOutboundAt/followUpCount + SalesAction executed + next action。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { getEmailProvider, hasGmailComposeScope, sendGmail } from "@/lib/google-email";
import { sendEmail as sendViaResend } from "@/lib/trade/email";
import { assertSideEffectOrThrow } from "@/lib/env/runtime-isolation";
import { logRevenueInteraction } from "@/lib/revenue-spine/interactions";
import { updateFdeAction } from "@/lib/revenue-spine/fde/actions";
import type { SalesSendInquiryReplyPayload } from "./types";

export interface InquiryReplySender {
  (input: { userId: string; to: string; subject: string; body: string; fromName: string }): Promise<{ channel: string; messageId: string }>;
}

let testSender: InquiryReplySender | null = null;

/** 测试注入：绕过真实邮件通道（仅测试进程可调用） */
export function __setInquiryReplySenderForTest(sender: InquiryReplySender | null): void {
  testSender = sender;
}

async function defaultSender(input: { userId: string; to: string; subject: string; body: string; fromName: string }): Promise<{ channel: string; messageId: string }> {
  const provider = await getEmailProvider(input.userId);
  if (provider && hasGmailComposeScope(provider.grantedScopes)) {
    const r = await sendGmail(input.userId, {
      to: input.to,
      from: `"${input.fromName}" <${provider.accountEmail}>`,
      subject: input.subject,
      body: input.body,
    });
    return { channel: "gmail", messageId: r.messageId };
  }
  if (process.env.RESEND_API_KEY) {
    assertSideEffectOrThrow("email");
    const r = await sendViaResend({ to: input.to, subject: input.subject, body: input.body });
    if (!r.success) throw new Error(r.error ?? "Resend 发送失败");
    return { channel: "resend", messageId: r.messageId ?? "" };
  }
  const err = new Error("未配置邮件发送通道（审批人未绑定 Gmail 且组织未配置 RESEND_API_KEY）");
  (err as Error & { code?: string }).code = "NO_EMAIL_PROVIDER";
  throw err;
}

export async function execSalesSendInquiryReply(
  payload: SalesSendInquiryReplyPayload,
  ctx: { userId: string; role: string | null | undefined; orgId?: string | null },
  pendingActionId: string,
): Promise<{ ok: boolean; resultRef?: string; message?: string; error?: string; errorCode?: string }> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  const to = (payload.to ?? "").trim();
  const subject = (payload.subject ?? "").trim().slice(0, 200);
  const body = (payload.body ?? "").trim().slice(0, 10_000);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return { ok: false, error: "收件人邮箱无效" };
  if (!subject || !body) return { ok: false, error: "邮件主题或正文为空" };

  const opp = await db.salesOpportunity.findFirst({
    where: { id: payload.opportunityId, orgId },
    select: { id: true, customerId: true, customer: { select: { email: true } } },
  });
  if (!opp) return { ok: false, error: "商机不存在或不属于本组织" };
  if (opp.customerId !== payload.customerId) return { ok: false, error: "客户与商机不匹配" };
  if (opp.customer.email && opp.customer.email.toLowerCase() !== to.toLowerCase()) {
    return { ok: false, error: "收件人与客户档案邮箱不一致，拒绝发送" };
  }

  // 客户在该草稿之后又有新来信 → 草稿过时，拒绝发送（防止两份草稿被各自批准而双发 / 答非所问）
  if (payload.replyToInteractionId) {
    const latestInbound = await db.customerInteraction.findFirst({
      where: { orgId, opportunityId: opp.id, direction: "inbound" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latestInbound && latestInbound.id !== payload.replyToInteractionId) {
      return { ok: false, error: "客户已有更新的来信，该草稿已过时；请使用最新草稿", errorCode: "STALE_DRAFT" };
    }
  }

  const approver = await db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  const fromName = approver?.name?.trim() || "Sales Team";

  let sent: { channel: string; messageId: string };
  try {
    sent = await (testSender ?? defaultSender)({ userId: ctx.userId, to, subject, body, fromName });
  } catch (err) {
    const e = err as Error & { code?: string };
    return { ok: false, error: e.message, errorCode: e.code ?? "SEND_FAILED" };
  }

  const logged = await logRevenueInteraction({
    orgId,
    opportunityId: opp.id,
    direction: "outbound",
    channel: "email",
    type: "email",
    summary: subject,
    content: body,
    actorUserId: ctx.userId,
    emailMessageId: sent.messageId || null,
    language: payload.language ?? null,
    source: "revenue_spine.inquiry_reply",
    extra: { pendingActionId, sendChannel: sent.channel, salesActionId: payload.salesActionId ?? null, replyToInteractionId: payload.replyToInteractionId ?? null },
  });

  if (payload.salesActionId) {
    await updateFdeAction({
      orgId,
      actionId: payload.salesActionId,
      resultJson: { sent: true, channel: sent.channel, messageId: sent.messageId, interactionId: logged.interactionId, approvedBy: ctx.userId, pendingActionId },
      executed: { by: ctx.userId, note: `询盘回复已由 ${ctx.userId} 批准并经 ${sent.channel} 发送` },
    }).catch((e) => console.warn("[inquiry-reply] action update failed:", e instanceof Error ? e.message : e));
  }

  await logAudit({
    userId: ctx.userId,
    orgId,
    action: "revenue_spine.inquiry_reply.sent",
    targetType: "sales_opportunity",
    targetId: opp.id,
    afterData: { to, subject, channel: sent.channel, messageId: sent.messageId, pendingActionId, salesActionId: payload.salesActionId ?? null, interactionId: logged.interactionId },
  });

  return { ok: true, resultRef: logged.interactionId, message: `已发送询盘回复：${subject}` };
}
