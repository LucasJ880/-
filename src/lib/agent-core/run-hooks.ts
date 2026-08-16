/**
 * Agent run observation hooks.
 * Start/terminal tool observation is awaited so canonical AgentRunEvent +
 * same-TX outbox exist before the engine continues.
 * Hook failure must not change the tool business result.
 */

import { logger } from "@/lib/common/logger";
import type {
  AgentRunHooks,
  AgentToolCallInfo,
  AgentToolStartInfo,
} from "./types";

export async function fireToolStartHook(
  hooks: AgentRunHooks | undefined,
  info: AgentToolStartInfo,
): Promise<void> {
  if (!hooks?.onToolStart) return;
  try {
    await hooks.onToolStart(info);
  } catch (err) {
    logger.warn("agent_core.hook.tool_start_failed", {
      tool: info.name,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function fireToolCallHook(
  hooks: AgentRunHooks | undefined,
  info: AgentToolCallInfo,
): Promise<void> {
  if (!hooks?.onToolCall) return;
  try {
    await hooks.onToolCall(info);
  } catch (err) {
    logger.warn("agent_core.hook.tool_call_failed", {
      tool: info.name,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
