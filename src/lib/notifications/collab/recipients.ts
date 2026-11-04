/**
 * 协作通知 COLLAB-2：收件人（design D1；spec notifications/activity-events「协作通知的收件人范围」）
 *
 * 公共过滤：账号在职；对象属于组织时，是该组织的 active 成员；排除操作人；去重。
 * 数据库读取从参数注入，便于测试。
 */

import { db } from "@/lib/db";

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
