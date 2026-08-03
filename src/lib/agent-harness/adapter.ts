/**
 * Harness Adapter — 唯一执行引擎仍是 agent-core.runAgent
 */

import { runAgent, AgentTimeoutError } from "@/lib/agent-core/engine";
import type { AgentRunOptions, AgentRunResult } from "@/lib/agent-core/types";
import {
  assertToolArgsDoNotOverrideScope,
  scopeToToolContextFields,
  writeQmAuditEvent,
  type ScopeContext,
} from "@/lib/scope";
import type { HarnessInput, HarnessOutput } from "./types";

export type HarnessRunDeps = {
  runAgentFn?: (options: AgentRunOptions) => Promise<AgentRunResult>;
  audit?: boolean;
};

function mergeSystemPrompt(input: HarnessInput): string {
  const roleBlock = input.agentRoleDefinition?.instructions?.trim();
  if (!roleBlock) return input.systemPrompt;
  return `${input.systemPrompt}\n\n## Role\n${roleBlock}`;
}

function classifyFromResult(result: AgentRunResult): {
  ok: boolean;
  errorClass: HarnessOutput["errorClass"];
  finishReason: HarnessOutput["finishReason"];
  message?: string;
} {
  if (result.timedOut || result.finishReason === "timeout" || result.errorClass === "timeout") {
    return {
      ok: false,
      errorClass: "timeout",
      finishReason: "timeout",
      message: result.errorMessage ?? result.content,
    };
  }
  if (result.ok === false || result.finishReason === "error") {
    const msg = result.errorMessage ?? result.content ?? "runtime failure";
    const lower = msg.toLowerCase();
    const provider =
      lower.includes("openai") || lower.includes("provider") || lower.includes("api key");
    return {
      ok: false,
      errorClass: provider ? "provider_error" : (result.errorClass as HarnessOutput["errorClass"]) || "unknown",
      finishReason: result.finishReason === "aborted" ? "aborted" : "error",
      message: msg,
    };
  }
  return { ok: true, errorClass: "none", finishReason: "completed" };
}

function classifyError(err: unknown): {
  errorClass: HarnessOutput["errorClass"];
  finishReason: HarnessOutput["finishReason"];
  message: string;
} {
  if (err instanceof AgentTimeoutError) {
    return {
      errorClass: "timeout",
      finishReason: "timeout",
      message: err.message,
    };
  }
  if (err instanceof Error && err.name === "AbortError") {
    return {
      errorClass: "aborted",
      finishReason: "aborted",
      message: err.message,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("openai") || lower.includes("provider") || lower.includes("api key")) {
    return {
      errorClass: "provider_error",
      finishReason: "error",
      message: msg,
    };
  }
  return { errorClass: "unknown", finishReason: "error", message: msg };
}

/**
 * 通过 Harness 调用现有 OpenAI Runtime。
 * 不自行执行高风险副作用；maxRisk / forceApproval 由底层 registry 执行前闸处理。
 */
export async function runWithHarness(
  input: HarnessInput,
  deps?: HarnessRunDeps,
): Promise<HarnessOutput> {
  const started = Date.now();
  const scope: ScopeContext = input.scope;
  const runFn = deps?.runAgentFn ?? runAgent;
  const deniedTools: HarnessOutput["deniedTools"] = [];

  const allowed = [...new Set(input.allowedTools)];
  const toolFields = scopeToToolContextFields(scope);

  try {
    const cleanAllowed = allowed.filter((n) => n.trim());
    for (const name of allowed) {
      if (!name.trim()) {
        deniedTools.push({ name: name || "(empty)", reason: "invalid_tool_name" });
      }
    }

    const result = await runFn({
      systemPrompt: mergeSystemPrompt(input),
      messages: input.messages,
      // 关键：始终传数组（含 []），使 registry 将空列表视为零工具
      tools: cleanAllowed,
      userId: toolFields.userId,
      orgId: toolFields.orgId,
      orgRole: toolFields.orgRole,
      hasMembership: toolFields.hasMembership,
      workspaceIds: toolFields.workspaceIds,
      sessionId: input.sessionId,
      agentRunId: input.agentRunId,
      modulesJson: input.modulesJson,
      mode: input.model.mode,
      model: input.model.model,
      reasoningEffort: input.model.reasoningEffort,
      maxToolRounds: input.limits?.maxToolRounds,
      perRoundTimeoutMs: input.limits?.perRoundTimeoutMs,
      totalTimeoutMs: input.limits?.totalTimeoutMs,
      temperature: input.limits?.temperature,
      maxTokens: input.limits?.maxTokens,
      maxRisk: input.approvalPolicy.maxDirectRisk,
      toolPolicy: {
        forceApprovalTools: input.approvalPolicy.forceApprovalTools,
      },
      scopeGuard: {
        orgId: scope.orgId,
        principalUserId: scope.principalUserId,
        projectId: scope.projectId,
      },
      hooks: {
        onToolCall: (info) => {
          // 仅观测：安全边界已在 execute 前
          if (!info.result.success) {
            deniedTools.push({
              name: info.name,
              reason: info.result.error ?? "tool_failed",
            });
          }
          try {
            assertToolArgsDoNotOverrideScope(scope, info.args);
          } catch (err) {
            deniedTools.push({
              name: info.name,
              reason: err instanceof Error ? err.message : "scope_override",
            });
          }
        },
      },
    });

    const classified = classifyFromResult(result);

    const proposals: HarnessOutput["pendingActionProposals"] = [];
    for (const tc of result.toolCalls) {
      const data = tc.result?.data;
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).pendingActionProposal &&
        typeof (data as Record<string, unknown>).pendingActionProposal === "object"
      ) {
        const p = (data as Record<string, unknown>).pendingActionProposal as Record<
          string,
          unknown
        >;
        if (typeof p.type === "string" && typeof p.title === "string") {
          proposals.push({
            type: p.type,
            title: p.title,
            preview: typeof p.preview === "string" ? p.preview : p.title,
            payload:
              p.payload && typeof p.payload === "object" && !Array.isArray(p.payload)
                ? (p.payload as Record<string, unknown>)
                : {},
            idempotencyKey:
              typeof p.idempotencyKey === "string" ? p.idempotencyKey : undefined,
          });
        }
      }
      // createDraft 返回的 pending 结果
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (data as Record<string, unknown>).pendingActionId
      ) {
        proposals.push({
          type: String((data as Record<string, unknown>).type ?? "pending"),
          title: String((data as Record<string, unknown>).title ?? "待审批"),
          preview: String((data as Record<string, unknown>).preview ?? ""),
          payload: data as Record<string, unknown>,
        });
      }
    }

    if (!classified.ok) {
      if (deps?.audit !== false) {
        await writeQmAuditEvent({
          event: "scope.harness_failure",
          orgId: scope.orgId,
          userId: scope.principalUserId,
          projectId: scope.projectId,
          correlationId: scope.correlationId,
          servicePrincipal: scope.servicePrincipal,
          actorType: scope.servicePrincipal ? "service" : "human",
          reason: classified.errorClass,
          meta: { message: (classified.message ?? "").slice(0, 200) },
        });
      }
      return {
        ok: false,
        structuredResult: { content: result.content, rounds: result.rounds },
        requestedToolCalls: result.toolCalls,
        deniedTools,
        pendingActionProposals: proposals,
        model: result.model,
        provider: "openai",
        latencyMs: Date.now() - started,
        finishReason: classified.finishReason,
        correlationId: scope.correlationId,
        causationId: scope.causationId,
        errorClass: classified.errorClass,
        errorMessage: classified.message,
        legacy: result,
      };
    }

    return {
      ok: true,
      structuredResult: { content: result.content, rounds: result.rounds },
      requestedToolCalls: result.toolCalls,
      deniedTools,
      pendingActionProposals: proposals,
      model: result.model,
      provider: "openai",
      latencyMs: Date.now() - started,
      finishReason: "completed",
      correlationId: scope.correlationId,
      causationId: scope.causationId,
      errorClass: "none",
      legacy: result,
    };
  } catch (err) {
    const classified = classifyError(err);
    if (deps?.audit !== false) {
      await writeQmAuditEvent({
        event: "scope.harness_failure",
        orgId: scope.orgId,
        userId: scope.principalUserId,
        projectId: scope.projectId,
        correlationId: scope.correlationId,
        servicePrincipal: scope.servicePrincipal,
        actorType: scope.servicePrincipal ? "service" : "human",
        reason: classified.errorClass,
        meta: { message: classified.message.slice(0, 200) },
      });
    }
    return {
      ok: false,
      structuredResult: { content: "", rounds: 0 },
      requestedToolCalls: [],
      deniedTools,
      pendingActionProposals: [],
      model: input.model.model ?? "unknown",
      provider: "openai",
      latencyMs: Date.now() - started,
      finishReason: classified.finishReason,
      correlationId: scope.correlationId,
      causationId: scope.causationId,
      errorClass: classified.errorClass,
      errorMessage: classified.message,
    };
  }
}

/**
 * 计算有效工具 allowlist：调用方权限 ∩ Skill/Agent 声明 ∩ 显式请求
 * （取交集，永不并集扩大）
 */
export function intersectToolAllowlists(
  ...lists: Array<string[] | undefined | null>
): string[] {
  const nonEmpty = lists.filter((l): l is string[] => Array.isArray(l));
  if (nonEmpty.length === 0) return [];
  let acc = new Set(nonEmpty[0]);
  for (let i = 1; i < nonEmpty.length; i++) {
    const next = new Set(nonEmpty[i]);
    acc = new Set([...acc].filter((x) => next.has(x)));
  }
  return [...acc];
}
