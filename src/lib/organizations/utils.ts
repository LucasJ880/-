import { db } from "@/lib/db";
import type { OrgPlanType, OrgRole, MemberStatus } from "@/lib/rbac/roles";
import { ORG_PLAN_TYPES, ORG_ROLES, MEMBER_STATUS } from "@/lib/rbac/roles";

/** 规范化组织 code：小写、字母数字与连字符，支持中文名时生成可读前缀 */
export function slugifyOrgCode(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const ascii = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (ascii.length >= 2) return ascii;
  const alnum = trimmed.replace(/[^a-z0-9\u4e00-\u9fff]/g, "").slice(0, 16);
  if (alnum.length >= 1) {
    let h = 0;
    for (let i = 0; i < alnum.length; i++) {
      h = (h * 31 + alnum.charCodeAt(i)) >>> 0;
    }
    return `org-${h.toString(16)}`;
  }
  return `org-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function ensureUniqueOrgCode(base: string): Promise<string> {
  let code = base;
  let n = 0;
  while (await db.organization.findUnique({ where: { code } })) {
    n += 1;
    code = `${base}-${n}`;
  }
  return code;
}

export function isValidOrgRole(role: string): role is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(role);
}

export function isValidMemberStatus(s: string): s is MemberStatus {
  return (MEMBER_STATUS as readonly string[]).includes(s);
}

export function isValidPlanType(p: string): p is OrgPlanType {
  return (ORG_PLAN_TYPES as readonly string[]).includes(p);
}

/** 活跃 org_admin 成员数量 */
export async function countActiveOrgAdmins(orgId: string): Promise<number> {
  return db.organizationMember.count({
    where: {
      orgId,
      role: "org_admin",
      status: "active",
    },
  });
}
