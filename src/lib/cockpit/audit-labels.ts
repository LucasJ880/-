/**
 * 组织驾驶舱 — company.log 审计条目的中文摘要与来源（openspec change org-cockpit-timeline-labels）
 *
 * 纯函数：按精确动作代码查中文标签（没有标签就回退原始代码，不猜）；按动作固定表 + 商机阶段变更的流转来源判定
 * 人工 / AI / 系统；商机阶段变更只解析 3 个枚举字段（来源、是否按策略、前后阶段），自由文本一律不出。
 */

import { OPPORTUNITY_STAGE_LABELS, toCanonicalStage, type OpportunityStage } from "@/lib/revenue-spine/opportunity-stage";

export type TimelineSource = "human" | "ai" | "system";

/** 与 src/lib/revenue-spine/transition.ts 写入的动作一致（测试对照源码） */
export const OPPORTUNITY_TRANSITION_ACTION = "revenue_spine.opportunity.transition";

/** 常见动作 → 中文标签（精确匹配） */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  // 通用（audit/logger.ts AUDIT_ACTIONS 常见项）
  create: "新建",
  update: "更新",
  delete: "删除",
  login: "登录",
  logout: "退出登录",
  invite: "邀请成员",
  remove: "移除",
  role_change: "变更角色",
  status_change: "变更状态",
  password_change: "修改密码",
  password_reset: "重置密码",
  export: "导出",
  assign_owner: "指派负责人",
  assign_members: "指派成员",
  abandon_project: "放弃项目",
  dispatch_project: "分派项目",
  // 审批生命周期（capabilities/approvals/decision.ts、pending-actions/*）
  APPROVAL_CREATED: "发起审批",
  APPROVAL_APPROVED: "批准",
  APPROVAL_REJECTED: "驳回",
  APPROVAL_CANCELLED: "取消审批",
  APPROVAL_EXECUTION_STARTED: "开始执行",
  APPROVAL_EXECUTED: "执行完成",
  APPROVAL_EXECUTION_FAILED: "执行失败",
  APPROVAL_EXECUTION_BLOCKED: "执行被拦下",
  APPROVAL_SYSTEM_SUPERSEDED: "被系统作废",
  // Revenue Spine / FDE
  [OPPORTUNITY_TRANSITION_ACTION]: "商机阶段变更",
  "revenue_spine.commercial_fact.applied": "商务事实写入",
  "revenue_spine.inquiry_reply.draft_snapshot": "FDE 草稿留底",
  "revenue_spine.followup_draft.guardrail_blocked": "跟进草稿被守卫拦下",
  "revenue_spine.draft_preferences.ignored": "草稿偏好有项被忽略",
};

/** 常见目标类型 → 中文名 */
export const AUDIT_TARGET_LABELS: Readonly<Record<string, string>> = {
  user: "用户",
  organization: "组织",
  organization_member: "组织成员",
  project: "项目",
  project_member: "项目成员",
  task: "任务",
  calendar_event: "日程",
  knowledge_base: "知识库",
  knowledge_document: "知识文档",
  report: "报告",
  quote_analysis: "报价分析",
  sales_customer: "客户",
  sales_action: "销售动作",
  sales_opportunity: "商机",
  pending_action: "审批",
  approval: "审批",
  approval_request: "审批",
  api_token: "API 令牌",
  webhook_endpoint: "Webhook",
};

/** 固定由 FDE 以负责人名义写入的动作 */
export const AI_AUDIT_ACTIONS: readonly string[] = [
  "revenue_spine.inquiry_reply.draft_snapshot",
  "revenue_spine.followup_draft.guardrail_blocked",
  "revenue_spine.draft_preferences.ignored",
];

/** 固定由系统写入的动作 */
export const SYSTEM_AUDIT_ACTIONS: readonly string[] = ["APPROVAL_SYSTEM_SUPERSEDED"];

/** 商机阶段变更审计里白名单解析出的枚举值；解析不出的项为 null */
export interface TransitionDetail {
  source: TimelineSource | null;
  byPolicy: boolean;
  from: OpportunityStage | null;
  to: OpportunityStage | null;
}

const TRANSITION_SOURCE_MAP: Readonly<Record<string, TimelineSource>> = { human: "human", fde: "ai", system: "system" };

/** AuditLog 的 beforeData / afterData 是 JSON 字符串；解析失败或不是对象 → null */
function jsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const v: unknown = JSON.parse(value);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 只取三项枚举：流转来源（human / fde / system）、是否带策略键（只要布尔）、前后阶段（已知阶段值才收） */
export function transitionDetailOf(beforeData: string | null | undefined, afterData: string | null | undefined): TransitionDetail {
  const before = jsonObject(beforeData);
  const after = jsonObject(afterData);
  const stage = (v: unknown) => (typeof v === "string" ? toCanonicalStage(v) : null);
  const src = after?.source;
  return {
    source: typeof src === "string" ? TRANSITION_SOURCE_MAP[src] ?? null : null,
    byPolicy: typeof after?.policyKey === "string" && after.policyKey.trim().length > 0,
    from: stage(before?.stage),
    to: stage(after?.stage),
  };
}

/** 审计条目摘要：有标签 → "标签 · 目标名"；没有 → 原始 "action · targetType"。商机阶段变更有前后阶段时显示阶段 */
export function auditSummaryText(action: string, targetType: string, transition?: TransitionDetail | null): string {
  if (action === OPPORTUNITY_TRANSITION_ACTION && transition?.from && transition.to) {
    const zh = (s: OpportunityStage) => OPPORTUNITY_STAGE_LABELS[s].zh;
    return `商机阶段：${zh(transition.from)} → ${zh(transition.to)}${transition.byPolicy ? "（按策略自动）" : ""}`;
  }
  const label = AUDIT_ACTION_LABELS[action];
  if (!label) return `${action} · ${targetType}`;
  const target = AUDIT_TARGET_LABELS[targetType.trim().toLowerCase()] ?? targetType;
  return `${label} · ${target}`;
}

/** 审计条目来源：固定表 → 商机阶段变更的流转来源 → 默认人工 */
export function auditSource(action: string, transition?: TransitionDetail | null): TimelineSource {
  if (AI_AUDIT_ACTIONS.includes(action)) return "ai";
  if (SYSTEM_AUDIT_ACTIONS.includes(action)) return "system";
  if (action === OPPORTUNITY_TRANSITION_ACTION) return transition?.source ?? "human";
  return "human";
}
