/**
 * GET /api/projects/[id]/bid-workspace/schedule-candidates（FIX-2）
 *
 * 价格表「从招标分析带入」用：返回当前有效的那份招标分析里保留的数量线索变成的行、生成的粘贴文本、
 * 每一行对应的原文与页码、没能带入的条目及原因。项目读权限。只读——不保存价格表，不写任何东西。
 *
 * 开关 TENDER_BID_WORKSPACE_ENABLED 关闭（或组织不在白名单）→ 404。
 * 组织只取自服务端加载的项目记录。响应里只有招标文件里的说明、数量、单位与页码，不含任何金额。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { isBidWorkspaceEnabledForOrg } from "@/lib/tender-bid-workspace/flags";
import { loadSchedulePrefill } from "@/lib/tender-bid-workspace/schedule-prefill-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!isBidWorkspaceEnabledForOrg(orgId) || !orgId) return NextResponse.json({ error: "投标工作区未启用" }, { status: 404 });

  return NextResponse.json(await loadSchedulePrefill({ projectId, orgId }));
}
