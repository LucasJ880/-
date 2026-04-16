/**
 * 秘书域工具 — 注册到统一工具注册表
 *
 * 将 AI 秘书的能力暴露给 Agent Core，
 * 使全局助手和外贸聊天都能调用简报/跟进/一键动作。
 */

import { registry } from "../tool-registry";
import { generateDailyBriefing } from "@/lib/secretary/briefing";
import { scanFollowups, suggestionsToItems, generateFollowupSuggestions } from "@/lib/secretary/followup-engine";
import { executeAction } from "@/lib/secretary/actions";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

function ok(data: unknown): ToolExecutionResult {
  return { success: true, data };
}

// ── secretary.get_briefing ──────────────────────────────────────

registry.register({
  name: "secretary_get_briefing",
  description: "生成今日 AI 工作简报：扫描外贸客户动态、待办事项、跟进提醒，并汇总为自然语言摘要",
  domain: "secretary",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const briefing = await generateDailyBriefing(ctx.userId, ctx.orgId);
    return ok({
      summary: briefing.summary,
      totalUrgent: briefing.totalUrgent,
      totalWarning: briefing.totalWarning,
      totalItems: briefing.totalItems,
      domains: briefing.domains.map((d) => ({
        domain: d.domain,
        itemCount: d.items.length,
        topItems: d.items.slice(0, 5).map((i) => ({
          title: i.title,
          severity: i.severity,
          category: i.category,
        })),
      })),
    });
  },
});

// ── secretary.scan_followups ────────────────────────────────────

registry.register({
  name: "secretary_scan_followups",
  description: "扫描需要跟进的外贸客户：到期跟进、未回复阶梯、未处理回复、谈判停滞",
  domain: "secretary",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async (ctx: ToolExecutionContext) => {
    const candidates = await scanFollowups(ctx.orgId);
    return ok({
      totalCandidates: candidates.length,
      candidates: candidates.slice(0, 10).map((c) => ({
        companyName: c.companyName,
        reason: c.reason,
        daysSilent: c.daysSilent,
        stage: c.stage,
        priorityScore: c.priorityScore,
      })),
    });
  },
});

// ── secretary.generate_followup_draft ───────────────────────────

registry.register({
  name: "secretary_generate_followup_draft",
  description: "为指定客户生成 AI 跟进邮件草稿",
  domain: "secretary",
  parameters: {
    type: "object",
    properties: {
      prospectId: { type: "string", description: "客户线索 ID" },
      isSecondTouch: { type: "string", description: "是否为二次触达（true/false）" },
    },
    required: ["prospectId"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const result = await executeAction({
      type: "followup_draft",
      entityId: ctx.args.prospectId as string,
      params: { isSecondTouch: ctx.args.isSecondTouch === "true" },
    });
    return { success: result.success, data: result.draft ?? result.message, error: result.success ? undefined : result.message };
  },
  riskLevel: "low",
});

// ── secretary.execute_action ────────────────────────────────────

registry.register({
  name: "secretary_execute_action",
  description: "执行一键动作：延期报价（quote_extend）、批准客户（prospect_approve）、跳过客户（prospect_skip）",
  domain: "secretary",
  parameters: {
    type: "object",
    properties: {
      actionType: { type: "string", description: "动作类型", enum: ["quote_extend", "prospect_approve", "prospect_skip"] },
      entityId: { type: "string", description: "目标实体 ID（客户或报价）" },
    },
    required: ["actionType", "entityId"],
  },
  execute: async (ctx: ToolExecutionContext) => {
    const result = await executeAction({
      type: ctx.args.actionType as "quote_extend" | "prospect_approve" | "prospect_skip",
      entityId: ctx.args.entityId as string,
    });
    return { success: result.success, data: result, error: result.success ? undefined : result.message };
  },
  riskLevel: "medium",
});
