/**
 * TI-4a 成本核算表（带着输入算一次，不落库）
 *
 * POST → 请求里的成本输入 + 已存的价格表行项 → 核算表视图、Markdown、带成本的可投标判定。
 * 须有财务查看权：平台超级管理员、持企业级财务键者、项目负责人。
 * 不保存成本输入或计算结果：情报室的 JSON 位对所有项目读者敞开，成本数据不能放进去。
 */
import { NextResponse, type NextRequest } from "next/server";
import { resolveFinancePrivilege } from "@/lib/project-finance/access";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { costSheetRequestSchema, firstIssueZh } from "@/lib/tender-bid-workspace/contract";
import { isBidWorkspaceEnabledForOrg } from "@/lib/tender-bid-workspace/flags";
import { loadWorkspace, loadWorkspaceContext } from "@/lib/tender-bid-workspace/store";
import { buildCostSheet } from "@/lib/tender-bid-workspace/workspace-view";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!isBidWorkspaceEnabledForOrg(orgId) || !orgId) return NextResponse.json({ error: "投标工作区未启用" }, { status: 404 });

  const finance = await resolveFinancePrivilege(access.user, orgId, access.project.ownerId);
  if (!finance.canReadAll) return NextResponse.json({ error: "无权查看成本核算" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = costSheetRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssueZh(parsed.error).replace("保存内容", "成本输入") }, { status: 400 });

  const now = new Date();
  const [stored, ctx] = await Promise.all([loadWorkspace(projectId), loadWorkspaceContext(projectId, orgId, now)]);
  const result = buildCostSheet(stored, parsed.data, ctx);
  if (!result.ok) return NextResponse.json({ error: result.messageZh, code: result.code }, { status: result.status });
  return NextResponse.json({ view: result.view, markdown: result.markdown, readiness: result.readiness });
}
