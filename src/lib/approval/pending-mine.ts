/**
 * VIS-1d「待我确认」与侧栏红点（spec approvals/visibility「待我确认、红点、运营看板与收件箱的范围」，design D7）
 *
 * 待我确认 = 既有处理人范围 ∩ 审批的可见集合 ∩ 当前企业（另含本人的个人草稿）。
 * 列表、红点、运营看板、审批收件箱都用 `pendingMineWhere` 这同一组条件；红点另加未过期。
 * 解析不出当前企业（orgId 为空）时只含本人的个人草稿。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getTeamApprovalAccessIds, teamApprovalScopeWhere } from "@/lib/marketing/team";
import { pendingActionAudienceWhere, type ApprovalViewer } from "./audience";
import { loadApprovalViewer } from "./audience-server";

type TeamAccess = { orgIds: readonly string[]; projectIds: readonly string[] };

/** 当前企业范围：该企业的卡 ∪ 本人的无企业草稿；企业为空时只有后者 */
export function currentOrgScopeWhere(userId: string, orgId: string | null): Prisma.PendingActionWhereInput {
  const personal: Prisma.PendingActionWhereInput = { orgId: null, createdById: userId };
  return orgId ? { OR: [{ orgId }, personal] } : personal;
}

/**
 * 处理人范围 ∩ 可见集合 ∩ 企业范围。企业范围缺省为 viewer 企业的当前企业范围；
 * 运营看板传它自己的（含该企业项目上的无企业卡）。
 */
export function pendingMineWhere(
  viewer: ApprovalViewer,
  teamAccess: TeamAccess,
  orgScope: Prisma.PendingActionWhereInput = currentOrgScopeWhere(viewer.userId, viewer.orgId),
): Prisma.PendingActionWhereInput {
  return {
    AND: [
      teamApprovalScopeWhere(viewer.userId, teamAccess),
      orgScope,
      pendingActionAudienceWhere(viewer) as Prisma.PendingActionWhereInput,
    ],
  };
}

/** 按用户与企业取判定输入与处理人范围，拼出「待我确认」条件 */
export async function loadPendingMineWhere(
  userId: string,
  orgId: string | null,
  opts: { viewer?: ApprovalViewer; orgScope?: Prisma.PendingActionWhereInput } = {},
): Promise<Prisma.PendingActionWhereInput> {
  const [viewer, teamAccess] = await Promise.all([
    opts.viewer && opts.viewer.userId === userId && opts.viewer.orgId === orgId
      ? Promise.resolve(opts.viewer)
      : loadApprovalViewer(userId, orgId),
    getTeamApprovalAccessIds(userId),
  ]);
  return pendingMineWhere(viewer, teamAccess, opts.orgScope);
}

const PENDING_MINE_SELECT = {
  id: true,
  type: true,
  title: true,
  preview: true,
  status: true,
  threadId: true,
  messageId: true,
  expiresAt: true,
  decidedAt: true,
  executedAt: true,
  failureReason: true,
  resultRef: true,
  createdAt: true,
  orgId: true,
  projectId: true,
  approverUserId: true,
  createdById: true,
  createdBy: { select: { name: true, email: true } },
  approver: { select: { name: true, email: true } },
} satisfies Prisma.PendingActionSelect;

/** AI 助手「待我确认」列表：照旧不过滤过期（过期的照常显示为已过期），最多 50 条 */
export async function listMyPendingActions(
  userId: string,
  orgId: string | null,
  opts: { status?: string; threadId?: string | null } = {},
) {
  const where = await loadPendingMineWhere(userId, orgId);
  return db.pendingAction.findMany({
    where: {
      ...where,
      ...(opts.status && opts.status !== "all" ? { status: opts.status } : {}),
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: PENDING_MINE_SELECT,
  });
}

/** 侧栏红点 = 「待我确认」里待审批且未过期的条数 */
export async function countMyPendingActions(userId: string, orgId: string | null, now = new Date()): Promise<number> {
  const where = await loadPendingMineWhere(userId, orgId);
  return db.pendingAction.count({
    where: { ...where, status: "pending", expiresAt: { gt: now } },
  });
}
