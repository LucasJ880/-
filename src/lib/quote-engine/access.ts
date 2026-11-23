/**
 * Quote Engine 授权（复用既有 per-project RBAC，不建第二套）：
 *  - read           ：项目读权限（客户视图 / 基本信息）
 *  - internal_cost  ：财务查看权（看供应商成本 / 毛利 / 佣金 / 内部备注）——CHAIN-2e 起与成本核算同一判定
 *                     （平台 super_admin / 企业内持 project.finance.manage 或 project.finance.read（ORG）/ 项目负责人），
 *                     不再认项目角色的成本读权限（只读成员 viewer 也带它）
 *  - edit           ：财务查看权 + project:cost:write（编辑草稿）
 *  - approve        ：财务查看权 + project:cost:review（批准 / award）
 *  privileged（super_admin / 企业内持 project.finance.manage（ORG）/ 项目 owner）直通——PERM-4c1 起不再认 org_admin。
 *  授权查询出错时只剩 super_admin 与项目负责人（resolveFinanceViewSafe）。
 *  全部先过 TENDER_QUOTE_ENGINE_ENABLED（OFF → 404 dark）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, type ProjectAccessContext } from "@/lib/projects/access";
import { hasProjectPermission, PERMISSIONS } from "@/lib/rbac/permissions";
import { resolveFinanceViewSafe, type FinancePrivilege } from "@/lib/project-finance/access";
import { isQuoteEngineEnabled } from "./flags";

export type QuoteAccessLevel = "read" | "internal_cost" | "edit" | "approve";
export type QuoteAccessContext = ProjectAccessContext & { orgId: string; canViewInternal: boolean; canEdit: boolean; canApprove: boolean };

export function quoteEngineDisabledResponse(): NextResponse | null {
  if (isQuoteEngineEnabled()) return null;
  return NextResponse.json({ error: "报价引擎未启用" }, { status: 404 });
}

/** 纯决策：财务能力（resolveFinanceViewSafe 的结果）+ 项目角色 → 报价引擎能力。编辑 / 批准要求先能看内部数字。 */
export function resolveQuoteCapabilities(
  access: ProjectAccessContext,
  opts: { finance: FinancePrivilege },
): { privileged: boolean; canViewInternal: boolean; canEdit: boolean; canApprove: boolean } {
  const privileged = opts.finance.privileged;
  const canViewInternal = opts.finance.canReadAll;
  const role = (p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => !!access.projectRole && hasProjectPermission(access.projectRole, p);
  return {
    privileged,
    canViewInternal,
    canEdit: canViewInternal && (privileged || role(PERMISSIONS.PROJECT_COST_WRITE)),
    canApprove: canViewInternal && (privileged || role(PERMISSIONS.PROJECT_COST_REVIEW)),
  };
}

export async function requireQuoteAccess(request: NextRequest, projectId: string, level: QuoteAccessLevel): Promise<QuoteAccessContext | NextResponse> {
  const disabled = quoteEngineDisabledResponse();
  if (disabled) return disabled;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ error: "项目缺少组织归属，报价引擎不可用" }, { status: 400 });
  const finance = await resolveFinanceViewSafe(access.user, orgId, access.project.ownerId);
  const caps = resolveQuoteCapabilities(access, { finance });
  const allowed = level === "read" ? true : level === "internal_cost" ? caps.canViewInternal : level === "edit" ? caps.canEdit : caps.canApprove;
  if (!allowed) return NextResponse.json({ error: "无权执行该报价操作" }, { status: 403 });
  return { ...access, orgId, canViewInternal: caps.canViewInternal, canEdit: caps.canEdit, canApprove: caps.canApprove };
}
