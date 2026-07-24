import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import type { AgentRunEventType } from "@/lib/agent-runtime/types";
import type { RuntimeV2EventType } from "./schemas";

export async function emitRuntimeV2Event(input: {
  orgId: string;
  runId: string;
  eventType: RuntimeV2EventType | AgentRunEventType;
  title?: string;
  payload?: Record<string, unknown>;
  visibleToUser?: boolean;
}) {
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: input.eventType as AgentRunEventType,
    title: input.title,
    payload: input.payload,
    visibleToUser: input.visibleToUser ?? true,
  });
}

export function userFacingRunLabel(status: string): string {
  switch (status) {
    case "planning":
      return "正在理解目标";
    case "planned":
      return "正在制定计划";
    case "executing":
    case "running":
      return "正在读取客户和报价";
    case "awaiting_approval":
      return "等待你确认动作";
    case "verifying":
      return "正在验证执行结果";
    case "repairing":
      return "发现未完成项，正在修复";
    case "completed":
      return "任务已完成";
    case "partially_executed":
      return "部分完成";
    case "needs_human":
      return "需要人工处理";
    case "failed":
      return "任务失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}
