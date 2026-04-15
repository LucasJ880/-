/**
 * 单技能操作 API
 *
 * GET    /api/agent-core/skills/[id]                — 技能详情 + 统计
 * POST   /api/agent-core/skills/[id]                — 执行/反馈/优化
 * PATCH  /api/agent-core/skills/[id]                — 更新技能配置
 * DELETE /api/agent-core/skills/[id]                — 停用技能
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

export const GET = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;

  const skill = await db.agentSkill.findUnique({
    where: { id },
    include: {
      _count: { select: { executions: true } },
    },
  });

  if (!skill) {
    return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  }

  const { getSkillStats } = await import("@/lib/agent-core/skills/learner");
  const stats = await getSkillStats(id);

  const recentExecutions = await db.skillExecution.findMany({
    where: { skillId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      success: true,
      durationMs: true,
      userRating: true,
      userFeedback: true,
      wasEdited: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ skill, stats, recentExecutions });
});

export const POST = withAuth(async (req, ctx, user) => {
  const { id } = await ctx.params;
  const body = await req.json();

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  if (body.action === "run") {
    const { runSkill } = await import("@/lib/agent-core/skills/runtime");
    const result = await runSkill({
      skillId: id,
      variables: body.variables ?? {},
      userId: user.id,
      orgId: membership.orgId,
    });
    return NextResponse.json({ result });
  }

  if (body.action === "feedback") {
    const { recordFeedback } = await import("@/lib/agent-core/skills/runtime");
    await recordFeedback(body.executionId, {
      rating: body.rating,
      feedback: body.feedback,
      wasEdited: body.wasEdited,
    });
    return NextResponse.json({ success: true });
  }

  if (body.action === "optimize") {
    const { optimizeSkill } = await import("@/lib/agent-core/skills/learner");
    const result = await optimizeSkill(id, { force: body.force });
    if (!result) {
      return NextResponse.json({
        message: "暂不需要优化（数据不足或当前表现良好）",
      });
    }
    return NextResponse.json({ optimization: result });
  }

  return NextResponse.json({ error: "未知 action" }, { status: 400 });
});

export const PATCH = withAuth(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await req.json();

  const skill = await db.agentSkill.findUnique({
    where: { id },
    select: { isBuiltin: true },
  });

  if (!skill) {
    return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;
  if (body.userPromptTemplate !== undefined) updateData.userPromptTemplate = body.userPromptTemplate;
  if (body.outputFormat !== undefined) updateData.outputFormat = body.outputFormat;
  if (body.temperature !== undefined) updateData.temperature = body.temperature;
  if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens;
  if (body.requiredTools !== undefined) updateData.requiredTools = body.requiredTools;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  const updated = await db.agentSkill.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ skill: { id: updated.id, version: updated.version } });
});

export const DELETE = withAuth(async (_req, ctx) => {
  const { id } = await ctx.params;

  const skill = await db.agentSkill.findUnique({
    where: { id },
    select: { isBuiltin: true },
  });

  if (!skill) {
    return NextResponse.json({ error: "技能不存在" }, { status: 404 });
  }

  if (skill.isBuiltin) {
    await db.agentSkill.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ message: "内置技能已停用" });
  }

  await db.agentSkill.delete({ where: { id } });
  return NextResponse.json({ message: "技能已删除" });
});
