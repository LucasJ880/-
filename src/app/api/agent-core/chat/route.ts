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
import { runAgent } from "@/lib/agent-core";
import type { CoreMessage, ToolDomain, AgentRunOptions } from "@/lib/agent-core";

const DEFAULT_SYSTEM_PROMPT = `你是「青砚」AI 工作助理，帮助用户管理工作、外贸获客、项目跟进。
用简洁中文回复。如果需要数据，直接调用工具查询。
给出具体可执行的建议。`;

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages 为必填数组" }, { status: 400 });
  }

  const messages: CoreMessage[] = body.messages.map((m: { role: string; content: string }) => ({
    role: m.role as CoreMessage["role"],
    content: m.content,
  }));

  const orgId = body.orgId ?? "default";
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
