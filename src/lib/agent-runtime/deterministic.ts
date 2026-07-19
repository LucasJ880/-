/**
 * 确定性命令 — 不调用大模型
 */

import {
  cancelAgentRun,
  findLatestActiveRun,
  getAgentRunStatus,
  listAgentRunEvents,
} from "./run";
import { ACTIVE_RUN_STATUSES } from "./types";

export type DeterministicResult =
  | { handled: true; reply: string; cancelledRunId?: string }
  | { handled: false };

const STATUS_WORDS = new Set([
  "状态",
  "进度",
  "做到哪了",
  "/status",
  "status",
]);

const CANCEL_RUN_WORDS = new Set([
  "停止",
  "不做了",
  "/cancel",
  "cancel",
  "stop",
]);

/** 纯「取消」留给 PendingAction；若有活动 Run 则优先取消 Run */
const CANCEL_AMBIGUOUS = new Set(["取消", "算了", "放弃"]);

export function matchStatusCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  return STATUS_WORDS.has(t) || STATUS_WORDS.has(text.trim());
}

export function matchCancelRunCommand(text: string): {
  match: boolean;
  preferPendingIfNoRun: boolean;
} {
  const raw = text.trim();
  const t = raw.toLowerCase();
  if (CANCEL_RUN_WORDS.has(t) || CANCEL_RUN_WORDS.has(raw)) {
    return { match: true, preferPendingIfNoRun: false };
  }
  if (CANCEL_AMBIGUOUS.has(t) || CANCEL_AMBIGUOUS.has(raw)) {
    return { match: true, preferPendingIfNoRun: true };
  }
  return { match: false, preferPendingIfNoRun: false };
}

export async function tryHandleDeterministicCommand(input: {
  orgId: string;
  sessionId: string;
  text: string;
  /** 当前消息对应的 Run，查询状态/取消时需排除 */
  currentRunId?: string;
}): Promise<DeterministicResult> {
  const text = (input.text || "").trim();
  if (!text) return { handled: false };

  if (matchStatusCommand(text)) {
    const active = await findLatestActiveRun({
      orgId: input.orgId,
      sessionId: input.sessionId,
      excludeRunId: input.currentRunId,
    });
    if (!active) {
      return {
        handled: true,
        reply: "当前没有进行中的任务。",
      };
    }
    const detail = await getAgentRunStatus(input.orgId, active.id);
    const lastEvent = detail?.events[0];
    const canCancel = ACTIVE_RUN_STATUSES.includes(
      active.status as (typeof ACTIVE_RUN_STATUSES)[number],
    );
    return {
      handled: true,
      reply: [
        `任务状态：${active.status}`,
        active.intent ? `意图：${active.intent}` : null,
        lastEvent
          ? `最近步骤：${lastEvent.title || lastEvent.eventType}`
          : null,
        active.status === "awaiting_approval" ? "等待你确认待审批动作。" : null,
        canCancel ? "可发送「停止」取消该任务。" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const cancel = matchCancelRunCommand(text);
  if (cancel.match) {
    const active = await findLatestActiveRun({
      orgId: input.orgId,
      sessionId: input.sessionId,
      excludeRunId: input.currentRunId,
    });
    if (active) {
      await cancelAgentRun(input.orgId, active.id);
      return {
        handled: true,
        reply: "已取消当前进行中的任务。已创建的待确认动作不会自动执行。",
        cancelledRunId: active.id,
      };
    }
    if (!cancel.preferPendingIfNoRun) {
      return { handled: true, reply: "当前没有可取消的任务。" };
    }
    // 交给现有 PendingAction「取消」逻辑
    return { handled: false };
  }

  return { handled: false };
}

export async function formatRunEventsBrief(
  orgId: string,
  runId: string,
): Promise<string> {
  const events = await listAgentRunEvents(orgId, runId);
  return events
    .filter((e) => e.visibleToUser)
    .slice(-5)
    .map((e) => `· ${e.title || e.eventType}`)
    .join("\n");
}
