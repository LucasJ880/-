/**
 * POST /api/admin/onboarding/[orgId]/website-channel — 建 / 复用网站询盘通道（平台管理员专用）
 * 复用外贸渠道页同一条创建路径（upsertWebsiteChannel：重复调用沿用旧密钥）。
 * 只返回本企业 website 通道自己的密钥，不读取、不返回其他通道的凭证。
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { ensureOnboardingWebsiteChannel } from "@/lib/organizations/onboarding";
import { onboardingErrorResponse, readJsonBody } from "@/lib/organizations/onboarding-http";

type Ctx = { params: Promise<{ orgId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const name = typeof (parsed.body as { name?: unknown })?.name === "string" ? (parsed.body as { name: string }).name : null;
  try {
    const out = await ensureOnboardingWebsiteChannel(orgId, auth.user.id, name);
    return NextResponse.json(
      {
        created: out.created,
        channel: out.channel,
        secret: out.secret,
        endpointPath: "/api/trade/webhook/website",
        header: "x-qingyan-webhook-secret",
      },
      { status: out.created ? 201 : 200 },
    );
  } catch (err) {
    return onboardingErrorResponse(err, "website-channel");
  }
}
