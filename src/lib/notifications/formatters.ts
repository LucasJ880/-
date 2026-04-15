// ─── Types ─────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  type: string;
  category: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  activityId: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  snoozeUntil: string | null;
  readAt: string | null;
  doneAt: string | null;
  sourceKey: string | null;
  metadata: string | null;
  createdAt: string;
}

// ─── Audit title formatting ────────────────────────────────────

export function extractName(dataStr: string | null): string | null {
  if (!dataStr) return null;
  try {
    const d = JSON.parse(dataStr);
    return d.name || d.title || d.key || null;
  } catch {
    return null;
  }
}

const ACTION_LABELS: Record<string, string> = {
  runtime_fail: "Agent 运行失败",
  evaluation_low: "触发了低分评估",
  create_conversation_feedback: "提交了会话反馈",
  update_conversation_feedback: "更新了会话反馈",
  create_message_feedback: "提交了消息反馈",
  update_message_feedback: "更新了消息反馈",
  status_change: "变更了状态",
};

const TARGET_LABELS: Record<string, string> = {
  project: "项目",
  prompt: "Prompt",
  knowledge_base: "知识库",
  conversation: "会话",
  agent: "Agent",
  tool: "工具",
  runtime: "Runtime",
  conversation_feedback: "会话反馈",
  message_feedback: "消息反馈",
};

export function formatAuditTitle(
  action: string,
  targetType: string,
  targetName: string | null,
  actorName: string
): string {
  const actionLabel = ACTION_LABELS[action] ?? action;
  const target = TARGET_LABELS[targetType] ?? targetType;
  const name = targetName ? `「${targetName}」` : "";
  return `${actorName} ${actionLabel} ${target}${name}`.trim();
}

// ─── DB record → API serialization ────────────────────────────

export function serializeNotification(n: {
  id: string;
  userId: string;
  orgId: string | null;
  projectId: string | null;
  type: string;
  category: string;
  title: string;
  summary: string | null;
  entityType: string | null;
  entityId: string | null;
  activityId: string | null;
  status: string;
  priority: string;
  dueAt: Date | null;
  snoozeUntil: Date | null;
  readAt: Date | null;
  doneAt: Date | null;
  sourceKey: string | null;
  metadata: string | null;
  createdAt: Date;
}): NotificationItem {
  return {
    ...n,
    dueAt: n.dueAt?.toISOString() ?? null,
    snoozeUntil: n.snoozeUntil?.toISOString() ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    doneAt: n.doneAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
