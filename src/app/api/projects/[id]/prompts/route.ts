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

  const { searchParams } = new URL(request.url);
  const environmentId = searchParams.get("environmentId")?.trim() ?? "";
  const keyword = searchParams.get("keyword")?.trim() ?? "";
  const typeFilter = searchParams.get("type")?.trim() ?? "";
  const statusFilter = searchParams.get("status")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50)
  );

  if (environmentId) {
    const env = await getEnvironmentInProject(projectId, environmentId);
    if (!env) {
      return NextResponse.json(
        { error: "环境不存在或不属于该项目" },
        { status: 404 }
      );
    }
  }

  const where: Record<string, unknown> = { projectId };
  if (environmentId) where.environmentId = environmentId;
  if (typeFilter) where.type = typeFilter;
  if (statusFilter) where.status = statusFilter;
  if (keyword) {
    where.OR = [
      { name: { contains: keyword, mode: "insensitive" } },
      { key: { contains: keyword, mode: "insensitive" } },
    ];
  }

  const [total, prompts] = await Promise.all([
    db.prompt.count({ where }),
    db.prompt.findMany({
      where,
      include: {
        activeVersion: {
          select: { id: true, version: true, createdAt: true },
        },
        environment: {
          select: { id: true, code: true, name: true },
        },
        updatedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ key: "asc" }, { environment: { code: "asc" } }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const promptKeys = [...new Set(prompts.map((p) => p.key))];
  const crossEnvMap: Record<
    string,
    { envCode: string; envName: string; activeVersion: number | null; promptId: string }[]
  > = {};

  if (promptKeys.length > 0) {
    const allForKeys = await db.prompt.findMany({
      where: { projectId, key: { in: promptKeys } },
      select: {
        id: true,
        key: true,
        environment: { select: { code: true, name: true } },
        activeVersion: { select: { version: true } },
      },
    });
    for (const p of allForKeys) {
      if (!crossEnvMap[p.key]) crossEnvMap[p.key] = [];
      crossEnvMap[p.key].push({
        envCode: p.environment.code,
        envName: p.environment.name,
        activeVersion: p.activeVersion?.version ?? null,
        promptId: p.id,
      });
    }
  }

  return NextResponse.json({
    prompts: prompts.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      type: p.type,
      status: p.status,
      environmentId: p.environmentId,
      environment: p.environment,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
      activeVersion: p.activeVersion
        ? {
            id: p.activeVersion.id,
            version: p.activeVersion.version,
            createdAt: p.activeVersion.createdAt,
          }
        : null,
      crossEnvVersions: crossEnvMap[p.key] ?? [],
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
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

  const content = typeof body.content === "string" ? body.content : "";
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
