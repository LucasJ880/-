import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import {
  ensureMarketingSkill,
  MARKETING_SKILL_SLUG,
} from "@/lib/market-intelligence/skill";
import { listMarketIntelligenceWorkspace } from "@/lib/market-intelligence/service";
import { canManageMarketIntelligence } from "@/lib/market-intelligence/access";

const RATE_LIMIT = {
  name: "market-intelligence-analysis",
  windowMs: 60_000,
  maxRequests: 6,
} as const;

function parseInputJson(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  const skill = await ensureMarketingSkill(orgRes.orgId);
  const [executions, automation, canManage] = await Promise.all([
    db.skillExecution.findMany({
      where: { skillId: skill.id, success: true },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        inputJson: true,
        outputJson: true,
        durationMs: true,
        createdAt: true,
      },
    }),
    listMarketIntelligenceWorkspace(orgRes.orgId),
    canManageMarketIntelligence({
      userId: user.id,
      platformRole: user.role,
      orgId: orgRes.orgId,
    }),
  ]);

  return NextResponse.json({
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
    },
    executions: executions.map((execution) => ({
      id: execution.id,
      input: parseInputJson(execution.inputJson),
      output: execution.outputJson,
      durationMs: execution.durationMs,
      createdAt: execution.createdAt,
    })),
    automation: { ...automation, canManage },
  });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const rate = await checkRateLimitAsync(RATE_LIMIT, user.id);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "分析请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) },
      },
    );
  }

  const body = await request.json();
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId ?? null);
  if (!orgRes.ok) return orgRes.response;

  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  if (!objective) {
    return NextResponse.json({ error: "请先填写本次需要做出的决策" }, { status: 400 });
  }
  if (objective.length > 3000) {
    return NextResponse.json({ error: "决策目标过长" }, { status: 400 });
  }

  await ensureMarketingSkill(orgRes.orgId);

  const keys = [
    "objective",
    "targetGeography",
    "primaryProduct",
    "salesModel",
    "competitors",
    "marketEvidence",
    "firstPartyData",
    "unitEconomics",
    "outputType",
  ] as const;
  const variables: Record<string, string> = {};
  for (const key of keys) {
    const value = typeof body[key] === "string" ? body[key].trim() : "";
    variables[key] = value.slice(0, 20_000);
  }

  const { runSkill } = await import("@/lib/agent-core/skills/runtime");
  const result = await runSkill({
    slug: MARKETING_SKILL_SLUG,
    variables,
    userId: user.id,
    orgId: orgRes.orgId,
  });

  return NextResponse.json({
    result: {
      content: result.content,
      executionId: result.executionId,
      durationMs: result.durationMs,
    },
  });
});
