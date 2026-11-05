/**
 * 协作通知 COLLAB-2：收件人（design D1、D7、D8；spec notifications/activity-events）
 *
 * 公共过滤：账号在职；对象属于组织时，是该组织的 active 成员；排除操作人；去重。
 * 另有两类事件的候选人：工艺单阶段（创建人、商机负责人、下一阶段负责角色）与项目文件上传（项目成员与负责人）。
 * 数据库读取从参数注入，便于测试。
 */

import { db } from "@/lib/db";
import { updateKeyFor, type FulfillmentCategory } from "@/lib/fulfillment/category";
import { listUsersWithPermission } from "@/lib/sales/approvers";

export interface RecipientDeps {
  /** ids 中账号在职（User.status = active）的人 */
  findActiveUserIds(ids: string[]): Promise<string[]>;
  /** ids 中是 orgId 的 active 成员的人 */
  findActiveMemberIds(orgId: string, ids: string[]): Promise<string[]>;
}

export const defaultRecipientDeps: RecipientDeps = {
  async findActiveUserIds(ids) {
    const rows = await db.user.findMany({
      where: { id: { in: ids }, status: "active" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },
  async findActiveMemberIds(orgId, ids) {
    const rows = await db.organizationMember.findMany({
      where: { orgId, userId: { in: ids }, status: "active" },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  },
};

/** 纯函数：去掉空值、操作人与重复，保留先后顺序 */
export function normalizeCandidates(
  ids: ReadonlyArray<string | null | undefined>,
  actorId: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || id === actorId || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 收件人过滤：在职 + 组织 active 成员（对象属于组织时）+ 排除操作人 + 去重 */
export async function filterCollabRecipients(
  ids: ReadonlyArray<string | null | undefined>,
  opts: { orgId: string | null; actorId: string | null },
  deps: RecipientDeps = defaultRecipientDeps,
): Promise<string[]> {
  const candidates = normalizeCandidates(ids, opts.actorId);
  if (candidates.length === 0) return [];
  const active = new Set(await deps.findActiveUserIds(candidates));
  let kept = candidates.filter((id) => active.has(id));
  if (opts.orgId && kept.length > 0) {
    const members = new Set(await deps.findActiveMemberIds(opts.orgId, kept));
    kept = kept.filter((id) => members.has(id));
  }
  return kept;
}

// ── 工艺单阶段（design D7）──────────────────────────────────────

export interface OrderRoleDeps {
  /** 组织内持该权限键（有效岗位绑定、ALLOW）的人 */
  listUsersWithPermission(orgId: string, permissionKey: string): Promise<string[]>;
}

export const defaultOrderRoleDeps: OrderRoleDeps = { listUsersWithPermission };

/**
 * 下一阶段负责角色的权限键：
 * - 已确认 / 开始生产：该单各品类的履约推进键 `orders.fulfillment.update.<品类>`（不含全品类键）；
 * - 备货完成 / 已排期：`install.task.assign`（排期负责角色）。
 */
export function nextStageRoleKeys(
  toStatus: string,
  categories: readonly FulfillmentCategory[],
): string[] {
  if (toStatus === "confirmed" || toStatus === "in_production") return categories.map(updateKeyFor);
  if (toStatus === "ready" || toStatus === "scheduled") return ["install.task.assign"];
  return [];
}

/** 工艺单阶段通知的候选人：创建人、关联商机的负责人、下一阶段负责角色；没有所属组织时只有前两者 */
export async function orderStageRecipients(
  input: {
    toStatus: string;
    creatorId: string;
    opportunityOwnerId: string | null;
    /** 工艺单所属组织（与访问判断所用的组织相同） */
    orgId: string | null;
    categories: readonly FulfillmentCategory[];
  },
  deps: OrderRoleDeps = defaultOrderRoleDeps,
): Promise<string[]> {
  const ids: Array<string | null> = [input.creatorId, input.opportunityOwnerId];
  if (input.orgId) {
    for (const key of nextStageRoleKeys(input.toStatus, input.categories)) {
      ids.push(...(await deps.listUsersWithPermission(input.orgId, key)));
    }
  }
  return normalizeCandidates(ids, null);
}

// ── 项目文件上传（design D8）────────────────────────────────────

export interface ProjectMemberDeps {
  findActiveProjectMemberIds(projectId: string): Promise<string[]>;
}

export const defaultProjectMemberDeps: ProjectMemberDeps = {
  async findActiveProjectMemberIds(projectId) {
    const rows = await db.projectMember.findMany({
      where: { projectId, status: "active" },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  },
};

/** 项目文件上传的候选人：active 项目成员与项目负责人（上传人由投递入口排除） */
export async function projectFileRecipients(
  input: { projectId: string; ownerId: string | null },
  deps: ProjectMemberDeps = defaultProjectMemberDeps,
): Promise<string[]> {
  const members = await deps.findActiveProjectMemberIds(input.projectId);
  return normalizeCandidates([...members, input.ownerId], null);
}
