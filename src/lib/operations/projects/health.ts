/**
 * 执行项目健康度（服务端实时计算，非 DB 字段）
 *
 * 优先级：completed > blocked > at_risk > attention > healthy
 */

import {
  isDeliveryStageComplete,
  isDeliveryStageOnHold,
  normalizeDeliveryStage,
} from "./stage";

export const DELIVERY_HEALTH_STATUSES = [
  "healthy",
  "attention",
  "at_risk",
  "blocked",
  "completed",
] as const;

export type DeliveryHealthStatus = (typeof DELIVERY_HEALTH_STATUSES)[number];

/** 长期无更新天数（集中配置） */
export const DELIVERY_STALE_UPDATE_DAYS = 14;

/** 计划完成日前多少天进入 attention（仍有开放任务） */
export const DELIVERY_DUE_SOON_DAYS = 7;

export const DELIVERY_HEALTH_LABELS: Record<DeliveryHealthStatus, string> = {
  healthy: "健康",
  attention: "需关注",
  at_risk: "有风险",
  blocked: "阻塞",
  completed: "已完成",
};

export type DeliveryHealthTaskSignal = {
  status: string;
  dueDate?: Date | null;
  waitingUntil?: Date | null;
};

export type DeliveryHealthInput = {
  deliveryStage: string | null | undefined;
  ownerId?: string | null;
  plannedCompletionDate?: Date | null;
  updatedAt?: Date | null;
  openTasks?: readonly DeliveryHealthTaskSignal[];
  now?: Date;
};

export type DeliveryHealthResult = {
  status: DeliveryHealthStatus;
  reasons: string[];
  primaryRisk: string | null;
};

function isOpenTaskStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return (
    s !== "done" &&
    s !== "cancelled" &&
    s !== "completed"
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function computeDeliveryHealth(
  input: DeliveryHealthInput,
): DeliveryHealthResult {
  const now = input.now ?? new Date();
  const today = startOfDay(now);
  const reasons: string[] = [];
  const openTasks = (input.openTasks ?? []).filter((t) =>
    isOpenTaskStatus(t.status),
  );

  if (isDeliveryStageComplete(input.deliveryStage)) {
    return {
      status: "completed",
      reasons: ["交付阶段为已完成"],
      primaryRisk: null,
    };
  }

  // cancelled 不计为活跃；健康度不映射为 completed
  if (normalizeDeliveryStage(input.deliveryStage) === "cancelled") {
    return {
      status: "attention",
      reasons: ["项目已取消"],
      primaryRisk: "已取消",
    };
  }

  const hasBlocked = openTasks.some(
    (t) => t.status.trim().toLowerCase() === "blocked",
  );
  if (isDeliveryStageOnHold(input.deliveryStage) || hasBlocked) {
    if (isDeliveryStageOnHold(input.deliveryStage)) {
      reasons.push("项目已暂停");
    }
    if (hasBlocked) reasons.push("存在阻塞任务");
    return {
      status: "blocked",
      reasons,
      primaryRisk: reasons[0] ?? "阻塞",
    };
  }

  const planned = input.plannedCompletionDate
    ? startOfDay(input.plannedCompletionDate)
    : null;
  if (planned && planned.getTime() < today.getTime()) {
    reasons.push("计划完成日期已过");
  }

  const overdueTasks = openTasks.filter(
    (t) => t.dueDate && startOfDay(t.dueDate).getTime() < today.getTime(),
  );
  if (overdueTasks.length) {
    reasons.push(`存在 ${overdueTasks.length} 个逾期开放任务`);
  }

  const waitingDue = openTasks.filter((t) => {
    const s = t.status.trim().toLowerCase();
    if (s !== "waiting_external" && s !== "waiting_internal") return false;
    return Boolean(t.waitingUntil && t.waitingUntil.getTime() <= now.getTime());
  });
  if (waitingDue.length) {
    reasons.push("存在等待截止已到期的任务");
  }

  if (reasons.length) {
    return {
      status: "at_risk",
      reasons,
      primaryRisk: reasons[0] ?? "有风险",
    };
  }

  const attentionReasons: string[] = [];
  if (!input.ownerId) attentionReasons.push("没有负责人");
  if (!planned) attentionReasons.push("没有计划完成日期");

  const waitingOpen = openTasks.filter((t) => {
    const s = t.status.trim().toLowerCase();
    return s === "waiting_external" || s === "waiting_internal";
  });
  if (waitingOpen.length) {
    attentionReasons.push("存在等待中的任务");
  }

  if (planned && openTasks.length) {
    const soon = new Date(today);
    soon.setDate(soon.getDate() + DELIVERY_DUE_SOON_DAYS);
    if (
      planned.getTime() >= today.getTime() &&
      planned.getTime() <= soon.getTime()
    ) {
      attentionReasons.push("七天内即将到达计划完成日期且仍有开放任务");
    }
  }

  if (input.updatedAt) {
    const staleMs = DELIVERY_STALE_UPDATE_DAYS * 86_400_000;
    if (now.getTime() - input.updatedAt.getTime() > staleMs) {
      attentionReasons.push(
        `${DELIVERY_STALE_UPDATE_DAYS} 天内没有更新`,
      );
    }
  }

  if (attentionReasons.length) {
    return {
      status: "attention",
      reasons: attentionReasons,
      primaryRisk: attentionReasons[0] ?? "需关注",
    };
  }

  return {
    status: "healthy",
    reasons: [],
    primaryRisk: null,
  };
}

export function deliveryHealthLabel(status: DeliveryHealthStatus): string {
  return DELIVERY_HEALTH_LABELS[status];
}

/** 列表排序权重：blocked > at_risk > attention > healthy > completed */
export function deliveryHealthSortRank(status: DeliveryHealthStatus): number {
  switch (status) {
    case "blocked":
      return 0;
    case "at_risk":
      return 1;
    case "attention":
      return 2;
    case "healthy":
      return 3;
    case "completed":
      return 4;
    default:
      return 9;
  }
}
