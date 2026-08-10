/**
 * Workforce Read API — org 访问解析（Final Review FIX A）
 *
 * activeOrgId 只是**偏好**，不是授权：读取任何 org 数据前必须以
 * canUserUseOrg 现查重授权（membership active + org 未归档；
 * super_admin 走同一规则——org 存在且未归档即可）。
 *
 * 规则（fail-closed）：
 * 1. activeOrgId 存在 → canUseOrg 现查 → 通过才可用；
 * 2. stale / revoked / archived 的 activeOrgId **不得继续使用**（落入 3）；
 * 3. 无有效 activeOrgId → 枚举 active membership 候选；
 * 4. 恰好一个可用 org → fallback 使用；
 * 5. 多个可用 org → 绝不 findFirst 随机选一个 → ORG_SELECTION_REQUIRED；
 * 6. 零可用 org → NO_ORG。
 *
 * 依赖注入（纯逻辑，零 DB import）：路由侧接 getUserActiveOrgId /
 * canUserUseOrg / organizationMember 只读查询；测试注入内存 fake。
 */

export type WorkforceApiOrgDeps = {
  /** 用户当前偏好 org（可能 stale，仅作候选，不作授权） */
  getActiveOrgId(userId: string): Promise<string | null>;
  /** 现查重授权：membership active + org 未归档（super_admin 同规则） */
  canUseOrg(userId: string, userRole: string, orgId: string): Promise<boolean>;
  /** active membership 的 orgId 候选（不含授权判断，仍需逐个 canUseOrg） */
  listActiveMembershipOrgIds(userId: string): Promise<string[]>;
};

export type WorkforceApiOrgResolution =
  | { ok: true; orgId: string }
  /** 无任何可用 org */
  | { ok: false; reason: "NO_ORG" }
  /** 多个可用 org 且无有效偏好——必须让用户显式选择，不得随机代选 */
  | { ok: false; reason: "ORG_SELECTION_REQUIRED" };

export async function resolveWorkforceApiOrg(
  input: { userId: string; userRole: string },
  deps: WorkforceApiOrgDeps,
): Promise<WorkforceApiOrgResolution> {
  const { userId, userRole } = input;

  // 1/2. 偏好 org：现查通过才可用；stale/revoked/archived 一律不得使用
  const activeOrgId = await deps.getActiveOrgId(userId);
  if (activeOrgId && (await deps.canUseOrg(userId, userRole, activeOrgId))) {
    return { ok: true, orgId: activeOrgId };
  }

  // 3–5. membership fallback：逐个现查；发现第二个可用即可判定歧义
  const candidates = [...new Set(await deps.listActiveMembershipOrgIds(userId))];
  const usable: string[] = [];
  for (const orgId of candidates) {
    if (await deps.canUseOrg(userId, userRole, orgId)) {
      usable.push(orgId);
      if (usable.length > 1) return { ok: false, reason: "ORG_SELECTION_REQUIRED" };
    }
  }
  if (usable.length === 1) return { ok: true, orgId: usable[0] };
  return { ok: false, reason: "NO_ORG" };
}
