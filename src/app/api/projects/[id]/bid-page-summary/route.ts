/**
 * GET /api/projects/[id]/bid-page-summary（BIDPAGE-1）
 *
 * 改版后的「标书与报价」页：「下一步」与三个分区各一句状态。项目读权限。只读——不批准、不发送、不写任何东西。
 *
 * 第一步不带条件地做项目读权限检查并紧接着检查结果（与 src/app/api/projects/[id]/ 下其它接口同一写法）；
 * 之后开关 TENDER_BID_PAGE_V2_ENABLED 关闭、组织不在白名单、项目没有组织、或不是招投标项目 → 404，
 * 在读取询价 / 报价 / 审批 / 生成文件之前返回；页面据此留在改版前的样子。组织只取自服务端加载的项目记录。
 * 金额（我方报价）只给同时有报价内部成本权限与财务查看权的人（任务书附录 C 决定 C）；这个判定与报价引擎开关无关
 * （同一个 resolveQuoteCapabilities），我方报价的金额另要报价功能开通。其余人拿到的状态不含数字金额。
 */
import { NextResponse, type NextRequest } from "next/server";
import { isBidPageV2EnabledForOrg } from "@/lib/bid-page-v2/flags";
import { canViewBidAmounts } from "@/lib/bid-page-v2/next-step";
import { loadBidPageView } from "@/lib/bid-page-v2/service";
import { resolveFinancePrivilege } from "@/lib/project-finance/access";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { resolveQuoteCapabilities } from "@/lib/quote-engine/access";
import { isQuoteEngineEnabled } from "@/lib/quote-engine/flags";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";

const notEnabled = () => NextResponse.json({ error: "新版标书与报价页未启用" }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { project, user, orgRole, projectRole } = access;
  const orgId = project.orgId;
  if (!orgId || project.workDomain !== "tender" || !isBidPageV2EnabledForOrg(orgId)) return notEnabled();

  // 有没有项目编辑权限（与写接口同一组条件）
  const canManage =
    isSuperAdmin(user.role) ||
    project.ownerId === user.id ||
    (!!orgRole && hasOrgRole(orgRole, "org_admin")) ||
    (!!projectRole && hasProjectRole(projectRole, "project_admin"));

  // 金额门：财务查看权 + 报价内部成本权限（与 requireQuoteAccess 同一个判定函数；特权 = 超级管理员 / ORG 持
  // project.finance.manage / 项目负责人，与 resolveFinancePrivilege 的 privileged 同一组条件）。与报价引擎开关无关。
  // CHAIN-2e 起报价内部成本权限本身就是财务查看权（不再认项目角色的成本读权限），两项在这里是同一个判定
  const finance = await resolveFinancePrivilege(user, orgId, project.ownerId);
  const caps = resolveQuoteCapabilities(access, { finance });
  const canViewAmounts = canViewBidAmounts({ canViewInternal: caps.canViewInternal, financeCanReadAll: finance.canReadAll });
  // 报价功能（引擎开关）没开：不取报价、不出我方报价金额
  const quoteAvailable = isQuoteEngineEnabled();

  const view = await loadBidPageView({
    project: {
      id: project.id,
      name: project.name,
      orgId,
      ownerId: project.ownerId,
      status: project.status ?? null,
      tenderStatus: project.tenderStatus ?? null,
      closeDate: project.closeDate ?? null,
      submittedAt: project.submittedAt ?? null,
      intakeStatus: project.intakeStatus ?? null,
      distributedAt: project.distributedAt ?? null,
      dispatchedAt: project.dispatchedAt ?? null,
      interpretedAt: project.interpretedAt ?? null,
      supplierInquiredAt: project.supplierInquiredAt ?? null,
      supplierQuotedAt: project.supplierQuotedAt ?? null,
    },
    userId: user.id,
    access: { canManage, quoteAvailable, canViewAmounts },
  });
  return NextResponse.json({ enabled: true, view });
}
