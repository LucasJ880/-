/**
 * 自主决策引擎
 *
 * 将 AI 动作分为三个风险等级：
 * - low:    可自动执行，不需要用户确认（创建任务、生成草稿）
 * - medium: 需要用户一键确认（发送邮件、推进阶段）
 * - high:   必须人工审核（批量操作、删除、资金相关）
 *
 * 只有 low 级别的动作会在扫描时自动执行。
 * 自动执行的结果会记录在 AuditLog 中，并通知用户。
 */

import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import type { ProactiveSuggestion } from "./types";

// ── 风险分级注册表 ───────────────────────────────────────────────

export type ActionRiskLevel = "low" | "medium" | "high";

interface ActionDefinition {
  type: string;
  risk: ActionRiskLevel;
  label: string;
  description: string;
  autoExecutable: boolean;
}

export const ACTION_REGISTRY: ActionDefinition[] = [
  {
    type: "create_reminder_task",
    risk: "low",
    label: "创建提醒任务",
    description: "在截止日逼近时自动创建提醒任务",
    autoExecutable: true,
  },
  {
    type: "create_overdue_task",
    risk: "low",
    label: "创建逾期跟进任务",
    description: "任务逾期后自动创建跟进任务",
    autoExecutable: true,
  },
  {
    type: "send_followup_email",
    risk: "medium",
    label: "发送催促邮件",
    description: "向未回复的供应商发送催促邮件",
    autoExecutable: false,
  },
  {
    type: "advance_stage",
    risk: "medium",
    label: "推进项目阶段",
    description: "将项目推进到下一阶段",
    autoExecutable: false,
  },
  {
    type: "generate_summary",
    risk: "low",
    label: "生成进展摘要",
    description: "自动生成项目进展摘要",
    autoExecutable: true,
  },
  {
    type: "batch_send_email",
    risk: "high",
    label: "批量发送邮件",
    description: "向多个供应商批量发送邮件",
    autoExecutable: false,
  },
];

const registryMap = new Map(ACTION_REGISTRY.map((a) => [a.type, a]));

export function getActionRisk(type: string): ActionRiskLevel {
  return registryMap.get(type)?.risk ?? "high";
}

export function isAutoExecutable(type: string): boolean {
  return registryMap.get(type)?.autoExecutable === true;
}

// ── 自动执行结果 ─────────────────────────────────────────────────

export interface AutoActionResult {
  suggestionId: string;
  actionType: string;
  success: boolean;
  message: string;
  createdEntityId?: string;
}

// ── 自动执行入口 ─────────────────────────────────────────────────

export async function executeAutoActions(
  userId: string,
  suggestions: ProactiveSuggestion[]
): Promise<AutoActionResult[]> {
  const results: AutoActionResult[] = [];

  for (const suggestion of suggestions) {
    const actionType = mapSuggestionToAutoAction(suggestion);
    if (!actionType || !isAutoExecutable(actionType)) continue;

    try {
      const result = await executeOne(userId, suggestion, actionType);
      if (result) results.push(result);
    } catch {
      results.push({
        suggestionId: suggestion.id,
        actionType,
        success: false,
        message: "执行失败",
      });
    }
  }

  return results;
}

function mapSuggestionToAutoAction(s: ProactiveSuggestion): string | null {
  switch (s.kind) {
    case "deadline_approaching":
      return s.severity === "urgent" ? "create_reminder_task" : null;
    case "tasks_overdue":
      return "create_overdue_task";
    default:
      return null;
  }
}

// ── 各动作的具体执行逻辑 ─────────────────────────────────────────

async function executeOne(
  userId: string,
  suggestion: ProactiveSuggestion,
  actionType: string
): Promise<AutoActionResult | null> {
  switch (actionType) {
    case "create_reminder_task":
      return createReminderTask(userId, suggestion);
    case "create_overdue_task":
      return createOverdueFollowup(userId, suggestion);
    default:
      return null;
  }
}

async function createReminderTask(
  userId: string,
  suggestion: ProactiveSuggestion
): Promise<AutoActionResult> {
  const dedupeKey = `auto:reminder:${suggestion.projectId}:${suggestion.dedupeKey}`;

  const existing = await db.task.findFirst({
    where: {
      projectId: suggestion.projectId,
      creatorId: userId,
      title: { startsWith: "[自动]" },
      status: { notIn: ["done", "cancelled"] },
      description: { contains: dedupeKey },
    },
    select: { id: true },
  });
  if (existing) return { suggestionId: suggestion.id, actionType: "create_reminder_task", success: true, message: "已存在相同提醒任务，跳过" };

  const task = await db.task.create({
    data: {
      title: `[自动] ${suggestion.title}`,
      description: `${suggestion.description}\n\n---\n来源：AI 自动检测 | ${dedupeKey}`,
      status: "todo",
      priority: suggestion.severity === "urgent" ? "high" : "medium",
      projectId: suggestion.projectId,
      creatorId: userId,
      needReminder: true,
    },
  });

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.AI_GENERATE,
    targetType: AUDIT_TARGETS.TASK,
    targetId: task.id,
    projectId: suggestion.projectId,
    afterData: {
      type: "auto_reminder_task",
      trigger: suggestion.kind,
      severity: suggestion.severity,
    },
  });

  return {
    suggestionId: suggestion.id,
    actionType: "create_reminder_task",
    success: true,
    message: `已自动创建提醒任务「${task.title}」`,
    createdEntityId: task.id,
  };
}

async function createOverdueFollowup(
  userId: string,
  suggestion: ProactiveSuggestion
): Promise<AutoActionResult> {
  const dedupeKey = `auto:overdue:${suggestion.projectId}:${suggestion.dedupeKey}`;

  const existing = await db.task.findFirst({
    where: {
      projectId: suggestion.projectId,
      creatorId: userId,
      title: { startsWith: "[自动]" },
      status: { notIn: ["done", "cancelled"] },
      description: { contains: dedupeKey },
    },
    select: { id: true },
  });
  if (existing) return { suggestionId: suggestion.id, actionType: "create_overdue_task", success: true, message: "已存在相同跟进任务，跳过" };

  const task = await db.task.create({
    data: {
      title: `[自动] 逾期任务跟进 — ${suggestion.projectName}`,
      description: `${suggestion.description}\n\n请检查逾期任务并采取行动。\n\n---\n来源：AI 自动检测 | ${dedupeKey}`,
      status: "todo",
      priority: "high",
      projectId: suggestion.projectId,
      creatorId: userId,
      needReminder: true,
    },
  });

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.AI_GENERATE,
    targetType: AUDIT_TARGETS.TASK,
    targetId: task.id,
    projectId: suggestion.projectId,
    afterData: {
      type: "auto_overdue_followup",
      trigger: suggestion.kind,
      severity: suggestion.severity,
    },
  });

  return {
    suggestionId: suggestion.id,
    actionType: "create_overdue_task",
    success: true,
    message: `已自动创建跟进任务「${task.title}」`,
    createdEntityId: task.id,
  };
}
