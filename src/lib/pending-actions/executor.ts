/**
 * PR4 — PendingAction 执行器
 *
 * 用户点"批准"时调用。职责：
 * - 再次做权限校验（防止 action 过期或用户角色变化后越权）
 * - 按 type 分发到真实 DB 写入
 * - 更新 PendingAction 状态
 * - 写审计日志
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { canSeeResource } from "@/lib/rbac/data-scope";
import { getOrgMembership, getProjectMembership } from "@/lib/auth";
import { isSuperAdmin, hasOrgRole } from "@/lib/rbac/roles";
import { onAiInternalNote } from "@/lib/project-discussion/system-events";
import { getEmailProvider, createGmailDraft } from "@/lib/google-email";
import type {
  PendingActionType,
  PendingActionMetadata,
  SalesUpdateFollowupPayload,
  SalesUpdateStagePayload,
  CalendarCreateEventPayload,
  InternalNotePayload,
  ProjectTaskPayload,
  EmailDraftPayload,
  MarketingActivateCampaignPayload,
  MarketingApproveResearchPlanPayload,
  MarketingProposeContextUpdatePayload,
  MarketingCreateCampaignDraftPayload,
} from "./types";
import {
  isUnsupportedPendingActionType,
  SUPPORTED_INTERNAL_NOTE_TARGETS,
  INTERNAL_NOTE_MAX_LEN,
  PROJECT_TASK_TITLE_MAX_LEN,
  PROJECT_TASK_DESC_MAX_LEN,
  EMAIL_DRAFT_SUBJECT_MAX_LEN,
  EMAIL_DRAFT_BODY_MAX_LEN,
} from "./types";
import { canDecideTeamApproval } from "@/lib/marketing/team";
import { createNotification } from "@/lib/notifications/create";
import { pushMessage } from "@/lib/messaging/gateway";

interface ExecuteContext {
  userId: string;
  role: string | null | undefined;
  /**
   * 可选：调用方所属组织。传入后会与 payload.metadata.orgId 比对，
   * 不一致则拒绝执行（跨组织防护）。微信链路务必传入 binding.orgId。
   */
  orgId?: string | null;
}

/** 从 payload 读取 Grader 适配器写入的 metadata（可能不存在） */
function readPendingActionMetadata(
  payload: unknown,
): Partial<PendingActionMetadata> | null {
  if (payload && typeof payload === "object" && "metadata" in payload) {
    const meta = (payload as { metadata?: unknown }).metadata;
    if (meta && typeof meta === "object") {
      return meta as Partial<PendingActionMetadata>;
    }
  }
  return null;
}

export interface ExecuteResult {
  ok: boolean;
  resultRef?: string;
  message?: string;
  error?: string;
}

/** 对外入口 —— 按 id 取草稿并执行 */
export async function executePendingAction(
  actionId: string,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const action = await db.pendingAction.findUnique({
    where: { id: actionId },
  });
  if (!action) {
    return { ok: false, error: "草稿不存在" };
  }

  if (!(await canDecideTeamApproval(action, ctx))) {
    return { ok: false, error: "无权操作该草稿" };
  }

  // Phase 3B-A：列上的 orgId 与调用方 activeOrg 必须一致（保留 metadata 二次校验）
  if (action.orgId) {
    if (!ctx.orgId) {
      return { ok: false, error: "缺少组织上下文，拒绝执行" };
    }
    if (action.orgId !== ctx.orgId) {
      return { ok: false, error: "跨组织动作，拒绝执行" };
    }
  }

  // 跨组织防护：若调用方带了 orgId 且草稿 metadata 记录了 orgId，则必须一致。
  if (ctx.orgId) {
    const meta = readPendingActionMetadata(action.payload);
    if (meta?.orgId && meta.orgId !== ctx.orgId) {
      return { ok: false, error: "跨组织动作，拒绝执行" };
    }
  }

  // 占位动作（Grader 暂未接入执行器）：安全降级，不写任何业务数据。
  if (isUnsupportedPendingActionType(action.type)) {
    await db.pendingAction.update({
      where: { id: actionId },
      data: { status: "failed", failureReason: "该动作类型暂未接入执行器，仅作建议（未执行）" },
    });
    return {
      ok: false,
      error: "该动作类型暂未接入执行器，仅作建议（未执行）",
    };
  }

  if (action.status !== "pending" && action.status !== "approved") {
    return {
      ok: false,
      error: `该草稿状态为 ${action.status}，不能重复执行`,
    };
  }

  if (action.expiresAt.getTime() < Date.now()) {
    await db.pendingAction.update({
      where: { id: actionId },
      data: { status: "failed", failureReason: "已过期" },
    });
    return { ok: false, error: "草稿已过期" };
  }

  // 标记为 approved（进入执行态），避免并发重复执行
  await db.pendingAction.update({
    where: { id: actionId },
    data: { status: "approved", decidedAt: new Date(), decidedById: ctx.userId },
  });

  let exec: ExecuteResult;
  try {
    switch (action.type as PendingActionType) {
      case "sales.update_followup":
        exec = await execSalesUpdateFollowup(
          action.payload as unknown as SalesUpdateFollowupPayload,
          ctx,
        );
        break;
      case "sales.update_stage":
        exec = await execSalesUpdateStage(
          action.payload as unknown as SalesUpdateStagePayload,
          ctx,
        );
        break;
      case "calendar.create_event":
        exec = await execCalendarCreateEvent(
          action.payload as unknown as CalendarCreateEventPayload,
          ctx,
        );
        break;
      case "grader.internal_note":
        exec = await execGraderInternalNote(
          action.payload as unknown as InternalNotePayload,
          ctx,
        );
        break;
      case "grader.project_task":
        exec = await execGraderProjectTask(
          action.payload as unknown as ProjectTaskPayload,
          ctx,
        );
        break;
      case "grader.email_draft":
        exec = await execGraderEmailDraft(
          action.payload as unknown as EmailDraftPayload,
          ctx,
        );
        break;
      case "marketing.activate_campaign":
        exec = await execMarketingActivateCampaign(
          action.payload as unknown as MarketingActivateCampaignPayload,
          ctx,
        );
        break;
      case "marketing.approve_research_plan":
        exec = await execMarketingApproveResearchPlan(
          action.payload as unknown as MarketingApproveResearchPlanPayload,
          ctx,
        );
        break;
      case "marketing.propose_context_update":
        exec = await execMarketingProposeContextUpdate(
          action.payload as unknown as MarketingProposeContextUpdatePayload,
          ctx,
        );
        break;
      case "marketing.create_campaign_draft":
        exec = await execMarketingCreateCampaignDraft(
          action.payload as unknown as MarketingCreateCampaignDraftPayload,
          ctx,
        );
        break;
      default:
        exec = { ok: false, error: `未知动作类型 ${action.type}` };
    }
  } catch (err) {
    exec = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (exec.ok) {
    await db.pendingAction.update({
      where: { id: actionId },
      data: {
        status: "executed",
        executedAt: new Date(),
        resultRef: exec.resultRef,
      },
    });
    await logAudit({
      userId: ctx.userId,
      action: "ai_draft_approve",
      targetType: "pending_action",
      targetId: actionId,
      afterData: {
        type: action.type,
        resultRef: exec.resultRef,
      },
    });
  } else {
    await db.pendingAction.update({
      where: { id: actionId },
      data: { status: "failed", failureReason: exec.error },
    });
    await logAudit({
      userId: ctx.userId,
      action: "ai_draft_fail",
      targetType: "pending_action",
      targetId: actionId,
      afterData: { error: exec.error },
    });
  }

  return exec;
}

async function execMarketingApproveResearchPlan(
  payload: MarketingApproveResearchPlanPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId || !payload.planId || !payload.projectId || !payload.researchRunId) {
    return { ok: false, error: "计划审批参数不完整" };
  }
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };

  const plan = await db.marketingPlan.findFirst({
    where: {
      id: payload.planId,
      orgId,
      projectId: payload.projectId,
      sourceResearchRunId: payload.researchRunId,
    },
    include: { items: { orderBy: [{ dayOffset: "asc" }, { createdAt: "asc" }] } },
  });
  if (!plan) return { ok: false, error: "运营计划不存在或不属于当前组织" };
  if (plan.status !== "awaiting_approval" && plan.status !== "draft") {
    return { ok: false, error: `计划状态 ${plan.status} 不允许批准` };
  }

  await db.$transaction(async (tx) => {
    for (const item of plan.items) {
      if (item.taskId) continue;
      const task = await tx.task.create({
        data: {
          projectId: payload.projectId,
          creatorId: payload.requestedById,
          assigneeId: item.ownerId ?? payload.requestedById,
          title: item.title.slice(0, 200),
          description: item.description,
          priority: item.priority,
          dueDate: item.dueDate,
        },
      });
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: ctx.userId,
          action: "created_from_marketing_plan",
          detail: `Leader 批准研究计划后创建；计划 ${plan.id}`,
        },
      });
      await tx.marketingPlanItem.update({
        where: { id: item.id },
        data: { taskId: task.id, status: "tasked" },
      });
    }
    await tx.marketingPlan.update({
      where: { id: plan.id },
      data: { status: "active", approvedById: ctx.userId, approvedAt: new Date() },
    });
    await tx.marketResearchRun.updateMany({
      where: { id: payload.researchRunId, orgId, planId: plan.id },
      data: { planStatus: "active" },
    });
  });

  await logAudit({
    userId: ctx.userId,
    orgId,
    projectId: payload.projectId,
    action: "marketing_plan_approved",
    targetType: "marketing_plan",
    targetId: plan.id,
    beforeData: { status: plan.status },
    afterData: { status: "active", taskCount: plan.items.length, sourceResearchRunId: payload.researchRunId },
  });
  if (payload.requestedById !== ctx.userId) {
    await Promise.allSettled([
      createNotification({
        userId: payload.requestedById,
        type: "marketing_plan_approved",
        category: "marketing",
        title: "研究运营计划已批准",
        summary: `Leader 已批准计划，并创建 ${plan.items.length} 个执行任务。`,
        projectId: payload.projectId,
        entityType: "marketing_plan",
        entityId: plan.id,
        priority: "high",
        sourceKey: `marketing-plan:${plan.id}:approved`,
        metadata: { route: "/operations/growth", researchRunId: payload.researchRunId },
      }),
      pushMessage(payload.requestedById, `【青砚运营计划】\nLeader 已批准你的研究计划，并创建 ${plan.items.length} 个执行任务。\n请前往增长中心查看分工与截止日期。`, { channels: ["personal_wechat", "wecom"] }),
    ]);
  }
  return { ok: true, resultRef: plan.id, message: `计划已批准，已创建 ${plan.items.length} 个执行任务` };
}

async function execMarketingActivateCampaign(
  payload: MarketingActivateCampaignPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  const membership = await getOrgMembership(ctx.userId, orgId);
  if (!isSuperAdmin(ctx.role ?? "") && membership?.status !== "active") {
    return { ok: false, error: "无权启用该组织的营销活动" };
  }
  const campaign = await db.marketingCampaign.findFirst({
    where: { id: payload.campaignId, orgId },
    select: { id: true, status: true },
  });
  if (!campaign) return { ok: false, error: "营销活动不存在或不属于本组织" };
  if (campaign.status !== "awaiting_approval" && campaign.status !== "draft") {
    return { ok: false, error: `活动状态 ${campaign.status} 不允许启用` };
  }
  await db.marketingCampaign.update({
    where: { id: campaign.id },
    data: { status: "active", approvedById: ctx.userId, approvedAt: new Date(), startsAt: new Date() },
  });
  await logAudit({
    userId: ctx.userId,
    orgId,
    action: "marketing_campaign_activate",
    targetType: "marketing_campaign",
    targetId: campaign.id,
    beforeData: { status: campaign.status },
    afterData: { status: "active", via: "pending_action" },
  });
  return { ok: true, resultRef: campaign.id, message: "营销活动已审批并启用" };
}

async function execMarketingProposeContextUpdate(
  payload: MarketingProposeContextUpdatePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  const membership = await getOrgMembership(ctx.userId, orgId);
  if (!isSuperAdmin(ctx.role ?? "") && membership?.status !== "active") {
    return { ok: false, error: "无权更新该组织的产品营销上下文" };
  }
  if (!payload.context || typeof payload.context !== "object") {
    return { ok: false, error: "缺少 context 载荷" };
  }
  const { approveProductMarketingContextUpdate } = await import(
    "@/lib/marketing/product-marketing-context"
  );
  try {
    const stored = await approveProductMarketingContextUpdate({
      orgId,
      userId: ctx.userId,
      context: payload.context as unknown as import("@/lib/marketing/product-marketing-context").ProductMarketingContext,
    });
    await logAudit({
      userId: ctx.userId,
      orgId,
      action: "marketing_pmc_update",
      targetType: "marketing_brand_profile",
      targetId: orgId,
      afterData: {
        lastReviewedAt: stored.lastReviewedAt,
        reason: payload.reason ?? null,
        via: "pending_action",
        skillExecutionId: payload.metadata?.skillExecutionId ?? null,
      },
    });
    return {
      ok: true,
      resultRef: orgId,
      message: "产品营销上下文已人工确认并写入",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "PMC 更新失败",
    };
  }
}

async function execMarketingCreateCampaignDraft(
  payload: MarketingCreateCampaignDraftPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  const membership = await getOrgMembership(ctx.userId, orgId);
  if (!isSuperAdmin(ctx.role ?? "") && membership?.status !== "active") {
    return { ok: false, error: "无权在该组织创建营销活动草稿" };
  }
  const name = String(payload.name || "").trim();
  const objective = String(payload.objective || "").trim();
  const primaryConversion = String(payload.primaryConversion || "").trim();
  if (!name || !objective || !primaryConversion) {
    return { ok: false, error: "活动草稿缺少 name/objective/primaryConversion" };
  }
  const campaign = await db.marketingCampaign.create({
    data: {
      orgId,
      name,
      objective,
      product: payload.product?.trim() || null,
      geography: payload.geography?.trim() || null,
      offer: payload.offer?.trim() || null,
      primaryConversion,
      status: "draft",
      budget: typeof payload.budget === "number" ? payload.budget : null,
      currency: payload.currency?.trim() || "CAD",
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  await logAudit({
    userId: ctx.userId,
    orgId,
    action: "marketing_campaign_draft_create",
    targetType: "marketing_campaign",
    targetId: campaign.id,
    afterData: {
      status: "draft",
      via: "pending_action",
      skillExecutionId: payload.metadata?.skillExecutionId ?? null,
    },
  });
  return {
    ok: true,
    resultRef: campaign.id,
    message: "营销活动草稿已创建（未启用、未投放）",
  };
}

/** 对外入口 —— 用户点"拒绝" */
export async function rejectPendingAction(
  actionId: string,
  ctx: ExecuteContext,
  reason?: string,
): Promise<ExecuteResult> {
  const action = await db.pendingAction.findUnique({
    where: { id: actionId },
  });
  if (!action) return { ok: false, error: "草稿不存在" };
  if (!(await canDecideTeamApproval(action, ctx))) {
    return { ok: false, error: "无权操作该草稿" };
  }
  if (action.status !== "pending") {
    return { ok: false, error: `该草稿状态为 ${action.status}，不能拒绝` };
  }

  await db.pendingAction.update({
    where: { id: actionId },
    data: {
      status: "rejected",
      decidedAt: new Date(),
      decidedById: ctx.userId,
      failureReason: reason ?? undefined,
    },
  });

  if (action.type === "marketing.approve_research_plan") {
    const payload = action.payload as unknown as MarketingApproveResearchPlanPayload;
    if (payload.metadata?.orgId) {
      await db.$transaction([
        db.marketingPlan.updateMany({
          where: { id: payload.planId, orgId: payload.metadata.orgId, status: "awaiting_approval" },
          data: { status: "canceled" },
        }),
        db.marketResearchRun.updateMany({
          where: { id: payload.researchRunId, orgId: payload.metadata.orgId, planId: payload.planId },
          data: { planStatus: "rejected" },
        }),
      ]);
      if (payload.requestedById !== ctx.userId) {
        await Promise.allSettled([
          createNotification({
            userId: payload.requestedById,
            type: "marketing_plan_rejected",
            category: "marketing",
            title: "研究运营计划已退回",
            summary: reason || "Leader 已退回计划，请调整后重新提交。",
            projectId: payload.projectId,
            entityType: "marketing_plan",
            entityId: payload.planId,
            priority: "high",
            sourceKey: `marketing-plan:${payload.planId}:rejected`,
            metadata: { route: "/operations/growth", researchRunId: payload.researchRunId },
          }),
          pushMessage(payload.requestedById, `【青砚运营计划】\nLeader 已退回你的研究计划。\n原因：${reason || "请调整后重新提交"}`, { channels: ["personal_wechat", "wecom"] }),
        ]);
      }
    }
  }

  await logAudit({
    userId: ctx.userId,
    orgId: action.orgId,
    projectId: action.projectId,
    action: "ai_draft_reject",
    targetType: "pending_action",
    targetId: actionId,
    afterData: { reason },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 各类动作的具体执行
// ─────────────────────────────────────────────────────────────

async function execSalesUpdateFollowup(
  payload: SalesUpdateFollowupPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const opp = await db.salesOpportunity.findUnique({
    where: { id: payload.opportunityId },
    select: {
      id: true,
      createdById: true,
      assignedToId: true,
      nextFollowupAt: true,
    },
  });
  if (!opp) return { ok: false, error: "商机不存在" };

  if (
    !canSeeResource(ctx.role, ctx.userId, {
      createdById: opp.createdById,
      assignedToId: opp.assignedToId,
    })
  ) {
    return { ok: false, error: "无权修改该商机" };
  }

  await db.salesOpportunity.update({
    where: { id: opp.id },
    data: { nextFollowupAt: new Date(payload.nextFollowupAt) },
  });

  await logAudit({
    userId: ctx.userId,
    action: "update",
    targetType: "sales_opportunity",
    targetId: opp.id,
    beforeData: { nextFollowupAt: opp.nextFollowupAt },
    afterData: { nextFollowupAt: payload.nextFollowupAt, via: "ai_draft" },
  });

  return { ok: true, resultRef: opp.id, message: "已更新下次跟进时间" };
}

async function execSalesUpdateStage(
  payload: SalesUpdateStagePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const opp = await db.salesOpportunity.findUnique({
    where: { id: payload.opportunityId },
    select: {
      id: true,
      createdById: true,
      assignedToId: true,
      stage: true,
    },
  });
  if (!opp) return { ok: false, error: "商机不存在" };

  if (
    !canSeeResource(ctx.role, ctx.userId, {
      createdById: opp.createdById,
      assignedToId: opp.assignedToId,
    })
  ) {
    return { ok: false, error: "无权修改该商机" };
  }

  await db.salesOpportunity.update({
    where: { id: opp.id },
    data: { stage: payload.newStage },
  });

  await logAudit({
    userId: ctx.userId,
    action: "update",
    targetType: "sales_opportunity",
    targetId: opp.id,
    beforeData: { stage: opp.stage },
    afterData: { stage: payload.newStage, via: "ai_draft" },
  });

  return { ok: true, resultRef: opp.id, message: "已推进商机阶段" };
}

async function execCalendarCreateEvent(
  payload: CalendarCreateEventPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const event = await db.calendarEvent.create({
    data: {
      userId: ctx.userId,
      title: payload.title,
      description: payload.description,
      startTime: new Date(payload.startTime),
      endTime: new Date(payload.endTime),
      allDay: payload.allDay ?? false,
      location: payload.location,
      reminderMinutes: payload.reminderMinutes ?? 15,
      source: "qingyan",
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      allDay: true,
      location: true,
    },
  });

  // 销售日历页主要展示 Google 事件；批准后尽量同步，避免「已创建但不显示」
  try {
    const { getGoogleProvider, pushEventToGoogle } = await import(
      "@/lib/google-calendar"
    );
    const googleProvider = await getGoogleProvider(ctx.userId);
    if (googleProvider) {
      const googleId = await pushEventToGoogle(ctx.userId, {
        title: event.title,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        allDay: event.allDay,
        location: event.location,
      });
      if (googleId) {
        await db.calendarEvent.update({
          where: { id: event.id },
          data: { externalId: googleId },
        });
      }
    }
  } catch (err) {
    console.error("[pending-action] calendar google sync failed:", err);
  }

  await logAudit({
    userId: ctx.userId,
    action: "create",
    targetType: "calendar_event",
    targetId: event.id,
    afterData: { ...payload, via: "ai_draft" },
  });

  return { ok: true, resultRef: event.id, message: "已创建日历事件" };
}

// ─────────────────────────────────────────────────────────────
// grader.internal_note —— 把 Grader 发现的风险沉淀为内部备注
//
// 写入策略（白名单，禁止 LLM 决定写哪个字段）：
// - QUOTE       → 追加到 SalesQuote.notes（带时间戳 + 来源，不覆盖原有）
// - OPPORTUNITY → 新增 CustomerInteraction(type=note)（商机无 notes 字段）
// - CUSTOMER    → 新增 CustomerInteraction(type=note)（保留 timeline）
// - PROJECT     → 写入项目讨论流 ProjectMessage(type=SYSTEM, ai_internal_note)
// ─────────────────────────────────────────────────────────────

async function execGraderInternalNote(
  payload: InternalNotePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const targetType = payload?.targetType;
  const targetId = payload?.targetId;
  const orgId = payload?.metadata?.orgId;
  const note = (payload?.note ?? "").trim();

  // 1. 基础校验
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝写入" };
  if (ctx.orgId && ctx.orgId !== orgId) {
    return { ok: false, error: "跨组织动作，拒绝执行" };
  }
  if (!targetType || !targetId) return { ok: false, error: "备注目标无效" };
  if (!note) return { ok: false, error: "备注内容为空" };

  // 2. 白名单：不支持的 targetType（如 PROJECT）安全跳过，不写业务数据
  if (!SUPPORTED_INTERNAL_NOTE_TARGETS.includes(targetType)) {
    return {
      ok: false,
      error: `这类内部备注暂未接入真实写入（${targetType}），已保留为建议。`,
    };
  }

  const trimmed = note.slice(0, INTERNAL_NOTE_MAX_LEN);
  const stamp = new Date().toISOString().slice(0, 10);
  const block = `[AI Grader · ${stamp}]\n${trimmed}`;

  switch (targetType) {
    case "QUOTE":
      return noteToQuote(targetId, orgId, block, payload, ctx);
    case "OPPORTUNITY":
      return noteToOpportunity(targetId, orgId, trimmed, block, payload, ctx);
    case "CUSTOMER":
      return noteToCustomer(targetId, orgId, trimmed, block, payload, ctx);
    case "PROJECT":
      return noteToProject(targetId, orgId, block, payload, ctx);
    default:
      return { ok: false, error: "不支持的备注目标" };
  }
}

async function noteToProject(
  projectId: string,
  orgId: string,
  block: string,
  payload: InternalNotePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, ownerId: true },
  });
  if (!project) return { ok: false, error: "项目不存在或不属于本组织" };

  const allowed = await canWriteProject(ctx, project.id, orgId, project.ownerId);
  if (!allowed) return { ok: false, error: "无权修改该项目" };

  const msg = await onAiInternalNote({
    projectId: project.id,
    body: block,
    actorId: ctx.userId,
    graderType: payload.graderType,
    issueCategory: payload.metadata?.issueCategory,
    issueSeverity: payload.metadata?.issueSeverity,
  });

  await auditInternalNote(ctx, payload, "project", project.id, msg.id);
  return { ok: true, resultRef: msg.id, message: "已记录项目内部备注" };
}

async function noteToQuote(
  quoteId: string,
  orgId: string,
  block: string,
  payload: InternalNotePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const quote = await db.salesQuote.findFirst({
    where: { id: quoteId, orgId },
    select: { id: true, createdById: true, notes: true },
  });
  if (!quote) return { ok: false, error: "报价不存在或不属于本组织" };

  if (
    !canSeeResource(ctx.role, ctx.userId, { orgId, createdById: quote.createdById }, orgId)
  ) {
    return { ok: false, error: "无权修改该报价" };
  }

  const newNotes = quote.notes ? `${quote.notes}\n\n${block}` : block;
  await db.salesQuote.update({ where: { id: quote.id }, data: { notes: newNotes } });

  await auditInternalNote(ctx, payload, "sales_quote", quote.id, quote.id);
  return { ok: true, resultRef: quote.id, message: "已记录报价内部备注" };
}

async function noteToOpportunity(
  opportunityId: string,
  orgId: string,
  summary: string,
  block: string,
  payload: InternalNotePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const opp = await db.salesOpportunity.findFirst({
    where: { id: opportunityId, orgId },
    select: { id: true, customerId: true, createdById: true, assignedToId: true },
  });
  if (!opp) return { ok: false, error: "商机不存在或不属于本组织" };

  if (
    !canSeeResource(
      ctx.role,
      ctx.userId,
      { orgId, createdById: opp.createdById, assignedToId: opp.assignedToId },
      orgId,
    )
  ) {
    return { ok: false, error: "无权修改该商机" };
  }

  const interaction = await db.customerInteraction.create({
    data: {
      orgId,
      customerId: opp.customerId,
      opportunityId: opp.id,
      type: "note",
      channel: "ai_grader",
      summary,
      content: block,
      createdById: ctx.userId,
    },
    select: { id: true },
  });

  await auditInternalNote(ctx, payload, "sales_opportunity", opp.id, interaction.id);
  return { ok: true, resultRef: interaction.id, message: "已记录商机内部备注" };
}

async function noteToCustomer(
  customerId: string,
  orgId: string,
  summary: string,
  block: string,
  payload: InternalNotePayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const customer = await db.salesCustomer.findFirst({
    where: { id: customerId, orgId },
    select: { id: true, createdById: true },
  });
  if (!customer) return { ok: false, error: "客户不存在或不属于本组织" };

  if (
    !canSeeResource(ctx.role, ctx.userId, { orgId, createdById: customer.createdById }, orgId)
  ) {
    return { ok: false, error: "无权修改该客户" };
  }

  const interaction = await db.customerInteraction.create({
    data: {
      orgId,
      customerId: customer.id,
      type: "note",
      channel: "ai_grader",
      summary,
      content: block,
      createdById: ctx.userId,
    },
    select: { id: true },
  });

  await auditInternalNote(ctx, payload, "sales_customer", customer.id, interaction.id);
  return { ok: true, resultRef: interaction.id, message: "已记录客户内部备注" };
}

// ─────────────────────────────────────────────────────────────
// grader.project_task —— 把 Grader 发现的项目风险落为真实项目任务（Task）
//
// 安全策略（白名单，禁止 LLM 决定写哪个字段）：
// - 强制 metadata.orgId === ctx.orgId，且项目必须属于该 orgId
// - 权限：super_admin / 项目 owner / 组织 org_admin / 项目成员(active) 才可创建
// - 去重：同项目 + 同标题 + 未完成任务已存在时，不重复创建
// - 不改 Project.status，不派工给陌生人（默认指派项目 owner / 当前用户）
// ─────────────────────────────────────────────────────────────

const DONE_TASK_STATUSES = ["done", "completed", "cancelled", "archived"];

async function execGraderProjectTask(
  payload: ProjectTaskPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const orgId = payload?.metadata?.orgId;
  const projectId = payload?.projectId;
  const title = (payload?.title ?? "").trim().slice(0, PROJECT_TASK_TITLE_MAX_LEN);

  // 1. 基础 + 跨组织校验
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝写入" };
  if (ctx.orgId && ctx.orgId !== orgId) {
    return { ok: false, error: "跨组织动作，拒绝执行" };
  }
  if (!projectId) return { ok: false, error: "缺少项目信息" };
  if (!title) return { ok: false, error: "任务标题为空" };

  // 2. 项目必须属于本组织
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, orgId: true, ownerId: true, name: true, code: true },
  });
  if (!project) return { ok: false, error: "项目不存在或不属于本组织" };

  // 3. 项目权限二次校验
  const allowed = await canWriteProject(ctx, projectId, orgId, project.ownerId);
  if (!allowed) return { ok: false, error: "无权为该项目创建任务" };

  const displayTitle = title;

  // 4. 去重：同项目 + 同标题 + 未完成
  const existing = await db.task.findFirst({
    where: {
      projectId,
      title,
      completedAt: null,
      status: { notIn: DONE_TASK_STATUSES },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: true,
      resultRef: existing.id,
      message: `已存在类似项目任务：${displayTitle}`,
    };
  }

  // 5. 写入 Task（白名单字段；Task 无 orgId/source/metadata 列，按 schema 跳过）
  const priority = normalizePriority(payload.priority, payload.metadata?.issueSeverity);
  const dueDate = parseDate(payload.dueAt);
  // 默认指派项目 owner，无 owner 则指派当前用户（不派工给陌生人）
  const assigneeId = project.ownerId ?? ctx.userId;

  const task = await db.task.create({
    data: {
      projectId,
      title,
      description: payload.description?.slice(0, PROJECT_TASK_DESC_MAX_LEN),
      status: "todo",
      priority,
      dueDate: dueDate ?? undefined,
      creatorId: ctx.userId,
      assigneeId,
    },
    select: { id: true },
  });

  // 6. 审计
  await logAudit({
    userId: ctx.userId,
    orgId,
    projectId,
    action: "ai_project_task_create",
    targetType: "project_task",
    targetId: task.id,
    afterData: {
      source: payload.source ?? "GRADER",
      graderType: payload.graderType,
      issueCategory: payload.metadata?.issueCategory,
      issueSeverity: payload.metadata?.issueSeverity,
      projectId,
      title: displayTitle,
      via: "ai_draft",
    },
  });

  return { ok: true, resultRef: task.id, message: `已创建项目任务：${displayTitle}` };
}

/** 项目写权限（任务/备注共用）：super_admin / owner / org_admin / 项目成员(active) */
async function canWriteProject(
  ctx: ExecuteContext,
  projectId: string,
  orgId: string,
  ownerId: string,
): Promise<boolean> {
  if (isSuperAdmin(ctx.role ?? "")) return true;
  if (ownerId === ctx.userId) return true;

  const om = await getOrgMembership(ctx.userId, orgId);
  if (om?.status === "active" && hasOrgRole(om.role, "org_admin")) return true;

  const pm = await getProjectMembership(ctx.userId, projectId);
  if (pm?.status === "active") return true;

  return false;
}

function normalizePriority(
  priority: ProjectTaskPayload["priority"],
  severity: ProjectTaskPayload["metadata"]["issueSeverity"],
): string {
  if (priority) return priority;
  if (severity === "CRITICAL") return "urgent";
  if (severity === "HIGH") return "high";
  return "medium";
}

function parseDate(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────
// grader.email_draft —— 创建 Gmail 草稿（绝不发送）
//
// 安全策略：
// - 强制 metadata.orgId === ctx.orgId
// - 若关联业务对象（CUSTOMER/OPPORTUNITY/QUOTE/PROJECT），执行前校验可见/可写
// - 仅创建 Gmail 草稿（drafts.create），从不调用 send；to 可为空
// - 无 Gmail 授权 → 安全失败（不发送、不新建表、不降级写其他渠道）
// ─────────────────────────────────────────────────────────────

async function execGraderEmailDraft(
  payload: EmailDraftPayload,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const orgId = payload?.metadata?.orgId;
  const subject = (payload?.subject ?? "").trim().slice(0, EMAIL_DRAFT_SUBJECT_MAX_LEN);
  const body = (payload?.body ?? "").trim().slice(0, EMAIL_DRAFT_BODY_MAX_LEN);

  // 1. 基础 + 跨组织校验
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝写入" };
  if (ctx.orgId && ctx.orgId !== orgId) {
    return { ok: false, error: "跨组织动作，拒绝执行" };
  }
  if (!subject) return { ok: false, error: "邮件主题为空" };
  if (!body) return { ok: false, error: "邮件正文为空" };

  // 2. 业务对象权限校验（如关联）
  if (payload.targetType && payload.targetId) {
    const perm = await checkEmailTargetAccess(payload.targetType, payload.targetId, orgId, ctx);
    if (!perm.ok) return perm;
  }

  // 3. Gmail 授权（无授权 → 安全失败，不发送、不降级）
  const provider = await getEmailProvider(ctx.userId);
  if (!provider?.accessToken) {
    return {
      ok: false,
      error: "未找到 Gmail 授权，邮件草稿未创建。请到『设置 → 邮箱绑定』连接 Google 后重试。",
    };
  }

  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  const fromName = user?.name?.trim() || provider.accountEmail;

  // 4. 创建 Gmail 草稿（绝不发送）
  const { draftId } = await createGmailDraft(ctx.userId, {
    to: payload.to?.trim() || "",
    from: `"${fromName}" <${provider.accountEmail}>`,
    subject,
    body,
  });

  // 5. 审计
  await logAudit({
    userId: ctx.userId,
    orgId,
    action: "ai_email_draft_create",
    targetType: "email_draft",
    targetId: draftId,
    afterData: {
      source: payload.source ?? "GRADER",
      graderType: payload.graderType,
      issueCategory: payload.metadata?.issueCategory,
      issueSeverity: payload.metadata?.issueSeverity,
      targetType: payload.targetType,
      targetId: payload.targetId,
      customerId: payload.metadata?.customerId,
      opportunityId: payload.metadata?.opportunityId,
      quoteId: payload.metadata?.quoteId,
      projectId: payload.metadata?.projectId,
      subject,
      channel: "gmail",
      via: "ai_draft",
    },
  });

  return { ok: true, resultRef: draftId, message: `已生成邮件草稿：${subject}` };
}

/** 邮件草稿关联业务对象的可见/可写校验（按 targetType 分流） */
async function checkEmailTargetAccess(
  targetType: NonNullable<EmailDraftPayload["targetType"]>,
  targetId: string,
  orgId: string,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  switch (targetType) {
    case "QUOTE": {
      const q = await db.salesQuote.findFirst({ where: { id: targetId, orgId }, select: { createdById: true } });
      if (!q) return { ok: false, error: "报价不存在或不属于本组织" };
      return canSeeResource(ctx.role, ctx.userId, { orgId, createdById: q.createdById }, orgId)
        ? { ok: true }
        : { ok: false, error: "无权为该报价生成邮件草稿" };
    }
    case "OPPORTUNITY": {
      const o = await db.salesOpportunity.findFirst({
        where: { id: targetId, orgId },
        select: { createdById: true, assignedToId: true },
      });
      if (!o) return { ok: false, error: "商机不存在或不属于本组织" };
      return canSeeResource(ctx.role, ctx.userId, { orgId, createdById: o.createdById, assignedToId: o.assignedToId }, orgId)
        ? { ok: true }
        : { ok: false, error: "无权为该商机生成邮件草稿" };
    }
    case "CUSTOMER": {
      const c = await db.salesCustomer.findFirst({ where: { id: targetId, orgId }, select: { createdById: true } });
      if (!c) return { ok: false, error: "客户不存在或不属于本组织" };
      return canSeeResource(ctx.role, ctx.userId, { orgId, createdById: c.createdById }, orgId)
        ? { ok: true }
        : { ok: false, error: "无权为该客户生成邮件草稿" };
    }
    case "PROJECT": {
      const p = await db.project.findFirst({ where: { id: targetId, orgId }, select: { ownerId: true } });
      if (!p) return { ok: false, error: "项目不存在或不属于本组织" };
      return (await canWriteProject(ctx, targetId, orgId, p.ownerId))
        ? { ok: true }
        : { ok: false, error: "无权为该项目生成邮件草稿" };
    }
    default:
      return { ok: false, error: "不支持的邮件目标" };
  }
}

async function auditInternalNote(
  ctx: ExecuteContext,
  payload: InternalNotePayload,
  targetType: string,
  targetId: string,
  resultRef: string,
): Promise<void> {
  await logAudit({
    userId: ctx.userId,
    orgId: payload.metadata?.orgId ?? null,
    action: "ai_internal_note_create",
    targetType,
    targetId,
    afterData: {
      source: payload.source ?? "GRADER",
      graderType: payload.graderType,
      issueCategory: payload.metadata?.issueCategory,
      issueSeverity: payload.metadata?.issueSeverity,
      resultRef,
      via: "ai_draft",
    },
  });
}
