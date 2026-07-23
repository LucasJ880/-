/**
 * POST /api/ai/threads/[threadId]/runs/[runId]/retry
 * Phase 3B-A Commit 6：仅安全重试（Prepare 失败、无 PA）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveAssistantOrgId } from "@/lib/assistant/thread-org";
import { retryAssistantRun } from "@/lib/assistant/retry-run";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";

const RETRY_RATE_LIMIT = {
  name: "ai-run-retry",
  windowMs: 60_000,
  maxRequests: 10,
};

export const POST = withAuth(async (request, ctx, user) => {
  const { threadId, runId } = await ctx.params;

  const orgRes = await resolveAssistantOrgId(request, user, null);
  if (!orgRes.ok) return orgRes.response;

  const rl = await checkRateLimitAsync(
    RETRY_RATE_LIMIT,
    `${orgRes.orgId}:${user.id}`,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const result = await retryAssistantRun({
    orgId: orgRes.orgId,
    userId: user.id,
    role: user.role,
    threadId,
    runId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: result.status },
    );
  }

  // prepareAssistantDispatch / 幂等缓存返回的是标准 Response；包装为 NextResponse
  return new NextResponse(result.response.body, {
    status: result.response.status,
    headers: result.response.headers,
  });
});
