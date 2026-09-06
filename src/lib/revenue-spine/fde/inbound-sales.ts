/**
 * Revenue Spine — Mengxin Inbound Sales FDE（PART 4 / 5 / 6 / 15 / 16）
 *
 * 确定性流水线（每一步 = AgentRunEvent，可追踪 trigger / input / tools / facts / decision / action / approval）：
 *   research → extract RFQ(+evidence) → knowledge → score → qualify(stage) → missing info → draft
 *   → requestApproval(sales.send_inquiry_reply) → next action
 *
 * 允许自动执行：研究 / 抽取 / 分类 / 评分 / 缺失信息 / 草稿生成 / 提醒。
 * 必须人工审批：发送首次销售邮件（本 FDE 唯一的外部副作用，经 PendingAction）。
 * 禁止：自动发送、承诺 MOQ/价格/交期/认证/付款/折扣（草稿守卫）。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { requestApproval } from "@/lib/approval/request";
import { rejectApprovalItem } from "@/lib/approval/port";
import {
  appendAgentRunEvent,
  completeAgentRun,
  createAgentRun,
  failAgentRun,
  updateAgentRunStatus,
} from "@/lib/agent-runtime/run";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { markFdeTouch } from "../attribution";
import { loadFactoryKnowledge, summarizeKnowledge } from "../factory-knowledge";
import { applyNextAction } from "../next-action";
import { OpportunityStage, toCanonicalStage, type OpportunityStage as Stage } from "../opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "../policy";
import { buildReplyDraft, polishReplyDraftWithLlm, type ReplyDraft } from "../reply-draft";
import { classifyInquiry, type InquiryResearch } from "../research";
import { extractRfq } from "../rfq/extract";
import { buildClarifyingQuestions, computeMissingFields, type ClarifyingQuestion } from "../rfq/missing-info";
import { upsertRfq } from "../rfq/persist";
import type { RfqField, RfqFields } from "../rfq/types";
import { scoreOpportunity, type OpportunityScoreResult } from "../scoring";
import { transitionOpportunity } from "../transition";
import { FDE_EMPLOYEE_KEY, updateFdeAction } from "./actions";

export const FDE_RUN_TYPE = "fde_inbound_sales";
export const FDE_CHANNEL = "fde";
export const INQUIRY_REPLY_ACTION_TYPE = "sales.send_inquiry_reply";

export type FdeTrigger = "inquiry" | "customer_reply" | "manual" | "cron";

export interface RunInboundFdeInput {
  orgId: string;
  opportunityId: string;
  salesActionId?: string | null;
  trigger: FdeTrigger;
  actorUserId?: string | null;
  /** 默认 true；无 OPENAI_API_KEY 时自动退化为确定性路径 */
  useLlm?: boolean;
  now?: Date;
  policy?: RevenueSpinePolicy;
}

export interface InboundFdeResult {
  ok: boolean;
  agentRunId: string | null;
  opportunityId: string;
  stage: string;
  score: number | null;
  grade: string | null;
  missing: RfqField[];
  questions: ClarifyingQuestion[];
  rfqId: string | null;
  assessmentId: string | null;
  draft: ReplyDraft | null;
  pendingActionId: string | null;
  approvalRequired: boolean;
  error?: string;
  errorCode?: string;
}

function json(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;
}

async function safeTransition(
  orgId: string,
  opportunityId: string,
  to: Stage,
  ctx: { salesActionId: string | null; agentRunId: string; policy: RevenueSpinePolicy; now: Date; reason?: string },
): Promise<string> {
  const r = await transitionOpportunity({
    orgId,
    opportunityId,
    to,
    actorUserId: null,
    source: "fde",
    reason: ctx.reason ?? null,
    salesActionId: ctx.salesActionId,
    agentRunId: ctx.agentRunId,
    policy: ctx.policy,
    now: ctx.now,
  });
  if (r.ok) return r.to;
  const cur = await db.salesOpportunity.findUnique({ where: { id: opportunityId }, select: { stage: true } });
  return cur?.stage ?? to;
}

export async function runInboundSalesFde(input: RunInboundFdeInput): Promise<InboundFdeResult> {
  const now = input.now ?? new Date();
  const orgId = input.orgId;
  const base: InboundFdeResult = {
    ok: false,
    agentRunId: null,
    opportunityId: input.opportunityId,
    stage: "",
    score: null,
    grade: null,
    missing: [],
    questions: [],
    rfqId: null,
    assessmentId: null,
    draft: null,
    pendingActionId: null,
    approvalRequired: false,
  };

  const opp = await db.salesOpportunity.findFirst({
    where: { id: input.opportunityId, orgId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true, contactName: true, website: true, country: true } },
      interactions: { where: { direction: "inbound" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, content: true, summary: true, channel: true, createdAt: true, language: true } },
    },
  });
  if (!opp) return { ...base, error: "商机不存在或跨组织", errorCode: "NOT_FOUND" };
  base.stage = opp.stage;
  const canonical = toCanonicalStage(opp.stage);
  if (!canonical || canonical !== opp.stage) return { ...base, error: "商机不在 canonical 阶段词表，FDE 不处理", errorCode: "LEGACY_STAGE" };
  if (["won", "lost", "disqualified"].includes(canonical)) return { ...base, error: "商机已终结", errorCode: "TERMINAL" };
  if (!opp.interactions.length) return { ...base, error: "商机没有客户来信可分析", errorCode: "NO_INBOUND" };

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true, name: true } });
  if (!org) return { ...base, error: "组织不存在", errorCode: "NOT_FOUND" };
  const principalUserId = opp.assignedToId ?? org.ownerId;
  const principal = await db.user.findUnique({ where: { id: principalUserId }, select: { id: true, name: true } });
  const senderName = principal?.name?.trim() || "Sales Team";
  const policy = input.policy ?? (await loadRevenueSpinePolicy(orgId));
  const salesActionId = input.salesActionId ?? null;

  // ── AgentRun ──
  let runId: string;
  try {
    const session = await getOrCreateAgentSession({
      orgId,
      userId: principalUserId,
      channel: FDE_CHANNEL,
      channelUserId: FDE_EMPLOYEE_KEY,
      channelConversationId: opp.id,
    });
    const created = await createAgentRun({
      orgId,
      sessionId: session.id,
      runType: FDE_RUN_TYPE,
      intent: `inbound_sales:${input.trigger}`,
      metadata: {
        employeeKey: FDE_EMPLOYEE_KEY,
        opportunityId: opp.id,
        customerId: opp.customerId,
        salesActionId,
        trigger: input.trigger,
        actorUserId: input.actorUserId ?? null,
      },
    });
    runId = created.run.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (salesActionId) {
      await updateFdeAction({ orgId, actionId: salesActionId, inputContextPatch: { fdeStatus: "run_blocked", fdeError: message } }).catch(() => undefined);
    }
    return { ...base, error: message, errorCode: message.includes("配额") ? "QUOTA" : "RUN_CREATE_FAILED" };
  }
  base.agentRunId = runId;
  if (salesActionId) {
    await updateFdeAction({ orgId, actionId: salesActionId, agentRunId: runId, inputContextPatch: { fdeStatus: "running", trigger: input.trigger } }).catch(() => undefined);
  }

  const event = (eventType: Parameters<typeof appendAgentRunEvent>[0]["eventType"], title: string, payload?: Record<string, unknown>) =>
    appendAgentRunEvent({ orgId, runId, eventType, title, payload, visibleToUser: true });

  try {
    await updateAgentRunStatus(orgId, runId, "running");
    await event("run.started", "Inbound Sales FDE 开始", {
      trigger: input.trigger,
      opportunityId: opp.id,
      stage: opp.stage,
      inboundInteractions: opp.interactions.length,
      policyVersion: policy.version,
    });

    let stage: string = opp.stage;
    if (stage === OpportunityStage.NEW_INQUIRY) {
      stage = await safeTransition(orgId, opp.id, OpportunityStage.ENRICHING, { salesActionId, agentRunId: runId, policy, now });
    }

    // ── Step 1 research ──
    const latest = opp.interactions[0];
    const sourceText = opp.interactions
      .slice()
      .reverse()
      .map((i) => i.content ?? i.summary)
      .filter(Boolean)
      .join("\n\n---\n\n");
    await event("tool.started", "research: 识别公司/联系人/国家/行业/买家类型", { tool: "classifyInquiry", interactionId: latest.id });
    const research: InquiryResearch = classifyInquiry({
      name: opp.customer.contactName,
      email: opp.customer.email,
      company: opp.customer.name,
      phone: opp.customer.phone,
      country: opp.customer.country ?? opp.market,
      website: opp.customer.website,
      message: sourceText,
    });
    await event("tool.completed", "research 完成", {
      tool: "classifyInquiry",
      companyName: research.companyName,
      country: research.country,
      industry: research.industry,
      buyerType: research.buyerType,
      buyerTypeConfidence: research.buyerTypeConfidence,
      language: research.language,
      signals: research.signals,
    });

    // ── Step 2 RFQ extraction（证据必须接地） ──
    await event("tool.started", "extract: 结构化 RFQ", { tool: "extractRfq", useLlm: input.useLlm !== false });
    const extraction = await extractRfq({ text: sourceText, policy, orgId, userId: principalUserId, agentRunId: runId, useLlm: input.useLlm, now });
    const persisted = await upsertRfq({
      orgId,
      opportunityId: opp.id,
      customerId: opp.customerId,
      extraction,
      sourceInteractionId: latest.id,
      sourceKind: latest.channel === "website" ? "website_inquiry" : latest.channel === "email" ? "email" : "conversation",
      agentRunId: runId,
    });
    const fields: RfqFields = persisted.fields;
    base.rfqId = persisted.rfq.id;
    await event("tool.completed", "RFQ 抽取完成", {
      tool: "extractRfq",
      method: extraction.method,
      rfqId: persisted.rfq.id,
      status: persisted.status,
      facts: extraction.evidence.map((e) => ({ field: e.field, value: e.value, confidence: e.confidence, by: e.extractedBy })),
      notes: extraction.notes,
    });

    // ── Step 3 factory knowledge（无数据 → unavailable，禁止填值） ──
    await event("retrieval.started", "factory knowledge", { tool: "loadFactoryKnowledge", productCategory: fields.productCategory });
    const knowledge = await loadFactoryKnowledge(orgId, policy, { productCategory: fields.productCategory, customerId: opp.customerId, email: opp.customer.email });
    await event("retrieval.completed", "factory knowledge 完成", { facts: summarizeKnowledge(knowledge) });

    // ── Step 4 score + qualify ──
    const score: OpportunityScoreResult = scoreOpportunity({ fields, research, message: sourceText, policy });
    const assessmentCount = await db.salesOpportunityAssessment.count({ where: { opportunityId: opp.id } });
    const assessment = await db.salesOpportunityAssessment.create({
      data: {
        orgId,
        opportunityId: opp.id,
        version: assessmentCount + 1,
        score: score.score,
        grade: score.grade,
        priority: score.priority,
        dimensionsJson: json(score.dimensions),
        reasoning: score.reasoning,
        missingInformation: json(score.missingInformation),
        recommendedNextAction: `${score.recommendedNextAction}: ${score.recommendedNextActionLabel.en}`,
        policyVersion: score.policyVersion,
        agentRunId: runId,
        createdById: null,
      },
      select: { id: true },
    });
    base.assessmentId = assessment.id;
    await db.salesOpportunity.update({
      where: { id: opp.id },
      data: {
        score: score.score,
        scoreGrade: score.grade,
        scoredAt: now,
        priority: score.grade === "HOT" || score.grade === "HIGH" ? "hot" : score.grade === "MEDIUM" ? "warm" : "cold",
        buyerType: fields.buyerType ?? (research.buyerType !== "unknown" ? research.buyerType : null),
        market: fields.destinationCountry ?? research.country ?? opp.market,
        ...(opp.estimatedValue === null && score.estimatedValue !== null ? { estimatedValue: score.estimatedValue } : {}),
      },
    });
    await event("agent.output", `评分 ${score.score}/100 ${score.grade}`, {
      decision: "score",
      score: score.score,
      grade: score.grade,
      priority: score.priority,
      dimensions: score.dimensions,
      qualification: score.qualification,
      recommendedNextAction: score.recommendedNextAction,
      assessmentId: assessment.id,
    });

    const target: Stage =
      score.qualification === "disqualified"
        ? OpportunityStage.DISQUALIFIED
        : score.qualification === "needs_info"
          ? OpportunityStage.NEEDS_INFO
          : OpportunityStage.QUALIFIED;
    if (stage !== target) {
      stage = await safeTransition(orgId, opp.id, target, { salesActionId, agentRunId: runId, policy, now, reason: score.recommendedNextActionLabel.zh });
    }
    if (score.qualification === "rfq_ready" && stage === OpportunityStage.QUALIFIED) {
      stage = await safeTransition(orgId, opp.id, OpportunityStage.RFQ_READY, { salesActionId, agentRunId: runId, policy, now });
    }
    await event("agent.output", `阶段 → ${stage}`, { decision: "qualify", stage, qualification: score.qualification });

    // ── Step 5 missing info ──
    const missing = computeMissingFields(fields);
    const questions = buildClarifyingQuestions(missing, extraction.language, policy.followUp.maxQuestionsPerReply);
    base.missing = missing;
    base.questions = questions;
    await event("agent.output", `缺失信息 ${missing.length} 项，拟问 ${questions.length} 个问题`, {
      decision: "missing_info",
      missing,
      questions: questions.map((q) => ({ field: q.field, tier: q.tier })),
    });

    // ── Step 6 reply draft（模板接地 + 可选润色 + 守卫） ──
    let draft: ReplyDraft | null = null;
    let pendingActionId: string | null = null;
    let approvalRequired = false;
    if (score.qualification !== "disqualified") {
      draft = buildReplyDraft({
        language: extraction.language,
        contactName: opp.customer.contactName ?? research.contactName,
        companyName: research.companyName ?? opp.customer.name,
        orgName: org.name,
        senderName,
        fields,
        questions,
        knowledge,
        policy,
      });
      if (input.useLlm !== false) draft = await polishReplyDraftWithLlm(draft, { orgId, userId: principalUserId, agentRunId: runId });
      base.draft = draft;
      await event("agent.output", "回复草稿已生成（未发送）", {
        decision: "draft",
        subject: draft.subject,
        templateOnly: draft.templateOnly,
        factsUsed: draft.factsUsed,
        pendingInternalConfirmation: draft.pendingInternalConfirmation,
        guardrailViolations: draft.guardrailViolations,
      });

      // ── Step 7 approval（唯一外部副作用入口） ──
      if (opp.customer.email && draft.guardrailViolations.length === 0) {
        approvalRequired = true;
        // 幂等：同一来信已有未决草稿 → 复用；否则按历史草稿数生成新 key（拒绝/过期后允许重新起草）
        const openDraft = await db.pendingAction.findFirst({
          where: {
            orgId,
            type: INQUIRY_REPLY_ACTION_TYPE,
            status: "pending",
            expiresAt: { gt: now },
            payload: { path: ["replyToInteractionId"], equals: latest.id },
          },
          select: { id: true },
        });
        const priorDrafts = openDraft
          ? 0
          : await db.pendingAction.count({
              where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["opportunityId"], equals: opp.id } },
            });
        // 同商机针对更早来信的未决草稿已过时：先作废，避免两份草稿被各自批准造成双发
        if (!openDraft) {
          const staleDrafts = await db.pendingAction.findMany({
            where: {
              orgId,
              type: INQUIRY_REPLY_ACTION_TYPE,
              status: "pending",
              payload: { path: ["opportunityId"], equals: opp.id },
            },
            select: { id: true },
          });
          for (const stale of staleDrafts) {
            try {
              const rej = await rejectApprovalItem("pending_action", stale.id, {
                userId: principalUserId,
                role: null,
                orgId,
                note: `superseded by newer inbound message ${latest.id}`,
              });
              await event("approval.rejected", "旧回复草稿已被新来信取代", { pendingActionId: stale.id, ok: rej.ok, supersededBy: latest.id });
            } catch (err) {
              // 取代失败不阻塞：executor 在发送前还会以 STALE_DRAFT 拒绝针对旧来信的草稿
              await event("approval.failed", "作废旧草稿失败（发送时由 executor 二次拦截）", {
                pendingActionId: stale.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
        const approval = openDraft
          ? ({ ok: true, kind: "pending_action", actionIds: [openDraft.id] } as const)
          : await requestApproval({
          orgId,
          principal: { userId: principalUserId, actorType: "agent" },
          actionType: INQUIRY_REPLY_ACTION_TYPE,
          title: `发送询盘回复：${opp.customer.name}`.slice(0, 160),
          preview: `${draft.subject}\n\n${draft.body}`.slice(0, 4000),
          payload: {
            opportunityId: opp.id,
            customerId: opp.customerId,
            salesActionId,
            to: opp.customer.email,
            subject: draft.subject,
            body: draft.body,
            language: draft.language,
            replyToInteractionId: latest.id,
            metadata: { orgId, customerId: opp.customerId, opportunityId: opp.id, salesActionId, agentRunId: runId, employeeKey: FDE_EMPLOYEE_KEY },
          },
          risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
          // 不写 source.runId：PendingAction.agentRunId 会把草稿挂进 assistant 会话 run 的收敛机
          // （reconcile-run：run 状态由 PA 状态推导，run 终态被改写；merge-closure 探针实测该事务在远端
          // 库上超 5s 超时并可能阻塞 FDE）。FDE run 是确定性流水线、在草稿生成后即终态；
          // 追溯链保留在 payload.metadata.agentRunId / SalesAction.agentRunId / approval.required 事件。
          source: { module: "revenue-spine.inbound-sales-fde", toolName: "sales_send_inquiry_reply", stepKey: `reply:${latest.id}` },
          approver: { approverUserId: principalUserId },
          ttlHours: 72,
          idempotencyKey: `revenue-spine:reply:${opp.id}:${latest.id}:v${priorDrafts + 1}`,
        });
        if (approval.ok) {
          pendingActionId = approval.actionIds[0] ?? null;
          await event("approval.required", openDraft ? "复用未决审批草稿" : "首次回复需人工审批后发送", { pendingActionId, actionType: INQUIRY_REPLY_ACTION_TYPE, to: opp.customer.email, reused: !!openDraft });
        } else {
          await event("approval.failed", "创建审批草稿失败", { error: approval.error, code: approval.errorCode });
        }
      } else if (!opp.customer.email) {
        await event("agent.output", "客户无邮箱，草稿仅供人工复制发送", { decision: "no_email_channel" });
      }
    } else {
      await event("agent.output", "商机不合格：不生成客户回复草稿", { decision: "disqualified", reason: score.recommendedNextActionLabel.zh });
    }
    base.pendingActionId = pendingActionId;
    base.approvalRequired = approvalRequired;

    // ── Step 8 next action + SalesAction 回填 ──
    const nextAction = await applyNextAction(orgId, opp.id, { policy, now });
    if (salesActionId) {
      await updateFdeAction({
        orgId,
        actionId: salesActionId,
        priority: score.priority,
        approvalRequired,
        pendingActionId,
        agentRunId: runId,
        interactionId: latest.id,
        recommendedAction: {
          action: score.recommendedNextAction,
          label: score.recommendedNextActionLabel,
          stage,
          score: score.score,
          grade: score.grade,
          missing,
          questions: questions.map((q) => q.question),
          draftSubject: draft?.subject ?? null,
          pendingActionId,
          nextAction,
        },
        inputContextPatch: { fdeStatus: "completed", agentRunId: runId, rfqId: persisted.rfq.id, assessmentId: assessment.id, research },
        ...(score.qualification === "disqualified" ? { close: { status: "auto_resolved", reason: `FDE 判定不合格：${score.recommendedNextActionLabel.zh}` } } : {}),
      });
      await markFdeTouch({ orgId, opportunityId: opp.id, salesActionId, sourced: opp.fdeSourced });
    }
    await event("agent.output", "Next action 已设置", { decision: "next_action", nextAction });

    // 通知负责人：审批待办
    if (pendingActionId) {
      await createNotificationsForUsers([principalUserId], {
        type: "approval",
        title: `待审批：询盘回复 — ${opp.customer.name}`.slice(0, 120),
        summary: `${score.grade} ${score.score}/100 · ${score.recommendedNextActionLabel.zh}`.slice(0, 140),
        orgId,
        entityType: "revenue_opportunity",
        entityId: opp.id,
        priority: score.priority === "urgent" ? "urgent" : "high",
        metadata: { pendingActionId, opportunityId: opp.id, agentRunId: runId },
        sourceKeyPrefix: `revenue-approval:${pendingActionId}`,
      }).catch(() => undefined);
    }

    await completeAgentRun(orgId, runId);
    return { ...base, ok: true, stage, score: score.score, grade: score.grade };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failAgentRun(orgId, runId, { code: "unknown", message }).catch(() => undefined);
    if (salesActionId) {
      await updateFdeAction({ orgId, actionId: salesActionId, inputContextPatch: { fdeStatus: "failed", fdeError: message } }).catch(() => undefined);
    }
    return { ...base, ok: false, error: message, errorCode: "FDE_FAILED" };
  }
}
