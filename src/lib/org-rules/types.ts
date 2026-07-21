/**
 * 企业业务规则加载结果 — 禁止静默跨租户回退
 */

export type ConfigLoadStatus =
  | "ok"
  | "missing"
  | "invalid"
  | "incompatible";

export type ConfigLoadResult<T> = {
  status: ConfigLoadStatus;
  /** 用于执行的值；missing 时为平台通用默认（非另一企业配置） */
  value: T;
  orgId: string;
  ruleKey: string;
  version: number | null;
  effectiveAt: Date | null;
  updatedById: string | null;
  /** 经营中心展示 */
  message?: string;
};

export const RULE_KEYS = [
  "quote_discounts",
  "quote_margin",
  "quote_auto_send",
  "project_risk",
  "agent_tool_policy",
  "product_content_approval",
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];

export type QuoteMarginConfig = {
  urgentBelowPct: number;
  warnBelowPct: number;
  highAbovePct: number;
};

export type QuoteAutoSendConfig = {
  /** 是否允许 Agent 会话直发报价邮件（默认 false，须审批） */
  allowDirectSend: boolean;
  /** 会话 maxRisk 上限 */
  sessionMaxRisk: "l0_read" | "l1_internal_write" | "l2_soft" | "l3_strong";
};

export type ProjectRiskConfig = {
  staleDaysByStage: Record<string, number>;
  defaultStaleDays: number;
};

export type AgentToolPolicyOverride = {
  /** 工具名 → 是否启用；未列出沿用平台默认 */
  disabledTools?: string[];
  /** 强制需人工审批的工具 */
  forceApprovalTools?: string[];
};

export const PLATFORM_DEFAULT_QUOTE_MARGIN: QuoteMarginConfig = {
  urgentBelowPct: 5,
  warnBelowPct: 10,
  highAbovePct: 60,
};

export const PLATFORM_DEFAULT_QUOTE_AUTO_SEND: QuoteAutoSendConfig = {
  allowDirectSend: false,
  sessionMaxRisk: "l2_soft",
};

export const PLATFORM_DEFAULT_PROJECT_RISK: ProjectRiskConfig = {
  staleDaysByStage: {
    lead: 7,
    qualified: 7,
    proposal: 5,
    negotiation: 3,
  },
  defaultStaleDays: 7,
};

export const PLATFORM_DEFAULT_AGENT_TOOL_POLICY: AgentToolPolicyOverride = {
  disabledTools: [],
  forceApprovalTools: ["sales_send_quote_email", "secretary_execute_action"],
};
