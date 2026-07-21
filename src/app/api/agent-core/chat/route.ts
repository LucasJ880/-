/**
 * POST /api/agent-core/chat
 *
 * 统一 Agent Core 对话端点。
 * 所有入口（全局助手、外贸、项目）可复用此 API。
 *
 * body:
 *   messages: { role: string; content: string }[]
 *   domains?: string[]     — 限制可用工具域（不传则全部可用）
 *   systemPrompt?: string  — 自定义系统提示词
 *   orgId?: string
 *   mode?: string          — chat / normal / deep / fast
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { checkRateLimitAsync } from "@/lib/common/rate-limit";
import { runAgent } from "@/lib/agent-core";
import type { CoreMessage, ToolDomain, AgentRunOptions } from "@/lib/agent-core";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { resolveAgentTenant } from "@/lib/tenancy/resolve-agent-tenant";
import { loadQuoteAutoSendRule } from "@/lib/org-rules/service";

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `你是「青砚」AI 工作助理，帮助用户管理工作、外贸获客、项目跟进。
用简洁中文回复。如果需要数据，直接调用工具查询。
给出具体可执行的建议。`;

const AGENT_CHAT_RATE_LIMIT = {
  name: "agent-core-chat",
  windowMs: 60_000,
  maxRequests: 20,
} as const;

export const POST = withAuth(async (request, _ctx, user) => {
  const rl = await checkRateLimitAsync(AGENT_CHAT_RATE_LIMIT, user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages 为必填数组" }, { status: 400 });
  }

  const messages: CoreMessage[] = body.messages.map((m: { role: string; content: string }) => ({
    role: m.role as CoreMessage["role"],
    content: m.content,
  }));

  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId as string | undefined);
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;
  const tenant = await resolveAgentTenant(user, orgId);
  if ("error" in tenant) {
    return NextResponse.json({ error: tenant.error }, { status: tenant.status });
  }
  if (!tenant.hasMembership) {
    return NextResponse.json(
      { error: "无企业成员身份，不能调用企业 Agent 工具" },
      { status: 403 },
    );
  }
  const autoSend = await loadQuoteAutoSendRule(orgId);
  const maxRisk = autoSend.value.allowDirectSend
    ? autoSend.value.sessionMaxRisk
    : "l2_soft";
  const domains = body.domains as ToolDomain[] | undefined;
  const systemPrompt = body.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const mode = (body.mode ?? "chat") as AgentRunOptions["mode"];

  try {
    const result = await runAgent({
      systemPrompt,
      messages,
      domains,
      mode,
      userId: user.id,
      orgId,
      role: user.role,
      orgRole: tenant.orgRole,
      hasMembership: tenant.hasMembership,
      modulesJson: tenant.modulesJson,
      workspaceIds: tenant.workspaceIds,
      toolPolicy: tenant.toolPolicy,
      maxRisk,
      abortSignal: request.signal,
    });

    return NextResponse.json({
      content: result.content,
      model: result.model,
      rounds: result.rounds,
      toolCalls: result.toolCalls.map((tc) => ({
        name: tc.name,
        args: tc.args,
        success: tc.result.success,
      })),
    });
  } catch (e) {
    console.error("[agent-core/chat] Error:", e);
    return NextResponse.json(
      { error: "AI 处理失败", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
});
