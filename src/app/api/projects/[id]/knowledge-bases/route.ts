import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { getEnvironmentInProject } from "@/lib/prompts/scope";
import {
  normalizeKbKey,
  isValidKbKeyFormat,
} from "@/lib/knowledge-bases/validation";
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
          "该项目尚未配置环境，请先在项目中创建环境后再管理知识库",
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

  const bases = await db.knowledgeBase.findMany({
    where: { projectId, environmentId },
    include: {
      activeVersion: { select: { id: true, version: true } },
    },
    orderBy: { key: "asc" },
  });

  const kbIds = bases.map((b) => b.id);
  const counts =
    kbIds.length === 0
      ? []
      : await db.knowledgeDocument.groupBy({
          by: ["knowledgeBaseId"],
          where: {
            knowledgeBaseId: { in: kbIds },
            status: "active",
          },
          _count: { _all: true },
        });
  const countMap = new Map(
    counts.map((c) => [c.knowledgeBaseId, c._count._all])
  );

  return NextResponse.json({
    knowledgeBases: bases.map((b) => ({
      id: b.id,
      key: b.key,
      name: b.name,
      description: b.description,
      status: b.status,
      updatedAt: b.updatedAt,
      activeVersion: b.activeVersion
        ? { id: b.activeVersion.id, version: b.activeVersion.version }
        : null,
      documentCount: countMap.get(b.id) ?? 0,
    })),
  });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId } = await ctx.params;

  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const body = await request.json().catch(() => ({}));
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
  const key = normalizeKbKey(keyRaw);
  if (!key || !isValidKbKeyFormat(key)) {
    return NextResponse.json(
      { error: "key 格式无效，请使用小写字母、数字、下划线或短横线" },
      { status: 400 }
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  const dup = await db.knowledgeBase.findUnique({
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
    const kb = await tx.knowledgeBase.create({
      data: {
        projectId,
        environmentId,
        key,
        name,
        description,
        status: "active",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const kbv = await tx.knowledgeBaseVersion.create({
      data: {
        knowledgeBaseId: kb.id,
        version: 1,
        note,
        createdById: user.id,
      },
    });

    return tx.knowledgeBase.update({
      where: { id: kb.id },
      data: { activeVersionId: kbv.id },
      include: {
        activeVersion: {
          select: { id: true, version: true, note: true, createdAt: true },
        },
        environment: { select: { id: true, code: true, name: true } },
      },
    });
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGETS.KNOWLEDGE_BASE,
    targetId: result.id,
    afterData: {
      key,
      environmentId,
      kbVersion: 1,
      activeVersionId: result.activeVersionId,
    },
    request,
  });

  return NextResponse.json({ knowledgeBase: result }, { status: 201 });
}
