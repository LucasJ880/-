/**
 * POST /api/admin/onboarding/[orgId]/invites — 生成企业邀请码（平台管理员专用）
 * body: { role?: "trade" | "sales", orgRole?: "org_member" | "org_admin", count?: 1–20, expiresInDays?: 1–30, label? }
 * 单次使用、有到期时间；注册时直接加入该企业并设为当前工作企业，不建个人工作区。
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { createOrgInvites } from "@/lib/organizations/onboarding";
import { onboardingErrorResponse, readJsonBody, validationErrorResponse } from "@/lib/organizations/onboarding-http";
import { validateInviteRequest } from "@/lib/organizations/onboarding-rules";

type Ctx = { params: Promise<{ orgId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const v = validateInviteRequest(parsed.body);
  if (!v.ok) return validationErrorResponse(v.errors);
  try {
    const invites = await createOrgInvites(orgId, v.value, auth.user.id);
    return NextResponse.json({ invites, registerPath: "/register" }, { status: 201 });
  } catch (err) {
    return onboardingErrorResponse(err, "invites");
  }
}
