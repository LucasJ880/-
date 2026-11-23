/**
 * FIX-26：旧报价单的财务查看权与编辑权（服务端；读库）。
 * 与成本核算、报价引擎（CHAIN-2e）同一口径，本文件不写第二份规则：
 *   财务能力 = resolveFinanceViewSafe(user, project.orgId, project.ownerId)（授权查询出错只剩平台超级管理员与负责人，标 unconfirmed；
 *             项目没有组织时按不持组织键算、不调用授权查询）
 *   能看 / 能编辑 = resolveQuoteCapabilities(access, { finance })（能编辑 = 能看 且（特权，或项目角色带成本写权限））
 *   提示原因 = 不能编辑时 resolveFinanceHintReason（暂时无法确认 > 没有真人负责人 > 默认）
 * 路由用 resolveLegacyQuoteCaps（已过项目读权限的上下文）；智能体报价技能与问青砚工具没有请求，用 resolveLegacyQuoteCapsForUser。
 */
import type { AuthUser } from "@/lib/auth";
import { getProjectMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActivePreview } from "@/lib/preview/server";
import { PREVIEW_PLATFORM_ROLE } from "@/lib/preview/identity";
import { resolveFinanceHintReason, resolveFinancePrivilege, resolveFinanceViewSafe, projectOwnerAssigned } from "@/lib/project-finance/access";
import { hintReasonField } from "@/lib/project-finance/view-hint";
import type { ProjectAccessContext } from "@/lib/projects/access";
import { resolveQuoteCapabilities } from "@/lib/quote-engine/access";
import type { LegacyQuoteCaps, LegacyQuoteHintReason } from "./finance-view";

/** 只给测试注入：会抛错的授权查询、「有没有真人负责人」 */
export type LegacyQuoteAccessDeps = {
  resolve?: typeof resolveFinancePrivilege;
  ownerAssigned?: (ownerId: string | null) => Promise<boolean>;
};

type AccessLike = Pick<ProjectAccessContext, "user" | "projectRole"> & { project: { orgId: string | null; ownerId: string | null } };

export async function resolveLegacyQuoteCaps(access: AccessLike, deps: LegacyQuoteAccessDeps = {}): Promise<LegacyQuoteCaps> {
  const finance = await resolveFinanceViewSafe(access.user, access.project.orgId, access.project.ownerId, deps.resolve);
  const caps = resolveQuoteCapabilities(access as ProjectAccessContext, { finance });
  // 不能编辑的人才需要提示；只在这时多查一次负责人账号（与报价引擎 requireQuoteAccess 相同）
  const hint = caps.canEdit ? {} : hintReasonField(await resolveFinanceHintReason(finance, access.project.ownerId, deps.ownerAssigned ?? projectOwnerAssigned));
  return { canViewInternal: caps.canViewInternal, canEdit: caps.canEdit, ...(hint as { hintReason?: LegacyQuoteHintReason }) };
}

const NONE: LegacyQuoteCaps = { canViewInternal: false, canEdit: false };

/**
 * 按执行这一步的人判（智能体任务、一键投标方案、问青砚）：与 getCurrentUser 同样读库里的用户（停用 → 什么都不能），
 * 以岗位预览期间平台角色视同普通用户；项目角色取 active 的项目成员身份。项目不存在 → 什么都不能。
 * 本函数只判财务能力，不判项目读权限（调用方先判）。
 */
export async function resolveLegacyQuoteCapsForUser(userId: string, projectId: string, deps: LegacyQuoteAccessDeps = {}): Promise<LegacyQuoteCaps> {
  const [row, project] = await Promise.all([
    db.user.findUnique({ where: { id: userId } }),
    db.project.findUnique({ where: { id: projectId }, select: { orgId: true, ownerId: true } }),
  ]);
  if (!row || row.status !== "active" || !project) return NONE;
  const preview = await getActivePreview(row.id);
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    nickname: row.nickname,
    avatar: row.avatar,
    role: preview ? PREVIEW_PLATFORM_ROLE : row.role,
    status: row.status,
    canEditCustomers: row.canEditCustomers ?? true,
  };
  const pm = await getProjectMembership(userId, projectId);
  return resolveLegacyQuoteCaps({ user, project, projectRole: pm?.status === "active" ? pm.role : null }, deps);
}
