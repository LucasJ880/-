/**
 * POST /api/admin/onboarding/[orgId]/test-inquiry — 端到端测试询盘（平台管理员专用）
 * 合成询盘直接走 ingestWebsiteInquiry（收据 → 商机 → FDE 草稿 → 通知），随后系统取消草稿、关闭商机、
 * 归档测试买家，返回逐段结果。测试买家在保留域名 example.com，且带测试标记，发送执行器一律拒发。
 */

import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guards";
import { onboardingErrorResponse } from "@/lib/organizations/onboarding-http";
import { runOnboardingTestInquiry } from "@/lib/organizations/onboarding-test-inquiry";

export const runtime = "nodejs";
// 与网站询盘 webhook 同一条同步链（含 FDE 的 RFQ 抽取与草稿润色 LLM 调用）
export const maxDuration = 300;

type Ctx = { params: Promise<{ orgId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requirePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = await ctx.params;
  try {
    const result = await runOnboardingTestInquiry(orgId, auth.user.id);
    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    return onboardingErrorResponse(err, "test-inquiry");
  }
}
