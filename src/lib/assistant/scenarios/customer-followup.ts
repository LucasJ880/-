/**
 * 场景：客户跟进 Prepare（日历 / 商机跟进 / 双 PA）
 * 澄清路径不创建 PendingAction；提交路径再 createDraft。
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import { resolveCustomerForFollowup } from "@/lib/ai-grader/graders/customer-followup-grader";
import { resolveSalesOwnOnly } from "@/lib/ai-grader/graders/_scope";
import type { AssistantScenarioResult, ScenarioContext } from "./types";
import { friendlyScenarioError } from "./types";
import { parseFollowupRequest, type ParsedFollowupRequest } from "./entity-parse";

const ACTIVE_STAGES = [
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
];

export type FollowupDraftPlan =
  | {
      type: "sales.update_followup";
      title: string;
      preview: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "calendar.create_event";
      title: string;
      preview: string;
      payload: Record<string, unknown>;
    };

export type FollowupAnalyzeResult =
  | {
      kind: "clarification_required";
      assistantContent: string;
      missingFields: string[];
    }
  | {
      kind: "ready";
      assistantLines: string[];
      plans: FollowupDraftPlan[];
      customerName: string;
      parsed: ParsedFollowupRequest;
    };

async function listOpportunitiesForCustomer(input: {
  orgId: string;
  userId: string;
  role: string;
  customerId: string;
}) {
  const ownOnly = await resolveSalesOwnOnly(
    input.userId,
    input.orgId,
    input.role,
  );
  return db.salesOpportunity.findMany({
    where: {
      orgId: input.orgId,
      customerId: input.customerId,
      stage: { in: ACTIVE_STAGES },
      ...(ownOnly
        ? {
            OR: [
              { createdById: input.userId },
              { assignedToId: input.userId },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      nextFollowupAt: true,
      customer: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
}

function draftOk(
  result: Awaited<ReturnType<typeof createDraft>>,
): result is {
  success: true;
  data: {
    status: string;
    actionId: string;
    type: string;
    title: string;
    preview: string;
  };
} {
  return (
    result.success === true &&
    !!result.data &&
    typeof result.data === "object" &&
    typeof (result.data as { actionId?: unknown }).actionId === "string"
  );
}

/** 分析阶段：可澄清、不创建 Run / PA */
export async function analyzeCustomerFollowup(
  ctx: Pick<
    ScenarioContext,
    "orgId" | "userId" | "role" | "message" | "threadId"
  >,
): Promise<FollowupAnalyzeResult> {
  const parsed = parseFollowupRequest(ctx.message);

  if (parsed.otherAssignee) {
    return {
      kind: "clarification_required",
      missingFields: ["assignee"],
      assistantContent: `当前阶段只能在你的日历创建提醒，不能替 ${parsed.otherAssignee} 创建任务或发邀请。是否改为在你的日历提醒你联系 ${parsed.otherAssignee}？`,
    };
  }

  if (!parsed.customerName) {
    return {
      kind: "clarification_required",
      missingFields: ["customerName"],
      assistantContent:
        "请告诉我要跟进的客户名称。例如：「周五提醒我跟进 ABC」。",
    };
  }

  if (parsed.needsTimeClarification || !parsed.startIso || !parsed.endIso) {
    return {
      kind: "clarification_required",
      missingFields: ["followupTime"],
      assistantContent: friendlyScenarioError("FOLLOWUP_TIME_REQUIRED"),
    };
  }

  if (parsed.actionKind === "unclear") {
    return {
      kind: "clarification_required",
      missingFields: ["actionKind"],
      assistantContent:
        "请明确你要：① 在日历提醒自己，还是 ② 更新商机下次跟进日，或 ③ 两项都要。",
    };
  }

  const customer = await resolveCustomerForFollowup({
    orgId: ctx.orgId,
    userId: ctx.userId,
    role: ctx.role,
    customerName: parsed.customerName,
  });

  if (customer.status === "need_name" || customer.status === "not_found") {
    return {
      kind: "clarification_required",
      missingFields: ["customerName"],
      assistantContent: friendlyScenarioError("CUSTOMER_NOT_FOUND"),
    };
  }
  if (customer.status === "ambiguous") {
    const names = customer.candidates.map((c) => c.name).join("、");
    return {
      kind: "clarification_required",
      missingFields: ["customerName"],
      assistantContent: `找到多个匹配客户：${names}。请告诉我具体是哪一个。`,
    };
  }

  const wantCalendar =
    parsed.actionKind === "calendar" || parsed.actionKind === "both";
  const wantSales =
    parsed.actionKind === "sales_followup" || parsed.actionKind === "both";

  const plans: FollowupDraftPlan[] = [];
  const lines: string[] = [];

  if (wantSales) {
    const opps = await listOpportunitiesForCustomer({
      orgId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
      customerId: customer.customerId,
    });

    if (opps.length === 0) {
      if (!wantCalendar) {
        return {
          kind: "clarification_required",
          missingFields: ["opportunityId"],
          assistantContent: `客户「${customer.customerName}」当前没有可更新的活跃商机，不能创建商机跟进更新。是否改为在你的日历创建提醒？`,
        };
      }
      lines.push(
        `客户「${customer.customerName}」没有活跃商机，已跳过商机跟进更新，改为准备日历提醒。`,
      );
    } else if (opps.length > 1) {
      const list = opps
        .map((o, i) => `${i + 1}. ${o.title || o.id}`)
        .join("\n");
      return {
        kind: "clarification_required",
        missingFields: ["opportunityId"],
        assistantContent: `客户「${customer.customerName}」有多个商机，请选择要更新哪一个：\n${list}`,
      };
    } else {
      const opp = opps[0];
      plans.push({
        type: "sales.update_followup",
        title: `更新跟进：${customer.customerName}`,
        preview: `将「${opp.title || "商机"}」下次跟进改到 ${parsed.timeRaw}`,
        payload: {
          opportunityId: opp.id,
          opportunityTitle: opp.title || "商机",
          customerName: customer.customerName,
          previousFollowupAt: opp.nextFollowupAt?.toISOString() ?? null,
          nextFollowupAt: parsed.startIso,
          note: `来自助手对话：${ctx.message.slice(0, 120)}`,
          metadata: { orgId: ctx.orgId },
        },
      });
      lines.push(
        `已准备商机跟进更新预览：将「${opp.title || "商机"}」下次跟进改到 ${parsed.timeRaw}`,
      );
    }
  }

  if (wantCalendar || (wantSales && plans.length === 0)) {
    plans.push({
      type: "calendar.create_event",
      title: `提醒跟进：${customer.customerName}`,
      preview: `${parsed.timeRaw} 在你的日历提醒你跟进 ${customer.customerName}`,
      payload: {
        title: `跟进 ${customer.customerName}`,
        description: `助手准备的跟进提醒。\n原文：${ctx.message.slice(0, 200)}`,
        startTime: parsed.startIso,
        endTime: parsed.endIso,
        reminderMinutes: 15,
        metadata: { orgId: ctx.orgId },
      },
    });
    lines.push(
      `已准备日历提醒预览（仅写入你自己的日历，确认前不会创建事件）。`,
    );
  }

  if (plans.length === 0) {
    return {
      kind: "clarification_required",
      missingFields: ["actionKind"],
      assistantContent: "未能生成可确认的跟进动作，请补充客户、时间与动作类型。",
    };
  }

  lines.push("");
  lines.push("请确认下方卡片后才会写入；取消则不会执行。");

  return {
    kind: "ready",
    assistantLines: lines,
    plans,
    customerName: customer.customerName,
    parsed,
  };
}

/** 提交阶段：创建独立 PendingAction（须已有 AgentRun） */
export async function commitCustomerFollowup(
  ctx: ScenarioContext,
  ready: Extract<FollowupAnalyzeResult, { kind: "ready" }>,
): Promise<AssistantScenarioResult> {
  const pendingActions: Array<{
    id: string;
    type: string;
    title: string;
    preview: string;
  }> = [];

  for (const plan of ready.plans) {
    const draft = await createDraft({
      type: plan.type,
      title: plan.title,
      preview: plan.preview,
      payload: plan.payload,
      userId: ctx.userId,
      orgId: ctx.orgId,
      threadId: ctx.threadId,
      messageId: ctx.assistantMessageId,
      agentRunId: ctx.agentRunId,
    });
    if (!draftOk(draft)) {
      return {
        kind: "failed",
        assistantContent: friendlyScenarioError("DRAFT_CREATION_FAILED"),
        errorCode: "DRAFT_CREATION_FAILED",
      };
    }
    pendingActions.push({
      id: draft.data.actionId,
      type: draft.data.type,
      title: draft.data.title,
      preview: draft.data.preview,
    });
  }

  return {
    kind: "approval_required",
    assistantContent: ready.assistantLines.join("\n"),
    pendingActions,
    resultSummary: `followup_actions_${pendingActions.length}`,
  };
}

export async function runCustomerFollowupScenario(
  ctx: ScenarioContext,
): Promise<AssistantScenarioResult> {
  const analyzed = await analyzeCustomerFollowup(ctx);
  if (analyzed.kind === "clarification_required") {
    return analyzed;
  }
  return commitCustomerFollowup(ctx, analyzed);
}
