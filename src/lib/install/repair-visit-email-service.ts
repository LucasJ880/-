/**
 * INSTALL-2j：返修时间确认邮件——数据库侧（生成审批 / 当前返修时间的状态），供排期接口、维修单详情与重新生成共用。
 *
 * - 一个"返修时间"（维修单 + 预约 + 开始时间）一封；幂等键 install-repair-visit:<维修单>:<预约>:<开始毫秒>:<第几次>（design D1）
 * - 内容在生成时定稿进审批 payload；批准人 = 发起人（排期的人 / 点"生成确认邮件"的人）
 * - 不发任何邮件：发送只在审批执行器（exec-install-repair-visit-email.ts）
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { loadOrgTimezone } from "@/lib/automation/registry";
import type { InstallSendRepairVisitEmailPayload } from "@/lib/pending-actions/types";
import { repairVisitSentWhere } from "@/lib/pending-actions/exec-install-repair-visit-email";
import { REPAIR_TARGET_TYPE, repairProgress, type RepairRecord } from "./repair";
import { loadRepairEvents, loadRepairInOrg } from "./repair-service";
import {
  INSTALL_REPAIR_VISIT_EMAIL_SENT,
  REPAIR_VISIT_EMAIL_ACTION_TYPE,
  renderRepairVisitEmail,
  repairVisitEmailBlockers,
} from "./repair-visit-email";
import { deriveWarrantyStatus, readWarrantySettings, type WarrantyStatusView } from "./warranty";

export type RepairVisitEmailPreview = { to: string; subject: string; html: string };
export type RepairVisitEmailView = WarrantyStatusView & { installAt: string; preview?: RepairVisitEmailPreview };

const keyPrefix = (repairId: string, appointmentId: string, installAt: string) =>
  `install-repair-visit:${repairId}:${appointmentId}:${new Date(installAt).getTime()}:`;

type Ctx = {
  rec: RepairRecord;
  orderId: string;
  customer: { name: string; email: string | null; address: string | null } | null;
  address: string | null;
  appointment: { id: string; startAt: Date; endAt: Date };
  installAt: string;
};

/** 维修单 + 当前未完成的返修预约；没有返修安排 / 已关闭 → schedule 为 null */
async function loadContext(orgId: string, repairId: string): Promise<{ rec: RepairRecord; ctx: Ctx | null } | null> {
  const rec = await loadRepairInOrg(repairId, orgId);
  if (!rec) return null;
  const order = (await db.blindsOrder.findFirst({
    where: { id: rec.orderId, customer: { orgId } },
    select: { id: true, address: true, customer: { select: { name: true, email: true, address: true } } },
  })) as { id: string; address: string | null; customer: { name: string; email: string | null; address: string | null } | null } | null;
  if (!order) return null;
  const progress = repairProgress(rec, (await loadRepairEvents([order.id])).get(order.id) ?? []);
  if (progress.closed || !progress.schedule) return { rec, ctx: null };
  const appt = await db.appointment.findUnique({ where: { id: progress.schedule.appointmentId }, select: { id: true, status: true, startAt: true, endAt: true } });
  if (!appt || appt.status === "cancelled" || appt.status === "completed") return { rec, ctx: null };
  return {
    rec,
    ctx: {
      rec,
      orderId: order.id,
      customer: order.customer,
      address: order.address ?? order.customer?.address ?? null,
      appointment: { id: appt.id, startAt: appt.startAt, endAt: appt.endAt },
      installAt: appt.startAt.toISOString(),
    },
  };
}

function previewOf(payload: unknown): RepairVisitEmailPreview | undefined {
  const p = payload as Partial<InstallSendRepairVisitEmailPayload> | null;
  if (!p || typeof p.to !== "string" || typeof p.subject !== "string" || typeof p.html !== "string") return undefined;
  return { to: p.to, subject: p.subject, html: p.html };
}

async function stateOf(orgId: string, ctx: Ctx) {
  const where = repairVisitSentWhere(ctx.orderId, { repairId: ctx.rec.id, appointmentId: ctx.appointment.id, installAt: ctx.installAt });
  const [sent, actions, org] = await Promise.all([
    db.auditLog.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.pendingAction.findMany({
      where: { orgId, type: REPAIR_VISIT_EMAIL_ACTION_TYPE, idempotencyKey: { startsWith: keyPrefix(ctx.rec.id, ctx.appointment.id, ctx.installAt) } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, failureReason: true, payload: true },
    }),
    db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }),
  ]);
  const contact = readWarrantySettings(org?.settingsJson ?? null).settings.contact;
  const blockers = repairVisitEmailBlockers({ customerEmail: ctx.customer?.email ?? null, contact });
  return { sentAt: sent?.createdAt.toISOString() ?? null, actions, contact, blockers };
}

/** 当前返修时间的邮件状态（spec「返修时间确认邮件状态与重新生成」）；没有未完成的返修预约 → null */
export async function loadRepairVisitEmailView(orgId: string, repairId: string): Promise<RepairVisitEmailView | null> {
  const loaded = await loadContext(orgId, repairId);
  if (!loaded?.ctx) return null;
  const s = await stateOf(orgId, loaded.ctx);
  const latest = s.actions[0] ?? null;
  const view: RepairVisitEmailView = {
    ...deriveWarrantyStatus({
      sentAt: s.sentAt,
      latestAction: latest ? { id: latest.id, status: latest.status, failureReason: latest.failureReason } : null,
      blockers: s.blockers,
    }),
    installAt: loaded.ctx.installAt,
  };
  if (view.status === "pending_approval" && latest) view.preview = previewOf(latest.payload);
  return view;
}

export type GenerateRepairVisitResult =
  | { kind: "created" | "existing" | "blocked" | "sent"; view: RepairVisitEmailView }
  | { kind: "no_schedule" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/** 生成返修时间确认邮件审批（spec「返修时间确认邮件的生成」）。不发信。 */
export async function generateRepairVisitEmail(input: { orgId: string; repairId: string; approverUserId: string }): Promise<GenerateRepairVisitResult> {
  const { orgId } = input;
  const loaded = await loadContext(orgId, input.repairId);
  if (!loaded) return { kind: "not_found" };
  const ctx = loaded.ctx;
  if (!ctx) return { kind: "no_schedule" };
  const s = await stateOf(orgId, ctx);
  if (s.sentAt) return { kind: "sent", view: { status: "sent", sentAt: s.sentAt, canRegenerate: false, installAt: ctx.installAt } };
  const open = s.actions.find((a) => a.status === "pending" || a.status === "approved");
  if (open) {
    return { kind: "existing", view: { status: "pending_approval", approvalId: open.id, canRegenerate: false, installAt: ctx.installAt, preview: previewOf(open.payload) } };
  }
  if (s.blockers.length > 0) return { kind: "blocked", view: { status: "blocked", blockers: s.blockers, canRegenerate: true, installAt: ctx.installAt } };

  // 该维修单此前任一时间已发过 → 改期主题（design D1）
  const everSent = await db.auditLog.findFirst({
    where: { action: INSTALL_REPAIR_VISIT_EMAIL_SENT, targetType: REPAIR_TARGET_TYPE, targetId: ctx.orderId, afterData: { contains: `"repairId":"${ctx.rec.id}"` } },
    select: { id: true },
  });
  const email = renderRepairVisitEmail({
    repairNo: ctx.rec.repairNo,
    orderCode: ctx.rec.orderCode,
    customerName: ctx.rec.header.customerName || ctx.customer?.name || "",
    address: ctx.address,
    startAt: ctx.installAt,
    endAt: ctx.appointment.endAt.toISOString(),
    timeZone: await loadOrgTimezone(orgId),
    rows: ctx.rec.rows.map((r) => ({ location: r.location, itemNumber: r.itemNumber, issueType: r.issueType })),
    contact: s.contact,
    rescheduled: !!everSent,
  });
  const to = (ctx.customer?.email ?? "").trim().toLowerCase();
  const payload: InstallSendRepairVisitEmailPayload = {
    repairId: ctx.rec.id,
    repairNo: ctx.rec.repairNo,
    orderId: ctx.orderId,
    appointmentId: ctx.appointment.id,
    installAt: ctx.installAt,
    to,
    subject: email.subject,
    body: email.text,
    html: email.html,
    rescheduled: !!everSent,
    metadata: { orgId, orderId: ctx.orderId, targetType: "blinds_order", targetId: ctx.orderId, toolName: "install_send_repair_visit_email" },
  };
  const approval = await requestApproval({
    orgId,
    principal: { userId: input.approverUserId, actorType: "user" },
    actionType: REPAIR_VISIT_EMAIL_ACTION_TYPE,
    title: `发送返修时间确认邮件 — ${ctx.rec.repairNo}`,
    preview: `收件人 ${to}；主题 ${email.subject}`,
    payload: payload as unknown as Record<string, unknown>,
    // 对外发邮件：与质保邮件同级
    risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
    source: { module: "install.repair-visit", toolName: "install_send_repair_visit_email", stepKey: `install-repair-visit:${ctx.rec.id}` },
    approver: { approverUserId: input.approverUserId },
    ttlHours: 24 * 7,
    idempotencyKey: `${keyPrefix(ctx.rec.id, ctx.appointment.id, ctx.installAt)}${s.actions.length + 1}`,
  });
  if (!approval.ok) return { kind: "error", message: approval.error };
  return {
    kind: "created",
    view: { status: "pending_approval", approvalId: approval.actionIds[0] ?? "", canRegenerate: false, installAt: ctx.installAt, preview: { to, subject: email.subject, html: email.html } },
  };
}
