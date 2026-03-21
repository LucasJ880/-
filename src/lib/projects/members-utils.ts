import { db } from "@/lib/db";
import { PROJECT_ROLES, type ProjectRole } from "@/lib/rbac/roles";

/** 系统默认环境 code，不可归档/删除 */
export const DEFAULT_ENV_CODES = ["test", "prod"] as const;
export type DefaultEnvCode = (typeof DEFAULT_ENV_CODES)[number];

export const PROJECT_MEMBER_STATUS = ["active", "inactive"] as const;
export type ProjectMemberStatus = (typeof PROJECT_MEMBER_STATUS)[number];

export const ENVIRONMENT_STATUS = ["active", "archived"] as const;
export type EnvironmentStatus = (typeof ENVIRONMENT_STATUS)[number];

export function isValidProjectMemberRole(role: string): role is ProjectRole {
  return (PROJECT_ROLES as readonly string[]).includes(role);
}

export function isValidProjectMemberStatus(s: string): s is ProjectMemberStatus {
  return (PROJECT_MEMBER_STATUS as readonly string[]).includes(s);
}

export function isValidEnvironmentStatus(s: string): s is EnvironmentStatus {
  return (ENVIRONMENT_STATUS as readonly string[]).includes(s);
}

export function isReservedEnvCode(code: string): boolean {
  return (DEFAULT_ENV_CODES as readonly string[]).includes(code);
}

export async function countActiveProjectAdmins(
  projectId: string
): Promise<number> {
  return db.projectMember.count({
    where: {
      projectId,
      role: "project_admin",
      status: "active",
    },
  });
}

/** 环境 code：小写字母、数字、连字符，2–32 位 */
export function normalizeEnvCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** 长度 2–32，小写字母/数字/连字符，不以连字符结尾 */
export function isValidEnvCodeFormat(code: string): boolean {
  if (code.length < 2 || code.length > 32) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(code);
}

const ROLE_LEVEL: Record<ProjectRole, number> = {
  project_admin: 40,
  operator: 30,
  tester: 20,
  viewer: 10,
};

export function projectRoleLevel(role: string): number {
  return ROLE_LEVEL[role as ProjectRole] ?? 0;
}

/** 是否试图在「同一人」记录上提升角色（且新角色高于旧角色） */
export function isSelfPromotion(
  actorUserId: string,
  memberUserId: string,
  currentRole: string,
  newRole: string
): boolean {
  if (actorUserId !== memberUserId) return false;
  return projectRoleLevel(newRole) > projectRoleLevel(currentRole);
}

export const DEFAULT_NEW_PROJECT_MEMBER_ROLE: ProjectRole = "viewer";
