/**
 * 组织驾驶舱 — 岗位注册表（A-1，openspec change org-cockpit-posts）
 *
 * 把自动化、待审批动作、workforce 工作域、AgentRun 类型归到固定的七个岗位，
 * 并为每个岗位指定 KPI 来源与跳转页面。岗位归属是代码事实，不是租户配置：
 * 本文件只有 type import，不连库、不读组织设置，同一份代码对所有组织给出相同归属。
 *
 * 漏归属在两处报错：
 *   - 类型层：文件末尾的穷举断言，漏一个自动化键 / 动作类型 / 工作域 → tsc 报出缺失字面量
 *   - 运行期：__tests__/posts.test.ts 逐个统计命中岗位数，必须恰好为 1
 */

import type { AutomationKey } from "@/lib/automation/registry";
import type { PendingActionType } from "@/lib/pending-actions/types";
import type { WorkDomain } from "@/lib/workforce-runtime/work-domain";

// ── 类型 ──────────────────────────────────────────────────────

export interface PostKpiMetric {
  /** 读函数返回值里的属性路径（点分），如 "inquiries.answeredWithin24hRate" */
  path: string;
  label: string;
}

/**
 * KPI 来源是"指针"：指向仓库里已存在的、按组织只读的导出函数，取数由读模型（A-2）完成。
 * 没有既有读函数的岗位标为 unavailable 并写明原因，不在注册表里新写查询。
 * 指标只取计数 / 比率字段；毛利、利润、估值、中标金额、我方最终报价一律不进 KPI。
 */
export type PostKpiSpec =
  | {
      kind: "existing_read";
      /** 仓库相对路径（不 import，保持注册表零运行时依赖） */
      module: string;
      exportName: string;
      metrics: readonly [PostKpiMetric, PostKpiMetric, PostKpiMetric];
    }
  | { kind: "unavailable"; reason: string };

export interface PostDefinition {
  key: string;
  /** 岗位中文名 */
  name: string;
  automationKeys: readonly AutomationKey[];
  pendingActionTypes: readonly PendingActionType[];
  workDomains: readonly WorkDomain[];
  /**
   * 整个 runType 都属于本岗位时才列出。workforce_job 按 metadata.workDomain 归属，不在这里列；
   * conversation / assistant_dispatch / supervisor 是人主动发起的对话或已冻结模块，不归任何岗位。
   */
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
    ],
    pendingActionTypes: [
      "sales.update_followup",
      "sales.update_stage",
      "sales.approve_quote_promotion",
      "sales.send_inquiry_reply",
    ],
    workDomains: ["sales"],
    agentRunTypes: ["fde_inbound_sales"],
    kpi: {
      kind: "existing_read",
      module: "src/lib/revenue-spine/sla-metrics.ts",
      exportName: "loadSlaMetrics",
      metrics: [
        { path: "inquiries.medianFirstResponseMinutes", label: "首响中位（分钟）" },
        { path: "inquiries.answeredWithin24hRate", label: "24 小时回复率" },
        { path: "guardrail.total", label: "护栏拦截" },
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
      module: "src/lib/project-finance/portfolio.ts",
      exportName: "getTenderPortfolioSummary",
      metrics: [
        { path: "tenderSubmittedCount", label: "已投标" },
        { path: "wonCount", label: "中标" },
        { path: "winRatePercentage", label: "中标率" },
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
      module: "src/lib/marketing/query-dashboard.ts",
      exportName: "getMarketingDashboard",
      metrics: [
        { path: "summary.effectiveLeads", label: "有效线索" },
        { path: "summary.growthExecution", label: "增长执行" },
        { path: "summary.highPriorityIssues", label: "高优先级问题" },
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
    pendingActionTypes: [
      "grader.internal_note",
      "grader.project_task",
      "grader.email_draft",
      "calendar.create_event",
    ],
    workDomains: ["delivery"],
    agentRunTypes: [],
    kpi: {
      kind: "existing_read",
      module: "src/lib/operations/projects/query.ts",
      exportName: "listDeliveryProjects",
      metrics: [
        { path: "sections.needsAttention", label: "需关注" },
        { path: "sections.active", label: "进行中" },
        { path: "sections.onHold", label: "暂停" },
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
    ],
    pendingActionTypes: [],
    workDomains: ["general"],
    agentRunTypes: [],
    kpi: {
      kind: "existing_read",
      module: "src/lib/employee-ai/metrics.ts",
      exportName: "getTeamLearningMetrics",
      metrics: [
        { path: "candidatePracticeCount", label: "候选方法" },
        { path: "activePlaybookCount", label: "生效手册" },
        { path: "acceptRate", label: "采纳率" },
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

export function getPostDefinition(key: string): PostRegistryEntry | null {
  return POST_BY_KEY.get(key) ?? null;
}

export function postForAutomation(automationKey: string): PostKey | null {
  return POST_BY_AUTOMATION.get(automationKey) ?? null;
}

export function postForPendingActionType(type: string): PostKey | null {
  return POST_BY_ACTION_TYPE.get(type) ?? null;
}

export function postForWorkDomain(workDomain: string): PostKey | null {
  return POST_BY_WORK_DOMAIN.get(workDomain) ?? null;
}

export function postForAgentRunType(runType: string): PostKey | null {
  return POST_BY_RUN_TYPE.get(runType) ?? null;
}

// ── 类型层穷举断言 ────────────────────────────────────────────
// 漏归属时 tsc 报 `Type '"<缺失字面量>"' does not satisfy the constraint 'never'`。

type AssertAllAssigned<Missing extends never> = Missing;
type Assigned<Field extends "automationKeys" | "pendingActionTypes" | "workDomains"> =
  PostRegistryEntry[Field][number];

export type PostRegistryCoversAllAutomations = AssertAllAssigned<Exclude<AutomationKey, Assigned<"automationKeys">>>;
export type PostRegistryCoversAllPendingActionTypes = AssertAllAssigned<
  Exclude<PendingActionType, Assigned<"pendingActionTypes">>
>;
export type PostRegistryCoversAllWorkDomains = AssertAllAssigned<Exclude<WorkDomain, Assigned<"workDomains">>>;
