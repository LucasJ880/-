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
/** 与 src/lib/pending-actions/drafts.ts 写入的动作一致；发起方看审批载荷 metadata.principalActorType（approval/request.ts 写入） */
export const APPROVAL_CREATED_ACTION = "APPROVAL_CREATED";

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
  ai_draft_reject: "驳回 AI 草稿",
  // 配额守卫（capabilities/governance/evaluate.ts）
  QUOTA_HARD_LIMIT_BLOCKED: "配额用尽被拦下",
  QUOTA_SOFT_LIMIT_REACHED: "配额接近上限",
  QUOTA_WARNING: "配额预警",
  // 投标询价邮件自动录入（tender-rfq/inbound-sync.ts，只由定时任务写）
  "rfq_inbound:applied": "询价邮件已自动录入",
  "rfq_inbound:failed": "询价邮件自动录入失败",
  // Revenue Spine / FDE
  [OPPORTUNITY_TRANSITION_ACTION]: "商机阶段变更",
  "revenue_spine.commercial_fact.applied": "商务事实写入",
  "revenue_spine.inquiry_reply.draft_snapshot": "FDE 草稿留底",
  "revenue_spine.followup_draft.guardrail_blocked": "跟进草稿被守卫拦下",
  "revenue_spine.draft_preferences.ignored": "草稿偏好有项被忽略",
  "revenue_spine.inquiry.intake": "询盘录入",
  "revenue_spine.inquiry_reply.sent": "询盘回复已发送",
  "revenue_spine.trade_outbound.mirrored": "人工外发已同步到商机",
  // 组织驾驶舱（cockpit/daily-digest.ts，只由定时任务写）
  "cockpit.post_daily_digest": "岗位日结",
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
  product_content_approval: "产品内容审批",
  revenue_spine_policy: "Revenue Spine 策略",
  quota: "配额",
  rfq_inbound_message: "询价邮件",
};

/** 固定由 FDE 以负责人名义写入的动作 */
export const AI_AUDIT_ACTIONS: readonly string[] = [
  "revenue_spine.inquiry_reply.draft_snapshot",
  "revenue_spine.followup_draft.guardrail_blocked",
  "revenue_spine.draft_preferences.ignored",
];

/** 固定由系统写入的动作（挂名的是被作废审批的负责人 / 被拦下的用户 / 邮箱主人 / 外发人 / 组织所有者） */
export const SYSTEM_AUDIT_ACTIONS: readonly string[] = [
  "APPROVAL_SYSTEM_SUPERSEDED",
  "QUOTA_HARD_LIMIT_BLOCKED",
  "QUOTA_SOFT_LIMIT_REACHED",
  "QUOTA_WARNING",
  "rfq_inbound:applied",
  "rfq_inbound:failed",
  "revenue_spine.trade_outbound.mirrored",
  "cockpit.post_daily_digest",
];

/** 只认自有键（普通对象查表会命中原型链上的 toString / constructor） */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

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
    source: typeof src === "string" ? own(TRANSITION_SOURCE_MAP, src) ?? null : null,
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
  const label = own(AUDIT_ACTION_LABELS, action);
  if (!label) return `${action} · ${targetType}`;
  const target = own(AUDIT_TARGET_LABELS, targetType.trim().toLowerCase()) ?? targetType;
  return `${label} · ${target}`;
}

/**
 * 审计条目来源：固定表 → 商机阶段变更的流转来源 → 发起审批看审批载荷里的发起方（agent = FDE 等 AI 发起）→ 默认人工。
 * principalActorType 只对发起审批有意义（读模型已为 pending_action 目标读了载荷，不额外读审计变更数据）。
 */
export function auditSource(action: string, transition?: TransitionDetail | null, principalActorType?: string | null): TimelineSource {
  if (AI_AUDIT_ACTIONS.includes(action)) return "ai";
  if (SYSTEM_AUDIT_ACTIONS.includes(action)) return "system";
  if (action === OPPORTUNITY_TRANSITION_ACTION) return transition?.source ?? "human";
  if (action === APPROVAL_CREATED_ACTION && principalActorType === "agent") return "ai";
  return "human";
}

/** 审批载荷 metadata.principalActorType（approval/request.ts buildPendingActionDraftInput 写入）；没有或不是字符串 → null */
export function principalActorTypeOf(payload: unknown): string | null {
  const meta = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).metadata : null;
  const v = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>).principalActorType : null;
  return typeof v === "string" ? v : null;
}
