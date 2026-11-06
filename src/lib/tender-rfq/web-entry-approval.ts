/**
 * W-1 询价 Web 入口 — 审批卡的「能否原地批」与邮件正文（服务端）
 *
 * 能否批准完全取审批中心对同一张卡的判定（capabilities/approvals/query.getCapabilityApproval），
 * 前端批准 / 驳回也直接调审批中心既有接口；本文件不新增任何权限规则。
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCapabilitiesAccess } from "@/lib/capabilities/http";
import { getCapabilityApproval } from "@/lib/capabilities/approvals/query";
import { makeApprovalId } from "@/lib/capabilities/approvals/types";
import type { TenderSendRfqPayload } from "./types";

export type RfqApprovalInfo = {
  approvalId: string;
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

/** 读不到审批中心上下文（不在该企业、无成员身份）时一律 canApprove=false，界面给审批中心链接。 */
export async function loadRfqApprovalInfo(
  request: NextRequest,
  projectOrgId: string,
  actionIds: string[],
): Promise<Record<string, RfqApprovalInfo>> {
  const out: Record<string, RfqApprovalInfo> = {};
  const fallback = (actionId: string): RfqApprovalInfo => {
    const approvalId = makeApprovalId("PENDING_ACTION", actionId);
    return { approvalId, href: rfqApprovalHref(approvalId), canApprove: false, canReject: false, payloadHash: null, status: "PENDING" };
  };
  if (actionIds.length === 0) return out;

  const access = await requireCapabilitiesAccess(request).catch(() => null);
  const usable = access && !(access instanceof NextResponse) && access.orgId === projectOrgId ? access : null;

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
