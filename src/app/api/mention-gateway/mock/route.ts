/**
 * POST /api/mention-gateway/mock — Mention Gateway M1 Mock 入口
 *
 * 门禁（全部 fail-closed）：
 * - MENTION_GATEWAY_MOCK_ENABLED=1 且非生产运行时（production 恒拒，flag 无法覆盖）
 * - MENTION_GATEWAY_ENABLED=1
 * - 已登录（withAuth）；非平台管理员只能以「自己」的外部身份触发（防冒充）
 * - 按用户限流 20/min
 *
 * 不是公开 webhook：无匿名调用；不签发任何外部消息。
 *
 * body 示例：
 *   { "eventId": "evt-001", "messageId": "msg-001", "externalUserId": "mock-user-1",
 *     "channelId": "mock-project-1", "threadId": "thread-1",
 *     "text": "@Qingyan what needs attention today?" }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { isPlatformAdmin } from "@/lib/rbac/platform-admin";
import {
  isMentionGatewayEnabled,
  isMentionMockEnabled,
} from "@/lib/mention-gateway/flags";
import { loadMockFixturesFromEnv } from "@/lib/mention-gateway/fixtures";
import { getDefaultMockChannelAdapter } from "@/lib/mention-gateway/adapters/mock";
import { handleMentionEvent } from "@/lib/mention-gateway/handle";
import type { MentionGatewayErrorCode } from "@/lib/mention-gateway/types";

export const maxDuration = 120;

const RATE_LIMIT = {
  name: "mention-gateway-mock",
  windowMs: 60_000,
  maxRequests: 20,
} as const;

function httpStatusFor(code: MentionGatewayErrorCode): number {
  switch (code) {
    case "GATEWAY_DISABLED":
    case "MOCK_DISABLED":
    case "AUDIENCE_DENIED":
    case "IDENTITY_OR_MEMBERSHIP_DENIED":
    case "CHANNEL_ORG_MISMATCH":
    case "SCOPE_DENIED":
      return 403;
    case "INVALID_EVENT":
      return 400;
    case "CONTEXT_UNRESOLVED":
      return 422;
    case "NOT_MENTIONED":
    case "DUPLICATE_EVENT":
      return 200;
    default:
      return 500;
  }
}

export const POST = withAuth(async (request, _ctx, user) => {
  // 环境 + flag 门禁先于一切（生产恒拒）
  if (!isMentionMockEnabled()) {
    return NextResponse.json(
      { status: "rejected", error: "MOCK_DISABLED" },
      { status: 403 },
    );
  }
  if (!isMentionGatewayEnabled()) {
    return NextResponse.json(
      { status: "rejected", error: "GATEWAY_DISABLED" },
      { status: 403 },
    );
  }

  const rl = await checkRateLimitAsync(RATE_LIMIT, user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { status: "rejected", error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { status: "rejected", error: "INVALID_EVENT" },
      { status: 400 },
    );
  }

  loadMockFixturesFromEnv();

  const result = await handleMentionEvent({
    raw: body,
    adapter: getDefaultMockChannelAdapter(),
    caller: { userId: user.id, isPlatformAdmin: isPlatformAdmin(user.role) },
    abortSignal: request.signal,
  });

  if (result.ok) {
    return NextResponse.json({
      status: result.status,
      runId: result.runId,
      sessionId: result.sessionId,
      context: result.context,
      response: result.response,
      audience: result.audience,
      delivered: result.delivered,
      toolCalls: result.toolCalls,
      maxRisk: result.maxRisk,
    });
  }

  // 错误不泄漏：只回 code + 安全文案（+ runId / delivered，便于工作台追踪）
  return NextResponse.json(
    {
      status: result.status,
      error: result.code,
      message: result.message,
      ...(result.runId ? { runId: result.runId } : {}),
      ...(result.delivered !== undefined ? { delivered: result.delivered } : {}),
    },
    { status: httpStatusFor(result.code) },
  );
});
