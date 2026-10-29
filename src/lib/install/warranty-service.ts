/**
 * INSTALL-2c：质保邮件——数据库侧（生成审批 / 阻断原因 / 状态），供尾款确认、重新生成与"最近已确认"列表共用。
 *
 * - 内容在生成时定稿进审批 payload（design D4）；批准人 = 确认尾款 / 点"生成"的人（design D6）
 * - 幂等键 install-warranty:<工艺单 id>:<第几次>（design D7）；已发送 / 已有待批准的不再生成
 * - 不发任何邮件：发送只在审批执行器（exec-install-warranty-email.ts）
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { BALANCE_TARGET_TYPE, todayInTimeZone } from "./balance";
import { loadBalanceRecords } from "./balance-service";
import { INSTALL_ORDER_SELECT, loadOrdersCloseout, type InstallOrderRow } from "./service";
import {
  deriveWarrantyStatus,
  INSTALL_WARRANTY_SENT,
  readWarrantySettings,
  renderWarrantyEmail,
  WARRANTY_ACTION_TYPE,
  warrantyBlockers,
  type WarrantyStatusView,
  type WarrantyUnit,
} from "./warranty";
import type { InstallSendWarrantyEmailPayload } from "@/lib/pending-actions/types";

const keyPrefix = (orderId: string) => `install-warranty:${orderId}:`;

type WarrantyOrderRow = InstallOrderRow & {
  installedAt: Date | null;
  customer: { orgId: string; email: string | null; address: string | null; name: string } | null;
};

type WarrantyContext = {
  order: WarrantyOrderRow;
  units: WarrantyUnit[];
  blockers: string[];
  installDate: string;
  settings: ReturnType<typeof readWarrantySettings>["settings"];
};

/** 批量：工艺单 + 收口单元（含品类）+ 企业质保设置 + 阻断原因 */
async function loadContexts(orgId: string, orderIds: string[]): Promise<Map<string, WarrantyContext>> {
  const out = new Map<string, WarrantyContext>();
  if (orderIds.length === 0) return out;
  const orders = (await db.blindsOrder.findMany({
    where: { id: { in: orderIds }, customer: { orgId } },
    select: { ...INSTALL_ORDER_SELECT, installedAt: true, customer: { select: { orgId: true, email: true, address: true, name: true } } },
  })) as unknown as WarrantyOrderRow[];
  const [org, closeouts, records, tz] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }),
    loadOrdersCloseout(orders),
    loadBalanceRecords(orders.map((o) => o.id)),
    loadOrgTimezone(orgId),
  ]);
  const { settings } = readWarrantySettings(org?.settingsJson ?? null);
  for (const order of orders) {
    const units: WarrantyUnit[] = (closeouts.get(order.id)?.units ?? []).map((u) => ({
      itemNumber: u.itemNumber,
      location: u.location,
      productType: u.productType,
      fabricSku: u.fabricSku,
      category: u.category,
    }));
    const blockers = warrantyBlockers({
      balanceConfirmed: records.has(order.id),
      customerEmail: order.customer?.email ?? null,
      units,
      settings,
    });
    const installDate = todayInTimeZone(tz, order.installedAt ?? new Date());
    out.set(order.id, { order, units, blockers, installDate, settings });
  }
  return out;
}

/** 已发送时间（install.warranty.sent） */
async function loadSentAt(orderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (orderIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { action: INSTALL_WARRANTY_SENT, targetType: BALANCE_TARGET_TYPE, targetId: { in: orderIds } },
    orderBy: { createdAt: "asc" },
    select: { targetId: true, createdAt: true },
  });
  for (const r of rows) if (r.targetId && !out.has(r.targetId)) out.set(r.targetId, r.createdAt.toISOString());
  return out;
}

type ActionRow = { id: string; status: string; failureReason: string | null; idempotencyKey: string | null; payload: unknown; createdAt: Date };

/** 每单所有质保审批（新 → 旧） */
async function loadActions(orgId: string, orderIds: string[]): Promise<Map<string, ActionRow[]>> {
  const out = new Map<string, ActionRow[]>();
  if (orderIds.length === 0) return out;
  const rows = (await db.pendingAction.findMany({
    where: { orgId, type: WARRANTY_ACTION_TYPE, OR: orderIds.map((id) => ({ idempotencyKey: { startsWith: keyPrefix(id) } })) },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, failureReason: true, idempotencyKey: true, payload: true, createdAt: true },
  })) as ActionRow[];
  for (const r of rows) {
    const orderId = (r.idempotencyKey ?? "").split(":")[1];
    if (!orderId) continue;
    if (!out.has(orderId)) out.set(orderId, []);
    out.get(orderId)!.push(r);
  }
  return out;
}

export type WarrantyPreview = { to: string; cc: string[]; subject: string; html: string };
export type WarrantyView = WarrantyStatusView & { preview?: WarrantyPreview };

function previewOf(payload: unknown): WarrantyPreview | undefined {
  const p = payload as Partial<InstallSendWarrantyEmailPayload> | null;
  if (!p || typeof p.to !== "string" || typeof p.subject !== "string" || typeof p.html !== "string") return undefined;
  const cc = Array.isArray(p.cc) ? p.cc.filter((a): a is string => typeof a === "string") : [];
  return { to: p.to, cc, subject: p.subject, html: p.html };
}

/** 多单状态（"最近已确认"列表）；待批准的带预览 */
export async function loadWarrantyStatuses(orgId: string, orderIds: string[]): Promise<Map<string, WarrantyView>> {
  const [sent, actions, contexts] = await Promise.all([loadSentAt(orderIds), loadActions(orgId, orderIds), loadContexts(orgId, orderIds)]);
  const out = new Map<string, WarrantyView>();
  for (const id of orderIds) {
    const latest = actions.get(id)?.[0] ?? null;
    const view: WarrantyView = deriveWarrantyStatus({
      sentAt: sent.get(id) ?? null,
      latestAction: latest ? { id: latest.id, status: latest.status, failureReason: latest.failureReason } : null,
      blockers: contexts.get(id)?.blockers ?? ["工艺单不存在或不属于本企业"],
    });
    if (view.status === "pending_approval" && latest) view.preview = previewOf(latest.payload);
    out.set(id, view);
  }
  return out;
}

export type GenerateResult =
  | { kind: "created" | "existing"; view: WarrantyView }
  | { kind: "blocked"; view: WarrantyView }
  | { kind: "sent"; view: WarrantyView }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * 生成质保邮件审批（spec「尾款确认后生成审批」「重新生成」）。不发信。
 * 已发送 → sent；已有待批准 → existing；缺资料 → blocked（原因）；否则建审批 → created。
 */
export async function generateWarrantyApproval(input: { orgId: string; orderId: string; approverUserId: string }): Promise<GenerateResult> {
  const { orgId, orderId } = input;
  const [contexts, sent, actions] = await Promise.all([
    loadContexts(orgId, [orderId]),
    loadSentAt([orderId]),
    loadActions(orgId, [orderId]),
  ]);
  const ctx = contexts.get(orderId);
  if (!ctx) return { kind: "not_found" };
  const sentAt = sent.get(orderId);
  if (sentAt) return { kind: "sent", view: { status: "sent", sentAt, canRegenerate: false } };
  const all = actions.get(orderId) ?? [];
  const open = all.find((a) => a.status === "pending" || a.status === "approved");
  if (open) {
    return { kind: "existing", view: { status: "pending_approval", approvalId: open.id, canRegenerate: false, preview: previewOf(open.payload) } };
  }
  if (ctx.blockers.length > 0) {
    return { kind: "blocked", view: { status: "blocked", blockers: ctx.blockers, canRegenerate: true } };
  }

  const { order } = ctx;
  const email = renderWarrantyEmail({
    orderCode: order.code,
    customerName: order.customer?.name || order.customerName,
    address: order.address ?? order.customer?.address ?? null,
    installDate: ctx.installDate,
    units: ctx.units,
    settings: ctx.settings,
  });
  const to = (order.customer?.email ?? "").trim().toLowerCase();
  // 抄送只取企业质保设置（spec「抄送来源」），去掉与收件人相同的地址
  const cc = ctx.settings.cc.filter((a) => a !== to);
  const payload: InstallSendWarrantyEmailPayload = {
    orderId,
    orderCode: order.code,
    warrantyNo: email.warrantyNo,
    to,
    cc,
    subject: email.subject,
    body: email.text,
    html: email.html,
    metadata: { orgId, orderId, targetType: "blinds_order", targetId: orderId, toolName: "install_send_warranty_email" },
  };
  const approval = await requestApproval({
    orgId,
    principal: { userId: input.approverUserId, actorType: "user" },
    actionType: WARRANTY_ACTION_TYPE,
    title: `发送完工与质保邮件 — ${payload.orderCode}`,
    preview: `收件人 ${to}${cc.length ? `；抄送 ${cc.join("、")}` : ""}；主题 ${email.subject}`,
    payload: payload as unknown as Record<string, unknown>,
    // 对外发邮件：与询盘回复 / 投标询价同级
    risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
    source: { module: "install.warranty", toolName: "install_send_warranty_email", stepKey: `install-warranty:${orderId}` },
    approver: { approverUserId: input.approverUserId },
    ttlHours: 24 * 7,
    idempotencyKey: `${keyPrefix(orderId)}${all.length + 1}`,
  });
  if (!approval.ok) return { kind: "error", message: approval.error };
  const approvalId = approval.actionIds[0] ?? "";
  return {
    kind: "created",
    view: { status: "pending_approval", approvalId, canRegenerate: false, preview: { to, cc, subject: email.subject, html: email.html } },
  };
}
