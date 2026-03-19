import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import {
  isValidPromptType,
  isValidPromptStatus,
} from "@/lib/prompts/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; promptId: string }> };

async function loadPrompt(projectId: string, promptId: string) {
  return db.prompt.findFirst({
    where: { id: promptId, projectId },
    include: {
      environment: { select: { id: true, code: true, name: true, status: true } },
      activeVersion: true,
    },
  });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const prompt = await loadPrompt(projectId, promptId);
  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  }

  const recentVersions = await db.promptVersion.findMany({
    where: { promptId },
    orderBy: { version: "desc" },
    take: 10,
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdById: true,
    },
  });

  return NextResponse.json({
    prompt: {
      id: prompt.id,
      projectId: prompt.projectId,
      environmentId: prompt.environmentId,
      environment: prompt.environment,
      key: prompt.key,
      name: prompt.name,
      type: prompt.type,
      status: prompt.status,
      activeVersionId: prompt.activeVersionId,
      activeVersion: prompt.activeVersion
        ? {
            id: prompt.activeVersion.id,
            version: prompt.activeVersion.version,
            content: prompt.activeVersion.content,
            note: prompt.activeVersion.note,
            createdAt: prompt.activeVersion.createdAt,
            createdById: prompt.activeVersion.createdById,
          }
        : null,
      createdAt: prompt.createdAt,
      updatedAt: prompt.updatedAt,
    },
    recentVersions,
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, promptId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const prompt = await loadPrompt(projectId, promptId);
  if (!prompt) {
    return NextResponse.json({ error: "Prompt 不存在" }, { status: 404 });
  }

  const body = await request.json();

  if (body.key !== undefined) {
    return NextResponse.json({ error: "不允许修改 key" }, { status: 400 });
  }
  if (body.environmentId !== undefined || body.projectId !== undefined) {
    return NextResponse.json(
      { error: "不允许修改所属项目或环境" },
      { status: 400 }
    );
  }

  const data: {
    name?: string;
    type?: string;
    status?: string;
    updatedById: string;
  } = { updatedById: user.id };

  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) {
      return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
    }
    data.name = n;
  }

  if (body.type !== undefined) {
    const t = String(body.type);
    if (!isValidPromptType(t)) {
      return NextResponse.json({ error: "无效的 type" }, { status: 400 });
    }
    data.type = t;
  }

  if (body.status !== undefined) {
    const s = String(body.status);
    if (!isValidPromptStatus(s)) {
      return NextResponse.json({ error: "无效的 status" }, { status: 400 });
    }
    data.status = s;
  }

  const beforeSnapshot = {
    name: prompt.name,
    type: prompt.type,
    status: prompt.status,
    activeVersionId: prompt.activeVersionId,
    activeVersion: prompt.activeVersion?.version,
  };

  let newVersionId: string | null = null;
  let newVersionNum: number | null = null;

  if (body.content !== undefined) {
    const newContent = String(body.content);
    const oldContent = prompt.activeVersion?.content ?? "";
    if (newContent !== oldContent) {
      const agg = await db.promptVersion.aggregate({
        where: { promptId },
        _max: { version: true },
      });
      const nextV = (agg._max.version ?? 0) + 1;
      const note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim()
          : null;

      const version = await db.promptVersion.create({
        data: {
          promptId,
          version: nextV,
          content: newContent,
          note,
          createdById: user.id,
        },
      });

      newVersionId = version.id;
      newVersionNum = nextV;

      await db.prompt.update({
        where: { id: promptId },
        data: {
          activeVersionId: version.id,
          updatedById: user.id,
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
    }
  }

  if (newVersionId === null) {
    if (Object.keys(data).length <= 1) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
    }
    await db.prompt.update({
      where: { id: promptId },
      data,
    });
  }

  const updated = await loadPrompt(projectId, promptId);
  if (!updated) {
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: AUDIT_TARGETS.PROMPT,
    targetId: promptId,
    beforeData: beforeSnapshot,
    afterData: {
      name: updated.name,
      type: updated.type,
      status: updated.status,
      activeVersionId: updated.activeVersionId,
      newVersion: newVersionNum,
    },
    request,
  });

  return NextResponse.json({
    prompt: {
      id: updated.id,
      key: updated.key,
      name: updated.name,
      type: updated.type,
      status: updated.status,
      environment: updated.environment,
      activeVersion: updated.activeVersion
        ? {
            id: updated.activeVersion.id,
            version: updated.activeVersion.version,
            content: updated.activeVersion.content,
            note: updated.activeVersion.note,
          }
        : null,
    },
    newVersion: newVersionNum,
  });
}
