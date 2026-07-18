import { after, NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { db } from "@/lib/db";
import { ensureMarketingSkill } from "@/lib/market-intelligence/skill";
import { listMarketIntelligenceWorkspace } from "@/lib/market-intelligence/service";
import { canManageMarketIntelligence } from "@/lib/market-intelligence/access";
import {
  executeMarketResearchRun,
  listMarketResearchRuns,
  queueMarketResearchRun,
} from "@/lib/market-intelligence/research-runtime";
import { validateAuditContext, validateBrandTruth } from "@/lib/marketing/brand-validation";

export const maxDuration = 300;

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
  const [executions, researchRuns, automation, canManage] = await Promise.all([
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
    listMarketResearchRuns(orgRes.orgId),
    listMarketIntelligenceWorkspace(orgRes.orgId),
    canManageMarketIntelligence({
      userId: user.id,
      platformRole: user.role,
      orgId: orgRes.orgId,
    }),
  ]);
  const researchUsers = researchRuns.length
    ? await db.user.findMany({
        where: { id: { in: [...new Set(researchRuns.map((run) => run.createdById))] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const researchUserNames = new Map(researchUsers.map((row) => [row.id, row.name || row.email]));

  return NextResponse.json({
    skill: {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
    },
    executions: [
      ...researchRuns.map((run) => ({
        id: run.id,
        input: run.inputJson,
        output: run.outputMarkdown,
        durationMs: run.durationMs,
        createdAt: run.createdAt,
        status: run.status,
        errorCode: run.errorCode,
        error: run.error,
        modelUsed: run.modelUsed,
        fallbackUsed: run.fallbackUsed,
        attempts: run.attempts,
        createdById: run.createdById,
        requesterName: researchUserNames.get(run.createdById) ?? "未知成员",
        planId: run.planId,
        planStatus: run.planStatus,
        pendingActionId: run.pendingActionId,
      })),
      ...executions
        .filter((execution) =>
          !researchRuns.some((run) => run.skillExecutionId === execution.id)
          && execution.outputJson !== "AI 处理总时间超限，请稍后重试"
          && execution.outputJson !== "市场研究处理总时间超限，请稍后重试",
        )
        .map((execution) => ({
          id: execution.id,
          input: parseInputJson(execution.inputJson),
          output: execution.outputJson,
          durationMs: execution.durationMs,
          createdAt: execution.createdAt,
          status: "completed",
          errorCode: null,
          error: null,
          modelUsed: null,
          fallbackUsed: false,
          attempts: 1,
          createdById: null,
          requesterName: "历史任务",
          planId: null,
          planStatus: "none",
          pendingActionId: null,
        })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 12),
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

  const profile = await db.marketingBrandProfile.findUnique({ where: { orgId: orgRes.orgId } });
  if (!profile || profile.validationStatus !== "valid") {
    return NextResponse.json({ error: "请先在企业事实中心完成并通过画像校验" }, { status: 409 });
  }
  const truth = validateBrandTruth({
    ...profile,
    products: profile.productsJson,
    serviceAreas: profile.serviceAreasJson,
    targetAudiences: profile.targetAudiencesJson,
    competitors: profile.competitorsJson,
    forbiddenContexts: profile.forbiddenContextsJson,
  }).value;
  const contextIssues = validateAuditContext(truth, {
    geography: variables.targetGeography,
    industry: truth.industry,
    product: variables.primaryProduct,
    competitors: variables.competitors,
    query: `${variables.objective}\n${variables.marketEvidence}`,
  });
  if (contextIssues.some((issue) => issue.severity === "error")) {
    return NextResponse.json({
      error: "研究范围与企业事实不一致，请先确认地域、产品和竞争对手",
      issues: contextIssues,
    }, { status: 422 });
  }
  variables.targetGeography ||= truth.serviceAreas.join("、");
  variables.primaryProduct ||= truth.products.join("、");
  variables.competitors ||= truth.competitors.join("、") || "未确认竞争对手，请标记待验证";
  variables.industry = truth.industry;

  const run = await queueMarketResearchRun({
    orgId: orgRes.orgId,
    userId: user.id,
    variables,
  });
  after(async () => {
    await executeMarketResearchRun(run.id);
  });

  return NextResponse.json({
    run: {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt,
    },
  }, { status: 202 });
});
