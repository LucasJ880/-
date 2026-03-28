/**
 * 审计日志 → 用户可读动态的格式化层
 * 将 action + targetType 转换为中文描述，提炼 before/after 差异摘要
 */

const ACTION_LABELS: Record<string, string> = {
  create: "创建了",
  update: "更新了",
  delete: "删除了",
  login: "登录了",
  logout: "登出了",
  invite: "邀请了",
  remove: "移除了",
  role_change: "变更了角色",
  status_change: "变更了状态",
  export: "导出了",
  runtime_run: "运行了",
  runtime_tool: "调用了工具",
  runtime_fail: "运行失败",
  create_conversation_feedback: "提交了会话反馈",
  update_conversation_feedback: "更新了会话反馈",
  create_message_feedback: "提交了消息反馈",
  update_message_feedback: "更新了消息反馈",
  create_evaluation_tag: "创建了评估标签",
  update_evaluation_tag: "更新了评估标签",
  ai_generate: "AI 生成了",
  ai_send: "发送了",
  ai_analyze: "AI 分析了",
};

const TARGET_LABELS: Record<string, string> = {
  user: "用户",
  organization: "组织",
  organization_member: "组织成员",
  project: "项目",
  project_member: "项目成员",
  environment: "环境",
  task: "任务",
  calendar_event: "日程",
  blinds_order: "工艺单",
  prompt: "Prompt",
  knowledge_base: "知识库",
  knowledge_document: "知识库文档",
  conversation: "会话",
  message: "消息",
  agent: "Agent",
  tool: "工具",
  tool_trace: "工具调用",
  runtime: "Runtime",
  conversation_feedback: "会话反馈",
  message_feedback: "消息反馈",
  evaluation_tag: "评估标签",
  project_email: "邮件草稿",
  project_question: "问题邮件",
  report: "周报",
  quote_analysis: "报价分析",
};

export interface FormattedActivity {
  id: string;
  timestamp: string;
  actor: { id: string; name: string; email: string };
  actionKey: string;
  actionLabel: string;
  targetType: string;
  targetTypeLabel: string;
  targetId: string | null;
  targetName: string | null;
  summary: string;
  diff: string | null;
}

export interface RawAuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeData: string | null;
  afterData: string | null;
  createdAt: Date | string;
  user: { id: string; name: string; email: string };
}

export interface RawSystemEvent {
  id: string;
  body: string;
  metadata: Record<string, unknown> | null;
  senderId: string | null;
  sender: { id: string; name: string; email: string } | null;
  createdAt: Date | string;
}

export function formatActivity(log: RawAuditLog): FormattedActivity {
  const actionLabel = ACTION_LABELS[log.action] ?? log.action;
  const targetTypeLabel = TARGET_LABELS[log.targetType] ?? log.targetType;

  const targetName = extractTargetName(log.afterData ?? log.beforeData, log.targetType);
  const diff = extractDiff(log.beforeData, log.afterData, log.action);

  const targetDisplay = targetName ? `${targetTypeLabel}「${targetName}」` : targetTypeLabel;

  let summary: string;
  if (log.action === "ai_generate") {
    summary = `AI 生成了${targetTypeLabel}${targetName ? `「${targetName}」` : ""}`;
  } else if (log.action === "ai_send") {
    summary = `发送了${targetTypeLabel}${targetName ? `「${targetName}」` : ""}`;
  } else if (log.action === "ai_analyze") {
    summary = `AI 分析了${targetTypeLabel}${targetName ? `「${targetName}」` : ""}`;
  } else if (log.action === "runtime_run") {
    summary = `运行了 Agent${targetName ? `「${targetName}」` : ""}`;
  } else if (log.action === "runtime_fail") {
    summary = `Agent 运行失败${targetName ? `（${targetName}）` : ""}`;
  } else if (log.action === "runtime_tool") {
    summary = `调用了工具${targetName ? `「${targetName}」` : ""}`;
  } else if (log.action === "status_change") {
    summary = diff ? `${targetDisplay} ${diff}` : `变更了${targetDisplay}的状态`;
  } else if (log.action === "role_change") {
    summary = diff ? `${targetDisplay} ${diff}` : `变更了${targetDisplay}的角色`;
  } else {
    summary = `${actionLabel}${targetDisplay}`;
    if (diff) summary += `（${diff}）`;
  }

  return {
    id: log.id,
    timestamp: typeof log.createdAt === "string" ? log.createdAt : log.createdAt.toISOString(),
    actor: log.user,
    actionKey: log.action,
    actionLabel,
    targetType: log.targetType,
    targetTypeLabel,
    targetId: log.targetId,
    targetName,
    summary,
    diff,
  };
}

const SYSTEM_EVENT_LABELS: Record<string, string> = {
  project_created: "创建项目",
  member_joined: "成员加入",
  member_removed: "成员移出",
  stage_changed: "阶段变更",
  date_changed: "日期变更",
  project_submitted: "项目提交",
  status_changed: "状态变更",
  project_abandoned: "项目放弃",
  task_created: "创建任务",
  event_created: "创建日程",
  stage_advanced: "阶段推进",
  email_sent: "邮件发送",
};

export function formatSystemEvent(msg: RawSystemEvent): FormattedActivity {
  const eventType = (msg.metadata?.eventType as string) ?? "system";
  const actorName = (msg.metadata?.actorName as string) ?? msg.sender?.name ?? "系统";
  const actor = msg.sender ?? { id: "system", name: actorName, email: "" };

  return {
    id: `sys_${msg.id}`,
    timestamp: typeof msg.createdAt === "string" ? msg.createdAt : msg.createdAt.toISOString(),
    actor,
    actionKey: eventType,
    actionLabel: SYSTEM_EVENT_LABELS[eventType] ?? eventType,
    targetType: "system_event",
    targetTypeLabel: "系统事件",
    targetId: null,
    targetName: null,
    summary: msg.body,
    diff: null,
  };
}

function extractTargetName(dataStr: string | null, _targetType: string): string | null {
  if (!dataStr) return null;
  try {
    const data = JSON.parse(dataStr);
    return data.name || data.title || data.key || data.label || data.toolName || null;
  } catch {
    return null;
  }
}

function extractDiff(beforeStr: string | null, afterStr: string | null, action: string): string | null {
  if (!beforeStr && !afterStr) return null;

  let before: Record<string, unknown> | null = null;
  let after: Record<string, unknown> | null = null;

  try { if (beforeStr) before = JSON.parse(beforeStr); } catch { /* skip */ }
  try { if (afterStr) after = JSON.parse(afterStr); } catch { /* skip */ }

  if (action === "status_change" || action === "update") {
    const bStatus = before?.status as string | undefined;
    const aStatus = after?.status as string | undefined;
    if (bStatus && aStatus && bStatus !== aStatus) {
      return `状态从 ${translateStatus(bStatus)} 变更为 ${translateStatus(aStatus)}`;
    }
  }

  if (action === "role_change") {
    const bRole = before?.role as string | undefined;
    const aRole = after?.role as string | undefined;
    if (bRole && aRole && bRole !== aRole) {
      return `角色从 ${bRole} 变更为 ${aRole}`;
    }
  }

  if (after && !before && action === "create") {
    const name = after.name || after.title || after.key;
    if (name) return null;
  }

  if (before && after) {
    const changes: string[] = [];
    const trackFields = ["name", "title", "status", "description", "envCode", "rating", "score"];
    for (const field of trackFields) {
      const bv = before[field];
      const av = after[field];
      if (bv !== undefined && av !== undefined && bv !== av) {
        if (field === "status") {
          changes.push(`状态: ${translateStatus(String(bv))} → ${translateStatus(String(av))}`);
        } else {
          const label = FIELD_LABELS[field] ?? field;
          changes.push(`${label}: ${String(bv).slice(0, 30)} → ${String(av).slice(0, 30)}`);
        }
      }
    }
    if (changes.length > 0) return changes.join("；");
  }

  return null;
}

const FIELD_LABELS: Record<string, string> = {
  name: "名称",
  title: "标题",
  status: "状态",
  description: "描述",
  envCode: "环境",
  rating: "评分",
  score: "分数",
};

const STATUS_LABELS: Record<string, string> = {
  active: "正常",
  draft: "草稿",
  archived: "已归档",
  inactive: "已停用",
  suspended: "已封禁",
  open: "待处理",
  triaged: "已分类",
  resolved: "已解决",
  closed: "已关闭",
  completed: "已完成",
  failed: "失败",
  running: "运行中",
};

function translateStatus(s: string): string {
  return STATUS_LABELS[s] ?? s;
}
