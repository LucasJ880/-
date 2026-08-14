/**
 * Autopilot 指标定义（A0：字段标准 + 事件来源 + 计算公式）。
 * 不在本阶段计算全部指标；未就绪的必须标 DATA NOT AVAILABLE YET。
 */

import type { AutopilotMetricKey } from "./types";

export type AutopilotMetricDefinition = {
  key: AutopilotMetricKey;
  label: string;
  description: string;
  unit: "count" | "rate" | "milliseconds" | "tokens" | "currency";
  /** 计算所需的事件 / 字段 */
  sources: string[];
  formula: string;
  /** A0 是否尝试实算 */
  a0Compute: boolean;
};

export const AUTOPILOT_METRIC_DEFINITIONS: readonly AutopilotMetricDefinition[] =
  [
    {
      key: "runCount",
      label: "Run count",
      description: "时间窗内 AgentRun 数量",
      unit: "count",
      sources: ["AgentRun.createdAt"],
      formula: "COUNT(AgentRun WHERE createdAt IN window)",
      a0Compute: true,
    },
    {
      key: "taskSuccessRate",
      label: "Task success rate",
      description: "outcome = TASK_SUCCESS 的比例。A0 不把 status=completed 当成任务成功。",
      unit: "rate",
      sources: ["AutopilotRun.outcome"],
      formula: "COUNT(outcome=TASK_SUCCESS) / COUNT(runs with terminal outcome)",
      a0Compute: false,
    },
    {
      key: "partialSuccessRate",
      label: "Partial success rate",
      description: "outcome = PARTIAL_SUCCESS 的比例",
      unit: "rate",
      sources: ["AutopilotRun.outcome"],
      formula: "COUNT(outcome=PARTIAL_SUCCESS) / COUNT(terminal runs)",
      a0Compute: false,
    },
    {
      key: "failureRate",
      label: "Failure rate",
      description: "outcome = FAILURE 的比例",
      unit: "rate",
      sources: ["AutopilotRun.outcome", "AgentRun.status=failed"],
      formula: "COUNT(outcome=FAILURE) / COUNT(terminal runs)",
      a0Compute: false,
    },
    {
      key: "humanOverrideRate",
      label: "Human override rate",
      description: "人否决/改选 AI 建议的比例",
      unit: "rate",
      sources: ["AutopilotRun.humanOverride", "PendingAction status", "HUMAN_OVERRIDE events"],
      formula: "COUNT(humanOverride=true) / COUNT(runs with a recommendation)",
      a0Compute: false,
    },
    {
      key: "humanEditRate",
      label: "Human edit rate",
      description: "人对 AI 输出做编辑的比例",
      unit: "rate",
      sources: ["AutopilotRun.humanEdit", "HUMAN_EDIT events", "job.human_edited"],
      formula: "COUNT(humanEdit=true) / COUNT(runs with agent output)",
      a0Compute: false,
    },
    {
      key: "reAskRate",
      label: "Re-ask rate",
      description: "用户对同一需求再次解释的比例。A0 无语义检测器。",
      unit: "rate",
      sources: ["AutopilotRun.reAskStatus", "RE_ASK_SIGNAL"],
      formula: "COUNT(reAskStatus IN CANDIDATE|CONFIRMED) / COUNT(runs)",
      a0Compute: false,
    },
    {
      key: "toolFailureRate",
      label: "Tool failure rate",
      description: "工具调用失败次数 / 工具调用总次数",
      unit: "rate",
      sources: ["TOOL_CALL_FAILED", "TOOL_CALL_COMPLETED", "AgentRunEvent tool.failed"],
      formula: "toolFailures / (toolFailures + toolSuccesses)",
      a0Compute: false,
    },
    {
      key: "retrievalFailureRate",
      label: "Retrieval failure rate",
      description: "检索失败比例。A0 事件源尚未统一写入。",
      unit: "rate",
      sources: ["RETRIEVAL_STARTED", "RETRIEVAL_COMPLETED"],
      formula: "retrievalFailures / retrievalAttempts",
      a0Compute: false,
    },
    {
      key: "avgLatency",
      label: "Average latency",
      description: "AgentRun.latencyMs 算术平均（仅已有 latency 的 run）",
      unit: "milliseconds",
      sources: ["AgentRun.latencyMs"],
      formula: "AVG(latencyMs) WHERE latencyMs IS NOT NULL",
      a0Compute: true,
    },
    {
      key: "p50Latency",
      label: "P50 latency",
      description: "latencyMs 第 50 百分位",
      unit: "milliseconds",
      sources: ["AgentRun.latencyMs"],
      formula: "PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latencyMs)",
      a0Compute: false,
    },
    {
      key: "p95Latency",
      label: "P95 latency",
      description: "latencyMs 第 95 百分位",
      unit: "milliseconds",
      sources: ["AgentRun.latencyMs"],
      formula: "PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latencyMs)",
      a0Compute: false,
    },
    {
      key: "tokenUsage",
      label: "Token usage",
      description: "AiUsageLedger input+output tokens；按 runId/traceId 关联",
      unit: "tokens",
      sources: ["AiUsageLedger.inputTokens", "AiUsageLedger.outputTokens"],
      formula: "SUM(inputTokens + outputTokens)",
      a0Compute: false,
    },
    {
      key: "estimatedCost",
      label: "Estimated cost",
      description: "AiUsageLedger.costAmount 合计",
      unit: "currency",
      sources: ["AiUsageLedger.costAmount"],
      formula: "SUM(costAmount)",
      a0Compute: false,
    },
  ];

export function getAutopilotMetricDefinition(
  key: AutopilotMetricKey,
): AutopilotMetricDefinition | undefined {
  return AUTOPILOT_METRIC_DEFINITIONS.find((d) => d.key === key);
}
