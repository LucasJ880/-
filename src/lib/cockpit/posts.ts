/**
 * 组织驾驶舱 — 岗位注册表（A-1，openspec change org-cockpit-posts）
 *
 * 把自动化、待审批动作、workforce 工作域、AgentRun 类型归到固定的七个岗位，
 * 并为每个岗位指定 KPI 来源与跳转页面。岗位归属是代码事实，不是租户配置：
 * 本文件没有运行时导入（只有 import type 与类型位置的 typeof import），不连库、不读组织设置，
 * 同一份代码对所有组织给出相同归属。
 *
 * 漏归属在两处报错：
 *   - 类型层：文件末尾的穷举断言，漏一个自动化键 / 动作类型 / 工作域、KPI 路径解析不到标量 → tsc 报出字面量
 *   - 运行期：__tests__/posts.test.ts 逐个统计命中岗位数，固定归属必须恰好为 1
 */

import type { AutomationKey } from "@/lib/automation/registry";
import type { PendingActionType } from "@/lib/pending-actions/types";
import type { WorkDomain } from "@/lib/workforce-runtime/work-domain";

// ── KPI 来源 ──────────────────────────────────────────────────

/**
 * 既有只读读函数 → 返回值类型。纯类型映射（typeof import 编译后被擦除），
 * 用来在编译期校验每个 KPI 指标路径能解析到标量；键即 PostKpiSpec.source。
 */
export interface PostKpiSourceResults {
  "src/lib/revenue-spine/sla-metrics.ts#loadSlaMetrics": Awaited<
    ReturnType<(typeof import("@/lib/revenue-spine/sla-metrics"))["loadSlaMetrics"]>
  >;
  "src/lib/project-finance/portfolio.ts#getTenderPortfolioSummary": Awaited<
    ReturnType<(typeof import("@/lib/project-finance/portfolio"))["getTenderPortfolioSummary"]>
  >;
  "src/lib/marketing/query-dashboard.ts#getMarketingDashboard": Awaited<
    ReturnType<(typeof import("@/lib/marketing/query-dashboard"))["getMarketingDashboard"]>
  >;
  "src/lib/operations/projects/query.ts#listDeliveryProjects": Awaited<
    ReturnType<(typeof import("@/lib/operations/projects/query"))["listDeliveryProjects"]>
  >;
  "src/lib/employee-ai/metrics.ts#getTeamLearningMetrics": Awaited<
    ReturnType<(typeof import("@/lib/employee-ai/metrics"))["getTeamLearningMetrics"]>
  >;
}

export type PostKpiSource = keyof PostKpiSourceResults;

/** 指标格式白名单：没有金额格式，金额类字段无法声明成 KPI */
export const POST_KPI_FORMATS = ["count", "rate", "percentage_string", "minutes", "score"] as const;
export type PostKpiFormat = (typeof POST_KPI_FORMATS)[number];

/** 读函数的统计口径，读模型据此传参并在卡片上标注 */
export type PostKpiWindow =
  | { kind: "rolling_days"; days: number }
  | { kind: "month_to_date" }
  | { kind: "point_in_time" }
  | { kind: "all_time" };

export interface PostKpiMetric {
  /** 读函数返回值里的属性路径（点分），如 "inquiries.answeredWithin24hRate" */
  path: string;
  label: string;
  /** count 计数；rate 0..1；percentage_string 0..100 的字符串；minutes 分钟；score 0..100 得分 */
  format: PostKpiFormat;
}

/**
 * KPI 来源是"指针"：指向仓库里已存在的、按组织只读的导出函数，取数由读模型（A-2）完成。
 * 没有既有读函数的岗位标为 unavailable 并写明原因，不在注册表里新写查询。
 */
export type PostKpiSpec =
  | {
      kind: "existing_read";
      source: PostKpiSource;
      window: PostKpiWindow;
      metrics: readonly [PostKpiMetric, PostKpiMetric, PostKpiMetric];
    }
  | { kind: "unavailable"; reason: string };

// ── 岗位定义 ──────────────────────────────────────────────────

export interface PostDefinition {
  key: string;
  /** 岗位中文名 */
  name: string;
  automationKeys: readonly AutomationKey[];
  /** 固定归属本岗位的动作类型；通用动作类型不在任何岗位里列出，见 SHARED_PENDING_ACTION_TYPES */
  pendingActionTypes: readonly PendingActionType[];
  workDomains: readonly WorkDomain[];
  /** 整个 runType 都属于本岗位时才列出；不归属的取值见 UNATTRIBUTED_AGENT_RUN_TYPES */
  agentRunTypes: readonly string[];
  kpi: PostKpiSpec;
  /** 卡片点击跳转的既有页面路径 */
  nav: string;
}

// ── 注册表（数组顺序即岗位卡片展示顺序） ────────────────────────

export const POST_REGISTRY = [
  {
    key: "inbound_sales",
    name: "询盘销售",
    automationKeys: [
      "daily-brief",
      "trade-followup",
      "sales-action-sync",
      "revenue-spine-sync",
      "wechat-push",
      "inquiry-sla",
      "trade-daily",
      "muse-reminder-scan",
      "calendar-watch",
    ],
    pendingActionTypes: [
      "sales.update_followup",
      "sales.update_stage",
      "sales.approve_quote_promotion",
      "sales.send_inquiry_reply",
      "sales.update_quote_settings",
      "sales.update_signed_quote",
      "revenue_spine.propose_commercial_fact",
    ],
    workDomains: ["sales"],
    // runtime_v2 唯一写入点（agent-runtime-v2/process.ts）的 intent 固定为 sales_followup_triage
    agentRunTypes: ["fde_inbound_sales", "runtime_v2"],
    kpi: {
      kind: "existing_read",
      source: "src/lib/revenue-spine/sla-metrics.ts#loadSlaMetrics",
      window: { kind: "rolling_days", days: 30 },
      metrics: [
        { path: "inquiries.medianFirstResponseMinutes", label: "首响中位（分钟）", format: "minutes" },
        { path: "inquiries.answeredWithin24hRate", label: "24 小时回复率", format: "rate" },
        { path: "guardrail.total", label: "护栏拦截", format: "count" },
      ],
    },
    nav: "/revenue",
  },
  {
    key: "tender",
    name: "投标",
    automationKeys: ["tender-watch", "tender-auto-analysis", "tender-rfq-inbound"],
    pendingActionTypes: ["tender.send_rfq", "tender.send_chase"],
    workDomains: ["tender"],
    agentRunTypes: [],
    kpi: {
      kind: "existing_read",
      source: "src/lib/project-finance/portfolio.ts#getTenderPortfolioSummary",
      // 与 /api/org/tender-portfolio 的默认窗口一致；返回值含毛利 / 利润 / 估值，只取下面三个计数字段
      window: { kind: "rolling_days", days: 365 },
      metrics: [
        { path: "tenderSubmittedCount", label: "已投标", format: "count" },
        { path: "wonCount", label: "中标", format: "count" },
        { path: "winRatePercentage", label: "中标率", format: "percentage_string" },
      ],
    },
    nav: "/bids",
  },
  {
    key: "marketing",
    name: "营销增长",
    automationKeys: [
      "market-intelligence",
      "marketing-channel-sync",
      "marketing-crm-attribution",
      "marketing-health",
      "marketing-daily-brief",
      "marketing-experiment-review",
      "marketing-mmm",
      "postiz-sync",
    ],
    pendingActionTypes: [
      "marketing.activate_campaign",
      "marketing.approve_research_plan",
      "marketing.propose_context_update",
      "marketing.create_campaign_draft",
    ],
    workDomains: [],
    agentRunTypes: [],
    kpi: {
      kind: "existing_read",
      source: "src/lib/marketing/query-dashboard.ts#getMarketingDashboard",
      // 返回值的 funnel.economics 含毛利率 / 毛利，只取 summary 下三个字段
      window: { kind: "month_to_date" },
      metrics: [
        { path: "summary.effectiveLeads", label: "有效线索", format: "count" },
        { path: "summary.growthExecution", label: "增长执行", format: "score" },
        { path: "summary.highPriorityIssues", label: "高优先级问题", format: "count" },
      ],
    },
    nav: "/operations/growth",
  },
  {
    key: "service",
    name: "客服",
    automationKeys: ["service-inbox-sla"],
    pendingActionTypes: [],
    workDomains: [],
    agentRunTypes: [],
    kpi: {
      kind: "unavailable",
      reason: "客服线只有写入型的 SLA 扫描函数（runServiceInboxSla，跨组织、会改提醒级别），计数内联在 GET /api/service-inbox 路由里，没有按组织只读的读函数",
    },
    nav: "/service-inbox",
  },
  {
    key: "projects",
    name: "项目交付",
    automationKeys: ["project-inspection", "progress-summary", "proactive-scan"],
    // Sunny 窗饰：工艺单作废、安装收口后的质保邮件与返修时间确认邮件属于交付环节
    pendingActionTypes: ["orders.cancel_blinds_order", "install.send_warranty_email", "install.send_repair_visit_email"],
    workDomains: ["delivery"],
    agentRunTypes: [],
    kpi: {
      kind: "existing_read",
      source: "src/lib/operations/projects/query.ts#listDeliveryProjects",
      // 按查看人可见范围统计，与 /projects 页面口径一致
      window: { kind: "point_in_time" },
      metrics: [
        { path: "sections.needsAttention", label: "需关注", format: "count" },
        { path: "sections.active", label: "进行中", format: "count" },
        { path: "sections.onHold", label: "暂停", format: "count" },
      ],
    },
    nav: "/projects",
  },
  {
    key: "ops_knowledge",
    name: "运维与知识",
    automationKeys: [
      "employee-ai-practice-miner",
      "release-drift",
      "agent-runs",
      "autopilot-telemetry",
      "approval-timeout",
      "post-daily-digest",
    ],
    pendingActionTypes: [],
    workDomains: ["general"],
    agentRunTypes: [],
    kpi: {
      kind: "existing_read",
      source: "src/lib/employee-ai/metrics.ts#getTeamLearningMetrics",
      window: { kind: "all_time" },
      metrics: [
        { path: "candidatePracticeCount", label: "候选方法", format: "count" },
        { path: "activePlaybookCount", label: "生效手册", format: "count" },
        { path: "acceptRate", label: "采纳率", format: "rate" },
      ],
    },
    nav: "/ai-activity",
  },
  {
    key: "content",
    name: "内容",
    automationKeys: ["aivora-sync"],
    pendingActionTypes: [],
    workDomains: [],
    agentRunTypes: [],
    kpi: {
      kind: "unavailable",
      reason: "Aivora 线只有写入型的同步函数（syncAivoraVideosForOrg，会写 VideoAsset），计数内联在 GET /api/operations/dashboard 路由里，没有按组织只读的读函数",
    },
    nav: "/operations/dashboard",
  },
] as const satisfies readonly PostDefinition[];

export type PostKey = (typeof POST_REGISTRY)[number]["key"];
export type PostRegistryEntry = (typeof POST_REGISTRY)[number];

export const POST_KEYS: readonly PostKey[] = POST_REGISTRY.map((p) => p.key);

/**
 * 通用动作类型：由销售跟进、助手场景、技能、approval-gate、ai-grader 等多条链路产出，
 * 目标既有客户 / 商机 / 报价也有项目，没有固定岗位，按每条动作的上下文归属（postForPendingAction）。
 */
export const SHARED_PENDING_ACTION_TYPES = [
  "calendar.create_event",
  "grader.email_draft",
  "grader.internal_note",
  "grader.project_task",
] as const satisfies readonly PendingActionType[];

/**
 * 代码里会写入、但不归属任何岗位的 runType：
 * workforce_job 按 metadata.workDomain 归属；conversation / assistant_dispatch / background_conversation
 * 是人主动发起的对话与其后台续跑；supervisor 属于已冻结模块。
 */
export const UNATTRIBUTED_AGENT_RUN_TYPES = [
  "workforce_job",
  "conversation",
  "assistant_dispatch",
  "background_conversation",
  "supervisor",
] as const;

// ── 反查（未命中一律 null，不猜、不回退到默认岗位） ─────────────

function indexBy(pick: (post: PostRegistryEntry) => readonly string[]): ReadonlyMap<string, PostKey> {
  const index = new Map<string, PostKey>();
  for (const post of POST_REGISTRY) {
    for (const value of pick(post)) index.set(value, post.key);
  }
  return index;
}

const POST_BY_KEY: ReadonlyMap<string, PostRegistryEntry> = new Map(POST_REGISTRY.map((p) => [p.key, p]));
const POST_BY_AUTOMATION = indexBy((p) => p.automationKeys);
const POST_BY_ACTION_TYPE = indexBy((p) => p.pendingActionTypes);
const POST_BY_WORK_DOMAIN = indexBy((p) => p.workDomains);
const POST_BY_RUN_TYPE = indexBy((p) => p.agentRunTypes);
const SHARED_ACTION_TYPES: ReadonlySet<string> = new Set(SHARED_PENDING_ACTION_TYPES);
const POST_BY_TARGET_TYPE: ReadonlyMap<string, PostKey> = new Map([
  ["PROJECT", "projects"],
  ["CUSTOMER", "inbound_sales"],
  ["OPPORTUNITY", "inbound_sales"],
  ["QUOTE", "inbound_sales"],
]);

export function getPostDefinition(key: string): PostRegistryEntry | null {
  return POST_BY_KEY.get(key) ?? null;
}

export function postForAutomation(automationKey: string): PostKey | null {
  return POST_BY_AUTOMATION.get(automationKey) ?? null;
}

/** 动作类型的固定岗位；通用动作类型没有固定岗位，返回 null */
export function postForPendingActionType(type: string): PostKey | null {
  return POST_BY_ACTION_TYPE.get(type) ?? null;
}

export function isSharedPendingActionType(type: string): boolean {
  return SHARED_ACTION_TYPES.has(type);
}

export function postForWorkDomain(workDomain: string): PostKey | null {
  return POST_BY_WORK_DOMAIN.get(workDomain) ?? null;
}

export function postForAgentRunType(runType: string): PostKey | null {
  return POST_BY_RUN_TYPE.get(runType) ?? null;
}

/** Project.workDomain 的默认值（未分类项目）；只有 workforce 作业上的 general 才表示平台级作业 */
export const UNCLASSIFIED_PROJECT_DOMAIN = "general";

/** 一条待审批动作的归属上下文，由调用方从行与关联表取好传入 */
export interface PendingActionAttributionInput {
  type: string;
  /** 所属项目的工作域：PendingAction.projectId，为空时取目标类型为 PROJECT 的 payload.targetId，再查 Project.workDomain */
  projectWorkDomain?: string | null;
  /** payload.targetType，为空再取 payload.metadata.targetType */
  targetType?: string | null;
  /** agentRunId 对应 AgentRun 的 runType */
  agentRunType?: string | null;
}

/**
 * 单条待审批动作的岗位。固定归属的类型始终返回固定岗位；通用动作类型依次看
 * 项目工作域 → 目标类型 → 产出 run 类型，第一条命中即停，都不命中返回 null（未归属）。
 * 只用结构化字段，不读标题 / 正文。
 */
export function postForPendingAction(input: PendingActionAttributionInput): PostKey | null {
  const fixed = postForPendingActionType(input.type);
  if (fixed) return fixed;
  if (!isSharedPendingActionType(input.type)) return null;

  // Project.workDomain 的默认值 general 表示"项目未分类"，不是平台级作业，不据此归属
  const domain = input.projectWorkDomain?.trim().toLowerCase();
  const byDomain = domain && domain !== UNCLASSIFIED_PROJECT_DOMAIN ? postForWorkDomain(domain) : null;
  if (byDomain) return byDomain;

  const target = input.targetType?.trim().toUpperCase();
  const byTarget = target ? POST_BY_TARGET_TYPE.get(target) ?? null : null;
  if (byTarget) return byTarget;

  const runType = input.agentRunType?.trim();
  return runType ? postForAgentRunType(runType) : null;
}

// ── 按 KPI 声明取值（只取声明路径，不透出结果对象的其他字段） ────

export interface PickedKpiMetric extends PostKpiMetric {
  value: number | string | null;
}

function readScalarPath(source: unknown, path: string): number | string | null {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === "number") return Number.isFinite(current) ? current : null;
  return typeof current === "string" ? current : null;
}

export function pickKpiMetrics(spec: PostKpiSpec, result: unknown): PickedKpiMetric[] | null {
  if (spec.kind !== "existing_read") return null;
  return spec.metrics.map((metric) => ({
    path: metric.path,
    label: metric.label,
    format: metric.format,
    value: readScalarPath(result, metric.path),
  }));
}

// ── 类型层穷举断言 ────────────────────────────────────────────
// 不满足时 tsc 报 `Type '"<字面量>"' does not satisfy the constraint 'never'`。

type AssertAllAssigned<Missing extends never> = Missing;
type Assigned<Field extends "automationKeys" | "pendingActionTypes" | "workDomains"> =
  PostRegistryEntry[Field][number];
type SharedActionType = (typeof SHARED_PENDING_ACTION_TYPES)[number];

export type PostRegistryCoversAllAutomations = AssertAllAssigned<Exclude<AutomationKey, Assigned<"automationKeys">>>;
export type PostRegistryCoversAllPendingActionTypes = AssertAllAssigned<
  Exclude<PendingActionType, Assigned<"pendingActionTypes"> | SharedActionType>
>;
export type PostRegistrySharedActionTypesHaveNoFixedPost = AssertAllAssigned<
  Extract<Assigned<"pendingActionTypes">, SharedActionType>
>;
export type PostRegistryCoversAllWorkDomains = AssertAllAssigned<Exclude<WorkDomain, Assigned<"workDomains">>>;

type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof NonNullable<T>
    ? PathValue<NonNullable<T>[Head], Rest>
    : never
  : P extends keyof NonNullable<T>
    ? NonNullable<T>[P]
    : never;
type BadKpiPath<Entry> = Entry extends {
  key: infer Key extends string;
  kpi: { kind: "existing_read"; source: infer Source extends PostKpiSource; metrics: readonly (infer Metric)[] };
}
  ? Metric extends { path: infer Path extends string }
    ? [PathValue<PostKpiSourceResults[Source], Path>] extends [never]
      ? `${Key}:${Path}`
      : [PathValue<PostKpiSourceResults[Source], Path>] extends [number | string | null | undefined]
        ? never
        : `${Key}:${Path}（非标量）`
    : never
  : never;

export type PostKpiPathsResolveToScalars = AssertAllAssigned<BadKpiPath<PostRegistryEntry>>;
