/**
 * 将 Run 按 assistantMessageId / workSuggestion.runId 挂到消息
 * （刷新恢复用，禁止 runs[0]→最后一条）
 */

import type { AssistantRunStatusDto } from "@/lib/assistant/run-status-types";

function readWorkSuggestionRunId(workSuggestion: unknown): string | null {
  if (!workSuggestion || typeof workSuggestion !== "object") return null;
  const id = (workSuggestion as { runId?: unknown }).runId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function attachRunsToAssistantMessages<
  T extends { id: string; role: string; workSuggestion?: unknown },
>(
  messages: T[],
  runs: AssistantRunStatusDto[],
): Array<T & { assistantRun?: AssistantRunStatusDto }> {
  const byAssistantId = new Map(
    runs
      .filter((r) => typeof r.assistantMessageId === "string" && r.assistantMessageId)
      .map((r) => [r.assistantMessageId as string, r]),
  );
  const byRunId = new Map(runs.map((r) => [r.runId, r]));

  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    const runId = readWorkSuggestionRunId(m.workSuggestion);
    const linked =
      byAssistantId.get(m.id) ?? (runId ? byRunId.get(runId) : undefined);
    return linked ? { ...m, assistantRun: linked } : m;
  });
}
