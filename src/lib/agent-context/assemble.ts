/**
 * P1-1 — 统一 Context Assembler（编排层，不重写任何底层 builder）
 *
 * 输入：AgentScopeContext + 用户消息 + 预算
 * 输出：结构化上下文块 + 拼接后的 system prompt 追加段
 *
 * 组合的全部是现有组件：
 * - getWorkContext（P0-4 已 org 收敛）
 * - buildCompanyBlock / buildContextBlock
 * - buildProjectAiContextBlock / getProjectDeepContext（expectedOrgId fail-closed）
 * - getWakeUpMemories / recallMemories / buildUserMemoryBlock（自带 orgId 隔离）
 * - getSalesContext / buildSalesContextBlock（P0-4 已 org 收敛）
 * - PendingAction 待审批摘要
 *
 * 所有查询严格以 scope.orgId 为界；memory 是否加载由 scope.orgId 决定，
 * 不做跨 org 合并。
 */

import { db } from "@/lib/db";
import type { AgentScopeContext } from "@/lib/agent-scope";
import { getWorkContext, getProjectDeepContext } from "@/lib/ai/context";
import { buildContextBlock, buildProjectDeepBlock } from "@/lib/ai/prompts/common";
import { buildCompanyBlock } from "@/lib/ai/company-context";
import {
  getWakeUpMemories,
  recallMemories,
  buildUserMemoryBlock,
} from "@/lib/ai/memory-search";
import { getSalesContext, buildSalesContextBlock } from "@/lib/ai/sales-context";
import { buildProjectAiContextBlock } from "@/lib/projects/project-ai-context";

export type ContextBudget = "FAST" | "STANDARD" | "DEEP";

export const SALES_INTENT_KEYWORDS = [
  "客户", "报价", "跟进", "销售", "成交", "询盘", "pipeline",
  "follow up", "follow-up", "quote", "客户管理", "机会",
  "安装", "测量", "订单",
] as const;

export function detectSalesIntent(message: string): boolean {
  const text = message.toLowerCase();
  return SALES_INTENT_KEYWORDS.some((kw) => text.includes(kw));
}

export interface AssembleContextInput {
  scope: AgentScopeContext;
  userMessage: string;
  /** 默认 STANDARD */
  budget?: ContextBudget;
  /** 覆盖 sales 上下文加载判定（默认按关键词） */
  includeSales?: boolean;
  /** 覆盖 memory 加载（默认 true；无 memory 场景如场景化调度可关） */
  includeMemory?: boolean;
}

export interface AssembledContext {
  budget: ContextBudget;
  blocks: {
    company: string;
    work: string;
    project: string;
    memory: string;
    sales: string;
    pendingApprovals: string;
  };
  /** 已拼接、可直接附加到 system prompt 的文本 */
  systemPromptSuffix: string;
  meta: {
    orgId: string;
    projectId?: string;
    traceId: string;
    /** 实际加载了哪些块（观测用） */
    loaded: string[];
  };
}

async function buildPendingApprovalsBlock(
  scope: AgentScopeContext,
): Promise<string> {
  const pending = await db.pendingAction.findMany({
    where: {
      orgId: scope.orgId,
      createdById: scope.principalUserId,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    select: { id: true, type: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (pending.length === 0) return "";
  const lines = pending.map(
    (p) => `- [${p.type}] ${p.title}（id: ${p.id}）`,
  );
  return `\n\n## 待你确认的审批项（${pending.length} 条，未确认前不会执行）\n${lines.join("\n")}`;
}

export async function assembleAgentContext(
  input: AssembleContextInput,
): Promise<AssembledContext> {
  const { scope, userMessage } = input;
  const budget: ContextBudget = input.budget ?? "STANDARD";
  const includeMemory = input.includeMemory ?? true;
  const includeSales = input.includeSales ?? detectSalesIntent(userMessage);
  const loaded: string[] = [];

  // FAST：company + work + L0 memory；STANDARD：+ L1/L2 + 项目轻量 + sales + 审批；
  // DEEP：+ 项目深度上下文
  const wantDeepProject = budget === "DEEP" && !!scope.projectId;
  const wantLightProject = budget !== "DEEP" && !!scope.projectId;
  const wantRecall = budget !== "FAST" && includeMemory;
  const wantSales = budget !== "FAST" && includeSales;
  const wantApprovals = budget !== "FAST";

  const [work, company, wakeUp, projectLight, projectDeep, sales, approvals] =
    await Promise.all([
      getWorkContext({
        userId: scope.principalUserId,
        role: scope.principalPlatformRole,
        orgId: scope.orgId,
      }),
      buildCompanyBlock(scope.principalUserId, scope.orgId),
      includeMemory
        ? getWakeUpMemories(scope.principalUserId, scope.orgId)
        : Promise.resolve({ l0: [], l1: [] }),
      wantLightProject
        ? buildProjectAiContextBlock(scope.projectId!, {
            light: true,
            expectedOrgId: scope.orgId,
          })
        : Promise.resolve(""),
      wantDeepProject
        ? getProjectDeepContext(scope.projectId!, {
            expectedOrgId: scope.orgId,
            requesterUserId: scope.principalUserId,
          })
        : Promise.resolve(null),
      wantSales
        ? getSalesContext(scope.principalUserId, scope.orgId).catch(() => null)
        : Promise.resolve(null),
      wantApprovals
        ? buildPendingApprovalsBlock(scope).catch(() => "")
        : Promise.resolve(""),
    ]);

  const l2 = wantRecall
    ? await recallMemories(scope.principalUserId, scope.orgId, userMessage, {
        customerId: scope.customerId,
        projectId: scope.projectId,
        limit: 5,
      }).catch(() => [])
    : [];

  const workBlock = buildContextBlock(work);
  loaded.push("work");
  if (company) loaded.push("company");

  let projectBlock = "";
  if (projectDeep) {
    projectBlock = buildProjectDeepBlock(projectDeep);
    loaded.push("project:deep");
  } else if (projectLight) {
    projectBlock = `\n\n## 项目工作台上下文（自动注入，勿要求用户重复提供）\n${projectLight}`;
    loaded.push("project:light");
  }

  const memoryBlock = includeMemory
    ? buildUserMemoryBlock(
        wakeUp.l0,
        budget === "FAST" ? [] : wakeUp.l1,
        l2,
      )
    : "";
  if (memoryBlock) loaded.push(budget === "FAST" ? "memory:l0" : "memory:l0+l1+l2");

  const salesBlock = sales ? buildSalesContextBlock(sales) : "";
  if (salesBlock) loaded.push("sales");
  if (approvals) loaded.push("pending_approvals");

  return {
    budget,
    blocks: {
      company,
      work: workBlock,
      project: projectBlock,
      memory: memoryBlock,
      sales: salesBlock,
      pendingApprovals: approvals,
    },
    systemPromptSuffix:
      company + workBlock + projectBlock + memoryBlock + salesBlock + approvals,
    meta: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      traceId: scope.traceId,
      loaded,
    },
  };
}
