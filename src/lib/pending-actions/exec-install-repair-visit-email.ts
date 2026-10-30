/**
 * install.send_repair_visit_email — 返修时间确认邮件执行器（INSTALL-2j）
 *
 * 只有人工批准后由 executor 调用。内容在生成审批时已定稿（payloadHash 防篡改），这里不重渲，只做发送前校验（design D2）：
 *   企业一致 → 批准人为有效成员 → 维修单存在且属本企业、未关闭 → 当前返修预约 = 审批里的预约、未取消未完成、开始时间未变
 *   → 同一预约同一时间未发过 → 收件人 = 客户档案当前邮箱 → 组织已配置发件身份
 * 发件身份只读组织设置 trade.email_sender（sendAsOrg）；未配置 → NO_ORG_SENDER，绝不回落到任何个人邮箱。
 * 同一维修单的发送串行化（advisory lock）；成功审计 install.repair_visit_email.sent。不发站内通知（proposal Out of scope）。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { assertSideEffectOrThrow } from "@/lib/env/runtime-isolation";
import { isAdmin } from "@/lib/rbac/roles";
import { loadOrgEmailSender, sendAsOrg, type OrgEmailSender } from "@/lib/trade/email-sender";
import { INSTALL_REPAIR_SUBMITTED, parseRepairRecord, REPAIR_TARGET_TYPE, repairProgress } from "@/lib/install/repair";
import { INSTALL_REPAIR_VISIT_EMAIL_SENT } from "@/lib/install/repair-visit-email";
import { loadRepairEvents } from "@/lib/install/repair-service";
import type { InstallSendRepairVisitEmailPayload } from "./types";

export interface RepairVisitSendInput {
  to: string;
  subject: string;
  body: string;
  html: string;
  sender: OrgEmailSender;
}

export interface RepairVisitSendResult {
  messageId: string;
  from?: string;
  fallback?: boolean;
}

export type RepairVisitSender = (input: RepairVisitSendInput) => Promise<RepairVisitSendResult>;

let testSender: RepairVisitSender | null = null;

/** 测试注入：绕过真实邮件通道（仅测试进程调用） */
export function __setRepairVisitSenderForTest(sender: RepairVisitSender | null): void {
  testSender = sender;
}

async function defaultSender(input: RepairVisitSendInput): Promise<RepairVisitSendResult> {
  if (!process.env.RESEND_API_KEY) {
    throw Object.assign(new Error("平台未配置 RESEND_API_KEY，无法以组织身份发信"), { code: "NO_EMAIL_PROVIDER" });
  }
  assertSideEffectOrThrow("email");
  const r = await sendAsOrg(input.sender, { to: input.to, subject: input.subject, body: input.body, html: input.html });
  return { messageId: r.messageId, from: r.from, fallback: r.fallback };
}

type ExecResult = { ok: boolean; resultRef?: string; message?: string; error?: string; errorCode?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** "同一预约同一时间已发过"——审计 afterData 里同时带这三个值 */
export function repairVisitSentWhere(orderId: string, p: { repairId: string; appointmentId: string; installAt: string }): Prisma.AuditLogWhereInput {
  return {
    action: INSTALL_REPAIR_VISIT_EMAIL_SENT,
    targetType: REPAIR_TARGET_TYPE,
    targetId: orderId,
    AND: [
      { afterData: { contains: `"repairId":"${p.repairId}"` } },
      { afterData: { contains: `"appointmentId":"${p.appointmentId}"` } },
      { afterData: { contains: `"installAt":"${p.installAt}"` } },
    ],
  };
}

export async function execInstallSendRepairVisitEmail(
  payload: InstallSendRepairVisitEmailPayload,
  ctx: { userId: string; role: string | null | undefined; orgId?: string | null },
  pendingActionId: string,
): Promise<ExecResult> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  const fail = (errorCode: string, message: string): ExecResult => ({ ok: false, error: `${errorCode}：${message}`, errorCode });

  const to = (payload.to ?? "").trim();
  const subject = (payload.subject ?? "").trim().slice(0, 300);
  const body = (payload.body ?? "").trim().slice(0, 20_000);
  const html = typeof payload.html === "string" && payload.html.startsWith("<!doctype html>") && payload.html.length <= 200_000 ? payload.html : "";
  const { repairId, appointmentId, installAt } = payload;
  if (!repairId || !appointmentId || !installAt || !to || !EMAIL_RE.test(to) || !subject || !body || !html) {
    return fail("INVALID_PAYLOAD", "返修时间确认邮件内容不完整，请重新生成");
  }

  if (!isAdmin(ctx.role)) {
    const membership = await db.organizationMember.findFirst({
      where: { orgId, userId: ctx.userId, status: "active", org: { status: "active" } },
      select: { id: true },
    });
    if (!membership) return fail("INACTIVE_MEMBERSHIP", "批准人不是该组织的有效成员，拒绝发送");
  }

  const row = await db.auditLog.findFirst({
    where: { id: repairId, action: INSTALL_REPAIR_SUBMITTED, targetType: REPAIR_TARGET_TYPE, orgId },
    select: { id: true, afterData: true, createdAt: true, userId: true },
  });
  const rec = row ? parseRepairRecord(row) : null;
  const order = rec
    ? ((await db.blindsOrder.findFirst({
        where: { id: rec.orderId, customer: { orgId } },
        select: { id: true, customer: { select: { email: true } } },
      })) as { id: string; customer: { email: string | null } | null } | null)
    : null;
  if (!rec || !order) return fail("NOT_FOUND", "维修单不存在或不属于本企业");

  const progress = repairProgress(rec, (await loadRepairEvents([order.id])).get(order.id) ?? []);
  if (progress.closed) return fail("REPAIR_CLOSED", "维修单已关闭，不再发送返修时间确认邮件");
  const appt = progress.schedule?.appointmentId === appointmentId
    ? await db.appointment.findUnique({ where: { id: appointmentId }, select: { status: true, startAt: true } })
    : null;
  if (!appt || appt.status === "cancelled" || appt.status === "completed" || appt.startAt.toISOString() !== installAt) {
    return fail("SCHEDULE_CHANGED", "返修时间已改或预约已取消，请在维修单详情重新生成确认邮件");
  }

  const currentEmail = (order.customer?.email ?? "").trim().toLowerCase();
  if (!currentEmail || currentEmail !== to.toLowerCase()) {
    return fail("RECIPIENT_MISMATCH", `收件人 ${to} 与客户档案邮箱${currentEmail ? ` ${currentEmail}` : "（空）"}不一致，请重新生成`);
  }

  const sender = await loadOrgEmailSender(orgId);
  if (!sender) {
    return fail("NO_ORG_SENDER", "组织未配置发件身份：请老板在 设置 → 邮件 → 组织发件人 配置后，重新生成并批准");
  }

  const send = testSender ?? defaultSender;
  let outcome: { sent: true; result: RepairVisitSendResult } | { sent: false; code: string; message: string };
  try {
    outcome = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`install-repair-visit:${repairId}`}))) AS l`;
        const already = await tx.auditLog.findFirst({ where: repairVisitSentWhere(order.id, { repairId, appointmentId, installAt }), select: { createdAt: true } });
        if (already) return { sent: false as const, code: "ALREADY_SENT", message: `这个返修时间的确认邮件已于 ${already.createdAt.toISOString()} 发送，不再重复发送` };
        const result = await send({ to, subject, body, html, sender });
        await writeAuditLog(tx as Prisma.TransactionClient, {
          userId: ctx.userId,
          orgId,
          action: INSTALL_REPAIR_VISIT_EMAIL_SENT,
          targetType: REPAIR_TARGET_TYPE,
          targetId: order.id,
          afterData: {
            repairId,
            repairNo: payload.repairNo,
            appointmentId,
            installAt,
            to,
            subject,
            from: result.from ?? null,
            fallback: result.fallback ?? false,
            messageId: result.messageId,
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
  return { ok: true, resultRef: outcome.result.messageId, message: `返修时间确认邮件已发送至 ${to}` };
}
