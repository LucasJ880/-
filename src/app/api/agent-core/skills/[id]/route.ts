/**
 * 单技能操作 API
 *
 * GET    /api/agent-core/skills/[id]                — 技能详情 + 统计
 * POST   /api/agent-core/skills/[id]                — 执行/反馈/优化
 * PATCH  /api/agent-core/skills/[id]                — 更新技能配置
 * DELETE /api/agent-core/skills/[id]                — 停用技能
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

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
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
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
    try {
      const result = await runSkill({
        skillId: id,
        variables: body.variables ?? {},
        userId: user.id,
        orgId: membership.orgId,
      });
      return NextResponse.json({ result });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
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
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;
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
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

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
}
