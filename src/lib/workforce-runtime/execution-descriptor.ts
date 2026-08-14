/**
 * T5-P0C-A — 执行策略 descriptor（Planner 可见性 ≠ 执行策略元数据）
 *
 * 修复的 blocker：executor 用 `getRuntimeV2Tool(toolName)` 取 descriptor，
 * 而 Tender 的 7 个工具**刻意不在** RUNTIME_V2_TOOL_CATALOG 中
 * （保持 GLOBAL_PLANNER_VISIBLE_TENDER_TOOLS = 0，避免全局 planner 看见投标工具），
 * 于是 descriptor 恒 undefined → 风险只能靠默认值猜。
 * 猜 l0_read 是错的（把 MEDIUM 写型分析工具当只读）；
 * 猜 l1_internal_write 同样是错的——**任何默认值都是猜风险**。
 *
 * 正确的拆分：
 *   Planner visibility  —— 决定"planner 能提议哪些工具"（按 domain 作用域注入）
 *   Execution policy    —— 决定"执行期用什么风险/审批属性鉴权"（必须覆盖全部可执行工具）
 * 两者是不同问题，本模块只解决后者。
 *
 * 解析顺序（唯一 canonical 入口，不新建第二套 handler registry / planner catalog）：
 *   1. RUNTIME_V2_TOOL_CATALOG（既有全局工具）
 *   2. TENDER_WORKFORCE_TOOL_DESCRIPTORS（已批准的 tender 域执行 descriptor）
 *   3. 未来其它已批准 domain descriptor 在此登记
 * 全部未命中 → **fail closed**（TOOL_POLICY_DESCRIPTOR_MISSING），绝不给默认风险。
 */

import type { ToolDescriptor } from "@/lib/agent-runtime-v2/schemas";
import { getRuntimeV2Tool } from "@/lib/agent-runtime-v2/tool-catalog";
import { TENDER_WORKFORCE_TOOL_DESCRIPTORS } from "@/lib/tender-workforce/tools";

/** tool-auth 风险词表（与 tool-auth.ts 的 RISK_ORDER 对齐） */
export type ExecutionToolRisk =
  | "l0_read"
  | "l1_internal_write"
  | "l2_soft"
  | "l3_strong";

const tenderByName = new Map<string, ToolDescriptor>(
  TENDER_WORKFORCE_TOOL_DESCRIPTORS.map((d) => [d.name, d]),
);

/**
 * 执行期 descriptor 解析（canonical）。
 * 返回 null 表示该工具没有已批准的执行策略元数据 → 调用方必须 fail-closed。
 */
export function getExecutionToolPolicyDescriptor(
  toolName: string,
): ToolDescriptor | null {
  const name = (toolName ?? "").trim();
  if (!name) return null;
  const global = getRuntimeV2Tool(name);
  if (global) return global;
  const tender = tenderByName.get(name);
  if (tender) return tender;
  return null;
}

/**
 * 唯一风险映射：ToolDescriptor → tool-auth risk。
 *
 * 不再是"requiresApproval ? l2 : l0"这种二值近似——真实使用
 * riskLevel + readOnly + requiresApproval 三个字段：
 *   requiresApproval=true                       → l2_soft（需软审批）
 *   readOnly=true                               → l0_read
 *   riskLevel HIGH/CRITICAL（写型）             → l2_soft
 *   riskLevel MEDIUM/LOW 且非只读（写型分析）   → l1_internal_write
 *
 * Tender 的 MEDIUM 写型分析工具因此正确落到 l1_internal_write，
 * 而不再被表示成 l0_read。
 */
export function executionRiskForDescriptor(
  descriptor: ToolDescriptor,
): ExecutionToolRisk {
  if (descriptor.requiresApproval) return "l2_soft";
  if (descriptor.readOnly) return "l0_read";
  const level = (descriptor.riskLevel ?? "MEDIUM").toUpperCase();
  if (level === "HIGH" || level === "CRITICAL") return "l2_soft";
  return "l1_internal_write";
}

export type ResolveExecutionPolicyToolResult =
  | { ok: true; descriptor: ToolDescriptor; risk: ExecutionToolRisk }
  | { ok: false; code: "TOOL_POLICY_DESCRIPTOR_MISSING"; error: string };

/** 一次拿到 descriptor + 风险；缺失即 fail-closed（唯一执行期入口） */
export function resolveExecutionPolicyTool(
  toolName: string,
): ResolveExecutionPolicyToolResult {
  const descriptor = getExecutionToolPolicyDescriptor(toolName);
  if (!descriptor) {
    return {
      ok: false,
      code: "TOOL_POLICY_DESCRIPTOR_MISSING",
      error: `工具「${toolName}」缺少已批准的执行策略 descriptor，拒绝执行（不猜测风险等级）`,
    };
  }
  return { ok: true, descriptor, risk: executionRiskForDescriptor(descriptor) };
}
