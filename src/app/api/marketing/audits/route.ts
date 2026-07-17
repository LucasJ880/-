import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { stringList, validateAuditContext, type AuditContextInput, type BrandValidationIssue, type NormalizedBrandTruth } from "@/lib/marketing/brand-validation";
import { MARKETING_DIMENSIONS, clampScore, scoreToGrade } from "@/lib/marketing/constants";
import { logAudit } from "@/lib/audit/logger";

function jsonArray(value: unknown): string[] {
  return stringList(value);
}

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const audits = await db.marketingAuditRun.findMany({
    where: { orgId: orgRes.orgId },
    include: { scores: true, findings: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ audits });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const profileRow = await db.marketingBrandProfile.findUnique({ where: { orgId: orgRes.orgId } });
  if (!profileRow || profileRow.validationStatus !== "valid") {
    return NextResponse.json({ error: "请先完成并通过企业事实中心校验" }, { status: 409 });
  }
  const profile: NormalizedBrandTruth = {
    legalName: profileRow.legalName,
    brandName: profileRow.brandName,
    website: profileRow.website,
    phone: profileRow.phone,
    addressLine: profileRow.addressLine,
    city: profileRow.city,
    region: profileRow.region,
    country: profileRow.country,
    postalCode: profileRow.postalCode,
    timezone: profileRow.timezone,
    industry: profileRow.industry,
    products: jsonArray(profileRow.productsJson),
    serviceAreas: jsonArray(profileRow.serviceAreasJson),
    targetAudiences: jsonArray(profileRow.targetAudiencesJson),
    competitors: jsonArray(profileRow.competitorsJson),
    forbiddenContexts: jsonArray(profileRow.forbiddenContextsJson),
  };
  const contexts: AuditContextInput[] = Array.isArray(body.contexts) ? body.contexts : [];
  const contextIssues: BrandValidationIssue[] = contexts.flatMap((context: AuditContextInput) => validateAuditContext(profile, context));
  if (contextIssues.some((issue: BrandValidationIssue) => issue.severity === "error")) {
    const audit = await db.marketingAuditRun.create({
      data: {
        orgId: orgRes.orgId,
        source: String(body.source || "manual"),
        status: "invalid",
        confidence: 0,
        profileValidationSnapshot: JSON.parse(JSON.stringify({ profileId: profileRow.id, validationScore: profileRow.validationScore, contextIssues })),
        invalidReason: contextIssues.map((issue: BrandValidationIssue) => issue.message).join("；"),
        completedAt: new Date(),
        createdById: user.id,
      },
    });
    await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_audit_rejected", targetType: "marketing_audit", targetId: audit.id, afterData: { contextIssues }, request });
    return NextResponse.json({ error: "检测上下文与企业事实不一致，本次检测已标记无效", audit, issues: contextIssues }, { status: 422 });
  }

  const scoreInput = Array.isArray(body.scores) ? body.scores : [];
  const scores = MARKETING_DIMENSIONS.map((dimension) => {
    const item = scoreInput.find((row: { dimension?: unknown }) => row?.dimension === dimension);
    const score = clampScore(item?.score);
    return { dimension, score, grade: scoreToGrade(score), confidence: clampScore(item?.confidence ?? body.confidence ?? 100), evidenceJson: item?.evidence ?? undefined };
  });
  const totalScore = Math.round(scores.reduce((sum, row) => sum + row.score, 0) / scores.length);
  const findingInput = Array.isArray(body.findings) ? body.findings : [];
  const findings = findingInput.slice(0, 200).map((item: Record<string, unknown>) => ({
    orgId: orgRes.orgId,
    dimension: MARKETING_DIMENSIONS.includes(item.dimension as never) ? String(item.dimension) : "SEO",
    severity: ["critical", "high", "medium", "low"].includes(String(item.severity)) ? String(item.severity) : "medium",
    title: String(item.title || "未命名营销问题").slice(0, 300),
    description: item.description ? String(item.description).slice(0, 8000) : null,
    currentValue: item.currentValue ? String(item.currentValue).slice(0, 4000) : null,
    expectedValue: item.expectedValue ? String(item.expectedValue).slice(0, 4000) : null,
    evidenceUrl: item.evidenceUrl ? String(item.evidenceUrl).slice(0, 2000) : null,
    evidenceJson: item.evidence ?? undefined,
    confidence: clampScore(item.confidence ?? body.confidence ?? 100),
    createdById: user.id,
  }));
  const audit = await db.marketingAuditRun.create({
    data: {
      orgId: orgRes.orgId,
      source: String(body.source || "manual"),
      status: "completed",
      totalScore,
      confidence: clampScore(body.confidence ?? 100),
      profileValidationSnapshot: JSON.parse(JSON.stringify({ profileId: profileRow.id, validationScore: profileRow.validationScore, contexts })),
      completedAt: new Date(),
      createdById: user.id,
      scores: { create: scores.map((score) => ({ orgId: orgRes.orgId, ...score })) },
      findings: { create: findings },
    },
    include: { scores: true, findings: true },
  });
  await logAudit({ userId: user.id, orgId: orgRes.orgId, action: "marketing_audit_create", targetType: "marketing_audit", targetId: audit.id, afterData: { totalScore, findingCount: findings.length }, request });
  return NextResponse.json({ audit }, { status: 201 });
});
