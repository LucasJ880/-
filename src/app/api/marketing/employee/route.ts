/**
 * GET  /api/marketing/employee — 营销数字员工工作台摘要
 * POST /api/marketing/employee — 启动快捷任务（按 slug 执行 AgentSkill）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import {
  getProductMarketingContext,
  getProductContextCompleteness,
} from "@/lib/marketing/product-marketing-context";
import {
  MARKETING_PHASE2_TASKS,
  isMarketingSkillSlug,
} from "@/lib/marketing/skill-router";

async function resolveOrgId(userId: string): Promise<string | null> {
  let orgId = await getUserActiveOrgId(userId);
  if (!orgId) {
    const membership = await db.organizationMember.findFirst({
      where: { userId, status: "active" },
      select: { orgId: true },
      orderBy: { joinedAt: "desc" },
    });
    orgId = membership?.orgId ?? null;
  }
  return orgId;
}

export const GET = withAuth(async (_req, _ctx, user) => {
  const orgId = await resolveOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, code: true },
  });

  const context = await getProductMarketingContext(orgId);
  const completeness = getProductContextCompleteness(context);

  const [activeCampaigns, pendingActions, runningExperiments, recentExecutions] =
    await Promise.all([
      db.marketingCampaign.count({
        where: { orgId, status: { in: ["active", "awaiting_approval"] } },
      }),
      db.pendingAction.findMany({
        where: {
          orgId,
          status: "pending",
          type: {
            in: [
              "marketing.propose_context_update",
              "marketing.create_campaign_draft",
              "marketing.activate_campaign",
              "grader.email_draft",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          title: true,
          preview: true,
          status: true,
          createdAt: true,
        },
      }),
      db.marketingExperiment.count({
        where: { orgId, status: { in: ["running", "active"] } },
      }),
      db.skillExecution.findMany({
        where: {
          skill: {
            orgId,
            slug: { in: MARKETING_PHASE2_TASKS.map((t) => t.slug) },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          success: true,
          createdAt: true,
          durationMs: true,
          skill: { select: { slug: true, name: true } },
        },
      }),
    ]);

  const skills = await db.agentSkill.findMany({
    where: {
      orgId,
      slug: { in: MARKETING_PHASE2_TASKS.map((t) => t.slug) },
      isActive: true,
    },
    select: { id: true, slug: true, name: true },
  });

  return NextResponse.json({
    org,
    completeness,
    contextStatus: context.status,
    missingInformation: context.missingInformation.slice(0, 12),
    summary: {
      activeCampaigns,
      pendingApprovals: pendingActions.length,
      runningExperiments,
      completenessScore: completeness.score,
    },
    pendingActions,
    recentExecutions,
    tasks: MARKETING_PHASE2_TASKS.map((t) => ({
      ...t,
      skillId: skills.find((s) => s.slug === t.slug)?.id ?? null,
      available: skills.some((s) => s.slug === t.slug),
    })),
  });
});

export const POST = withAuth(async (req, _ctx, user) => {
  const orgId = await resolveOrgId(user.id);
  if (!orgId) {
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const objective =
    typeof body.objective === "string" && body.objective.trim()
      ? body.objective.trim()
      : "";

  if (!slug || !isMarketingSkillSlug(slug)) {
    return NextResponse.json({ error: "无效的营销任务" }, { status: 400 });
  }

  const skill = await db.agentSkill.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: { id: true, isActive: true },
  });
  if (!skill || !skill.isActive) {
    return NextResponse.json(
      {
        error: `当前组织尚未导入技能「${slug}」。请先执行 seed:marketing-phase2:write`,
      },
      { status: 404 },
    );
  }

  const taskMeta = MARKETING_PHASE2_TASKS.find((t) => t.slug === slug);
  const { runSkill } = await import("@/lib/agent-core/skills/runtime");
  const result = await runSkill({
    skillId: skill.id,
    slug,
    variables: {
      objective: objective || taskMeta?.title || slug,
      rawMaterials:
        typeof body.rawMaterials === "string" ? body.rawMaterials : objective,
      productFocus:
        typeof body.productFocus === "string" ? body.productFocus : "",
      competitorName:
        typeof body.competitorName === "string" ? body.competitorName : "",
      landingPageContent:
        typeof body.landingPageContent === "string"
          ? body.landingPageContent
          : "",
    },
    userId: user.id,
    orgId,
  });

  return NextResponse.json({
    ok: true,
    slug,
    title: taskMeta?.title ?? slug,
    result: {
      executionId: result.executionId,
      success: result.success,
      content: result.content,
      parsed: result.parsed,
      pendingActions: result.pendingActions ?? [],
      pendingActionsSkipped: result.pendingActionsSkipped ?? [],
      durationMs: result.durationMs,
    },
  });
});
