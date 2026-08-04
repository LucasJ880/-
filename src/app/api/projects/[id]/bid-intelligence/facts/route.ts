import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { FACT_CONFIDENCE } from "@/lib/bid-workflow";
import { logAudit } from "@/lib/audit/logger";

/**
 * POST — 保存调查事实（建议保存 / 人工录入）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId: id },
    select: { id: true },
  });
  if (!room) {
    return NextResponse.json({ error: "调查室不存在" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content 必填" }, { status: 422 });
  }
  const confidence = String(body.confidence || "UNKNOWN");
  if (!(FACT_CONFIDENCE as readonly string[]).includes(confidence)) {
    return NextResponse.json({ error: "无效 confidence" }, { status: 422 });
  }

  const fact = await db.bidIntelligenceFact.create({
    data: {
      roomId: room.id,
      orgId: project.orgId,
      projectId: id,
      moduleKey: typeof body.moduleKey === "string" ? body.moduleKey : null,
      content: content.slice(0, 8000),
      sourceType:
        typeof body.sourceType === "string" ? body.sourceType : "manual",
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      sourceFileId:
        typeof body.sourceFileId === "string" ? body.sourceFileId : null,
      sourcePage: typeof body.sourcePage === "string" ? body.sourcePage : null,
      confidence,
      extractedBy:
        typeof body.extractedBy === "string" ? body.extractedBy : "human",
      humanConfirmed: body.humanConfirmed === true,
      confirmedById: body.humanConfirmed === true ? user.id : null,
      confirmedAt: body.humanConfirmed === true ? new Date() : null,
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId: id,
    action: "bid_intelligence_fact_saved",
    targetType: "bid_intelligence_fact",
    targetId: fact.id,
    afterData: {
      confidence,
      moduleKey: fact.moduleKey,
      contentPreview: content.slice(0, 120),
    },
  });

  return NextResponse.json({ fact });
}
