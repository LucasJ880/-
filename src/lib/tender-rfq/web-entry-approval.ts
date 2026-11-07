/**
 * W-1 询价 Web 入口 — 审批卡的「能否原地批」与邮件正文（服务端）
 *
 * 能否批准完全取审批中心对同一张卡的判定（capabilities/approvals/query.getCapabilityApproval），
 * 前端批准 / 驳回也直接调审批中心既有接口；本文件不新增任何权限规则。
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildCapabilitiesAccess } from "@/lib/capabilities/access";
import { getCapabilityApproval } from "@/lib/capabilities/approvals/query";
import { getTenantContext } from "@/lib/tenancy/context";
import { makeApprovalId } from "@/lib/capabilities/approvals/types";
import type { TenderSendRfqPayload } from "./types";

export type RfqApprovalInfo = {
  approvalId: string;
  /** 这张卡所属企业；前端调审批接口时显式带上（apiFetch 默认带的是组织切换器里选的企业） */
  orgId: string;
  /** 审批中心详情页 */
  href: string;
  canApprove: boolean;
  canReject: boolean;
  /** approve 时回传 expectedPayloadHash */
  payloadHash: string | null;
  status: string;
};

export type RfqEmailPreview = { supplierName: string; to: string; subject: string; body: string };

export function rfqApprovalHref(approvalId: string): string {
  return `/capabilities/approvals/${encodeURIComponent(approvalId)}`;
}

/**
 * 审批中心上下文按「项目所属企业」解析（显式 bodyOrgId），与审批中心接口的成员 / 角色规则相同（不开平台旁路）；
 * 解析不出来（不是该企业 active 成员等）时一律 canApprove=false，界面给审批中心链接。
 */
export async function loadRfqApprovalInfo(
  request: NextRequest,
  user: AuthUser,
  projectOrgId: string,
  actionIds: string[],
): Promise<Record<string, RfqApprovalInfo>> {
  const out: Record<string, RfqApprovalInfo> = {};
  const fallback = (actionId: string): RfqApprovalInfo => {
    const approvalId = makeApprovalId("PENDING_ACTION", actionId);
    return { approvalId, orgId: projectOrgId, href: rfqApprovalHref(approvalId), canApprove: false, canReject: false, payloadHash: null, status: "PENDING" };
  };
  if (actionIds.length === 0) return out;

  let usable: Awaited<ReturnType<typeof buildCapabilitiesAccess>> | null = null;
  try {
    const tenant = await getTenantContext(request, user, { bodyOrgId: projectOrgId });
    if (!(tenant instanceof NextResponse) && tenant.orgId === projectOrgId) usable = await buildCapabilitiesAccess(tenant);
  } catch {
    usable = null;
  }

  for (const actionId of actionIds) {
    if (!usable) {
      out[actionId] = fallback(actionId);
      continue;
    }
    try {
      const approvalId = makeApprovalId("PENDING_ACTION", actionId);
      const proj = await getCapabilityApproval(usable, approvalId);
      out[actionId] = {
        approvalId,
        orgId: projectOrgId,
        href: rfqApprovalHref(approvalId),
        canApprove: proj.capabilities.canApprove,
        canReject: proj.capabilities.canReject,
        payloadHash: proj.payloadHash ?? null,
        status: proj.status,
      };
    } catch {
      out[actionId] = fallback(actionId);
    }
  }
  return out;
}

/** 审批卡 payload 里每家供应商的邮件（发出的就是这份；正文已由 buildRfqDocument 做过敏感内容整单拦截）。 */
export async function loadRfqSendEmails(orgId: string, actionIds: string[]): Promise<Record<string, RfqEmailPreview[]>> {
  const out: Record<string, RfqEmailPreview[]> = {};
  if (actionIds.length === 0) return out;
  const rows = await db.pendingAction.findMany({
    where: { id: { in: actionIds }, orgId },
    select: { id: true, payload: true },
  });
  for (const r of rows) {
    const p = r.payload as Partial<TenderSendRfqPayload> | null;
    const items = Array.isArray(p?.items) ? p.items : [];
    out[r.id] = items
      .filter((i) => i && typeof i.to === "string" && typeof i.body === "string")
      .map((i) => ({ supplierName: String(i.supplierName ?? ""), to: i.to, subject: String(i.subject ?? ""), body: i.body }));
  }
  return out;
}
