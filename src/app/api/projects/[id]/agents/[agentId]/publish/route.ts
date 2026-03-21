import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectManageAccess } from "@/lib/projects/access";
import { getEnvironmentByCodeInProject } from "@/lib/prompts/scope";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string; agentId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id: projectId, agentId } = await ctx.params;
  const access = await requireProjectManageAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  const agent = await db.agent.findFirst({
    where: { id: agentId, projectId },
    include: { environment: true, toolBindings: true },
  });
  if (!agent) return NextResponse.json({ error: "Agent 不存在" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const targetCode = typeof body.targetEnvironmentCode === "string" ? body.targetEnvironmentCode.trim() : "prod";
  const remark = typeof body.remark === "string" ? body.remark.trim() : "";

  if (agent.environment.code === targetCode) {
    return NextResponse.json({ error: "不能发布到同一环境" }, { status: 400 });
  }

  const targetEnv = await getEnvironmentByCodeInProject(projectId, targetCode);
  if (!targetEnv) return NextResponse.json({ error: `目标环境 '${targetCode}' 不存在` }, { status: 404 });

  let prodPromptId: string | null = null;
  if (agent.promptId) {
    const srcPrompt = await db.prompt.findUnique({ where: { id: agent.promptId } });
    if (srcPrompt) {
      const prodPrompt = await db.prompt.findFirst({
        where: { projectId, environmentId: targetEnv.id, key: srcPrompt.key },
      });
      if (prodPrompt) prodPromptId = prodPrompt.id;
    }
  }

  let prodKbId: string | null = null;
  if (agent.knowledgeBaseId) {
    const srcKb = await db.knowledgeBase.findUnique({ where: { id: agent.knowledgeBaseId } });
    if (srcKb) {
      const prodKb = await db.knowledgeBase.findFirst({
        where: { projectId, environmentId: targetEnv.id, key: srcKb.key },
      });
      if (prodKb) prodKbId = prodKb.id;
    }
  }

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.agent.findUnique({
      where: { projectId_environmentId_key: { projectId, environmentId: targetEnv.id, key: agent.key } },
    });

    const data = {
      name: agent.name,
      description: agent.description,
      type: agent.type,
      status: "active" as const,
      promptId: prodPromptId,
      knowledgeBaseId: prodKbId,
      modelProvider: agent.modelProvider,
      modelName: agent.modelName,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      systemBehaviorNote: agent.systemBehaviorNote,
      extraConfigJson: agent.extraConfigJson,
      updatedById: user.id,
    };

    let target;
    if (existing) {
      target = await tx.agent.update({ where: { id: existing.id }, data });
    } else {
      target = await tx.agent.create({
        data: {
          ...data,
          projectId,
          environmentId: targetEnv.id,
          key: agent.key,
          createdById: user.id,
        },
      });
    }

    const maxVer = await tx.agentVersion.aggregate({
      where: { agentId: target.id },
      _max: { version: true },
    });
    const ver = await tx.agentVersion.create({
      data: {
        agentId: target.id,
        version: (maxVer._max.version ?? 0) + 1,
        configSnapshotJson: JSON.stringify({
          promptId: prodPromptId, knowledgeBaseId: prodKbId,
          modelProvider: data.modelProvider, modelName: data.modelName,
          temperature: data.temperature, maxTokens: data.maxTokens,
          systemBehaviorNote: data.systemBehaviorNote,
          extraConfigJson: data.extraConfigJson,
        }),
        changeNote: remark || `从 ${agent.environment.code} 发布`,
        createdById: user.id,
      },
    });

    await tx.agent.update({
      where: { id: target.id },
      data: { activeVersionId: ver.id },
    });

    if (agent.toolBindings.length > 0) {
      await tx.agentToolBinding.deleteMany({ where: { agentId: target.id } });
      const projectTools = await tx.toolRegistry.findMany({
        where: { projectId },
        select: { id: true, key: true },
      });
      const toolKeyMap = new Map(projectTools.map((t) => [t.key, t.id]));
      const srcTools = await tx.toolRegistry.findMany({
        where: { id: { in: agent.toolBindings.map((b) => b.toolId) } },
      });
      const bindings = srcTools
        .map((st, i) => {
          const targetToolId = toolKeyMap.get(st.key);
          if (!targetToolId) return null;
          return { agentId: target.id, toolId: targetToolId, enabled: true, sortOrder: i };
        })
        .filter(Boolean) as { agentId: string; toolId: string; enabled: boolean; sortOrder: number }[];
      if (bindings.length > 0) {
        await tx.agentToolBinding.createMany({ data: bindings });
      }
    }

    return target;
  });

  await logAudit({
    userId: user.id, orgId: project.orgId ?? undefined, projectId,
    action: AUDIT_ACTIONS.CREATE, targetType: AUDIT_TARGETS.AGENT, targetId: result.id,
    afterData: { action: "publish", from: agent.environment.code, to: targetCode, remark },
    request,
  });

  return NextResponse.json({ published: { id: result.id, environment: targetCode } });
}
