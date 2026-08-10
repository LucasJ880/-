/**
 * Workforce Operator UX — 纯展示层（2D-1）
 *
 * Read Model 视图 → 用户可见文案/样式的确定性映射。零 React、零 I/O、
 * 零 LLM——全部是字典 + 纯函数，供页面组件消费、供契约测试直接断言。
 *
 * 词汇边界（任务书 §3/§7/§10）：
 * - 用户永不看到 AgentRun / AgentRunStep / lease / fence / trace 等
 *   runtime 内部词汇——本层的输出字符串是最后一道闸门；
 * - workerKey 只映射为友好职能名；scope/capabilities/权限语义不进本层；
 * - 未知枚举值一律 fail-safe 到保守文案，绝不透传内部原始字符串。
 */

import type {
  WorkforceJobProgress,
  WorkforceNeedsYouType,
  WorkforceNeedsYouView,
  WorkforceTimelineItem,
  WorkforceUserJobStatus,
} from "@/lib/workforce-runtime/read-model";

/* ------------------------------------------------------------------ */
/* Job 状态（用户面七态 → 友好中文 + 语义色）                            */
/* ------------------------------------------------------------------ */

export type JobStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "pending"
  | "in-progress";

export const JOB_STATUS_PRESENTATION: Record<
  WorkforceUserJobStatus,
  { label: string; tone: JobStatusTone }
> = {
  QUEUED: { label: "排队中", tone: "pending" },
  WORKING: { label: "进行中", tone: "in-progress" },
  NEEDS_YOU: { label: "需要你", tone: "warning" },
  COMPLETED: { label: "已完成", tone: "success" },
  PARTIAL: { label: "部分完成", tone: "warning" },
  FAILED: { label: "未能完成", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "neutral" },
};

export function jobStatusLabel(status: WorkforceUserJobStatus): string {
  return JOB_STATUS_PRESENTATION[status]?.label ?? "处理中";
}

/** 活跃 = 详情页轮询刷新的依据（终态不再轮询） */
export function isActiveJobStatus(status: WorkforceUserJobStatus): boolean {
  return status === "QUEUED" || status === "WORKING" || status === "NEEDS_YOU";
}

/* ------------------------------------------------------------------ */
/* Task（AgentRunStep.status 透传值 → 友好中文）                        */
/* ------------------------------------------------------------------ */

/**
 * v2 步骤词汇全覆盖；未知/未来值 fail-safe 显示"处理中"
 * （与 Read Model 的非终态假定一致），绝不透传内部原始字符串。
 */
const TASK_STATUS_PRESENTATION: Record<
  string,
  { label: string; tone: JobStatusTone }
> = {
  pending: { label: "待开始", tone: "neutral" },
  ready: { label: "待开始", tone: "neutral" },
  running: { label: "进行中", tone: "in-progress" },
  awaiting_approval: { label: "等待审批", tone: "pending" },
  completed: { label: "已完成", tone: "success" },
  partially_executed: { label: "部分完成", tone: "warning" },
  failed: { label: "未成功", tone: "danger" },
  blocked: { label: "受阻", tone: "danger" },
  skipped: { label: "已跳过", tone: "neutral" },
};

export function taskStatusPresentation(status: string): {
  label: string;
  tone: JobStatusTone;
} {
  return TASK_STATUS_PRESENTATION[status] ?? { label: "处理中", tone: "info" };
}

/** 终态成功集合（任务清单里用于弱化显示） */
export function isTaskDone(status: string): boolean {
  return (
    status === "completed" ||
    status === "skipped" ||
    status === "partially_executed"
  );
}

/* ------------------------------------------------------------------ */
/* Worker（执行身份 → 友好职能名；权限语义结构性排除）                    */
/* ------------------------------------------------------------------ */

/**
 * workerKey → 用户面职能名。
 * canonical = #85 `WORKFORCE_WORKER_REGISTRY` 正式词汇（sales_worker /
 * tender_worker / synthesis_worker）；短名保留为 legacy / forward UI 别名。
 * 未知 workerKey fail-safe 为"数字员工"——内部 key 永不直出。
 * workerKey 缺失（2B-1 前的存量 Job）→ undefined，UI 不渲染徽标。
 */
const WORKER_PRESENTATION: Record<string, string> = {
  // #85 canonical registry keys
  sales_worker: "销售",
  tender_worker: "投标",
  synthesis_worker: "综合汇总",
  // legacy / forward UI aliases
  research: "资料研究",
  tender: "投标",
  sales: "销售",
  synthesis: "综合汇总",
  marketing: "营销",
  analytics: "数据分析",
  operations: "运营",
};

export function workerLabel(workerKey: string | undefined): string | undefined {
  if (!workerKey) return undefined;
  return WORKER_PRESENTATION[workerKey] ?? "数字员工";
}

/* ------------------------------------------------------------------ */
/* Progress（deterministic 计数展示；永不出现 AI 估算百分比）             */
/* ------------------------------------------------------------------ */

export function progressText(progress: WorkforceJobProgress): string {
  return `${progress.completedTasks} / ${progress.totalTasks} 项任务完成`;
}

/** 进度条填充比例（0..100 整数），只由 completed/total 推导 */
export function progressPercent(progress: WorkforceJobProgress): number {
  if (progress.totalTasks <= 0) return 0;
  return Math.round(
    (progress.completedTasks / progress.totalTasks) * 100,
  );
}

/** 规划期（尚无任务拆解）不显示 0/0，显示阶段文案（设计 §6 边界） */
export function hasPlannedTasks(progress: WorkforceJobProgress): boolean {
  return progress.totalTasks > 0;
}

/** 多任务并行标题（D6：currentTasks 从第一天就是数组契约） */
export function currentTasksHeading(count: number): string {
  if (count <= 1) return "当前任务";
  return `正在执行 ${count} 项`;
}

/* ------------------------------------------------------------------ */
/* Needs You（结构化等待原因 → 卡片文案 + 只读入口）                      */
/* ------------------------------------------------------------------ */

export type NeedsYouCardModel = {
  /** Read Model 字典标题（已是确定性人话） */
  title: string;
  detail?: string;
  /** 涉及的审批项数量（0 = 不显示计数） */
  pendingCount: number;
  /**
   * 只读跳转入口（本阶段无任何 mutation）：
   * 审批类 → 已有成熟审批中心；其余类型无入口（详情已在卡片内）。
   */
  action?: { label: string; href: string };
};

const APPROVAL_TYPES: ReadonlySet<WorkforceNeedsYouType> = new Set([
  "APPROVAL_REQUIRED",
  "APPROVAL_REJECTED",
]);

export function needsYouCardModel(view: WorkforceNeedsYouView): NeedsYouCardModel {
  const model: NeedsYouCardModel = {
    title: view.title,
    pendingCount: view.pendingActionIds?.length ?? 0,
  };
  if (view.detail) model.detail = view.detail;
  if (APPROVAL_TYPES.has(view.type)) {
    model.action = { label: "前往审批中心", href: "/capabilities/approvals" };
  }
  return model;
}

/* ------------------------------------------------------------------ */
/* Timeline（user timeline 专属；内部时间线结构性不消费）                 */
/* ------------------------------------------------------------------ */

export type TimelineTone = "neutral" | "accent" | "warning" | "success" | "danger";

const TIMELINE_KIND_PRESENTATION: Record<
  string,
  { label: string; tone: TimelineTone; fallbackText: string }
> = {
  JOB_STARTED: { label: "开始", tone: "accent", fallbackText: "青砚开始处理这项任务" },
  PROGRESS: { label: "进展", tone: "neutral", fallbackText: "有新进展" },
  NEEDS_YOU: { label: "需要你", tone: "warning", fallbackText: "需要你处理后继续" },
  RESUMED: { label: "继续", tone: "accent", fallbackText: "已恢复执行" },
  REPLANNED: { label: "计划调整", tone: "neutral", fallbackText: "根据进展调整了计划" },
  BLOCKED: { label: "受阻", tone: "danger", fallbackText: "任务暂时受阻" },
  COMPLETED: { label: "完成", tone: "success", fallbackText: "任务已完成" },
  PARTIAL: { label: "部分完成", tone: "warning", fallbackText: "任务部分完成" },
  FAILED: { label: "未能完成", tone: "danger", fallbackText: "任务未能完成" },
  CANCELLED: { label: "已取消", tone: "neutral", fallbackText: "任务已取消" },
};

const TIMELINE_FALLBACK = {
  label: "动态",
  tone: "neutral" as TimelineTone,
  fallbackText: "有新动态",
};

export function timelineKindPresentation(kind: string): {
  label: string;
  tone: TimelineTone;
  fallbackText: string;
} {
  return TIMELINE_KIND_PRESENTATION[kind] ?? TIMELINE_FALLBACK;
}

/**
 * 条目正文的确定性选择：
 * - PROGRESS / NEEDS_YOU：事件 title 本身是人话（步骤标题 / 等待原因），
 *   优先使用；缺失回退字典；
 * - 其余生命周期类：一律用字典文案（runtime 写入的 title 属工程话术，
 *   如 "Workforce Job 已恢复"，不进用户面）。
 */
export function timelineItemText(item: WorkforceTimelineItem): string {
  const meta = timelineKindPresentation(item.kind);
  if (item.kind === "PROGRESS" || item.kind === "NEEDS_YOU") {
    return item.title && item.title.trim().length > 0
      ? item.title
      : meta.fallbackText;
  }
  if (item.kind === "JOB_STARTED" && item.eventType === "plan.created") {
    return "已拆解任务计划";
  }
  return meta.fallbackText;
}

/* ------------------------------------------------------------------ */
/* Final Result（§15：只用已有产物；缺失 = 明确占位，不拼 LLM 摘要）       */
/* ------------------------------------------------------------------ */

export function finalResultPlaceholder(status: WorkforceUserJobStatus): string {
  if (status === "COMPLETED" || status === "PARTIAL") {
    return "尚未生成最终结果";
  }
  if (status === "FAILED") return "任务未能完成，暂无最终结果";
  if (status === "CANCELLED") return "任务已取消，未生成最终结果";
  return "任务完成后，这里会展示最终结果";
}

/* ------------------------------------------------------------------ */
/* Business Refs（type+id；label JOIN 属后续阶段——只显示类型归属）        */
/* ------------------------------------------------------------------ */

const BUSINESS_REF_LABELS: Record<string, string> = {
  workspace: "工作区",
  project: "项目",
  customer: "客户",
  supplier: "供应商",
  tender: "招标",
  order: "订单",
};

export function businessRefLabel(type: string): string {
  return BUSINESS_REF_LABELS[type] ?? "关联业务";
}

/* ------------------------------------------------------------------ */
/* 时间（列表/详情共用；deterministic，本地化 zh-CN）                     */
/* ------------------------------------------------------------------ */

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const diffMs = now.getTime() - at.getTime();
  if (diffMs < 0) return "刚刚";
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return at.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 用时（startedAt→completedAt 均存在才显示；单位分钟/小时，确定性） */
export function formatDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
): string | undefined {
  if (!startedAt || !completedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  const min = Math.round((end - start) / 60000);
  if (min < 1) return "不到 1 分钟";
  if (min < 60) return `${min} 分钟`;
  const hour = Math.floor(min / 60);
  const rest = min % 60;
  return rest > 0 ? `${hour} 小时 ${rest} 分钟` : `${hour} 小时`;
}

/** Job 卡片/详情标题兜底（title 缺失时的中性文案，不透出 id） */
export const UNTITLED_JOB = "未命名任务";
