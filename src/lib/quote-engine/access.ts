/**
 * Quote Engine 授权（复用既有 per-project RBAC，不建第二套）：
 *  - read           ：项目读权限（客户视图 / 基本信息）
 *  - internal_cost  ：project:cost:read（看供应商成本 / 毛利 / 佣金 / 内部备注）
 *  - edit           ：project:cost:write（编辑草稿）
 *  - approve        ：project:cost:review（批准 / award）
 *  privileged（super_admin / org_admin / 项目 owner）直通。全部先过 TENDER_QUOTE_ENGINE_ENABLED（OFF → 404 dark）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, type ProjectAccessContext } from "@/lib/projects/access";
import { hasProjectPermission, PERMISSIONS } from "@/lib/rbac/permissions";
import { isQuoteEngineEnabled } from "./flags";

export type QuoteAccessLevel = "read" | "internal_cost" | "edit" | "approve";
export type QuoteAccessContext = ProjectAccessContext & { orgId: string; canViewInternal: boolean; canEdit: boolean; canApprove: boolean };

export function quoteEngineDisabledResponse(): NextResponse | null {
  if (isQuoteEngineEnabled()) return null;
  return NextResponse.json({ error: "报价引擎未启用" }, { status: 404 });
}

export function resolveQuoteCapabilities(access: ProjectAccessContext): { privileged: boolean; canViewInternal: boolean; canEdit: boolean; canApprove: boolean } {
  const privileged = access.user.role === "super_admin" || access.orgRole === "org_admin" || access.project.ownerId === access.user.id;
  const has = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => privileged || (!!access.projectRole && hasProjectPermission(access.projectRole, p));
  return { privileged, canViewInternal: has(PERMISSIONS.PROJECT_COST_READ), canEdit: has(PERMISSIONS.PROJECT_COST_WRITE), canApprove: has(PERMISSIONS.PROJECT_COST_REVIEW) };
}

export async function requireQuoteAccess(request: NextRequest, projectId: string, level: QuoteAccessLevel): Promise<QuoteAccessContext | NextResponse> {
  const disabled = quoteEngineDisabledResponse();
  if (disabled) return disabled;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ error: "项目缺少组织归属，报价引擎不可用" }, { status: 400 });
  const caps = resolveQuoteCapabilities(access);
  const allowed = level === "read" ? true : level === "internal_cost" ? caps.canViewInternal : level === "edit" ? caps.canEdit : caps.canApprove;
  if (!allowed) return NextResponse.json({ error: "无权执行该报价操作" }, { status: 403 });
  return { ...access, orgId, canViewInternal: caps.canViewInternal, canEdit: caps.canEdit, canApprove: caps.canApprove };
}
