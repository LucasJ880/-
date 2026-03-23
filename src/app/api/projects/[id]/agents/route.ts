import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { getEnvironmentInProject } from "@/lib/prompts/scope";
import {
  normalizeAgentKey,
  isValidAgentKeyFormat,
  isValidAgentType,
} from "@/lib/agents/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string }> };

function buildConfigSnapshot(fields: Record<string, unknown>) {
  return JSON.stringify({
    promptId: fields.promptId ?? null,
    promptVersionId: fields.promptVersionId ?? null,
    knowledgeBaseId: fields.knowledgeBaseId ?? null,
    knowledgeBaseVersionId: fields.knowledgeBaseVersionId ?? null,
    modelProvider: fields.modelProvider ?? "openai",
    modelName: fields.modelName ?? "gpt-5.4",
    temperature: fields.temperature ?? 0.7,
    maxTokens: fields.maxTokens ?? 4096,
    systemBehaviorNote: fields.systemBehaviorNote ?? null,
    extraConfigJson: fields.extraConfigJson ?? null,
  });
}

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
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10) || 50));

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

  const [total, agents] = await Promise.all([
    db.agent.count({ where }),
    db.agent.findMany({
      where,
      include: {
        environment: { select: { id: true, code: true, name: true } },
        activeVersion: { select: { id: true, version: true } },
        updatedBy: { select: { id: true, name: true } },
        _count: { select: { toolBindings: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const promptIds = agents.map((a) => a.promptId).filter((id): id is string => !!id);
  const kbIds = agents.map((a) => a.knowledgeBaseId).filter((id): id is string => !!id);

  const [promptMap, kbMap] = await Promise.all([
    promptIds.length > 0
      ? db.prompt.findMany({ where: { id: { in: promptIds } }, select: { id: true, key: true, name: true } })
          .then((ps) => new Map(ps.map((p) => [p.id, p])))
      : Promise.resolve(new Map<string, { id: string; key: string; name: string }>()),
    kbIds.length > 0
      ? db.knowledgeBase.findMany({ where: { id: { in: kbIds } }, select: { id: true, key: true, name: true } })
          .then((ks) => new Map(ks.map((k) => [k.id, k])))
      : Promise.resolve(new Map<string, { id: string; key: string; name: string }>()),
  ]);

  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      key: a.key,
      name: a.name,
      description: a.description,
      type: a.type,
      status: a.status,
      environment: a.environment,
      modelProvider: a.modelProvider,
      modelName: a.modelName,
      activeVersion: a.activeVersion ? { id: a.activeVersion.id, version: a.activeVersion.version } : null,
      toolCount: a._count.toolBindings,
      prompt: a.promptId ? promptMap.get(a.promptId) ?? null : null,
      knowledgeBase: a.knowledgeBaseId ? kbMap.get(a.knowledgeBaseId) ?? null : null,
      updatedBy: a.updatedBy,
      updatedAt: a.updatedAt,
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

  const body = await request.json().catch(() => ({}));

  const environmentId = typeof body.environmentId === "string" ? body.environmentId.trim() : "";
  if (!environmentId) return NextResponse.json({ error: "environmentId 必填" }, { status: 400 });

  const env = await getEnvironmentInProject(projectId, environmentId);
  if (!env) return NextResponse.json({ error: "环境不存在或不属于该项目" }, { status: 404 });

  const key = normalizeAgentKey(typeof body.key === "string" ? body.key : "");
  if (!key || !isValidAgentKeyFormat(key)) {
    return NextResponse.json({ error: "key 格式无效" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "名称不能为空" }, { status: 400 });

  const agentType = typeof body.type === "string" && isValidAgentType(body.type) ? body.type : "chat";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const promptId = typeof body.promptId === "string" && body.promptId.trim() ? body.promptId.trim() : null;
  const knowledgeBaseId = typeof body.knowledgeBaseId === "string" && body.knowledgeBaseId.trim() ? body.knowledgeBaseId.trim() : null;
  const modelProvider = typeof body.modelProvider === "string" && body.modelProvider.trim() ? body.modelProvider.trim() : "openai";
  const modelName = typeof body.modelName === "string" && body.modelName.trim() ? body.modelName.trim() : "gpt-5.4";
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
  const maxTokens = typeof body.maxTokens === "number" ? body.maxTokens : 4096;

  const dup = await db.agent.findUnique({
    where: { projectId_environmentId_key: { projectId, environmentId, key } },
  });
  if (dup) return NextResponse.json({ error: "该环境下 key 已存在" }, { status: 409 });

  const result = await db.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        projectId, environmentId, key, name, description,
        type: agentType, status: "active",
        promptId, knowledgeBaseId,
        modelProvider, modelName, temperature, maxTokens,
        createdById: user.id, updatedById: user.id,
      },
    });

    const ver = await tx.agentVersion.create({
      data: {
        agentId: agent.id, version: 1,
        configSnapshotJson: buildConfigSnapshot(agent),
        changeNote: "初始版本",
        createdById: user.id,
      },
    });

    return tx.agent.update({
      where: { id: agent.id },
      data: { activeVersionId: ver.id },
      include: {
        environment: { select: { id: true, code: true, name: true } },
        activeVersion: { select: { id: true, version: true } },
      },
    });
  });

  await logAudit({
    userId: user.id, orgId: project.orgId ?? undefined, projectId,
    action: AUDIT_ACTIONS.CREATE, targetType: AUDIT_TARGETS.AGENT, targetId: result.id,
    afterData: { key, environmentId, type: agentType, promptId, knowledgeBaseId },
    request,
  });

  return NextResponse.json({ agent: result }, { status: 201 });
}
