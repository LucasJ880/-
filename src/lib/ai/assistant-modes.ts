/**
 * 项目内 / 协同助手模式
 * - fast：轻量快答（类 Cursor Ask）
 * - agent：主 Agent 可调工具（类 Cursor Agent）
 * - project_expert：强制项目域工具 + 专家提示
 */

export const ASSISTANT_MODES = ["fast", "agent", "project_expert"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const ASSISTANT_MODE_META: Record<
  AssistantMode,
  { label: string; hint: string }
> = {
  fast: {
    label: "快速对话",
    hint: "轻模型，秒回，适合问答与梳理",
  },
  agent: {
    label: "主 Agent",
    hint: "可调用工具办事，看得见执行步骤",
  },
  project_expert: {
    label: "项目专家",
    hint: "聚焦本标书/风险/供应商/澄清邮件",
  },
};

export function parseAssistantMode(raw: unknown): AssistantMode | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim() as AssistantMode;
  return (ASSISTANT_MODES as readonly string[]).includes(v) ? v : null;
}

/** 项目场景下，即使无销售关键词也应触发工具的意图 */
const PROJECT_TOOL_TRIGGERS = [
  "风险",
  "标书",
  "供应商",
  "澄清",
  "截标",
  "开标",
  "投标",
  "清单",
  "文档",
  "解读",
  "报价",
  "询价",
  "时间节点",
  "进度",
  "复盘",
  "中标",
  "丢标",
];

export function needsProjectTools(content: string): boolean {
  const t = content.toLowerCase();
  return PROJECT_TOOL_TRIGGERS.some((k) => t.includes(k.toLowerCase()));
}

export function buildProjectExpertSystemAddon(projectId: string): string {
  return [
    ``,
    `# 项目专家模式`,
    `- 你正在服务一个具体招投标/交付项目。`,
    `- 所有 project_* 工具的 projectId 固定为：${projectId}`,
    `- 优先：风险扫描、文档要点、供应商推荐、澄清邮件草稿、关键日期核对。`,
    `- 不确定就先用工具查，不要空猜。`,
    `- 需要用户确认的动作走审批，不要假装已执行。`,
  ].join("\n");
}
