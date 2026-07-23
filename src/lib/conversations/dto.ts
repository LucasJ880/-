/**
 * 会话 API DTO：业务视图 vs 平台诊断视图。
 * 禁止先返回完整对象再由前端删字段。
 */

export type ConversationRow = {
  id: string;
  title: string;
  channel: string;
  status: string;
  environment?: { id: string; code: string; name: string } | null;
  user?: { id: string; name: string | null; email?: string | null } | null;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  avgLatencyMs: number;
  agentId?: string | null;
  runtimeStatus?: string | null;
  lastErrorMessage?: string | null;
  runCount?: number | null;
  startedAt: Date | string;
  lastMessageAt: Date | string | null;
  endedAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  promptId?: string | null;
  knowledgeBaseId?: string | null;
};

export type MessageRow = {
  id: string;
  role: string;
  content: string;
  contentType: string;
  sequence: number;
  modelName: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: string;
  errorMessage: string | null;
  toolName: string | null;
  toolCallId: string | null;
  parentMessageId: string | null;
  metadataJson: string | null;
  createdAt: Date | string;
};

export type PromptInfo = {
  id: string;
  key: string;
  name: string;
  version?: number | null;
} | null;

export type ContextSnapshotInfo = {
  id: string;
  promptKey: string | null;
  knowledgeBaseKey: string | null;
  systemPromptSnapshot: string | null;
  retrievalConfigJson: string | null;
  extraConfigJson: string | null;
  createdAt: Date | string;
} | null;

/** 普通用户：业务会话摘要（无 token / prompt / agent 诊断） */
export function toBusinessConversationDto(conv: ConversationRow) {
  return {
    id: conv.id,
    title: conv.title,
    channel: conv.channel,
    status: conv.status,
    environment: conv.environment
      ? { id: conv.environment.id, name: conv.environment.name }
      : null,
    user: conv.user
      ? { id: conv.user.id, name: conv.user.name }
      : null,
    messageCount: conv.messageCount,
    startedAt: conv.startedAt,
    lastMessageAt: conv.lastMessageAt,
    endedAt: conv.endedAt ?? null,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    /** 业务态：映射 runtimeStatus，不暴露内部 agent 字段名 */
    businessStatus: mapBusinessStatus(conv.status, conv.runtimeStatus),
  };
}

/** 平台管理员：完整诊断会话 */
export function toPlatformDiagnosticConversationDto(
  conv: ConversationRow,
  extras?: {
    prompt?: PromptInfo;
    knowledgeBase?: PromptInfo;
    contextSnapshot?: ContextSnapshotInfo;
  },
) {
  return {
    conversation: {
      id: conv.id,
      title: conv.title,
      channel: conv.channel,
      status: conv.status,
      environment: conv.environment,
      user: conv.user,
      messageCount: conv.messageCount,
      inputTokens: conv.inputTokens,
      outputTokens: conv.outputTokens,
      totalTokens: conv.totalTokens,
      estimatedCost: conv.estimatedCost,
      avgLatencyMs: conv.avgLatencyMs,
      agentId: conv.agentId,
      runtimeStatus: conv.runtimeStatus,
      lastErrorMessage: conv.lastErrorMessage,
      runCount: conv.runCount,
      startedAt: conv.startedAt,
      lastMessageAt: conv.lastMessageAt,
      endedAt: conv.endedAt ?? null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    },
    prompt: extras?.prompt ?? null,
    knowledgeBase: extras?.knowledgeBase ?? null,
    contextSnapshot: extras?.contextSnapshot ?? null,
  };
}

/** 普通用户消息：角色 / 正文 / 时间 / 业务状态 */
export function toBusinessMessageDto(m: MessageRow) {
  const isTool = m.role === "tool";
  return {
    id: m.id,
    role: m.role,
    content: isTool ? "" : m.content,
    contentType: m.contentType,
    sequence: m.sequence,
    status: m.status,
    /** 友好错误，不透出模型/内部堆栈 */
    errorMessage:
      m.status === "error" ? "处理失败，请稍后重试或联系管理员" : null,
    createdAt: m.createdAt,
    /** 工具消息仅标记，不返回 toolName / payload */
    isToolCall: isTool,
  };
}

/** 平台管理员消息：含 model / tokens / metadata / tool */
export function toPlatformDiagnosticMessageDto(m: MessageRow) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    contentType: m.contentType,
    sequence: m.sequence,
    modelName: m.modelName,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    latencyMs: m.latencyMs,
    status: m.status,
    errorMessage: m.errorMessage,
    toolName: m.toolName,
    toolCallId: m.toolCallId,
    parentMessageId: m.parentMessageId,
    metadataJson: m.metadataJson,
    createdAt: m.createdAt,
  };
}

export function toBusinessConversationListItem(conv: ConversationRow & {
  prompt?: { id: string; key: string; name: string } | null;
  knowledgeBase?: { id: string; key: string; name: string } | null;
}) {
  return {
    id: conv.id,
    title: conv.title,
    channel: conv.channel,
    status: conv.status,
    environment: conv.environment
      ? { id: conv.environment.id, name: conv.environment.name }
      : null,
    user: conv.user ? { id: conv.user.id, name: conv.user.name } : null,
    messageCount: conv.messageCount,
    startedAt: conv.startedAt,
    lastMessageAt: conv.lastMessageAt,
    businessStatus: mapBusinessStatus(conv.status, conv.runtimeStatus),
  };
}

export function toPlatformDiagnosticConversationListItem(conv: ConversationRow & {
  prompt?: { id: string; key: string; name: string } | null;
  knowledgeBase?: { id: string; key: string; name: string } | null;
}) {
  return {
    id: conv.id,
    title: conv.title,
    channel: conv.channel,
    status: conv.status,
    environment: conv.environment,
    user: conv.user,
    messageCount: conv.messageCount,
    totalTokens: conv.totalTokens,
    estimatedCost: conv.estimatedCost,
    startedAt: conv.startedAt,
    lastMessageAt: conv.lastMessageAt,
    prompt: conv.prompt ?? null,
    knowledgeBase: conv.knowledgeBase ?? null,
  };
}

function mapBusinessStatus(
  status: string,
  runtimeStatus?: string | null,
): string {
  if (status === "archived" || status === "completed") return "已完成";
  if (runtimeStatus === "failed" || runtimeStatus === "error") return "处理失败";
  if (runtimeStatus === "running" || runtimeStatus === "queued") return "处理中";
  if (runtimeStatus === "awaiting_approval") return "需要确认";
  if (status === "active") return "进行中";
  return status;
}
