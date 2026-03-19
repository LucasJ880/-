import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { getEnvironmentInProject } from "@/lib/prompts/scope";
import {
  normalizePromptKey,
  isValidPromptKeyFormat,
  isValidPromptType,
} from "@/lib/prompts/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const envCount = await db.environment.count({ where: { projectId } });
  if (envCount === 0) {
    return NextResponse.json(
      {
        error:
          "该项目尚未配置环境，请先在项目中创建环境后再管理 Prompt",
      },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const environmentId = searchParams.get("environmentId")?.trim() ?? "";
  if (!environmentId) {
    return NextResponse.json(
      { error: "缺少必填参数 environmentId" },
      { status: 400 }
    );
  }

  const env = await getEnvironmentInProject(projectId, environmentId);
  if (!env) {
    return NextResponse.json(
      { error: "环境不存在或不属于该项目" },
      { status: 404 }
    );
  }

  const prompts = await db.prompt.findMany({
    where: { projectId, environmentId },
    include: {
      activeVersion: {
        select: { id: true, version: true, createdAt: true },
      },
    },
    orderBy: { key: "asc" },
  });

  return NextResponse.json({
    prompts: prompts.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      type: p.type,
      status: p.status,
      updatedAt: p.updatedAt,
      activeVersion: p.activeVersion
        ? {
            id: p.activeVersion.id,
            version: p.activeVersion.version,
            createdAt: p.activeVersion.createdAt,
          }
        : null,
    })),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json();
  const environmentId =
    typeof body.environmentId === "string" ? body.environmentId.trim() : "";
  if (!environmentId) {
    return NextResponse.json({ error: "environmentId 必填" }, { status: 400 });
  }

  const env = await getEnvironmentInProject(projectId, environmentId);
  if (!env) {
    return NextResponse.json(
      { error: "环境不存在或不属于该项目" },
      { status: 404 }
    );
  }

  const keyRaw = typeof body.key === "string" ? body.key : "";
  const key = normalizePromptKey(keyRaw);
  if (!key || !isValidPromptKeyFormat(key)) {
    return NextResponse.json(
      { error: "key 格式无效，请使用小写字母、数字、下划线或短横线" },
      { status: 400 }
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  }

  const type =
    typeof body.type === "string" && body.type.trim()
      ? body.type.trim()
      : "system";
  if (!isValidPromptType(type)) {
    return NextResponse.json({ error: "无效的 type" }, { status: 400 });
  }

  const content =
    typeof body.content === "string" ? body.content : "";
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  const dup = await db.prompt.findUnique({
    where: {
      projectId_environmentId_key: {
        projectId,
        environmentId,
        key,
      },
    },
  });
  if (dup) {
    return NextResponse.json({ error: "该环境下 key 已存在" }, { status: 409 });
  }

  const result = await db.$transaction(async (tx) => {
    const prompt = await tx.prompt.create({
      data: {
        projectId,
        environmentId,
        key,
        name,
        type,
        status: "active",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const version = await tx.promptVersion.create({
      data: {
        promptId: prompt.id,
        version: 1,
        content,
        note,
        createdById: user.id,
      },
    });

    const updated = await tx.prompt.update({
      where: { id: prompt.id },
      data: { activeVersionId: version.id },
      include: {
        activeVersion: {
          select: {
            id: true,
            version: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    return updated;
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.PROMPT,
    targetId: result.id,
    afterData: {
      key,
      environmentId,
      version: 1,
      activeVersionId: result.activeVersionId,
    },
    request,
  });

  return NextResponse.json({ prompt: result }, { status: 201 });
}
