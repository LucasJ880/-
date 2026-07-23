/**
 * 将 Run 按 assistantMessageId 挂到消息（刷新恢复用，禁止 runs[0]→最后一条）
 */

import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";

export function attachRunsToAssistantMessages<T extends { id: string; role: string }>(
  messages: T[],
  runs: AssistantRunStatusDto[],
): Array<T & { assistantRun?: AssistantRunStatusDto }> {
  const byAssistantId = new Map(
    runs
      .filter((r) => typeof r.assistantMessageId === "string" && r.assistantMessageId)
      .map((r) => [r.assistantMessageId as string, r]),
  );
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    const linked = byAssistantId.get(m.id);
    return linked ? { ...m, assistantRun: linked } : m;
  });
}
