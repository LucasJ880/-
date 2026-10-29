/**
 * install.send_warranty_email — 完工 + 质保邮件执行器（INSTALL-2c）
 *
 * 只有人工批准后由 executor 调用。内容在生成审批时已定稿（payloadHash 防篡改），这里不重渲，只做发送前校验：
 *   企业一致 → 批准人为有效成员 → 工艺单属本企业且已确认尾款 → 未发过 → 收件人 = 客户档案当前邮箱 → 组织已配置发件身份
 * 发件身份只读组织设置 trade.email_sender（sendAsOrg，平台 Resend）；未配置 → NO_ORG_SENDER，绝不回落到任何个人邮箱（design D5）。
 * 同一工艺单的发送串行化（advisory lock），已有 install.warranty.sent 即拒发（design D7）。
 * 成功：审计 install.warranty.sent + 通知该单销售；失败：通知批准人（落会计"待收尾款"页签）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { assertSideEffectOrThrow } from "@/lib/env/runtime-isolation";
import { isAdmin } from "@/lib/rbac/roles";
import { loadOrgEmailSender, sendAsOrg, type OrgEmailSender } from "@/lib/trade/email-sender";
import { BALANCE_TARGET_TYPE, ENTITY_INSTALL_BALANCE, INSTALL_BALANCE_CONFIRMED } from "@/lib/install/balance";
import { INSTALL_WARRANTY_SENT, NOTIFY_WARRANTY_FAILED, NOTIFY_WARRANTY_SENT } from "@/lib/install/warranty";
import { notifyInstallUser } from "@/lib/install/balance-service";
import type { InstallSendWarrantyEmailPayload } from "./types";

export interface WarrantySendInput {
  to: string;
  subject: string;
  body: string;
  html: string;
  sender: OrgEmailSender;
}

export interface WarrantySendResult {
  messageId: string;
  from?: string;
  fallback?: boolean;
}

export type WarrantySender = (input: WarrantySendInput) => Promise<WarrantySendResult>;

let testSender: WarrantySender | null = null;

/** 测试注入：绕过真实邮件通道（仅测试进程调用） */
export function __setWarrantySenderForTest(sender: WarrantySender | null): void {
  testSender = sender;
}

async function defaultSender(input: WarrantySendInput): Promise<WarrantySendResult> {
  if (!process.env.RESEND_API_KEY) {
    throw Object.assign(new Error("平台未配置 RESEND_API_KEY，无法以组织身份发信"), { code: "NO_EMAIL_PROVIDER" });
  }
  assertSideEffectOrThrow("email");
  const r = await sendAsOrg(input.sender, { to: input.to, subject: input.subject, body: input.body, html: input.html });
  return { messageId: r.messageId, from: r.from, fallback: r.fallback };
}

type ExecResult = { ok: boolean; resultRef?: string; message?: string; error?: string; errorCode?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function execInstallSendWarrantyEmail(
  payload: InstallSendWarrantyEmailPayload,
  ctx: { userId: string; role: string | null | undefined; orgId?: string | null },
  pendingActionId: string,
): Promise<ExecResult> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  const orderId = payload.orderId;

  // 失败：原因带错误码（写进 PendingAction.failureReason，页面据此显示），并通知批准人
  const fail = async (errorCode: string, message: string): Promise<ExecResult> => {
    if (orderId) {
      await notifyInstallUser(ctx.userId, {
        type: NOTIFY_WARRANTY_FAILED,
        orgId,
        orderId,
        entityType: ENTITY_INSTALL_BALANCE,
        title: `质保邮件未发出：${payload.orderCode ?? ""}`,
        summary: message,
        // 每次失败的尝试各发一条（spec「质保邮件通知」：发送失败 SHALL 通知批准人）
        dedupeKey: pendingActionId,
      });
    }
    return { ok: false, error: `${errorCode}：${message}`, errorCode };
  };

  const to = (payload.to ?? "").trim();
  const subject = (payload.subject ?? "").trim().slice(0, 300);
  const body = (payload.body ?? "").trim().slice(0, 20_000);
  const html = typeof payload.html === "string" && payload.html.startsWith("<!doctype html>") && payload.html.length <= 200_000 ? payload.html : "";
  if (!orderId || !to || !EMAIL_RE.test(to) || !subject || !body || !html) {
    return fail("INVALID_PAYLOAD", "质保邮件内容不完整，请重新生成");
  }

  if (!isAdmin(ctx.role)) {
    const membership = await db.organizationMember.findFirst({
      where: { orgId, userId: ctx.userId, status: "active", org: { status: "active" } },
      select: { id: true },
    });
    if (!membership) return fail("INACTIVE_MEMBERSHIP", "批准人不是该组织的有效成员，拒绝发送");
  }

  const order = (await db.blindsOrder.findUnique({
    where: { id: orderId },
    select: { id: true, code: true, customerName: true, creatorId: true, customer: { select: { orgId: true, email: true } } },
  })) as { id: string; code: string; customerName: string; creatorId: string; customer: { orgId: string; email: string | null } | null } | null;
  if (!order || order.customer?.orgId !== orgId) return fail("NOT_FOUND", "工艺单不存在或不属于本企业");

  const confirmed = await db.auditLog.findFirst({
    where: { action: INSTALL_BALANCE_CONFIRMED, targetType: BALANCE_TARGET_TYPE, targetId: order.id },
    select: { id: true },
  });
  if (!confirmed) return fail("NOT_CONFIRMED", "该单尚未确认尾款");

  const currentEmail = (order.customer?.email ?? "").trim().toLowerCase();
  if (!currentEmail || currentEmail !== to.toLowerCase()) {
    return fail("RECIPIENT_MISMATCH", `收件人 ${to} 与客户档案邮箱${currentEmail ? ` ${currentEmail}` : "（空）"}不一致，请重新生成`);
  }

  const sender = await loadOrgEmailSender(orgId);
  if (!sender) {
    return fail("NO_ORG_SENDER", "组织未配置发件身份：请老板在 设置 → 邮件 → 组织发件人 配置后，重新生成并批准");
  }

  const send = testSender ?? defaultSender;
  let outcome: { sent: true; result: WarrantySendResult } | { sent: false; code: string; message: string };
  try {
    outcome = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`install-warranty:${order.id}`}))) AS l`;
        const already = await tx.auditLog.findFirst({
          where: { action: INSTALL_WARRANTY_SENT, targetType: BALANCE_TARGET_TYPE, targetId: order.id },
          select: { createdAt: true },
        });
        if (already) return { sent: false as const, code: "ALREADY_SENT", message: `该单质保邮件已于 ${already.createdAt.toISOString()} 发送，不再重复发送` };
        const result = await send({ to, subject, body, html, sender });
        await writeAuditLog(tx as Prisma.TransactionClient, {
          userId: ctx.userId,
          orgId,
          action: INSTALL_WARRANTY_SENT,
          targetType: BALANCE_TARGET_TYPE,
          targetId: order.id,
          afterData: {
            to,
            subject,
            from: result.from ?? null,
            fallback: result.fallback ?? false,
            messageId: result.messageId,
            warrantyNo: payload.warrantyNo,
            pendingActionId,
          },
        });
        return { sent: true as const, result };
      },
      { timeout: 60_000 },
    );
  } catch (err) {
    const code = (err as { code?: string })?.code === "NO_EMAIL_PROVIDER" ? "NO_EMAIL_PROVIDER" : "SEND_FAILED";
    return fail(code, err instanceof Error ? err.message : String(err));
  }
  if (!outcome.sent) return fail(outcome.code, outcome.message);

  await notifyInstallUser(order.creatorId, {
    type: NOTIFY_WARRANTY_SENT,
    orgId,
    orderId: order.id,
    entityType: "blinds_order",
    title: `质保邮件已发出：${order.customerName}（${order.code}）`,
    summary: "客户已收到完工与质保确认邮件",
  });
  return { ok: true, resultRef: outcome.result.messageId, message: `质保邮件已发送至 ${to}` };
}
