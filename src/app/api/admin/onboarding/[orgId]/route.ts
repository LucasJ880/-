/**
 * /api/admin/onboarding/[orgId] — 单个企业的入驻状态（平台管理员专用）
 *   GET   逐步就绪状态（全部从数据库推导）+ 中台配置健康问题
 *   PATCH 时区 / 行业包（重写显式模块）/ 工厂老板 / 手动确认可跳过项
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import {
  findActiveUserIdByEmail,
  getOnboardingStatus,
  updateOnboardingSettings,
} from "@/lib/organizations/onboarding";
import { onboardingErrorResponse, readJsonBody, validationErrorResponse } from "@/lib/organizations/onboarding-http";
import { validateOnboardingPatch } from "@/lib/organizations/onboarding-rules";

type Ctx = { params: Promise<{ orgId: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  try {
    const status = await getOnboardingStatus(orgId, { configHealth: true, actorUserId: auth.user.id });
    if (!status) return NextResponse.json({ error: "企业不存在" }, { status: 404 });
    return NextResponse.json({ status });
  } catch (err) {
    return onboardingErrorResponse(err, "status");
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const v = validateOnboardingPatch(parsed.body);
  if (!v.ok) return validationErrorResponse(v.errors);
  try {
    const ownerUserId = v.value.ownerEmail ? await findActiveUserIdByEmail(v.value.ownerEmail) : undefined;
    await updateOnboardingSettings(orgId, { ...v.value, ownerUserId }, auth.user.id);
    const status = await getOnboardingStatus(orgId, { configHealth: true, actorUserId: auth.user.id });
    return NextResponse.json({ status });
  } catch (err) {
    return onboardingErrorResponse(err, "update");
  }
}
