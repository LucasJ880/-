/**
 * 青砚 AI 结构化输出类型定义
 *
 * 覆盖：任务拆解、文案生成、摘要总结、行动建议。
 * 解析逻辑在 parser.ts，这里只定义形状。
 */

// ── 任务/日程提取（沿用 WORK_JSON 协议） ──────────────────────

export interface TaskSuggestion {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  projectId: string | null;
  project: string | null;
  needReminder: boolean;
}

export interface EventSuggestion {
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
}

export interface WorkSuggestion {
  type: "task" | "event" | "task_and_event";
  task: TaskSuggestion | null;
  event: EventSuggestion | null;
}

// ── 任务拆解 ──────────────────────────────────────────────────

export interface SubTask {
  title: string;
  estimatedHours: number | null;
  priority: "low" | "medium" | "high" | "urgent";
  dependsOn: string | null;
}

export interface TaskBreakdown {
  summary: string;
  tasks: SubTask[];
  suggestedOrder: string;
}

// ── 摘要 ──────────────────────────────────────────────────────

export interface Summary {
  oneLiner: string;
  keyPoints: string[];
  nextSteps: string[];
}

// ── 行动建议 ──────────────────────────────────────────────────

export interface ActionItem {
  action: string;
  reason: string;
  expectedOutcome: string;
}

export interface ActionAdvice {
  context: string;
  items: ActionItem[];
}
