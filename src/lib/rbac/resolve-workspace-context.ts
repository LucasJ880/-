/**
 * 服务端：从 session cookie 解析 WorkspacePolicyContext
 */

import { cookies } from "next/headers";
import { verifySession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolvePreferredOrgId } from "@/lib/organizations/active-org";
import { parseOrgModulesJson } from "@/lib/tenancy/modules";
import type { WorkspacePolicyContext } from "@/lib/rbac/workspace-policy";

const COOKIE_NAME = "qy_session";

export type ResolvedWorkspaceSession = {
  userId: string;
  ctx: WorkspacePolicyContext;
};

export async function resolveWorkspaceContextFromCookies(): Promise<ResolvedWorkspaceSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload?.sub) return null;

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") return null;

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  let enabledModules: string[] | null = null;
  let orgRole: string | null = null;
  let hasMembership = false;
  let hasBidCapability = false;

  if (resolved.orgId) {
    const org = await db.organization.findUnique({
      where: { id: resolved.orgId },
      select: { modulesJson: true },
    });
    const modules = parseOrgModulesJson(org?.modulesJson);
    enabledModules = modules?.enabled ?? null;

    const member = await db.organizationMember.findUnique({
      where: {
        orgId_userId: { orgId: resolved.orgId, userId: user.id },
      },
      select: { role: true, status: true },
    });
    if (member?.status === "active") {
      orgRole = member.role;
      hasMembership = true;
    }

    // Phase 1：项目成员视为投标能力信号（不新增角色）
    const projectMember = await db.projectMember.findFirst({
      where: {
        userId: user.id,
        status: "active",
        project: { orgId: resolved.orgId },
      },
      select: { id: true },
    });
    hasBidCapability = Boolean(projectMember);
  }

  return {
    userId: user.id,
    ctx: {
      platformRole: user.role,
      orgRole,
      enabledModules,
      hasMembership,
      hasBidCapability,
      permissionKeys: null,
    },
  };
}
