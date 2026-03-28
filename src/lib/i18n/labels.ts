/**
 * 统一枚举中文映射
 *
 * 所有面向用户的枚举值 → 中文 label 集中管理于此。
 * 页面 / 组件通过 import 使用，避免 raw 英文值直接暴露给用户。
 */

// ─── 活动类型（项目动态筛选） ───
export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  project: "项目",
  task: "任务",
  calendar_event: "日程",
  prompt: "Prompt 模板",
  knowledge_base: "知识库",
  conversation: "会话",
  agent: "智能体",
  tool: "工具",
  runtime: "运行时",
  conversation_feedback: "评估反馈",
  project_email: "邮件",
  project_question: "问题邮件",
  report: "周报 / 摘要",
  quote_analysis: "报价分析",
};

// ─── Prompt 类型 ───
export const PROMPT_TYPE_LABELS: Record<string, string> = {
  system: "系统",
  assistant: "助手",
  workflow: "工作流",
};

// ─── Prompt / 通用资源状态 ───
export const RESOURCE_STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
  draft: "草稿",
};

// ─── Agent 类型 ───
export const AGENT_TYPE_LABELS: Record<string, string> = {
  chat: "对话",
  assistant: "助手",
  workflow: "工作流",
  router: "路由",
};

// ─── 工具执行类型 ───
export const TOOL_TYPE_LABELS: Record<string, string> = {
  function: "函数",
  http: "HTTP 接口",
  builtin: "内置",
};

// ─── 工具类别 ───
export const TOOL_CATEGORY_LABELS: Record<string, string> = {
  builtin: "内置",
  api: "API",
  internal: "内部",
  integration: "集成",
};

// ─── 会话渠道 ───
export const CHANNEL_LABELS: Record<string, string> = {
  web: "网页端",
  internal: "内部",
  api: "API",
  demo: "演示",
};

// ─── 文档来源类型 ───
export const DOC_SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: "手动上传",
  url: "网页抓取",
  api: "API 导入",
  file: "文件上传",
};

// ─── 文档状态 ───
export const DOC_STATUS_LABELS: Record<string, string> = {
  active: "已生效",
  processing: "处理中",
  failed: "处理失败",
  archived: "已归档",
};

/** 安全取值：key 不存在则返回原始 key */
export function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}
