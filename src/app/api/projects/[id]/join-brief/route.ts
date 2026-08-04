import { NextRequest, NextResponse } from "next/server";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import { db } from "@/lib/db";
import { ensureProjectJoinBrief } from "@/lib/bid-workflow";
import { hasOrgRole, hasProjectRole, isSuperAdmin } from "@/lib/rbac/roles";

function canViewAllBriefs(access: {
  user: { id: string; role?: string | null };
  project: { ownerId: string | null };
  orgRole: string | null;
  projectRole: string | null;
}): boolean {
  if (isSuperAdmin(access.user.role)) return true;
  if (access.project.ownerId === access.user.id) return true;
  if (access.orgRole && hasOrgRole(access.orgRole, "org_admin")) return true;
  if (
    access.projectRole &&
    hasProjectRole(access.projectRole, "project_admin")
  ) {
    return true;
  }
  return false;
}

/**
 * GET — 读取加入简报
 * - 默认：当前用户自己的简报
 * - ?all=1：Owner / Org Admin / Project Admin 查看全部
 * - ?userId=：管理员查看指定成员
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  const all = request.nextUrl.searchParams.get("all") === "1";
  const userIdParam = request.nextUrl.searchParams.get("userId");
  const viewAll = canViewAllBriefs(access);

  try {
    if (all) {
      if (!viewAll) {
        return NextResponse.json({ error: "无权查看全部简报" }, { status: 403 });
      }
      const briefs = await db.projectJoinBrief.findMany({
        where: { projectId: id, orgId: project.orgId },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ briefs, canViewAll: true });
    }

    const targetUserId = userIdParam || user.id;
    if (targetUserId !== user.id && !viewAll) {
      return NextResponse.json({ error: "无权查看他人简报" }, { status: 403 });
    }

    const brief = await db.projectJoinBrief.findUnique({
      where: {
        projectId_userId: { projectId: id, userId: targetUserId },
      },
    });
    return NextResponse.json({
      brief,
      canViewAll: viewAll,
      targetUserId,
    });
  } catch (err) {
    console.error("[join-brief GET]", err);
    return NextResponse.json(
      { brief: null, briefs: [], unavailable: true },
      { status: 200 },
    );
  }
}

/**
 * POST — 为指定内部成员生成/取得加入简报（幂等）
 * - 为自己生成：项目读权限即可
 * - 为他人生成：需要写权限（Owner / Admin）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { userId?: string; roleHint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const readAccess = await requireProjectReadAccess(request, id);
  if (readAccess instanceof NextResponse) return readAccess;
  const targetUserId = body.userId || readAccess.user.id;
  const forSelf = targetUserId === readAccess.user.id;

  let access = readAccess;
  if (!forSelf) {
    const writeAccess = await requireProjectWriteAccess(request, id);
    if (writeAccess instanceof NextResponse) return writeAccess;
    access = writeAccess;
  }

  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  // 仅允许为项目内部成员生成
  const membership = await db.projectMember.findFirst({
    where: {
      projectId: id,
      userId: targetUserId,
      status: "active",
    },
    select: { id: true },
  });
  const isOwner = project.ownerId === targetUserId;
  if (!membership && !isOwner) {
    return NextResponse.json(
      { error: "仅可为内部项目成员生成加入简报" },
      { status: 422 },
    );
  }

  try {
    const brief = await ensureProjectJoinBrief({
      orgId: project.orgId,
      projectId: id,
      userId: targetUserId,
      roleHint: body.roleHint,
      actorUserId: user.id,
    });
    return NextResponse.json(brief);
  } catch (err) {
    console.error("[join-brief]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成简报失败" },
      { status: 500 },
    );
  }
}
