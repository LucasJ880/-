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

/**
 * R1：assertProjectAccessForActor 的**批量**投影（列表面用；判定树逐条一致，不是第二套 RBAC）。
 *
 * 列表不能逐条鉴权（N+1），也不能只修单条 GET 而让列表照旧泄露。因此这里一次性算出
 * 「本 org 内该 actor 在给定级别下可访问的项目 id 集合」，交给查询层做集合过滤。
 *
 * 与单条判定树逐条对齐（R1 Edge Closure 修正）：单条里 `intakeStatus !== "dispatched"` 的
 * NOT_FOUND **先于** owner / org_admin / projectRole 三个放行分支，只有 `isSuperAdmin` 在它之前
 * 返回。因此：
 *   super_admin              → unrestricted（唯一特权分支；org 隔离仍由调用方的 orgId 条件保证）
 *   org_admin / org_owner    → 本 org **全部 dispatched 项目**（不是 unrestricted——org_admin 不等价
 *                              于 super_admin；非 dispatched 项目的信号单条读不到，列表/计数也不得出现）
 *   其余                     → owner 项目 ∪ active projectRole 项目（write 还需 project_admin），
 *                              两者同样只取 dispatched
 * 跨 org 一律不入集合；用户须 active。
 */
export type ProjectAccessScope =
  | { unrestricted: true }
  | { unrestricted: false; projectIds: string[] };

export async function listAccessibleProjectIdsForActor(
  actor: SupplierIntelActor,
  level: ProjectAccessLevel,
): Promise<ProjectAccessScope> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== "active") return { unrestricted: false, projectIds: [] };
  // 单条断言中 super_admin 在项目查询之前就返回 → 这里保留同样的特权分支
  if (isSuperAdmin(user.role)) return { unrestricted: true };

  const om = await getOrgMembership(actor.userId, actor.orgId);
  const orgRole = om?.status === "active" ? om.role : null;
  if (orgRole && hasOrgRole(orgRole, "org_admin")) {
    // org_admin 的放行分支在单条里位于 dispatched 检查**之后** → 只覆盖 dispatched 项目。
    // 仍是集合过滤（一次查询），不引入逐行鉴权。
    const dispatched = await db.project.findMany({
      where: { orgId: actor.orgId, intakeStatus: "dispatched" },
      select: { id: true },
    });
    return { unrestricted: false, projectIds: dispatched.map((p) => p.id).sort() };
  }

  const [owned, memberships] = await Promise.all([
    db.project.findMany({
      where: { orgId: actor.orgId, ownerId: actor.userId, intakeStatus: "dispatched" },
      select: { id: true },
    }),
    db.projectMember.findMany({
      where: {
        userId: actor.userId,
        status: "active",
        project: { orgId: actor.orgId, intakeStatus: "dispatched" },
      },
      select: { projectId: true, role: true },
    }),
  ]);

  const ids = new Set(owned.map((p) => p.id));
  for (const m of memberships) {
    if (level === "read" || hasProjectRole(m.role, "project_admin")) ids.add(m.projectId);
  }
  return { unrestricted: false, projectIds: [...ids].sort() };
}
