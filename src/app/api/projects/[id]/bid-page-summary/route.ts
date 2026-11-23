/**
 * GET /api/projects/[id]/bid-page-summary（BIDPAGE-1）
 *
 * 改版后的「标书与报价」页：「下一步」与三个分区各一句状态。项目读权限。只读——不批准、不发送、不写任何东西。
 *
 * 开关 TENDER_BID_PAGE_V2_ENABLED 关闭 → 404，在任何鉴权与取数之前返回；组织不在白名单、项目没有组织、
 * 或项目不是招投标项目 → 404，在读取询价 / 报价 / 审批 / 生成文件之前返回。页面据此留在改版前的样子。
 * 组织只取自服务端加载的项目记录。
 * 金额（我方报价）只给同时有报价内部成本权限与财务查看权的人（任务书附录 C 决定 C）；其余人拿到的状态不含数字金额。
 */
import { NextResponse, type NextRequest } from "next/server";
import { isBidPageV2EnabledForOrg, isBidPageV2GloballyEnabled } from "@/lib/bid-page-v2/flags";
import { canViewBidAmounts } from "@/lib/bid-page-v2/next-step";
import { loadBidPageView } from "@/lib/bid-page-v2/service";
import { resolveFinancePrivilege } from "@/lib/project-finance/access";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";

const notEnabled = () => NextResponse.json({ error: "新版标书与报价页未启用" }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 总闸关着：在任何鉴权与取数之前返回（开关关着时页签每次只多这一次很轻的请求）
  if (!isBidPageV2GloballyEnabled()) return notEnabled();
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

  // 报价：引擎没开（404）就不取报价、不出金额；能看内部成本的人再核财务查看权
  const quoteAccess = await requireQuoteAccess(request, projectId, "read");
  const quoteAvailable = !(quoteAccess instanceof NextResponse);
  const canViewInternal = quoteAvailable && quoteAccess.canViewInternal;
  const canViewAmounts = canViewBidAmounts({
    quoteAvailable,
    canViewInternal,
    financeCanReadAll: canViewInternal ? (await resolveFinancePrivilege(user, orgId, project.ownerId)).canReadAll : false,
  });

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
