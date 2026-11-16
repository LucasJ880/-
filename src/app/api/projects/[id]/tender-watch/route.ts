import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import { isValidWatchUrl, checkTenderWatch } from "@/lib/tender-intel/watch";
import { patchRoomSummary } from "@/lib/tender-room/summary-json";

/** 公告盯梢配置：GET 读状态 / POST 设 URL（并立即基线检查）/ DELETE 停止 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { summaryJson: true },
  });
  const watch =
    ((room?.summaryJson as Record<string, unknown>) ?? {}).tenderWatch ?? null;
  return NextResponse.json({ watch });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!isValidWatchUrl(url)) {
    return NextResponse.json({ error: "URL 必须是有效的 http(s) 地址" }, { status: 400 });
  }
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project?.orgId) {
    return NextResponse.json({ error: "项目缺少组织归属" }, { status: 409 });
  }
  const room = await db.bidIntelligenceRoom.upsert({
    where: { projectId },
    create: { orgId: project.orgId, projectId },
    update: {},
    select: { id: true },
  });
  // FIX-11：锁项目行、重读，只设 tenderWatch（summaryJson 里还有报价、投标工作区等别的功能的键）
  await patchRoomSummary({
    projectId,
    roomId: room.id,
    patch: () => ({ set: { tenderWatch: { url, lastHash: null, lastCheckedAt: null } } }),
  });
  // 立即做一次基线抓取（此次只记 hash 不通知——变更检测从下一次起生效）
  const first = await checkTenderWatch(projectId);
  return NextResponse.json({ ok: true, first });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  // FIX-11：锁项目行、重读，只去掉 tenderWatch；没有房间时什么都不写
  await patchRoomSummary({ projectId, patch: () => ({ unset: ["tenderWatch"] }) });
  return NextResponse.json({ ok: true });
}
