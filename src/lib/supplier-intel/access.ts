/**
 * Supplier Intelligence 访问门（对齐 quote-engine 404-dark 模式）：
 * flag 检查在任何 auth/DB 之前 → OFF 时 404（禁用与不存在不可区分，无存在性泄漏）；
 * 然后 canonical requireTenantContext（trusted principal，orgId/userId 只来自服务端上下文）；
 * 最后 org allowlist。复用既有租户体系，不建第二套鉴权。
 */

import { NextResponse, type NextRequest } from "next/server";
import { getOrgMembership, getProjectMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";
import { requireTenantContext, type TenantContext } from "@/lib/tenancy/context";
import type { SupplierIntelActor } from "./actor";
import { SupplierIntelError } from "./errors";
import { isSupplierIntelEnabled, isSupplierIntelEnabledForOrg } from "./flags";

function disabledResponse(): NextResponse {
  return NextResponse.json({ error: "供应商情报未启用" }, { status: 404 });
}

export async function requireSupplierIntelAccess(
  request: NextRequest,
): Promise<TenantContext | NextResponse> {
  if (!isSupplierIntelEnabled()) return disabledResponse();
  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;
  if (!isSupplierIntelEnabledForOrg(tenant.orgId)) return disabledResponse();
  return tenant;
}

export type ProjectAccessLevel = "read" | "write";

/**
 * B3：服务层项目授权（canonical 策略的服务层投影，非第二套系统）——
 * 判定树与 src/lib/projects/access.ts 的 requireProjectRead/WriteAccess 逐条一致，
 * 复用同一批 canonical 原语（getOrgMembership / getProjectMembership /
 * hasOrgRole / hasProjectRole / isSuperAdmin / intakeStatus=dispatched 规则）：
 *   read  = super_admin ∥ owner ∥ org_admin ∥ 任一 active projectRole
 *   write = super_admin ∥ owner ∥ org_admin ∥ project_admin
 * org 成员身份 ≠ 项目权限；跨 org / 未派发项目一律 NOT_FOUND（不泄露存在性）。
 * 路由层仍必须先走 requireProjectRead/WriteAccess（HTTP canonical 门）——
 * 本函数是服务层 defense-in-depth + 可测试面（外呼前置断言 S2-FR-T7/T8）。
 */
export async function assertProjectAccessForActor(
  actor: SupplierIntelActor,
  projectId: string,
  level: ProjectAccessLevel,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") {
    throw new SupplierIntelError("PROJECT_ACCESS_DENIED", "用户不存在或未激活");
  }
  if (isSuperAdmin(user.role)) return;

  const project = await db.project.findFirst({
    where: { id: projectId, orgId: actor.orgId },
    select: { id: true, ownerId: true, intakeStatus: true },
  });
  if (!project || project.intakeStatus !== "dispatched") {
    throw new SupplierIntelError("NOT_FOUND", "项目不存在");
  }
  if (project.ownerId === actor.userId) return;

  const om = await getOrgMembership(actor.userId, actor.orgId);
  const orgRole = om?.status === "active" ? om.role : null;
  if (orgRole && hasOrgRole(orgRole, "org_admin")) return;

  const pm = await getProjectMembership(actor.userId, projectId);
  const projectRole = pm?.status === "active" ? pm.role : null;
  if (level === "read" && projectRole) return;
  if (level === "write" && projectRole && hasProjectRole(projectRole, "project_admin")) return;

  throw new SupplierIntelError(
    "PROJECT_ACCESS_DENIED",
    level === "write" ? "无权在该项目下执行供应商搜索" : "无权查看该项目的供应商搜索",
  );
}
