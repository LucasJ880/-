import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; promptId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const prompt = await db.prompt.findFirst({
    where: { id: promptId, projectId },
    select: { id: true },
  });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  }

  const versions = await db.promptVersion.findMany({
    where: { promptId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdById: true,
      content: true,
    },
  });

  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
      createdById: v.createdById,
      contentPreview:
        v.content.length > 200 ? `${v.content.slice(0, 200)}…` : v.content,
    })),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const prompt = await db.prompt.findFirst({
    where: { id: promptId, projectId },
    select: { id: true, activeVersionId: true },
  });
  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content : "";
  const changeNote =
    typeof body.changeNote === "string" && body.changeNote.trim()
      ? body.changeNote.trim()
      : typeof body.note === "string" && body.note.trim()
        ? body.note.trim()
        : null;
  const updateTest = body.updateTest !== false;

  const agg = await db.promptVersion.aggregate({
    where: { promptId },
    _max: { version: true },
  });
  const nextV = (agg._max.version ?? 0) + 1;

  const version = await db.promptVersion.create({
    data: {
      promptId,
      version: nextV,
      content,
      note: changeNote,
      createdById: user.id,
    },
  });

  if (updateTest) {
    await db.prompt.update({
      where: { id: promptId },
      data: { activeVersionId: version.id, updatedById: user.id },
    });
  }

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROMPT,
    targetId: promptId,
    afterData: {
      action: "create_version",
      version: nextV,
      versionId: version.id,
      updateTest,
    },
    request,
  });

  return NextResponse.json(
    {
      version: {
        id: version.id,
        promptId: version.promptId,
        version: version.version,
        note: version.note,
        createdAt: version.createdAt,
        createdById: version.createdById,
      },
    },
    { status: 201 }
  );
}
