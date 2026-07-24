/**
 * Runtime V2 工具适配层 — 不直连任意 service 绕过审批。
 * 写操作只 createDraft；读/分析可查库或调 Grader。
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import { runCustomerFollowupGrader } from "@/lib/ai-grader/graders/customer-followup-grader";
import { runQuoteRiskGrader } from "@/lib/ai-grader/graders/quote-risk-grader";
import { isGmailDraftEnabled } from "@/lib/google-email";
import { classifyGraderError } from "./grader-errors";
import { buildRuntimeV2OperationKey } from "./idempotency";
import { prioritizeFollowups, type PrioritizeOpportunity } from "./prioritize";

export type AdapterContext = {
  orgId: string;
  userId: string;
  role: string;
  runId: string;
  threadId?: string | null;
  stepKey: string;
  /** 稳定业务操作键（不含 attempt） */
  operationKey: string;
  /** 前序步骤输出汇总 */
  priorEvidence: Record<string, unknown>;
};

export type AdapterResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  pendingActionId?: string;
  requiresApproval?: boolean;
};

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

async function runGraderWithGuardedFallback(
  name: "customer_followup" | "quote_risk",
  ctx: AdapterContext,
  run: () => Promise<unknown>,
  fallback: () => Promise<Record<string, unknown>>,
): Promise<AdapterResult> {
  try {
    const result = await run();
    return {
      ok: true,
      data: {
        grader: name,
        result: result as Record<string, unknown>,
        degraded: false,
        evidenceQuality: "FULL",
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
      },
    };
  }
}

export async function executeRuntimeV2Tool(
  toolName: string,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  switch (toolName) {
    case "sales_get_pipeline": {
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
      return {
        ok: true,
        data: {
          opportunityCount: opps.length,
          byStage,
          sample: opps.slice(0, 15),
        },
      };
    }
    case "sales_list_opportunities": {
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
      return { ok: true, data: { opportunities: opps } };
    }
    case "sales_customer_followup_analysis": {
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
    }
    case "sales_quote_risk_analysis": {
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
    }
    case "sales_prioritize_followups": {
      const prior = ctx.priorEvidence;
      const s2 = prior.s2_opportunities as {
        opportunities?: Array<Record<string, unknown>>;
      } | null;
      const s3 = prior.s3_followup_analysis;
      const s4 = prior.s4_quote_risk;
      if (!s3 || !s4) {
        return {
          ok: false,
          error: "MISSING_GRADER_EVIDENCE: 必须先完成 s3/s4 分析步骤",
        };
      }
      const rawOpps =
        s2?.opportunities ??
        (prior.s1_pipeline as { sample?: Array<Record<string, unknown>> })
          ?.sample ??
        [];
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
        followupAnalysis: s3,
        quoteRiskAnalysis: s4,
        limit: 3,
      });
      return {
        ok: true,
        data: {
          ...ranked,
          operationKey: ctx.operationKey,
        },
      };
    }
    case "grader_create_followup_task": {
      const prioritized =
        (
          ctx.priorEvidence.s5_prioritize as {
            prioritized?: Array<{
              customerId: string;
              customerName: string;
              opportunityId?: string;
              reasons?: string[];
            }>;
          }
        )?.prioritized ?? [];
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
        data: { pendingActionIds: actionIds, count: actionIds.length },
      };
    }
    case "sales_update_followup": {
      const prioritized =
        (
          ctx.priorEvidence.s5_prioritize as {
            prioritized?: Array<{
              customerId: string;
              customerName: string;
              opportunityId?: string;
            }>;
          }
        )?.prioritized ?? [];
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
        data: { pendingActionIds: actionIds, nextFollowupAt: nextAt },
      };
    }
    case "gmail_create_draft": {
      if (!isGmailDraftEnabled()) {
        return {
          ok: false,
          error: "FEATURE_NOT_CONFIGURED: GMAIL_DRAFT_DISABLED",
        };
      }
      const prioritized =
        (
          ctx.priorEvidence.s5_prioritize as {
            prioritized?: Array<{
              customerId: string;
              customerName: string;
              email?: string | null;
              reasons?: string[];
            }>;
          }
        )?.prioritized ?? [];
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
        data: { pendingActionIds: actionIds, count: actionIds.length },
      };
    }
    default:
      return { ok: false, error: `Unsupported tool: ${toolName}` };
  }
}
