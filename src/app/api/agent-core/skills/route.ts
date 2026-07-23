/**
 * 动态技能管理 API
 *
 * GET  /api/agent-core/skills          — 列出组织技能（支持筛选与统计）
 * POST /api/agent-core/skills          — 创建技能（手动或 AI 提议）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { seedBuiltinSkills } from "@/lib/agent-core/skills/seed";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import { denyUnlessPlatformAdmin } from "@/lib/auth/platform-admin-guard";

async function resolveOrgId(userId: string): Promise<string | null> {
  const active = await getUserActiveOrgId(userId);
  if (active) return active;
  const membership = await db.organizationMember.findFirst({
    where: { userId, status: "active" },
    select: { orgId: true },
    orderBy: { joinedAt: "desc" },
  });
  return membership?.orgId ?? null;
}

export const GET = withAuth(async (req, _ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const domain = searchParams.get("domain") || undefined;
  const tier = searchParams.get("tier") || undefined;
  const active = searchParams.get("active");
  const builtin = searchParams.get("builtin");
  const includeStats = searchParams.get("includeStats") === "1";

  const orgId = await resolveOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const existingCount = await db.agentSkill.count({
    where: { orgId },
  });
  if (existingCount === 0) {
    await seedBuiltinSkills(orgId);
  }

  const skills = await db.agentSkill.findMany({
    where: {
      orgId,
      ...(domain ? { domain } : {}),
      ...(tier ? { tier } : {}),
      ...(active === "true"
        ? { isActive: true }
        : active === "false"
          ? { isActive: false }
          : {}),
      ...(builtin === "true"
        ? { isBuiltin: true }
        : builtin === "false"
          ? { isBuiltin: false }
          : {}),
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
      isActive: true,
      outputFormat: true,
      optimizationCount: true,
      lastOptimizedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { executions: true } },
    },
  });

  if (!includeStats) {
    return NextResponse.json({ skills });
  }

  const { getSkillStats } = await import("@/lib/agent-core/skills/learner");
  const withStats = await Promise.all(
    skills.map(async (skill) => {
      const stats = await getSkillStats(skill.id);
      const last = await db.skillExecution.findFirst({
        where: { skillId: skill.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, userRating: true },
      });
      return {
        ...skill,
        stats: {
          successRate: stats.total > 0 ? stats.successRate : null,
          avgRating: stats.avgRating,
          lastExecutedAt: last?.createdAt?.toISOString() ?? null,
          lastRating: last?.userRating ?? null,
        },
      };
    }),
  );

  return NextResponse.json({ skills: withStats });
});

export const POST = withAuth(async (req, _ctx, user) => {
  const denied = denyUnlessPlatformAdmin(user);
  if (denied) return denied;

  const orgId = await resolveOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    select: { role: true },
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

    const proposal = await proposeSkillFromDescription(orgId, body.description);

    if (!proposal) {
      return NextResponse.json({ error: "无法提取技能" }, { status: 400 });
    }

    const skillId = await createSkillFromProposal(orgId, proposal, user.id);

    return NextResponse.json({ skillId, proposal });
  }

  if (action === "create") {
    const skill = await db.agentSkill.create({
      data: {
        orgId,
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
        outputSchema: body.outputSchema ?? undefined,
        requiredTools: body.requiredTools ?? null,
        isBuiltin: false,
        isActive: true,
        createdById: user.id,
      },
    });

    return NextResponse.json({ skill: { id: skill.id, slug: skill.slug } });
  }

  return NextResponse.json({ error: "未知 action" }, { status: 400 });
});
