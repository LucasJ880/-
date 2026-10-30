/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 普通助手 → Workforce 持久任务的受控接入
 *
 * 调用链（不新建任何任务表 / 队列 / worker / scheduler）：
 *   messages route → prepareAssistantDispatch → startDurableFollowupTask
 *     → parseFollowupGoal（受约束交付项）→ 工具可用性预检（canInvokeTool，与执行期同一策略）
 *     → buildFollowupServerPlan（ServerAuthoredPlanV1）
 *     → createWorkforceJob（WORKFORCE_RUNTIME 开关 / 白名单 / 组织配额 / 共享计划编译链）
 *     → 响应后 kick 一个 slice（processWorkforceJobSlice，CAS 认领；cron 兜底）
 *   之后：Runtime V2 执行 / 验证 → PendingAction → 审批 → resumeWorkforceJob → kick
 *
 * 安全边界：
 *   - 企业 / 线程 / 发起人全部由服务端确认；客户端只能提供文字、附件（已在路由层校验
 *     归属）与本次提交的 clientRequestId（只用于幂等，不参与任何授权）。
 *   - 本模块不直写 AgentRun / PendingAction（AgentRun 只经 createWorkforceJob /
 *     cancelAgentRun 这些既有入口）。
 *   - 新体验开关只能"收窄"：WORKFORCE_RUNTIME_* 未放行时直接回落既有行为。
 */

import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findOwnedThreadInOrg } from "@/lib/assistant/thread-org";
import { isAssistantDurableFollowupEnabled } from "@/lib/assistant/followup-flags";
import {
  buildFollowupContinuationPlan,
  buildFollowupServerPlan,
  followupAcceptanceText,
  isValidTimeZone,
  parseFollowupContinuationAnswer,
  parseFollowupGoal,
  type FollowupGoalSpec,
} from "@/lib/assistant/followup-goal";
import {
  FOLLOWUP_META,
  FOLLOWUP_TASK_CONTRACT,
  FOLLOWUP_TOOL,
  readFollowupRunContext,
  type FollowupEmailUnavailableReason,
} from "@/lib/assistant/followup-contract";
import {
  buildRunStatusEvent,
  type AssistantRunStatusDto,
} from "@/lib/assistant/run-status-types";
import type { IntentRouteResult } from "@/lib/assistant/intent-router";
import {
  attachmentsTitleSource,
  type ChatAttachment,
} from "@/lib/chat-attachments/core";
import { getRuntimeV2Tool } from "@/lib/agent-runtime-v2/tool-catalog";
import { isGmailDraftEnabled } from "@/lib/google-email";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import { resolveAgentTenant } from "@/lib/tenancy/resolve-agent-tenant";
import { isWorkforceRuntimeEnabled } from "@/lib/workforce-runtime/flags";
import { createWorkforceJob } from "@/lib/workforce-runtime/job";
import { cancelAgentRun } from "@/lib/agent-runtime/run";

export type ScheduleAfterResponse = (task: () => Promise<void>) => void;

export type DurableFollowupHandled = {
  kind: "handled";
  response: NextResponse;
  run: null;
  intent: IntentRouteResult;
};

const INTENT: IntentRouteResult = {
  intent: "general_answer",
  confidence: 1,
  reason: "assistant_durable_followup_m1",
};

const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

/** 客户端提交标识：仅用于"同一次提交"的幂等去重，不参与任何授权 */
export function normalizeClientRequestId(raw: unknown): string | null {
  return typeof raw === "string" && CLIENT_REQUEST_ID_RE.test(raw.trim())
    ? raw.trim()
    : null;
}

// ─────────────────────────── 服务端上下文 ───────────────────────────

/** 可信组织时区：只认组织事实中心（MarketingBrandProfile）且为合法 IANA 名 */
export async function resolveFollowupOrgTimezone(
  orgId: string,
): Promise<string | null> {
  const profile = await db.marketingBrandProfile
    .findUnique({ where: { orgId }, select: { timezone: true } })
    .catch(() => null);
  return isValidTimeZone(profile?.timezone) ? profile!.timezone : null;
}

export type FollowupToolAccess = {
  analysis: boolean;
  emailDrafts: boolean;
  reminders: boolean;
  reason: string | null;
};

/**
 * 计划前的工具可用性预检：与执行期 canInvokeTool 同一策略（销售域、
 * allowRoles admin/sales、模块门、组织 disabledTools、l2_soft 上限）。
 * 预检只用于"不规划必然被拒的步骤"；执行期仍会再次完整鉴权。
 */
export async function resolveFollowupToolAccess(input: {
  userId: string;
  role: string;
  orgId: string;
}): Promise<FollowupToolAccess> {
  const tenant = await resolveAgentTenant(
    { id: input.userId, role: input.role },
    input.orgId,
  );
  if ("error" in tenant || !tenant.hasMembership) {
    return {
      analysis: false,
      emailDrafts: false,
      reminders: false,
      reason: "当前账号在该组织没有有效成员身份",
    };
  }
  const allowed = (name: string) => {
    const descriptor = getRuntimeV2Tool(name);
    if (!descriptor) return false;
    const decision = canInvokeTool({
      tenant: {
        userId: input.userId,
        orgId: input.orgId,
        orgRole: tenant.orgRole === "org_owner" ? "org_admin" : tenant.orgRole,
        isPlatformAdmin: tenant.isPlatformAdmin,
        workspaceIds: tenant.workspaceIds,
      },
      hasMembership: true,
      tool: {
        name,
        domain: "sales",
        risk: descriptor.requiresApproval
          ? "l2_soft"
          : descriptor.readOnly
            ? "l0_read"
            : "l1_internal_write",
        allowRoles: ["admin", "sales"],
      },
      modulesJson: tenant.modulesJson,
      toolPolicy: tenant.toolPolicy,
      maxRisk: "l2_soft",
    });
    return decision.ok;
  };
  const disabled = new Set(tenant.toolPolicy?.disabledTools ?? []);
  const analysis = [
    FOLLOWUP_TOOL.opportunities,
    FOLLOWUP_TOOL.followupAnalysis,
    FOLLOWUP_TOOL.quoteRisk,
    FOLLOWUP_TOOL.prioritize,
  ].every(allowed);
  const prepare = allowed(FOLLOWUP_TOOL.prepareActions);
  return {
    analysis,
    emailDrafts:
      prepare && !disabled.has("gmail_create_draft") && !disabled.has("grader.email_draft"),
    reminders:
      prepare &&
      !disabled.has("calendar_create_event_draft") &&
      !disabled.has("calendar.create_event"),
    reason: analysis ? null : "当前账号或组织策略不允许使用销售分析工具",
  };
}

// ─────────────────────────── SSE ───────────────────────────

function sseResponse(orgId: string, events: unknown[]): NextResponse {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Org-Id": orgId,
    },
  });
}

function handled(response: NextResponse): DurableFollowupHandled {
  return { kind: "handled", response, run: null, intent: INTENT };
}

async function persistTurn(input: {
  threadId: string;
  threadTitle: string;
  userContent: string;
  attachments: ChatAttachment[];
  assistantContent: string;
  workSuggestion?: Prisma.InputJsonValue;
}): Promise<{ userMessageId: string; assistantMessageId: string }> {
  const attachmentData: { attachments?: Prisma.InputJsonValue } =
    input.attachments.length > 0
      ? { attachments: input.attachments as unknown as Prisma.InputJsonValue }
      : {};
  const userMsg = await db.aiMessage.create({
    data: {
      threadId: input.threadId,
      role: "user",
      content: input.userContent,
      ...attachmentData,
    },
    select: { id: true },
  });
  const assistantMsg = await db.aiMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: input.assistantContent,
      ...(input.workSuggestion ? { workSuggestion: input.workSuggestion } : {}),
    },
    select: { id: true },
  });
  await db.aiThread.update({
    where: { id: input.threadId },
    data: {
      lastMessageAt: new Date(),
      ...(input.threadTitle === "新对话"
        ? {
            title: attachmentsTitleSource(input.userContent, input.attachments).slice(
              0,
              60,
            ),
          }
        : {}),
    },
  });
  return { userMessageId: userMsg.id, assistantMessageId: assistantMsg.id };
}

/** 只回复、不建任务（缺信息追问 / 无权限）：仍落库对话，前端刷新可见 */
async function replyOnly(input: {
  orgId: string;
  threadId: string;
  threadTitle: string;
  message: string;
  attachments: ChatAttachment[];
  content: string;
  /** 续接追问：标记所属父任务，用户下一句回答才会被当作补充信息 */
  followupParentRunId?: string;
}): Promise<DurableFollowupHandled> {
  const persisted = await persistTurn({
    threadId: input.threadId,
    threadTitle: input.threadTitle,
    userContent: input.message,
    attachments: input.attachments,
    assistantContent: input.content,
    ...(input.followupParentRunId
      ? { workSuggestion: { followupParentRunId: input.followupParentRunId } }
      : {}),
  });
  return handled(
    sseResponse(input.orgId, [
      {
        type: "mode",
        mode: "assistant.dispatch",
        intent: "general_answer",
        runId: null,
        userMessageId: persisted.userMessageId,
        assistantMessageId: persisted.assistantMessageId,
        clarification: true,
      },
      { type: "text", content: input.content },
      { type: "done", mode: "assistant.dispatch", runId: null, latencyMs: 0 },
    ]),
  );
}

// ─────────────────────────── 读取 DTO ───────────────────────────

async function loadRunDto(input: {
  orgId: string;
  userId: string;
  threadId: string;
  runId: string;
}): Promise<AssistantRunStatusDto | null> {
  const { getAssistantRunStatusDto } = await import("@/lib/assistant/run-status");
  return getAssistantRunStatusDto(input).catch(() => null);
}

async function acceptedResponse(input: {
  orgId: string;
  userId: string;
  threadId: string;
  runId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  text: string;
  replayed: boolean;
}): Promise<NextResponse> {
  const dto = await loadRunDto(input);
  const events: unknown[] = [
    {
      type: "mode",
      mode: "agent_runtime_v2",
      durable: true,
      replayed: input.replayed,
      runId: input.runId,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
    },
  ];
  if (dto) events.push(buildRunStatusEvent(dto));
  events.push({ type: "text", content: input.text });
  events.push({
    type: "done",
    mode: "agent_runtime_v2",
    runId: input.runId,
    status: dto?.status ?? "received",
    latencyMs: 0,
  });
  return sseResponse(input.orgId, events);
}

// ─────────────────────────── 创建（幂等） ───────────────────────────

type CreateSpec = {
  goal: string;
  plan: ReturnType<typeof buildFollowupServerPlan>;
  metadata: Record<string, string | number | boolean | null>;
  acceptance: (runId: string) => string;
};

async function findReplayedJob(input: {
  orgId: string;
  userId: string;
  threadId: string;
  requestId: string;
}) {
  return db.agentRun.findFirst({
    where: {
      orgId: input.orgId,
      runType: "workforce_job",
      AND: [
        { metadata: { path: [FOLLOWUP_META.contract], equals: FOLLOWUP_TASK_CONTRACT } },
        { metadata: { path: [FOLLOWUP_META.requestId], equals: input.requestId } },
        { metadata: { path: ["threadId"], equals: input.threadId } },
        { metadata: { path: ["initiatedByUserId"], equals: input.userId } },
      ],
    },
    select: { id: true, userMessageId: true, metadata: true },
  });
}

async function createJobOnce(input: {
  orgId: string;
  userId: string;
  role: string;
  threadId: string;
  threadTitle: string;
  message: string;
  attachments: ChatAttachment[];
  requestId: string | null;
  spec: CreateSpec;
}): Promise<
  | {
      kind: "created" | "replayed";
      runId: string;
      userMessageId: string | null;
      assistantMessageId: string | null;
      text: string;
    }
  | {
      kind: "failed";
      userMessageId: string | null;
      assistantMessageId: string | null;
      text: string;
    }
> {
  const work = async () => {
    if (input.requestId) {
      const replay = await findReplayedJob({
        orgId: input.orgId,
        userId: input.userId,
        threadId: input.threadId,
        requestId: input.requestId,
      });
      if (replay) {
        const meta = (replay.metadata ?? {}) as Record<string, unknown>;
        return {
          kind: "replayed" as const,
          runId: replay.id,
          userMessageId: replay.userMessageId,
          assistantMessageId:
            typeof meta[FOLLOWUP_META.assistantMessageId] === "string"
              ? (meta[FOLLOWUP_META.assistantMessageId] as string)
              : null,
          text: `这条请求已经受理（任务编号 ${replay.id}），不会重复创建。进度见下方卡片。`,
        };
      }
    }

    // 先落对话，再建任务：任务创建失败时如实回复失败，绝不假装已受理
    const persisted = await persistTurn({
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      userContent: input.message,
      attachments: input.attachments,
      assistantContent: "已收到，正在创建后台任务…",
    });

    let created: Awaited<ReturnType<typeof createWorkforceJob>>;
    try {
      created = await createWorkforceJob({
        orgId: input.orgId,
        userId: input.userId,
        role: input.role,
        goal: input.spec.goal,
        channel: "web_assistant",
        threadId: input.threadId,
        userMessageId: persisted.userMessageId,
        source: "assistant_followup_m1",
        workDomain: "sales",
        plan: input.spec.plan.plan,
        planTools: input.spec.plan.tools.map((n) => getRuntimeV2Tool(n)!).filter(Boolean),
        extraMetadata: {
          ...input.spec.metadata,
          [FOLLOWUP_META.assistantMessageId]: persisted.assistantMessageId,
          ...(input.requestId ? { [FOLLOWUP_META.requestId]: input.requestId } : {}),
        },
      });
    } catch (err) {
      created = {
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : "CREATE_FAILED",
      };
    }

    if (!created.ok) {
      const text =
        created.error === "WORKFORCE_RUNTIME_DISABLED"
          ? "后台任务功能当前未对你开放，这次没有创建任务。"
          : `后台任务没有创建成功（${created.error}），这次没有执行任何操作，请稍后重试。`;
      await db.aiMessage.update({
        where: { id: persisted.assistantMessageId },
        data: { content: text },
      });
      return { kind: "failed" as const, ...persisted, text };
    }

    const text = input.spec.acceptance(created.runId);
    await db.aiMessage.update({
      where: { id: persisted.assistantMessageId },
      data: {
        content: text,
        workSuggestion: {
          runtimeVersion: "v2",
          durable: true,
          runId: created.runId,
        } as Prisma.InputJsonValue,
      },
    });
    return {
      kind: created.reused ? ("replayed" as const) : ("created" as const),
      runId: created.runId,
      userMessageId: persisted.userMessageId,
      assistantMessageId: persisted.assistantMessageId,
      text,
    };
  };

  // 已识别为本场景后绝不回落旧分流（旧分流会再落一条用户消息、且只做单一场景）：
  // 任何异常都在这里收口为"未创建成功"的如实回复
  try {
    if (!input.requestId) return await work();
    // 同一次提交的并发重放：advisory lock 串行化 check-then-create（与 tender 启动同一模式）
    const lockKey = `assistant-followup:${input.orgId}:${input.userId}:${input.requestId}`;
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        return work();
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (err) {
    console.error("[assistant.followup] create failed", err);
    return {
      kind: "failed" as const,
      userMessageId: null,
      assistantMessageId: null,
      text: "后台任务没有创建成功，这次没有执行任何操作，请稍后重试。",
    };
  }
}

function specMetadata(input: {
  spec: FollowupGoalSpec;
  prepared: string[];
  emailUnavailable: FollowupEmailUnavailableReason | null;
  attachmentCount: number;
}): Record<string, string | number | boolean | null> {
  const { spec } = input;
  return {
    [FOLLOWUP_META.contract]: FOLLOWUP_TASK_CONTRACT,
    [FOLLOWUP_META.topN]: spec.topN,
    [FOLLOWUP_META.deliverables]: spec.deliverables.join(","),
    [FOLLOWUP_META.reminderAt]:
      spec.reminder.status === "scheduled" && input.prepared.includes("reminders")
        ? spec.reminder.startAt
        : null,
    [FOLLOWUP_META.reminderTimezone]:
      spec.reminder.status === "scheduled" ? spec.reminder.timezone : null,
    [FOLLOWUP_META.reminderTimezoneSource]:
      spec.reminder.status === "scheduled" ? spec.reminder.timezoneSource : null,
    [FOLLOWUP_META.missing]:
      spec.reminder.status === "missing" ? spec.reminder.missing.join(",") : null,
    [FOLLOWUP_META.unsupported]: spec.unsupported.join(",") || null,
    [FOLLOWUP_META.emailSendRequested]: spec.emailSendRequested,
    [FOLLOWUP_META.emailUnavailable]: input.emailUnavailable,
    [FOLLOWUP_META.attachmentCount]: input.attachmentCount,
  };
}

// ─────────────────────────── 续接（补充提醒时间） ───────────────────────────

async function findContinuationParent(input: {
  orgId: string;
  userId: string;
  threadId: string;
  now: Date;
}) {
  const candidates = await db.agentRun.findMany({
    where: {
      orgId: input.orgId,
      runType: "workforce_job",
      createdAt: { gte: new Date(input.now.getTime() - 7 * 86_400_000) },
      status: { notIn: ["cancelled", "failed"] },
      AND: [
        { metadata: { path: [FOLLOWUP_META.contract], equals: FOLLOWUP_TASK_CONTRACT } },
        { metadata: { path: ["threadId"], equals: input.threadId } },
        { metadata: { path: ["initiatedByUserId"], equals: input.userId } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      metadata: true,
      steps: {
        where: { preferredTool: FOLLOWUP_TOOL.prioritize },
        select: { status: true, outputJson: true },
        take: 1,
      },
    },
  });
  for (const c of candidates) {
    const ctx = readFollowupRunContext(c.metadata);
    if (!ctx || ctx.parentRunId) continue;
    if (!ctx.deliverables.includes("reminders") || ctx.missing.length === 0) continue;
    const child = await db.agentRun.findFirst({
      where: {
        orgId: input.orgId,
        runType: "workforce_job",
        metadata: { path: [FOLLOWUP_META.parentRunId], equals: c.id },
        status: { notIn: ["cancelled", "failed"] },
      },
      select: { id: true },
    });
    if (child) return null; // 最近一次缺信息的任务已被承接
    const step = c.steps[0];
    const prioritized = Array.isArray(
      (step?.outputJson as { prioritized?: unknown } | null)?.prioritized,
    )
      ? ((step!.outputJson as { prioritized: Array<Record<string, unknown>> }).prioritized ?? [])
      : [];
    return {
      runId: c.id,
      ctx,
      prioritizeDone: step?.status === "completed",
      customers: prioritized
        .filter((p) => typeof p.customerId === "string")
        .map((p) => ({
          customerId: p.customerId as string,
          customerName: typeof p.customerName === "string" ? p.customerName : "",
        })),
    };
  }
  return null;
}

// ─────────────────────────── 主入口 ───────────────────────────

export type StartDurableFollowupInput = {
  userId: string;
  role: string;
  orgId: string;
  threadId: string;
  message: string;
  attachments?: ChatAttachment[];
  clientRequestId?: string | null;
  scheduleAfterResponse?: ScheduleAfterResponse;
  now?: Date;
};

/**
 * 返回 null = 不属于本场景或开关未放行 → 调用方继续既有行为（逐字不变）。
 * 返回 handled = 已在本场景内处理（创建 / 重放 / 追问 / 拒绝），响应已就绪。
 */
export async function startDurableFollowupTask(
  input: StartDurableFollowupInput,
): Promise<DurableFollowupHandled | null> {
  // PERM-4c5：功能开关角色白名单按岗位派生平台角色匹配
  const flagInput = {
    userId: input.userId,
    orgId: input.orgId,
    role: await resolveEffectivePlatformRole({ userId: input.userId, orgId: input.orgId, platformRole: input.role }),
  };
  if (!isAssistantDurableFollowupEnabled(flagInput)) return null;
  // 新体验开关不能覆盖既有 Workforce 开关 / 白名单
  if (!isWorkforceRuntimeEnabled(flagInput)) return null;

  const message = input.message.trim();
  const attachments = input.attachments ?? [];
  if (!message) return null;

  const thread = await findOwnedThreadInOrg(input.threadId, input.userId, input.orgId, {
    id: true,
    title: true,
    orgId: true,
    projectId: true,
  });
  // 项目会话保持既有项目助手行为（本轮不把项目线程接到企业级销售工具面）
  if (!thread || thread.orgId !== input.orgId || thread.projectId) return null;

  const now = input.now ?? new Date();
  const orgTimezone = await resolveFollowupOrgTimezone(input.orgId);
  const requestId = normalizeClientRequestId(input.clientRequestId);
  const base = {
    orgId: input.orgId,
    userId: input.userId,
    role: input.role,
    threadId: input.threadId,
    threadTitle: thread.title,
    message,
    attachments,
    requestId,
  };
  const kick = (runId: string) => {
    if (!input.scheduleAfterResponse) return;
    input.scheduleAfterResponse(async () => {
      const { kickQueuedWorkforceJobSlice } = await import(
        "@/lib/workforce-runtime/processor"
      );
      await kickQueuedWorkforceJobSlice(runId).catch((e) =>
        console.error("[assistant.followup] kick failed", e),
      );
    });
  };

  // ── 1. 续接：用户在补充上一任务缺失的提醒时间 ──
  if (!parseFollowupGoal(message, { now, orgTimezone })) {
    const parent = await findContinuationParent({
      orgId: input.orgId,
      userId: input.userId,
      threadId: input.threadId,
      now,
    });
    if (!parent) return null;
    // 只把"紧接在该任务回执 / 追问之后的下一句"当作补充信息，避免把无关的
    // 日程类闲聊误当成给上次客户建提醒
    const last = await db.aiMessage.findFirst({
      where: { threadId: input.threadId },
      orderBy: { createdAt: "desc" },
      select: { id: true, role: true, workSuggestion: true },
    });
    const lastWs = (last?.workSuggestion ?? null) as Record<string, unknown> | null;
    const followsParent =
      last?.role === "assistant" &&
      (last.id === parent.ctx.assistantMessageId ||
        lastWs?.followupParentRunId === parent.runId);
    if (!followsParent) return null;
    const answer = parseFollowupContinuationAnswer(message, {
      now,
      orgTimezone,
      parentCustomers: parent.customers,
    });
    if (answer.kind === "not_an_answer") return null;
    if (answer.kind === "still_incomplete") {
      return replyOnly({
        ...base,
        followupParentRunId: parent.runId,
        content: `还差一点信息才能建立提醒（${answer.reason}）。请${
          answer.missing.includes("timezone")
            ? "补充日期、具体时间和时区（例如「10月20日下午3点 多伦多时间」）"
            : "补充日期和具体时间（例如「10月20日下午3点」）"
        }。上次任务的分析结果已保留，不需要重新交代。`,
      });
    }
    if (!parent.prioritizeDone) {
      return replyOnly({
        ...base,
        followupParentRunId: parent.runId,
        content:
          "上次的客户分析还没有完成，暂时无法确定为哪些客户建立提醒。分析完成后（见上方任务卡片），请再回复一次提醒时间即可。",
      });
    }
    const access = await resolveFollowupToolAccess(input);
    if (!access.reminders) {
      return replyOnly({
        ...base,
        content: "当前账号或组织策略不允许创建跟进提醒，这次没有创建任务。",
      });
    }
    const plan = buildFollowupContinuationPlan();
    const named = answer.targetCustomerIds;
    const created = await createJobOnce({
      ...base,
      spec: {
        goal: `为上次跟进任务（${parent.runId}）补充提醒：${message}`.slice(0, 2000),
        plan,
        metadata: {
          [FOLLOWUP_META.contract]: FOLLOWUP_TASK_CONTRACT,
          [FOLLOWUP_META.topN]: parent.ctx.topN,
          [FOLLOWUP_META.deliverables]: "reminders",
          [FOLLOWUP_META.reminderAt]: answer.startAt,
          [FOLLOWUP_META.reminderTimezone]: answer.timezone,
          [FOLLOWUP_META.reminderTimezoneSource]: answer.timezoneSource,
          [FOLLOWUP_META.parentRunId]: parent.runId,
          [FOLLOWUP_META.targetCustomerIds]: named.length > 0 ? named.join(",") : null,
        },
        acceptance: (runId) =>
          [
            `已创建提醒任务（编号 ${runId}），沿用上次任务选出的${
              named.length > 0 ? ` ${named.length} 个指定` : ""
            }客户，不会重新分析。`,
            `提醒时间：${answer.local}（${answer.timezone}${
              answer.timezoneSource === "org_profile" ? "，来自组织时区设置" : ""
            }）。每个提醒都会生成确认卡片，确认后才写入日历。`,
          ].join("\n"),
      },
    });
    if (created.kind !== "failed") kick(created.runId);
    return handled(
      created.kind === "failed"
        ? sseResponse(input.orgId, [
            { type: "text", content: created.text },
            { type: "done", mode: "agent_runtime_v2", runId: null, error: true },
          ])
        : await acceptedResponse({
            orgId: input.orgId,
            userId: input.userId,
            threadId: input.threadId,
            runId: created.runId,
            userMessageId: created.userMessageId,
            assistantMessageId: created.assistantMessageId,
            text: created.text,
            replayed: created.kind === "replayed",
          }),
    );
  }

  // ── 2. 新的批量客户跟进目标 ──
  const spec = parseFollowupGoal(message, { now, orgTimezone })!;
  const access = await resolveFollowupToolAccess(input);
  if (!access.analysis) {
    return replyOnly({
      ...base,
      content: `这次没有创建任务：${access.reason ?? "当前账号无权使用销售分析工具"}。`,
    });
  }
  const gmailOn = isGmailDraftEnabled();
  const emailUnavailable: FollowupEmailUnavailableReason | null =
    spec.deliverables.includes("email_drafts")
      ? !gmailOn
        ? "gmail_disabled"
        : !access.emailDrafts
          ? "tool_denied"
          : null
      : null;
  const plan = buildFollowupServerPlan(spec, {
    includeAttachmentEvidence: attachments.length > 0,
    emailDraftsAvailable: emailUnavailable === null,
    remindersAvailable: access.reminders,
  });
  const created = await createJobOnce({
    ...base,
    spec: {
      goal: message.slice(0, 2000),
      plan,
      metadata: specMetadata({
        spec,
        prepared: plan.preparedDeliverables,
        emailUnavailable,
        attachmentCount: attachments.length,
      }),
      acceptance: (runId) =>
        followupAcceptanceText({
          runId,
          spec,
          preparedDeliverables: plan.preparedDeliverables,
          emailUnavailableReason:
            emailUnavailable === "gmail_disabled"
              ? "Gmail 草稿功能未开启"
              : emailUnavailable === "tool_denied"
                ? "当前账号或组织策略不允许使用邮件草稿工具"
                : null,
          remindersUnavailableReason: access.reminders
            ? null
            : "当前账号或组织策略不允许创建提醒",
          attachmentCount: attachments.length,
        }),
    },
  });
  if (created.kind !== "failed") kick(created.runId);
  return handled(
    created.kind === "failed"
      ? sseResponse(input.orgId, [
          {
            type: "mode",
            mode: "assistant.dispatch",
            runId: null,
            userMessageId: created.userMessageId,
            assistantMessageId: created.assistantMessageId,
          },
          { type: "text", content: created.text },
          { type: "done", mode: "assistant.dispatch", runId: null, latencyMs: 0 },
        ])
      : await acceptedResponse({
          orgId: input.orgId,
          userId: input.userId,
          threadId: input.threadId,
          runId: created.runId,
          userMessageId: created.userMessageId,
          assistantMessageId: created.assistantMessageId,
          text: created.text,
          replayed: created.kind === "replayed",
        }),
  );
}

// ─────────────────────────── 取消 ───────────────────────────

export type CancelDurableFollowupResult =
  | { ok: true; run: AssistantRunStatusDto | null }
  | { ok: false; code: "NOT_FOUND" | "NOT_CANCELLABLE"; error: string };

/**
 * 用户主动取消（与关闭页面 / 断网严格区分：只有这里会取消任务）。
 * 归属：org + 线程（本人）+ 发起人 + 本契约 + workforce_job，全部校验后才复用
 * 既有 cancelAgentRun（同时拒绝仍待确认的 PendingAction）。已发生的副作用保留并如实展示。
 */
export async function cancelDurableFollowupRun(input: {
  orgId: string;
  userId: string;
  threadId: string;
  runId: string;
}): Promise<CancelDurableFollowupResult> {
  const thread = await findOwnedThreadInOrg(input.threadId, input.userId, input.orgId, {
    id: true,
  });
  if (!thread) return { ok: false, code: "NOT_FOUND", error: "对话不存在" };
  const run = await db.agentRun.findFirst({
    where: {
      id: input.runId,
      orgId: input.orgId,
      runType: "workforce_job",
      AND: [
        { metadata: { path: [FOLLOWUP_META.contract], equals: FOLLOWUP_TASK_CONTRACT } },
        { metadata: { path: ["threadId"], equals: input.threadId } },
        { metadata: { path: ["initiatedByUserId"], equals: input.userId } },
      ],
    },
    select: { id: true, status: true },
  });
  if (!run) return { ok: false, code: "NOT_FOUND", error: "任务不存在或不属于当前对话" };
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return { ok: false, code: "NOT_CANCELLABLE", error: "任务已结束，无需取消" };
  }
  await cancelAgentRun(input.orgId, run.id);
  return { ok: true, run: await loadRunDto(input) };
}
