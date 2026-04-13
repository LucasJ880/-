/**
 * 动态技能管理 API
 *
 * GET  /api/agent-core/skills          — 列出组织技能
 * POST /api/agent-core/skills          — 创建技能（手动或 AI 提议）
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { seedBuiltinSkills } from "@/lib/agent-core/skills/seed";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain") || undefined;

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  // 首次访问时自动播种内置技能
  const existingCount = await db.agentSkill.count({
    where: { orgId: membership.orgId },
  });
  if (existingCount === 0) {
    await seedBuiltinSkills(membership.orgId);
  }

  const skills = await db.agentSkill.findMany({
    where: {
      orgId: membership.orgId,
      isActive: true,
      ...(domain ? { domain } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      domain: true,
      tier: true,
      version: true,
      isBuiltin: true,
      outputFormat: true,
      optimizationCount: true,
      lastOptimizedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { executions: true } },
    },
  });

  return NextResponse.json({ skills });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true, role: true },
  });

  if (!membership) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const body = await req.json();
  const { action } = body;

  if (action === "create_from_description") {
    const { proposeSkillFromDescription, createSkillFromProposal } = await import(
      "@/lib/agent-core/skills/auto-creator"
    );

    const proposal = await proposeSkillFromDescription(
      membership.orgId,
      body.description,
    );

    if (!proposal) {
      return NextResponse.json({ error: "无法提取技能" }, { status: 400 });
    }

    const skillId = await createSkillFromProposal(
      membership.orgId,
      proposal,
      user.id,
    );

    return NextResponse.json({ skillId, proposal });
  }

  if (action === "create") {
    const skill = await db.agentSkill.create({
      data: {
        orgId: membership.orgId,
        slug: body.slug,
        name: body.name,
        description: body.description,
        domain: body.domain ?? "secretary",
        tier: body.tier ?? "execution",
        systemPrompt: body.systemPrompt,
        userPromptTemplate: body.userPromptTemplate,
        outputFormat: body.outputFormat ?? "text",
        temperature: body.temperature ?? 0.3,
        maxTokens: body.maxTokens ?? 2000,
        inputSchema: body.inputSchema ?? undefined,
        requiredTools: body.requiredTools ?? null,
        isBuiltin: false,
        isActive: true,
        createdById: user.id,
      },
    });

    return NextResponse.json({ skill: { id: skill.id, slug: skill.slug } });
  }

  return NextResponse.json({ error: "未知 action" }, { status: 400 });
}
