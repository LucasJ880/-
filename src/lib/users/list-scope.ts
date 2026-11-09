/**
 * USR-1：平台「用户管理」列表的范围（纯函数，无 DB）。
 *
 * - `scope=platform` → 全平台用户（显式切换）
 * - 否则 `orgId` 参数 → 该企业 active 成员
 * - 否则操作者的当前工作企业（User.activeOrgId）
 * - 都没有 → ORG_SCOPE_REQUIRED（不回落到全平台：没选企业就看到所有人正是要避免的）
 */

export type UserListScope = { type: "platform" } | { type: "org"; orgId: string };

export type UserListScopeResolution =
  | { ok: true; scope: UserListScope }
  | { ok: false; code: "ORG_SCOPE_REQUIRED"; error: string };

export function resolveUserListScope(input: {
  scopeParam: string | null | undefined;
  orgIdParam: string | null | undefined;
  activeOrgId: string | null | undefined;
}): UserListScopeResolution {
  if ((input.scopeParam ?? "").trim() === "platform") return { ok: true, scope: { type: "platform" } };
  const explicit = (input.orgIdParam ?? "").trim();
  if (explicit) return { ok: true, scope: { type: "org", orgId: explicit } };
  const active = (input.activeOrgId ?? "").trim();
  if (active) return { ok: true, scope: { type: "org", orgId: active } };
  return { ok: false, code: "ORG_SCOPE_REQUIRED", error: "请先选择企业，或切换到全平台查看" };
}
