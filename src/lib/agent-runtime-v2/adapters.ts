/**
 * Runtime V2 工具适配层 — 不直连任意 service 绕过审批。
 * 写操作只 createDraft；读/分析可查库或调 Grader。
 *
 * P0 Execution Alignment（#88）：本文件的 handler map 是
 * server-authoritative 可执行工具注册表——一个工具"可执行"当且仅当
 * 它在 RUNTIME_V2_TOOL_HANDLERS 中有 handler。tool-catalog 的 planner
 * 可见投影据此过滤（PLANNER_VISIBLE_TOOLS ⊆ EXECUTABLE_TOOLS，
 * 不可能再出现 planner 可选但执行必失败的 ghost tool）。
 *
 * P0 Dynamic Aggregation（#89）：adapter 不再按黄金模板字面 stepKey
 * （s1_pipeline/s3_followup_analysis/s5_prioritize…）读取上游证据；
 * 一律按业务语义形状（grader 标记 / opportunities / prioritized 列表）
 * 在 ctx.priorEvidence 内识别。workforce 契约任务的 priorEvidence 已由
 * executor 收敛为 step.dependsOn 声明的上游（声明序）；legacy runtime_v2
 * 保持全量证据 map，语义识别对两者同样成立。
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import { runCustomerFollowupGrader } from "@/lib/ai-grader/graders/customer-followup-grader";
import { runQuoteRiskGrader } from "@/lib/ai-grader/graders/quote-risk-grader";
import { isGmailDraftEnabled } from "@/lib/google-email";
import { classifyGraderError } from "./grader-errors";
import { buildRuntimeV2OperationKey } from "./idempotency";
import { prioritizeFollowups, type PrioritizeOpportunity } from "./prioritize";
import { TENDER_WORKFORCE_TOOL_HANDLERS } from "@/lib/tender-workforce/tools";

export type AdapterContext = {
  orgId: string;
  userId: string;
  role: string;
  runId: string;
  threadId?: string | null;
  /** 关联助手消息，供刷新后挂载 ApprovalCard */
  assistantMessageId?: string | null;
  stepKey: string;
  /** 稳定业务操作键（不含 attempt） */
  operationKey: string;
  /**
   * 前序步骤输出汇总。workforce 契约任务（spec valid）由 executor 按
   * step.dependsOn 声明收敛（scoped，声明序）；legacy runtime_v2 与
   * true-legacy workforce step 保持全量 map（行为不变，§13 兼容）。
   */
  priorEvidence: Record<string, unknown>;
  /**
   * Phase 2B-1（workforce_job 任务专属）：server 构建的 Worker 执行上下文
   * （workerKey/role/objective/validated 上游 Handoff）。仅用于任务执行
   * 上下文与审计，绝不参与鉴权——Tool 授权仍由 canInvokeTool / scope /
   * 审批链独立判定（§12/§16）。legacy runtime_v2 恒为 undefined。
   */
  workforce?: import("@/lib/workforce-runtime/handoff").WorkforceExecutionContext;
};

export type AdapterResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  pendingActionId?: string;
  requiresApproval?: boolean;
};

type RuntimeV2ToolHandler = (ctx: AdapterContext) => Promise<AdapterResult>;

function nextFridayIso(): string {
  const d = new Date();
  const day = d.getDay();
  const add = day <= 5 ? 5 - day : 7 - day + 5;
  d.setDate(d.getDate() + (add === 0 ? 7 : add));
  d.setHours(15, 0, 0, 0);
  return d.toISOString();
}

function draftActionId(draft: { success: boolean; data: unknown }): string | null {
  if (!draft.success || !draft.data || typeof draft.data !== "object") return null;
  const id = (draft.data as { actionId?: string }).actionId;
  return typeof id === "string" ? id : null;
}

function truncateText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── 语义证据识别（#89：业务语义来自内容形状，不来自 stepKey 字面量）──

type EvidenceRecord = Record<string, unknown>;

/** priorEvidence 中的对象型条目（保持 map 插入序 = 依赖声明序/步骤序） */
function evidenceRecords(prior: Record<string, unknown>): EvidenceRecord[] {
  return Object.values(prior).filter(
    (v): v is EvidenceRecord =>
      !!v && typeof v === "object" && !Array.isArray(v),
  );
}

/** 跟进分析证据：CustomerFollowupGrader 输出（含 fallback 降级形态） */
export function findFollowupAnalysisEvidence(
  prior: Record<string, unknown>,
): EvidenceRecord | null {
  for (const v of evidenceRecords(prior)) {
    if (typeof v.grader === "string" && v.grader.startsWith("customer_followup")) {
      return v;
    }
  }
  return null;
}

/** 报价风险证据：QuoteRiskGrader 输出（含 fallback 降级形态） */
export function findQuoteRiskEvidence(
  prior: Record<string, unknown>,
): EvidenceRecord | null {
  for (const v of evidenceRecords(prior)) {
    if (typeof v.grader === "string" && v.grader.startsWith("quote_risk")) {
      return v;
    }
  }
  return null;
}

/** 商机列表证据：opportunities 数组（列表工具）或 pipeline sample */
export function findOpportunityListEvidence(
  prior: Record<string, unknown>,
): Array<Record<string, unknown>> {
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.opportunities)) {
      return v.opportunities as Array<Record<string, unknown>>;
    }
  }
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.sample) && v.byStage && typeof v.byStage === "object") {
      return v.sample as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export type PrioritizedEvidenceEntry = {
  customerId: string;
  customerName: string;
  email?: string | null;
  opportunityId?: string;
  reasons?: string[];
};

/** 优先客户证据：prioritized 数组（sales_prioritize_followups 输出形状） */
export function findPrioritizedEvidence(
  prior: Record<string, unknown>,
): PrioritizedEvidenceEntry[] {
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.prioritized)) {
      return (v.prioritized as Array<Record<string, unknown>>)
        .filter(
          (p): p is Record<string, unknown> =>
            !!p && typeof p === "object" && typeof p.customerId === "string",
        )
        .map((p) => ({
          customerId: p.customerId as string,
          customerName:
            typeof p.customerName === "string" ? p.customerName : "未知客户",
          email: typeof p.email === "string" ? p.email : null,
          opportunityId:
            typeof p.opportunityId === "string" ? p.opportunityId : undefined,
          reasons: Array.isArray(p.reasons)
            ? (p.reasons as unknown[]).filter(
                (r): r is string => typeof r === "string",
              )
            : undefined,
        }));
    }
  }
  return [];
}

const MAX_CUSTOMER_TARGETS = 5;

/**
 * 从声明依赖证据推导客户目标（#88 读 adapter 的目标定位）：
 * prioritized → customers 列表 → 标量 customerId → Handoff businessRefs。
 * 结果仅作查询候选——所有查询仍强制 orgId scope，跨 org id 自然查不到。
 */
export function deriveCustomerTargetIds(
  prior: Record<string, unknown>,
): string[] {
  const seen = new Set<string>();
  const push = (id: unknown) => {
    if (
      typeof id === "string" &&
      id.length > 0 &&
      !seen.has(id) &&
      seen.size < MAX_CUSTOMER_TARGETS
    ) {
      seen.add(id);
    }
  };
  for (const p of findPrioritizedEvidence(prior)) push(p.customerId);
  for (const v of evidenceRecords(prior)) {
    if (Array.isArray(v.customers)) {
      for (const c of v.customers as Array<Record<string, unknown>>) {
        if (c && typeof c === "object") push(c.id);
      }
    }
  }
  for (const v of evidenceRecords(prior)) push(v.customerId);
  for (const v of evidenceRecords(prior)) {
    const handoff = v.workforceHandoff;
    if (handoff && typeof handoff === "object" && !Array.isArray(handoff)) {
      const refs = (handoff as Record<string, unknown>).businessRefs;
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          if (typeof ref === "string" && ref.startsWith("customer:")) {
            push(ref.slice("customer:".length));
          }
        }
      }
    }
  }
  return [...seen];
}

async function runGraderWithGuardedFallback(
  name: "customer_followup" | "quote_risk",
  ctx: AdapterContext,
  run: () => Promise<unknown>,
  fallback: () => Promise<Record<string, unknown>>,
): Promise<AdapterResult> {
  const label = name === "customer_followup" ? "跟进优先级分析" : "报价风险分析";
  try {
    const result = await run();
    const issues = (result as { issues?: unknown[] } | null)?.issues;
    const issueCount = Array.isArray(issues) ? issues.length : undefined;
    return {
      ok: true,
      data: {
        grader: name,
        result: result as Record<string, unknown>,
        degraded: false,
        evidenceQuality: "FULL",
        summary:
          issueCount !== undefined
            ? `${label}完成：发现 ${issueCount} 项需关注问题`
            : `${label}完成（完整证据）`,
      },
    };
  } catch (err) {
    const classified = classifyGraderError(err);
    if (!classified.degradable) {
      return {
        ok: false,
        error: `${classified.code}: ${classified.message}`,
        data: {
          grader: name,
          errorCode: classified.code,
          degraded: false,
          evidenceQuality: "NONE",
        },
      };
    }
    const fb = await fallback();
    return {
      ok: true,
      data: {
        grader: `${name}_fallback`,
        ...fb,
        degraded: true,
        degradationReason: `${classified.code}: ${classified.message}`,
        evidenceQuality: "PARTIAL",
        summary: `${label}降级完成（Grader 不可用，使用数据库兜底证据）`,
      },
    };
  }
}

// ── Executable Tool Registry（#88 单一事实源）─────────────────────
//
// 一个工具在此 map 中有 handler ⇔ server 可执行。executeRuntimeV2Tool
// 从本 map 分发；tool-catalog 的 planner 投影按本 map 过滤。允许
// EXECUTABLE ⊋ PLANNER_VISIBLE（internal-only 工具），绝不允许反向。

const RUNTIME_V2_TOOL_HANDLERS: Record<string, RuntimeV2ToolHandler> = {
  sales_get_pipeline: async (ctx) => {
    const opps = await db.salesOpportunity.findMany({
      where: {
        orgId: ctx.orgId,
        stage: { notIn: ["signed", "completed", "lost"] },
      },
      select: {
        id: true,
        stage: true,
        estimatedValue: true,
        nextFollowupAt: true,
        updatedAt: true,
        installDate: true,
        measureDate: true,
        customerId: true,
        customer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });
    const byStage: Record<string, number> = {};
    for (const o of opps) {
      byStage[o.stage] = (byStage[o.stage] ?? 0) + 1;
    }
    const stageBrief = Object.entries(byStage)
      .map(([s, n]) => `${s}=${n}`)
      .join("，");
    return {
      ok: true,
      data: {
        opportunityCount: opps.length,
        byStage,
        sample: opps.slice(0, 15),
        summary: truncateText(
          `Pipeline 共 ${opps.length} 个活跃商机；阶段分布：${stageBrief || "无"}`,
          300,
        ),
      },
    };
  },

  sales_list_opportunities: async (ctx) => {
    const opps = await db.salesOpportunity.findMany({
      where: {
        orgId: ctx.orgId,
        stage: { notIn: ["signed", "completed", "lost"] },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        quotes: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true, updatedAt: true, status: true, sentAt: true },
        },
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
    const top = opps
      .slice(0, 3)
      .map((o) => o.customer?.name ?? o.title)
      .join("、");
    return {
      ok: true,
      data: {
        opportunities: opps,
        summary: truncateText(
          `读取 ${opps.length} 条活跃商机${top ? `（近期更新：${top}）` : ""}`,
          300,
        ),
      },
    };
  },

  // ── #88 新增：客户读工具（曾为 ghost tool）。全部 org-scoped、有界、
  // 只读；目标客户优先从声明依赖证据推导，无线索时回退组织内近期记录。──

  sales_search_customers: async (ctx) => {
    const customers = await db.salesCustomer.findMany({
      where: { orgId: ctx.orgId, archivedAt: null, status: { not: "dormant" } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        tags: true,
        source: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return {
      ok: true,
      data: {
        customers,
        count: customers.length,
        summary: truncateText(
          `检索到 ${customers.length} 个活跃客户（按最近更新排序，最多 20 条）`,
          300,
        ),
      },
    };
  },

  sales_get_customer: async (ctx) => {
    const targets = deriveCustomerTargetIds(ctx.priorEvidence);
    const customers = await db.salesCustomer.findMany({
      where: {
        orgId: ctx.orgId,
        archivedAt: null,
        ...(targets.length > 0 ? { id: { in: targets } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        status: true,
        tags: true,
        source: true,
        createdAt: true,
        updatedAt: true,
        opportunities: {
          select: {
            id: true,
            title: true,
            stage: true,
            estimatedValue: true,
            nextFollowupAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 5,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: targets.length > 0 ? MAX_CUSTOMER_TARGETS : 5,
    });
    const names = customers.map((c) => c.name).join("、");
    return {
      ok: true,
      data: {
        customers,
        targetSource: targets.length > 0 ? "dependency_evidence" : "recent_fallback",
        summary: truncateText(
          targets.length > 0
            ? `读取 ${customers.length} 个上游证据定位客户的详情：${names}`
            : `上游证据未定位到具体客户，读取组织内近期 ${customers.length} 个客户详情：${names}`,
          300,
        ),
      },
    };
  },

  sales_get_customer_interactions: async (ctx) => {
    const targets = deriveCustomerTargetIds(ctx.priorEvidence);
    const interactions = await db.customerInteraction.findMany({
      where: {
        orgId: ctx.orgId,
        ...(targets.length > 0 ? { customerId: { in: targets } } : {}),
      },
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        type: true,
        direction: true,
        channel: true,
        outcome: true,
        summary: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const bounded = interactions.map((ix) => ({
      ...ix,
      summary: truncateText(ix.summary ?? "", 300),
    }));
    return {
      ok: true,
      data: {
        interactions: bounded,
        count: bounded.length,
        targetSource: targets.length > 0 ? "dependency_evidence" : "recent_fallback",
        summary: truncateText(
          `读取 ${bounded.length} 条客户互动记录${
            targets.length > 0 ? "（上游证据定位客户）" : "（组织内近期）"
          }`,
          300,
        ),
      },
    };
  },

  sales_get_customer_quotes: async (ctx) => {
    const targets = deriveCustomerTargetIds(ctx.priorEvidence);
    const quotes = await db.salesQuote.findMany({
      where: {
        orgId: ctx.orgId,
        ...(targets.length > 0 ? { customerId: { in: targets } } : {}),
      },
      select: {
        id: true,
        customerId: true,
        opportunityId: true,
        version: true,
        status: true,
        grandTotal: true,
        currency: true,
        sentAt: true,
        viewedAt: true,
        signedAt: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    const byStatus: Record<string, number> = {};
    for (const q of quotes) {
      byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
    }
    const statusBrief = Object.entries(byStatus)
      .map(([s, n]) => `${s}=${n}`)
      .join("，");
    return {
      ok: true,
      data: {
        quotes,
        count: quotes.length,
        byStatus,
        targetSource: targets.length > 0 ? "dependency_evidence" : "recent_fallback",
        summary: truncateText(
          `读取 ${quotes.length} 份报价${
            targets.length > 0 ? "（上游证据定位客户）" : "（组织内近期）"
          }；状态分布：${statusBrief || "无"}`,
          300,
        ),
      },
    };
  },

  sales_customer_followup_analysis: async (ctx) => {
    return runGraderWithGuardedFallback(
      "customer_followup",
      ctx,
      () =>
        runCustomerFollowupGrader({
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          mode: "GLOBAL",
        }),
      async () => {
        const stale = await db.salesOpportunity.findMany({
          where: {
            orgId: ctx.orgId,
            stage: { notIn: ["signed", "completed", "lost"] },
            OR: [
              { nextFollowupAt: { lte: new Date() } },
              {
                nextFollowupAt: null,
                updatedAt: { lte: new Date(Date.now() - 14 * 86400000) },
              },
            ],
          },
          include: {
            customer: { select: { id: true, name: true, email: true } },
          },
          take: 20,
        });
        return { staleOpportunities: stale };
      },
    );
  },

  sales_quote_risk_analysis: async (ctx) => {
    return runGraderWithGuardedFallback(
      "quote_risk",
      ctx,
      () =>
        runQuoteRiskGrader({
          orgId: ctx.orgId,
          userId: ctx.userId,
          role: ctx.role,
          mode: "GLOBAL",
        }),
      async () => {
        const quotes = await db.salesQuote.findMany({
          where: { orgId: ctx.orgId },
          orderBy: { updatedAt: "desc" },
          take: 15,
          include: { customer: { select: { id: true, name: true } } },
        });
        return { recentQuotes: quotes };
      },
    );
  },

  sales_prioritize_followups: async (ctx) => {
    // #89：证据按业务语义识别（依赖声明是消费权威；不查字面 stepKey）
    const prior = ctx.priorEvidence;
    const followupAnalysis = findFollowupAnalysisEvidence(prior);
    const quoteRiskAnalysis = findQuoteRiskEvidence(prior);
    if (!followupAnalysis || !quoteRiskAnalysis) {
      return {
        ok: false,
        error:
          "MISSING_GRADER_EVIDENCE: 声明依赖中缺少跟进分析或报价风险分析证据（该任务必须依赖已完成的两类分析任务）",
      };
    }
    const rawOpps = findOpportunityListEvidence(prior);
    const opportunities: PrioritizeOpportunity[] = (
      rawOpps as Array<{
        id?: string;
        customerId?: string;
        customer?: { id?: string; name?: string; email?: string | null };
        nextFollowupAt?: string | Date | null;
        updatedAt?: string | Date;
        stage?: string;
        estimatedValue?: number | null;
        installDate?: string | Date | null;
        measureDate?: string | Date | null;
        quotes?: Array<{
          updatedAt?: string | Date;
          sentAt?: string | Date | null;
          status?: string;
        }>;
        interactions?: Array<{ createdAt?: string | Date }>;
      }>
    )
      .filter((o) => o.id && (o.customerId || o.customer?.id))
      .map((o) => {
        const lastQuote = o.quotes?.[0];
        const lastIx = o.interactions?.[0]?.createdAt;
        return {
          id: o.id!,
          customerId: (o.customerId ?? o.customer?.id)!,
          customerName: o.customer?.name ?? "未知客户",
          email: o.customer?.email ?? null,
          stage: o.stage,
          estimatedValue: o.estimatedValue,
          nextFollowupAt: o.nextFollowupAt,
          updatedAt: o.updatedAt,
          expectedCloseDate: o.installDate ?? o.measureDate ?? null,
          lastInteractionAt: lastIx ?? null,
          quoteSentAt: lastQuote?.sentAt ?? lastQuote?.updatedAt ?? null,
        };
      });

    const ranked = prioritizeFollowups({
      opportunities,
      followupAnalysis,
      quoteRiskAnalysis,
      limit: 3,
    });
    const names = ranked.prioritized
      .map((p) => `${p.customerName}(${p.score})`)
      .join("、");
    return {
      ok: true,
      data: {
        ...ranked,
        operationKey: ctx.operationKey,
        summary: truncateText(
          ranked.prioritized.length > 0
            ? `选出 ${ranked.prioritized.length} 个优先跟进客户：${names}`
            : "无需要优先跟进的客户",
          300,
        ),
      },
    };
  },

  grader_create_followup_task: async (ctx) => {
    // #89：优先客户按语义形状识别（不再读字面 s5_prioritize）
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    if (prioritized.length === 0) {
      return { ok: true, data: { skipped: true, reason: "无优先客户" } };
    }
    const targets = prioritized.slice(0, 3);
    const startTime = nextFridayIso();
    const endTime = new Date(
      new Date(startTime).getTime() + 30 * 60_000,
    ).toISOString();
    const actionIds: string[] = [];
    for (const t of targets) {
      const targetId = t.opportunityId || t.customerId;
      const idempotencyKey = buildRuntimeV2OperationKey({
        runId: ctx.runId,
        stepKey: ctx.stepKey,
        actionType: "calendar.create_event",
        targetId,
      });
      const draft = await createDraft({
        type: "calendar.create_event",
        title: `跟进提醒：${t.customerName}`,
        preview: t.reasons?.[0] ?? "销售跟进提醒",
        payload: {
          title: `跟进客户 ${t.customerName}`,
          description: t.reasons?.join("；") ?? "Runtime V2 建议跟进",
          startTime,
          endTime,
          metadata: {
            orgId: ctx.orgId,
            customerId: t.customerId,
            opportunityId: t.opportunityId,
            source: "agent_runtime_v2",
            stepKey: ctx.stepKey,
            idempotencyKey,
          },
        },
        userId: ctx.userId,
        orgId: ctx.orgId,
        agentRunId: ctx.runId,
        threadId: ctx.threadId ?? undefined,
        messageId: ctx.assistantMessageId ?? undefined,
        idempotencyKey,
      });
      const id = draftActionId(draft);
      if (id) actionIds.push(id);
    }
    if (actionIds.length === 0) {
      return { ok: false, error: "创建跟进任务草稿失败" };
    }
    return {
      ok: true,
      requiresApproval: true,
      pendingActionId: actionIds[0],
      data: {
        pendingActionIds: actionIds,
        count: actionIds.length,
        summary: `已创建 ${actionIds.length} 个跟进任务草稿，等待审批`,
      },
    };
  },

  sales_update_followup: async (ctx) => {
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    const withOpp = prioritized.filter((t) => t.opportunityId).slice(0, 2);
    if (withOpp.length === 0) {
      return { ok: true, data: { skipped: true, reason: "无可改期商机" } };
    }
    const nextAt = nextFridayIso();
    const actionIds: string[] = [];
    for (const t of withOpp) {
      const opp = await db.salesOpportunity.findFirst({
        where: { id: t.opportunityId!, orgId: ctx.orgId },
        select: { id: true, title: true, nextFollowupAt: true },
      });
      if (!opp) continue;
      const idempotencyKey = buildRuntimeV2OperationKey({
        runId: ctx.runId,
        stepKey: ctx.stepKey,
        actionType: "sales.update_followup",
        targetId: opp.id,
      });
      const draft = await createDraft({
        type: "sales.update_followup",
        title: `调整跟进日期：${t.customerName}`,
        preview: `下次跟进 → ${nextAt}`,
        payload: {
          opportunityId: opp.id,
          opportunityTitle: opp.title ?? t.customerName,
          customerName: t.customerName,
          previousFollowupAt: opp.nextFollowupAt
            ? opp.nextFollowupAt.toISOString()
            : null,
          nextFollowupAt: nextAt,
          note: "Runtime V2 建议",
          metadata: {
            orgId: ctx.orgId,
            customerId: t.customerId,
            source: "agent_runtime_v2",
            stepKey: ctx.stepKey,
            idempotencyKey,
          },
        },
        userId: ctx.userId,
        orgId: ctx.orgId,
        agentRunId: ctx.runId,
        threadId: ctx.threadId ?? undefined,
        messageId: ctx.assistantMessageId ?? undefined,
        idempotencyKey,
      });
      const id = draftActionId(draft);
      if (id) actionIds.push(id);
    }
    if (actionIds.length === 0) {
      return { ok: false, error: "创建跟进日期草稿失败" };
    }
    return {
      ok: true,
      requiresApproval: true,
      pendingActionId: actionIds[0],
      data: {
        pendingActionIds: actionIds,
        nextFollowupAt: nextAt,
        summary: `已创建 ${actionIds.length} 个跟进改期草稿（→ ${nextAt.slice(0, 10)}），等待审批`,
      },
    };
  },

  gmail_create_draft: async (ctx) => {
    if (!isGmailDraftEnabled()) {
      return {
        ok: false,
        error: "FEATURE_NOT_CONFIGURED: GMAIL_DRAFT_DISABLED",
      };
    }
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    const withEmail = prioritized.filter((t) => t.email).slice(0, 3);
    if (withEmail.length === 0) {
      return { ok: true, data: { skipped: true, reason: "优先客户无邮箱" } };
    }
    const actionIds: string[] = [];
    for (const t of withEmail) {
      const subject = `跟进：${t.customerName}`;
      const body = `<p>您好，${t.customerName}：</p><p>想跟进一下当前进展。${t.reasons?.[0] ?? ""}</p><p>方便时请回复，谢谢。</p>`;
      const idempotencyKey = buildRuntimeV2OperationKey({
        runId: ctx.runId,
        stepKey: ctx.stepKey,
        actionType: "grader.email_draft",
        targetId: t.customerId,
      });
      const draft = await createDraft({
        type: "grader.email_draft",
        title: `邮件草稿：${t.email}`,
        preview: subject,
        payload: {
          to: t.email,
          subject,
          body,
          targetType: "CUSTOMER",
          targetId: t.customerId,
          source: "GRADER",
          metadata: {
            orgId: ctx.orgId,
            customerId: t.customerId,
            source: "agent_runtime_v2",
            stepKey: ctx.stepKey,
            idempotencyKey,
          },
        },
        userId: ctx.userId,
        orgId: ctx.orgId,
        agentRunId: ctx.runId,
        threadId: ctx.threadId ?? undefined,
        messageId: ctx.assistantMessageId ?? undefined,
        idempotencyKey,
      });
      const id = draftActionId(draft);
      if (id) actionIds.push(id);
    }
    if (actionIds.length === 0) {
      return { ok: false, error: "创建 Gmail 草稿 PendingAction 失败" };
    }
    return {
      ok: true,
      requiresApproval: true,
      pendingActionId: actionIds[0],
      data: {
        pendingActionIds: actionIds,
        count: actionIds.length,
        summary: `已创建 ${actionIds.length} 封邮件草稿，等待审批`,
      },
    };
  },

  // #88 新增（曾为 ghost tool）：日历提醒草稿。严格走 createDraft →
  // PendingAction → 审批 → 既有 executor 的外部执行路径；本 adapter
  // 本身零外部副作用（绝不直连 Google Calendar）。
  calendar_create_event_draft: async (ctx) => {
    const prioritized = findPrioritizedEvidence(ctx.priorEvidence);
    const targets = prioritized.slice(0, 3);
    if (targets.length === 0) {
      return {
        ok: true,
        data: { skipped: true, reason: "无可安排日历提醒的优先客户" },
      };
    }
    const startTime = nextFridayIso();
    const endTime = new Date(
      new Date(startTime).getTime() + 30 * 60_000,
    ).toISOString();
    const actionIds: string[] = [];
    for (const t of targets) {
      const targetId = t.opportunityId || t.customerId;
      const idempotencyKey = buildRuntimeV2OperationKey({
        runId: ctx.runId,
        stepKey: ctx.stepKey,
        actionType: "calendar.create_event",
        targetId,
      });
      const draft = await createDraft({
        type: "calendar.create_event",
        title: `日历提醒：${t.customerName}`,
        preview: t.reasons?.[0] ?? "销售跟进日历提醒",
        payload: {
          title: `跟进提醒 ${t.customerName}`,
          description: t.reasons?.join("；") ?? "Runtime V2 建议的日历提醒",
          startTime,
          endTime,
          metadata: {
            orgId: ctx.orgId,
            customerId: t.customerId,
            opportunityId: t.opportunityId,
            source: "agent_runtime_v2",
            stepKey: ctx.stepKey,
            idempotencyKey,
          },
        },
        userId: ctx.userId,
        orgId: ctx.orgId,
        agentRunId: ctx.runId,
        threadId: ctx.threadId ?? undefined,
        messageId: ctx.assistantMessageId ?? undefined,
        idempotencyKey,
      });
      const id = draftActionId(draft);
      if (id) actionIds.push(id);
    }
    if (actionIds.length === 0) {
      return { ok: false, error: "创建日历提醒草稿失败" };
    }
    return {
      ok: true,
      requiresApproval: true,
      pendingActionId: actionIds[0],
      data: {
        pendingActionIds: actionIds,
        count: actionIds.length,
        summary: `已创建 ${actionIds.length} 个日历提醒草稿，等待审批`,
      },
    };
  },

  // ── Tender T1B（internal-only 工具组）：可执行但不入
  // RUNTIME_V2_TOOL_CATALOG（EXECUTABLE ⊋ PLANNER_VISIBLE 方向，上方
  // 注释明确允许）。仅 tender workforce job 经 workforce-runtime/scope
  // 的域白名单在规划期可见；handler 执行期自证 workDomain=tender，
  // 非 tender run 调用 fail-closed。业务写入全走 canonical tender service。
  ...TENDER_WORKFORCE_TOOL_HANDLERS,
};

/** server-authoritative 可执行判定（#88 §6）：有 handler ⇔ 可执行 */
export function isRuntimeV2ToolExecutable(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    RUNTIME_V2_TOOL_HANDLERS,
    toolName,
  );
}

/** 可执行工具全集（含未来 internal-only 工具；允许 ⊋ planner 可见集） */
export function listExecutableRuntimeV2ToolNames(): string[] {
  return Object.keys(RUNTIME_V2_TOOL_HANDLERS);
}

export async function executeRuntimeV2Tool(
  toolName: string,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const handler = RUNTIME_V2_TOOL_HANDLERS[toolName];
  if (!handler) {
    return { ok: false, error: `Unsupported tool: ${toolName}` };
  }
  return handler(ctx);
}
