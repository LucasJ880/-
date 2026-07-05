/**
 * Agent Core — 统一观测持久化（A-P0）
 *
 * engine 的 hooks 是纯回调；这里提供两个现成实现：
 * - buildSkillExecutionHooks：run 结束写一条 SkillExecution（技能型入口用）
 * - persistToolCallTraces：把 run 的 toolCalls 批量写 ToolCallTrace
 *   （项目会话 adapter 在 Message 落库后调用，A-P1 使用）
 *
 * 两者都吞掉自身错误（fire-and-forget 语义由 engine 统一保证，
 * 这里再兜一层，保证被直接调用时也不影响主链路）。
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/common/logger";
import type { AgentRunHooks, AgentRunResult } from "./types";

const TEXT_LIMIT = 50_000;

function clip(s: string, limit = TEXT_LIMIT): string {
  return s.length > limit ? s.slice(0, limit) : s;
}

/**
 * 构造「run 结束写 SkillExecution」的 hooks。
 * 与 recordAiCall（进程内指标）并行，互不替代。
 */
export function buildSkillExecutionHooks(params: {
  skillId: string;
  userId: string;
  /** 记录到 inputJson 的执行入参（会被 JSON.stringify） */
  input: unknown;
  /** 执行时使用的 prompt 快照（可选） */
  promptSnapshot?: string;
}): AgentRunHooks {
  return {
    onFinish: async (info) => {
      try {
        await db.skillExecution.create({
          data: {
            skillId: params.skillId,
            userId: params.userId,
            inputJson: clip(JSON.stringify(params.input ?? {})),
            outputJson: clip(JSON.stringify({ content: info.content, model: info.model, rounds: info.rounds })),
            toolCalls: info.toolCalls.length
              ? (JSON.parse(
                  clip(
                    JSON.stringify(
                      info.toolCalls.map((tc) => ({
                        name: tc.name,
                        args: tc.args,
                        success: tc.result.success,
                      })),
                    ),
                  ),
                ) as object)
              : undefined,
            success: info.success,
            durationMs: info.latencyMs,
            promptSnapshot: params.promptSnapshot ? clip(params.promptSnapshot) : undefined,
          },
        });
      } catch (err) {
        logger.warn("agent_core.observability.skill_execution_failed", {
          skillId: params.skillId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * 把一次 run 的 toolCalls 批量写为 ToolCallTrace。
 * 项目会话链路在 assistant Message 落库拿到 messageId 后调用（A-P1）。
 */
export async function persistToolCallTraces(params: {
  projectId: string;
  environmentId: string;
  conversationId: string;
  messageId: string;
  agentId?: string | null;
  toolCalls: AgentRunResult["toolCalls"];
  /** 每次调用的耗时（与 toolCalls 同序，可缺省） */
  durationsMs?: number[];
}): Promise<void> {
  if (params.toolCalls.length === 0) return;
  try {
    await db.toolCallTrace.createMany({
      data: params.toolCalls.map((tc, i) => ({
        projectId: params.projectId,
        environmentId: params.environmentId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        agentId: params.agentId ?? null,
        toolKey: tc.name,
        toolName: tc.name,
        inputJson: clip(JSON.stringify(tc.args ?? {})),
        outputJson: clip(JSON.stringify(tc.result.data ?? null)),
        status: tc.result.success ? "success" : "error",
        errorMessage: tc.result.success ? null : (tc.result.error ?? "工具执行失败"),
        durationMs: params.durationsMs?.[i] ?? 0,
      })),
    });
  } catch (err) {
    logger.warn("agent_core.observability.tool_trace_failed", {
      conversationId: params.conversationId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
