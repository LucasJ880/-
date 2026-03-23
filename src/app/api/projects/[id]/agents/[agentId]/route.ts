import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectManageAccess,
} from "@/lib/projects/access";
import { isValidAgentStatus } from "@/lib/agents/validation";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; agentId: string }> };

function buildConfigSnapshot(a: Record<string, unknown>) {
  return JSON.stringify({
    promptId: a.promptId ?? null,
    promptVersionId: a.promptVersionId ?? null,
    knowledgeBaseId: a.knowledgeBaseId ?? null,
    knowledgeBaseVersionId: a.knowledgeBaseVersionId ?? null,
    modelProvider: a.modelProvider ?? "openai",
    modelName: a.modelName ?? "gpt-5.2",
    temperature: a.temperature ?? 0.7,
    maxTokens: a.maxTokens ?? 4096,
    systemBehaviorNote: a.systemBehaviorNote ?? null,
    extraConfigJson: a.extraConfigJson ?? null,
  });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id: projectId, agentId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const agent = await db.agent.findFirst({
    where: { id: agentId, projectId },
    include: {
      environment: { select: { id: true, code: true, name: true } },
      activeVersion: { select: { id: true, version: true } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      toolBindings: {
        include: {
          tool: { select: { id: true, key: true, name: true, category: true, type: true, status: true } },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!agent) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });

  let promptInfo = null;
  if (agent.promptId) {
    const p = await db.prompt.findUnique({
      where: { id: agent.promptId },
      select: { id: true, key: true, name: true },
    });
    if (p) promptInfo = p;
  }

  let kbInfo = null;
  if (agent.knowledgeBaseId) {
    const k = await db.knowledgeBase.findUnique({
      where: { id: agent.knowledgeBaseId },
      select: { id: true, key: true, name: true },
    });
    if (k) kbInfo = k;
  }

  const latestVersions = await db.agentVersion.findMany({
    where: { agentId },
    orderBy: { version: "desc" },
    take: 5,
    select: { id: true, version: true, changeNote: true, createdAt: true },
  });

  return NextResponse.json({
    agent: {
      id: agent.id,
      key: agent.key,
      name: agent.name,
      description: agent.description,
      type: agent.type,
      status: agent.status,
      environment: agent.environment,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      systemBehaviorNote: agent.systemBehaviorNote,
      extraConfigJson: agent.extraConfigJson,
      promptId: agent.promptId,
      promptVersionId: agent.promptVersionId,
      knowledgeBaseId: agent.knowledgeBaseId,
      knowledgeBaseVersionId: agent.knowledgeBaseVersionId,
      activeVersion: agent.activeVersion ? { id: agent.activeVersion.id, version: agent.activeVersion.version } : null,
      createdBy: agent.createdBy,
      updatedBy: agent.updatedBy,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    },
    prompt: promptInfo,
    knowledgeBase: kbInfo,
    toolBindings: agent.toolBindings.map((b) => ({
      id: b.id,
      tool: b.tool,
      enabled: b.enabled,
      sortOrder: b.sortOrder,
      configOverrideJson: b.configOverrideJson,
    })),
    recentVersions: latestVersions,
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id: projectId, agentId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const agent = await db.agent.findFirst({ where: { id: agentId, projectId } });
  if (!agent) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.description === "string") updates.description = body.description.trim() || null;
  if (typeof body.status === "string" && isValidAgentStatus(body.status)) updates.status = body.status;
  if (typeof body.promptId === "string") updates.promptId = body.promptId.trim() || null;
  if (typeof body.knowledgeBaseId === "string") updates.knowledgeBaseId = body.knowledgeBaseId.trim() || null;
  if (typeof body.modelProvider === "string") updates.modelProvider = body.modelProvider.trim();
  if (typeof body.modelName === "string") updates.modelName = body.modelName.trim();
  if (typeof body.temperature === "number") updates.temperature = body.temperature;
  if (typeof body.maxTokens === "number") updates.maxTokens = body.maxTokens;
  if (typeof body.systemBehaviorNote === "string") updates.systemBehaviorNote = body.systemBehaviorNote.trim() || null;
  if (typeof body.extraConfigJson === "string") updates.extraConfigJson = body.extraConfigJson.trim() || null;

  const enabledToolIds = Array.isArray(body.enabledToolIds) ? body.enabledToolIds as string[] : null;
  const changeNote = typeof body.changeNote === "string" ? body.changeNote.trim() : "配置更新";

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.agent.update({
      where: { id: agentId },
      data: { ...updates, updatedById: user.id },
    });

    if (enabledToolIds) {
      await tx.agentToolBinding.deleteMany({ where: { agentId } });
      if (enabledToolIds.length > 0) {
        const tools = await tx.toolRegistry.findMany({
          where: { id: { in: enabledToolIds }, projectId },
        });
        await tx.agentToolBinding.createMany({
          data: tools.map((t, i) => ({
            agentId, toolId: t.id, enabled: true, sortOrder: i,
          })),
        });
      }
    }

    const maxVer = await tx.agentVersion.aggregate({
      where: { agentId },
      _max: { version: true },
    });
    const nextVer = (maxVer._max.version ?? 0) + 1;

    const ver = await tx.agentVersion.create({
      data: {
        agentId,
        version: nextVer,
        configSnapshotJson: buildConfigSnapshot(updated),
        changeNote,
        createdById: user.id,
      },
    });

    return tx.agent.update({
      where: { id: agentId },
      data: { activeVersionId: ver.id },
      include: {
        environment: { select: { id: true, code: true, name: true } },
        activeVersion: { select: { id: true, version: true } },
      },
    });
  });

  await logAudit({
    userId: user.id, orgId: project.orgId ?? undefined, projectId,
    action: AUDIT_ACTIONS.UPDATE, targetType: AUDIT_TARGETS.AGENT, targetId: agentId,
    afterData: updates,
    request,
  });

  return NextResponse.json({ agent: result });
}
