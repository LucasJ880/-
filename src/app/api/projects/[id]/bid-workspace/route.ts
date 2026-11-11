/**
 * TI-4a 投标工作区
 *
 * GET  → 已存内容 + 现算结果（价格表校验、尺寸对照、认证闸、领取方汇总、可投标判定、阶段清单）。项目读权限。
 * PUT  → 分块保存（价格表行项 / 每行的拟投产品与证书 / 领取方名单 / 补遗）。项目写权限。
 *
 * 开关 TENDER_BID_WORKSPACE_ENABLED 关闭（或组织不在白名单）→ 404，不读不写。
 * 组织只取自服务端加载的项目记录；操作者只取自登录会话。读取结果不含任何金额。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireProjectReadAccess, requireProjectWriteAccess } from "@/lib/projects/access";
import { firstIssueZh, saveWorkspaceRequestSchema, blocksIn } from "@/lib/tender-bid-workspace/contract";
import { isBidWorkspaceEnabledForOrg } from "@/lib/tender-bid-workspace/flags";
import { loadWorkspace, loadWorkspaceContext, saveWorkspaceBlocks } from "@/lib/tender-bid-workspace/store";
import { buildWorkspaceView } from "@/lib/tender-bid-workspace/workspace-view";

const notEnabled = () => NextResponse.json({ error: "投标工作区未启用" }, { status: 404 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!isBidWorkspaceEnabledForOrg(orgId) || !orgId) return notEnabled();

  const now = new Date();
  const [stored, ctx] = await Promise.all([loadWorkspace(projectId), loadWorkspaceContext(projectId, orgId, now)]);
  return NextResponse.json({ workspace: stored, view: buildWorkspaceView(stored, ctx) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!isBidWorkspaceEnabledForOrg(orgId) || !orgId) return notEnabled();

  const body = await request.json().catch(() => null);
  const parsed = saveWorkspaceRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstIssueZh(parsed.error) }, { status: 400 });
  if (blocksIn(parsed.data).length === 0) {
    return NextResponse.json({ error: "保存内容有误：至少给出价格表、行项详情、领取方名单或补遗之一" }, { status: 400 });
  }

  const now = new Date();
  const stored = await saveWorkspaceBlocks({ projectId, orgId, userId: access.user.id, request: parsed.data, now });
  const ctx = await loadWorkspaceContext(projectId, orgId, now);
  return NextResponse.json({ workspace: stored, view: buildWorkspaceView(stored, ctx) });
}
