/**
 * POST /api/ai/threads/[threadId]/runs/[runId]/cancel
 * DURABLE_FOLLOWUP_M1：用户主动取消客户跟进持久任务。
 *
 * 与"关闭页面 / 网络断开"严格区分：只有这里会取消任务。归属校验（组织 + 本人线程 +
 * 发起人 + 契约）全部在服务端完成后复用既有 cancelAgentRun——同时拒绝仍待确认的动作；
 * 已发生的副作用不回滚、在任务卡片中如实展示。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveAssistantOrgId } from "@/lib/assistant/thread-org";
import { cancelDurableFollowupRun } from "@/lib/assistant/followup-task";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { assertNonProdSideEffectsAllowed } from "@/lib/env/runtime-isolation";
import type { NextRequest } from "next/server";

const CANCEL_RATE_LIMIT = {
  name: "ai-run-cancel",
  windowMs: 60_000,
  maxRequests: 20,
};

const authenticatedPost = withAuth(async (request, ctx, user) => {
  const { threadId, runId } = await ctx.params;

  const orgRes = await resolveAssistantOrgId(request, user, null);
  if (!orgRes.ok) return orgRes.response;

  const rl = await checkRateLimitAsync(CANCEL_RATE_LIMIT, `${orgRes.orgId}:${user.id}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const result = await cancelDurableFollowupRun({
    orgId: orgRes.orgId,
    userId: user.id,
    threadId,
    runId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.code === "NOT_FOUND" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true, run: result.run });
});

/** 写入口：隔离检查先于鉴权 / DB（与 pending-actions 决策入口同一纪律） */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ threadId: string; runId: string }> },
) {
  const isolationBlock = assertNonProdSideEffectsAllowed("write");
  if (isolationBlock) return isolationBlock;
  return authenticatedPost(request, ctx);
}
