/**
 * GET  /api/revenue/policy — 当前企业 Revenue Spine 策略（默认 + 覆盖后）
 * PUT  /api/revenue/policy — 发布覆盖（boss / admin）body: { businessProfile?, policy? }
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { isAdmin } from "@/lib/rbac/roles";
import { resolveRevenueAccess } from "@/lib/revenue-spine/access";
import {
  RULE_KEY_BUSINESS_PROFILE,
  RULE_KEY_POLICY,
  loadRevenueSpinePolicy,
  mergeBusinessProfile,
  mergeRevenueSpinePolicy,
  publishRevenueSpineRule,
} from "@/lib/revenue-spine/policy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await resolveRevenueAccess(request);
  if (!access.ok) return access.response;
  const policy = await loadRevenueSpinePolicy(access.orgId);
  return NextResponse.json({ policy });
}

export async function PUT(request: NextRequest) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const role = access.auth.user.role;
  if (!isAdmin(role) && role !== "boss") return NextResponse.json({ error: "仅企业负责人或管理员可修改策略" }, { status: 403 });
  const current = await loadRevenueSpinePolicy(access.orgId);
  const published: Record<string, number> = {};
  if (body.businessProfile && typeof body.businessProfile === "object") {
    const merged = mergeBusinessProfile(current.businessProfile, body.businessProfile);
    const r = await publishRevenueSpineRule({ orgId: access.orgId, ruleKey: RULE_KEY_BUSINESS_PROFILE, config: merged as unknown as Record<string, unknown>, userId: access.auth.user.id });
    published.businessProfile = r.version;
  }
  if (body.policy && typeof body.policy === "object") {
    const merged = mergeRevenueSpinePolicy(current, body.policy);
    const rest: Record<string, unknown> = { ...merged };
    delete rest.businessProfile;
    const r = await publishRevenueSpineRule({ orgId: access.orgId, ruleKey: RULE_KEY_POLICY, config: rest, userId: access.auth.user.id });
    published.policy = r.version;
  }
  const policy = await loadRevenueSpinePolicy(access.orgId);
  return NextResponse.json({ ok: true, published, policy });
}
