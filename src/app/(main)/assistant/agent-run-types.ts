/** 主 Agent 执行步骤（前端时间线，由 SSE 累积） */
export type AgentStepKind = "think" | "dispatch" | "tool" | "approve" | "reply";

export type AgentStepStatus = "pending" | "running" | "done" | "error";

export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  label: string;
  status: AgentStepStatus;
  /** 工具原始名，便于配对 tool_result */
  toolName?: string;
  detail?: string;
  startedAt?: number;
  endedAt?: number;
}

export function createThinkStep(): AgentStep {
  return {
    id: `think-${Date.now()}`,
    kind: "think",
    label: "理解你的需求",
    status: "running",
    startedAt: Date.now(),
  };
}

export function upsertToolStart(
  steps: AgentStep[],
  toolName: string,
  label: string
): AgentStep[] {
  const next = steps.map((s) =>
    s.status === "running" && (s.kind === "think" || s.kind === "dispatch")
      ? { ...s, status: "done" as const, endedAt: Date.now() }
      : s
  );

  const hasDispatch = next.some((s) => s.kind === "dispatch");
  const withDispatch = hasDispatch
    ? next
    : [
        ...next,
        {
          id: `dispatch-${Date.now()}`,
          kind: "dispatch" as const,
          label: "主助手开始分发任务",
          status: "done" as const,
          startedAt: Date.now(),
          endedAt: Date.now(),
        },
      ];

  return [
    ...withDispatch,
    {
      id: `tool-${toolName}-${Date.now()}`,
      kind: "tool",
      label,
      toolName,
      status: "running",
      startedAt: Date.now(),
    },
  ];
}

export function completeToolResult(
  steps: AgentStep[],
  toolName: string,
  ok: boolean
): AgentStep[] {
  let matched = false;
  return steps.map((s) => {
    if (
      !matched &&
      s.kind === "tool" &&
      s.status === "running" &&
      (!toolName || s.toolName === toolName)
    ) {
      matched = true;
      return {
        ...s,
        status: ok ? ("done" as const) : ("error" as const),
        endedAt: Date.now(),
        detail: ok ? undefined : "未成功，继续处理",
      };
    }
    return s;
  });
}

export function markReplying(steps: AgentStep[]): AgentStep[] {
  const closed = steps.map((s) =>
    s.status === "running"
      ? { ...s, status: "done" as const, endedAt: Date.now() }
      : s
  );
  if (closed.some((s) => s.kind === "reply")) return closed;
  return [
    ...closed,
    {
      id: `reply-${Date.now()}`,
      kind: "reply",
      label: "整理回复",
      status: "running",
      startedAt: Date.now(),
    },
  ];
}

export function finalizeSteps(steps: AgentStep[]): AgentStep[] {
  return steps.map((s) =>
    s.status === "running" || s.status === "pending"
      ? { ...s, status: "done" as const, endedAt: Date.now() }
      : s
  );
}
