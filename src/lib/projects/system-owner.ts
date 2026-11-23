/**
 * CHAIN-2e：项目负责人是不是「系统账号」（纯模块）。
 *
 * 外部导入建项目（`POST /api/v1/projects`）时负责人是按邮箱找或建的系统账号 `system@qingyan.internal`（名字 `System (API)`），
 * 派发时「项目负责人（可选）」不指定就一直是它（`src/lib/project-intake/service.ts` 只在指定了 ownerUserId 时才改负责人）。
 * 这类项目没有真人负责人：提示里不能写「请找项目负责人」。
 */

/** 导入建项目用的系统账号邮箱（`src/app/api/v1/projects/route.ts` 按它找或建） */
export const INTAKE_SYSTEM_USER_EMAIL = "system@qingyan.internal";

export function isIntakeSystemUserEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === INTAKE_SYSTEM_USER_EMAIL;
}

/** 项目有没有真人负责人：负责人账号不存在，或是导入用的系统账号 → 没有 */
export function projectHasAssignedOwner(owner: { email: string | null } | null | undefined): boolean {
  if (!owner) return false;
  return !isIntakeSystemUserEmail(owner.email);
}
