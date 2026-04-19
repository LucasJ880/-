/**
 * 工具 RBAC 策略表（PR1）
 *
 * 这是整个 Agent 工具链的"权限真相源"。所有注册过的工具都必须在这里
 * 声明 risk + allowRoles，否则 registry 会把它当作 admin-only 处理。
 *
 * 设计原则：
 * - 只读（l0_read）默认开放给对应域的业务角色
 * - cockpit / skill_run / skill_create / secretary_execute_action 等涉及
 *   全局视角或高权限副作用的工具一律 admin-only
 * - 未来新增工具请在这里补一行声明
 */

import { registry } from "../tool-registry";
import type { ToolAllowRoles, ToolRisk } from "../types";

interface ToolPolicy {
  risk: ToolRisk;
  allowRoles: ToolAllowRoles;
}

export const TOOL_POLICY: Record<string, ToolPolicy> = {
  // ── sales 域（19 个） ────────────────────────────────────────
  sales_ai_quote:             { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_create_quote:         { risk: "l2_soft",           allowRoles: ["admin", "sales"] },
  sales_get_customer_quotes:  { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_search_customers:     { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_get_customer:         { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_get_pipeline:         { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_list_opportunities:   { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_get_overview:         { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_advance_stage:        { risk: "l2_soft",           allowRoles: ["admin", "sales"] },
  sales_compose_email:        { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_refine_email:         { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_send_quote_email:     { risk: "l3_strong",         allowRoles: ["admin", "sales"] },
  sales_create_appointment:   { risk: "l2_soft",           allowRoles: ["admin", "sales"] },
  sales_analyze_interaction:  { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_search_knowledge:     { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_get_coaching:         { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_get_deal_health:      { risk: "l0_read",           allowRoles: ["admin", "sales"] },
  sales_record_coaching:      { risk: "l1_internal_write", allowRoles: ["admin", "sales"] },
  sales_coaching_feedback:    { risk: "l1_internal_write", allowRoles: ["admin", "sales"] },

  // ── trade 域（7 个） ─────────────────────────────────────────
  trade_get_overview:         { risk: "l0_read", allowRoles: ["admin", "trade"] },
  trade_list_campaigns:       { risk: "l0_read", allowRoles: ["admin", "trade"] },
  trade_search_prospects:     { risk: "l0_read", allowRoles: ["admin", "trade"] },
  trade_get_prospect:         { risk: "l0_read", allowRoles: ["admin", "trade"] },
  trade_get_follow_ups:       { risk: "l0_read", allowRoles: ["admin", "trade"] },
  trade_list_quotes:          { risk: "l0_read", allowRoles: ["admin", "trade"] },
  trade_get_suggestions:      { risk: "l0_read", allowRoles: ["admin", "trade"] },

  // ── cockpit（当前 domain 标为 trade，仅 admin 可调） ──────────
  cockpit_get_metrics:        { risk: "l0_read", allowRoles: ["admin"] },
  cockpit_get_weekly_report:  { risk: "l0_read", allowRoles: ["admin"] },

  // ── secretary 域（4 个） ─────────────────────────────────────
  secretary_get_briefing:           { risk: "l0_read",   allowRoles: ["admin", "sales", "trade"] },
  secretary_scan_followups:         { risk: "l0_read",   allowRoles: ["admin", "sales", "trade"] },
  secretary_generate_followup_draft:{ risk: "l0_read",   allowRoles: ["admin", "sales", "trade"] },
  secretary_execute_action:         { risk: "l3_strong", allowRoles: ["admin"] },

  // ── context 域（所有登录用户都可以搜自己的历史） ──────────────
  context_search_history:     { risk: "l0_read",           allowRoles: "*" },
  context_get_summaries:      { risk: "l0_read",           allowRoles: "*" },
  context_index_messages:     { risk: "l1_internal_write", allowRoles: "*" },

  // ── skill 域（动态技能需 admin 权限执行 / 创建） ──────────────
  skill_list:                   { risk: "l0_read", allowRoles: "*" },
  skill_run:                    { risk: "l2_soft", allowRoles: ["admin"] },
  skill_create_from_description:{ risk: "l2_soft", allowRoles: ["admin"] },
};

/**
 * 在所有工具 import 完成后调用一次：
 * - 把策略表里的 risk / allowRoles 打到每个工具上
 * - 未在策略表中声明的工具保留默认（registry 会按 admin-only 处理）并输出警告
 */
export function applyToolPolicy(): {
  applied: number;
  missing: string[];
  orphaned: string[];
} {
  const allTools = registry.list();
  const declared = new Set<string>();
  const missing: string[] = [];

  for (const tool of allTools) {
    const policy = TOOL_POLICY[tool.name];
    if (!policy) {
      missing.push(tool.name);
      // 显式打标签为 admin-only，方便调试时看出是默认值
      tool.risk = tool.risk ?? "l0_read";
      tool.allowRoles = tool.allowRoles ?? ["admin"];
      continue;
    }
    tool.risk = policy.risk;
    tool.allowRoles = policy.allowRoles;
    declared.add(tool.name);
  }

  const orphaned = Object.keys(TOOL_POLICY).filter(
    (name) => !allTools.some((t) => t.name === name),
  );

  if (missing.length > 0) {
    console.warn(
      `[RBAC] ${missing.length} tools have no policy, defaulting to admin-only: ${missing.join(", ")}`,
    );
  }
  if (orphaned.length > 0) {
    console.warn(
      `[RBAC] policy references ${orphaned.length} unknown tools: ${orphaned.join(", ")}`,
    );
  }

  return { applied: declared.size, missing, orphaned };
}
