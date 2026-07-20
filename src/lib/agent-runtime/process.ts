/**
 * 主对话执行
 * Phase-B：Plan →（后台入队 | 子能力 | 直答 | 主 Agent）
 */

import { db } from "@/lib/db";
import {
  appendAgentRunEvent,
  failAgentRun,
  isAgentRunCancelled,
  updateAgentRunStatus,
} from "./run";
import { loadMinimalContext } from "./context";
import {
  createAgentPlan,
  routeFromPlan,
  type AgentPlan,
} from "./plan";
import {
  updateAgentSessionContext,
  updateAgentSessionResponseId,
  updateAgentSessionSummary,
} from "./session";
import {
  buildTurnSummaryLine,
  mergeSessionSummary,
} from "./session-memory";
import { resolvePlanCapability, runNamedCapability } from "./dispatch";
import { enqueueBackgroundAgentRun } from "./queue";
import { completeAgentRunRespectingApprovals } from "./pending-link";
import type { AgentSession } from "@prisma/client";

export type ConversationRunResult = {
  text: string;
  backgroundQueued?: boolean;
};

function withDefaultSkills(plan: AgentPlan): AgentPlan {
  if (plan.skills.length > 0) return plan;
  const skills: string[] = [];
  if (plan.intent === "quote" && plan.needsTools) {
    skills.push("grader.quote_risk");
  } else if (plan.intent === "project" && plan.needsTools) {
    skills.push("grader.project_health");
  } else if (plan.intent === "customer" && plan.needsTools) {
    skills.push("grader.customer_followup");
  } else if (plan.intent === "daily_brief") {
    skills.push("grader.daily_brief");
  }
  return skills.length ? { ...plan, skills } : plan;
}

function pickMarketingSkillSlug(plan: AgentPlan): string | null {
  for (const s of plan.skills) {
    const name = s.trim();
    if (name.startsWith("marketing-")) return name;
  }
  return null;
}

export async function executeConversationRun(input: {
  orgId: string;
  userId: string;
  userRole: string;
  userName: string | null;
  channel: string;
  /** 渠道侧用户 ID（微信 externalId）；优先于 session.channelUserId */
  channelUserId?: string;
  content: string;
  messageType: string;
  session: AgentSession;
  runId: string;
  /** worker 消费时跳过再次入队 */
  forceForeground?: boolean;
  /** worker 复用已规划结果，避免二次 Plan */
  precomputedPlan?: AgentPlan;
}): Promise<ConversationRunResult> {
  const { orgId, userId, runId } = input;
  const channelUserId =
    input.channelUserId || input.session.channelUserId || "";

  if (await isAgentRunCancelled(orgId, runId)) {
    return { text: "任务已取消。" };
  }

  await updateAgentRunStatus(orgId, runId, "planning");
  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "planning.started",
    title: "开始规划",
    visibleToUser: true,
  });

  const context = await loadMinimalContext({
    orgId,
    userId,
    channel: input.channel,
    runId,
    session: {
      id: input.session.id,
      summary: input.session.summary,
      currentProjectId: input.session.currentProjectId,
      currentCustomerId: input.session.currentCustomerId,
    },
    content: input.content,
  });

  if (await isAgentRunCancelled(orgId, runId)) {
    return { text: "任务已取消。" };
  }

  let plan =
    input.precomputedPlan ??
    (await createAgentPlan({
      orgId,
      content: input.content,
      sessionSummary: context.sessionSummary,
      session: input.session,
    }));
  plan = withDefaultSkills(plan);

  const route = routeFromPlan(plan);

  if (
    plan.entities.projectId ||
    plan.entities.customerId ||
    plan.entities.opportunityId ||
    plan.entities.quoteId
  ) {
    await updateAgentSessionContext({
      orgId,
      sessionId: input.session.id,
      currentProjectId: plan.entities.projectId,
      currentCustomerId: plan.entities.customerId,
      currentOpportunityId: plan.entities.opportunityId,
      currentQuoteId: plan.entities.quoteId,
    }).catch(() => {});
  }

  // ── 主管 AI：协同通道在 Flag 开启时始终走主管模式（网页 / 企微 / 个微同一策略）──
  try {
    const { isSupervisorEnabled, routeComplexity, runSupervisor } = await import(
      "@/lib/agent-supervisor"
    );
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { code: true },
    });
    const enabled = isSupervisorEnabled({
      userId,
      role: input.userRole,
      orgId,
      orgCode: org?.code,
    });
    if (enabled) {
      const pageContext = {
        projectId: plan.entities.projectId,
        customerId: plan.entities.customerId,
        opportunityId: plan.entities.opportunityId,
        quoteId: plan.entities.quoteId,
      };
      // 协同始终强制主管；自然复杂度仅用于判断是否入后台（避免短句全被「后台处理」）
      const naturalComplexity = routeComplexity({
        content: input.content,
        pageContext,
      });
      const complexity = routeComplexity({
        content: input.content,
        pageContext,
        forceMode: "supervisor",
      });
      if (complexity.mode === "supervisor") {
        const shouldBackground =
          !input.forceForeground && naturalComplexity.mode === "supervisor";
        if (shouldBackground) {
          await enqueueBackgroundAgentRun({
            orgId,
            runId,
            payload: {
              background: true,
              userId,
              userRole: input.userRole,
              userName: input.userName,
              channel: input.channel,
              channelUserId,
              content: input.content,
              messageType: input.messageType,
              plan,
              supervisor: true,
            },
          });
          return {
            text: "这个任务需要多步协调，我已按主管模式在后台处理。可发送「状态」查看进度。",
            backgroundQueued: true,
          };
        }
        const result = await runSupervisor({
          sessionId: input.session.id,
          runId,
          orgId,
          userId,
          userRole: input.userRole,
          content: input.content,
          pageContext,
          forceMode: "supervisor",
        });
        if (result.status !== "waiting_for_approval") {
          await persistSuccess({
            orgId,
            runId,
            session: input.session,
            userText: input.content,
            assistantText: result.text,
            plan,
          });
        }
        return { text: result.text };
      }
    }
  } catch (supervisorError) {
    // Supervisor 初始化失败 → 降级现有路径，不阻断主助手
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "planning.completed",
      title: "主管模式不可用，已降级",
      payload: {
        error:
          supervisorError instanceof Error
            ? supervisorError.message
            : String(supervisorError),
      },
      visibleToUser: false,
    }).catch(() => {});
  }

  // ── Phase-B：长任务入队，不阻塞手机对话 ──
  const shouldBackground =
    !input.forceForeground &&
    (plan.requiresBackgroundRun || plan.complexity === "complex");

  if (shouldBackground) {
    await enqueueBackgroundAgentRun({
      orgId,
      runId,
      payload: {
        background: true,
        userId,
        userRole: input.userRole,
        userName: input.userName,
        channel: input.channel,
        channelUserId,
        content: input.content,
        messageType: input.messageType,
        plan,
      },
    });
    return {
      text: "这个任务稍复杂，我已在后台继续处理。你可以先说下一件事，或发送「状态」查看进度，「停止」取消。",
      backgroundQueued: true,
    };
  }

  await updateAgentRunStatus(orgId, runId, "running", {
    intent: plan.intent,
    metadata: {
      planSource: plan.source,
      complexity: plan.complexity,
      needsTools: plan.needsTools,
      direct: route.useDirectAnswer,
    },
  });
  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "planning.completed",
    title: route.useDirectAnswer ? "可直接回复" : "准备调用助手",
    payload: {
      intent: plan.intent,
      source: plan.source,
      complexity: plan.complexity,
      needsTools: plan.needsTools,
      requiresApproval: plan.requiresApproval,
      maxToolRounds: route.maxToolRounds,
      mode: route.mode,
      skills: plan.skills,
    },
    visibleToUser: false,
  });

  // ── 快路径：直答 ──
  if (route.useDirectAnswer && plan.initialResponse) {
    const reply = plan.initialResponse;
    await persistSuccess({
      orgId,
      runId,
      session: input.session,
      userText: input.content,
      assistantText: reply,
      plan,
    });
    return { text: reply };
  }

  // ── 营销数字员工：Plan 命中 marketing-* 时走现有 runSkill（无第二套 Runtime）──
  const marketingSlug = pickMarketingSkillSlug(plan);
  if (marketingSlug) {
    try {
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "skill.started",
        title: `营销技能 ${marketingSlug}`,
        payload: { skillSlug: marketingSlug, requiresApproval: plan.requiresApproval },
        visibleToUser: true,
      });
      const { runSkill } = await import("@/lib/agent-core/skills/runtime");
      const result = await runSkill({
        slug: marketingSlug,
        variables: {
          objective: input.content,
          rawMaterials: input.content,
        },
        userId,
        orgId,
        agentRunId: runId,
      });
      const pendingHint =
        result.pendingActions && result.pendingActions.length > 0
          ? `\n\n已生成 ${result.pendingActions.length} 条待审批草稿，请在营销数字员工或待办中批准后才会生效。`
          : "";
      const text =
        (typeof result.content === "string" && result.content.trim()
          ? result.content.trim()
          : "营销任务已完成，请查看结构化结果。") + pendingHint;
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "skill.completed",
        title: `${marketingSlug} 完成`,
        payload: {
          skillSlug: marketingSlug,
          executionId: result.executionId,
          pendingCount: result.pendingActions?.length ?? 0,
        },
        visibleToUser: false,
      });
      await persistSuccess({
        orgId,
        runId,
        session: input.session,
        userText: input.content,
        assistantText: text,
        plan,
      });
      return { text };
    } catch (error) {
      await failAgentRun(orgId, runId, {
        code: "tool_failed",
        message: error instanceof Error ? error.message : "营销技能失败",
      });
      return {
        text: "营销任务没有完成。可能尚未导入对应技能，请先在营销数字员工页运行 Seed，或稍后重试。",
      };
    }
  }

  // ── 子能力：Plan 点名才跑 ──
  const capability = resolvePlanCapability(plan);
  if (capability) {
    try {
      const text = await runNamedCapability({
        orgId,
        userId,
        channel: input.channel,
        externalUserId: channelUserId,
        runId,
        capability,
        plan,
      });
      await persistSuccess({
        orgId,
        runId,
        session: input.session,
        userText: input.content,
        assistantText: text,
        plan,
      });
      return { text };
    } catch (error) {
      await failAgentRun(orgId, runId, {
        code: "tool_failed",
        message: error instanceof Error ? error.message : "子能力失败",
      });
      return {
        text: "这个任务没有完成，我已经保留了任务记录。请稍后重试。",
      };
    }
  }

  if (await isAgentRunCancelled(orgId, runId)) {
    return { text: "任务已取消。" };
  }

  const { runAgent } = await import("@/lib/agent-core");

  const domains: Array<
    "trade" | "sales" | "project" | "secretary" | "knowledge" | "cockpit" | "system"
  > = ["secretary", "system"];
  if (input.userRole === "admin" || input.userRole === "super_admin") {
    domains.push("trade", "sales", "cockpit");
  } else if (input.userRole === "sales") {
    domains.push("sales");
  } else if (input.userRole === "trade") {
    domains.push("trade");
  }

  const isVoice = input.messageType === "voice";
  const projectHint = context.project
    ? `\n当前会话关联项目：${context.project.name}（${context.project.id}）`
    : plan.entities.projectId
      ? `\n当前会话关联项目 ID：${plan.entities.projectId}`
      : "";
  const customerHint = context.customer
    ? `\n当前会话关联客户：${context.customer.name}（${context.customer.id}）`
    : plan.entities.customerId
      ? `\n当前会话关联客户 ID：${plan.entities.customerId}`
      : "";
  const summaryHint = context.sessionSummary
    ? `\n会话摘要（连续对话，勿失忆）：\n${context.sessionSummary.slice(0, 600)}`
    : "";
  const toolHints =
    plan.tools.length > 0
      ? `\n规划建议工具（仅参考）：${plan.tools.map((t) => t.name).join(", ")}`
      : "";
  const approvalHint = plan.requiresApproval
    ? "\n本轮涉及高风险动作，必须走 PendingAction。"
    : "";

  const systemPrompt = `你是「青砚」AI 工作助理，正在通过微信与用户 ${input.userName || ""} 对话。
用户角色：${input.userRole}
组织边界：仅使用当前组织数据。
本轮意图：${plan.intent}（${plan.source}）${projectHint}${customerHint}${summaryHint}${toolHints}${approvalHint}
${isVoice ? "⚠️ 语音转写可能有误差。\n" : ""}
规则：简洁中文；保持连续；工具克制；禁止声称已发送邮件。
${context.memoryBlock}`;

  const messages = [
    ...context.recentMessages.slice(-8),
    { role: "user" as const, content: input.content },
  ];

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "response.started",
    title: "生成回复",
    visibleToUser: true,
  });

  const abort = new AbortController();
  const cancelPoll = setInterval(() => {
    void isAgentRunCancelled(orgId, runId).then((cancelled) => {
      if (cancelled && !abort.signal.aborted) abort.abort();
    });
  }, 1500);

  try {
    const result = await runAgent({
      systemPrompt,
      messages,
      domains,
      mode: route.mode,
      temperature: 0.3,
      userId,
      orgId,
      maxToolRounds: route.maxToolRounds,
      sessionId: input.session.id,
      agentRunId: runId,
      role: input.userRole,
      abortSignal: abort.signal,
      hooks: {
        onToolCall: async (info) => {
          if (await isAgentRunCancelled(orgId, runId)) {
            abort.abort();
            return;
          }
          await appendAgentRunEvent({
            orgId,
            runId,
            eventType: "tool.started",
            title: `调用 ${info.name}`,
            payload: { name: info.name, round: info.round },
            visibleToUser: true,
          });
          await appendAgentRunEvent({
            orgId,
            runId,
            eventType: "tool.completed",
            title: `${info.name} 完成`,
            payload: {
              name: info.name,
              ok: info.result?.success !== false,
              durationMs: info.durationMs,
            },
            visibleToUser: false,
          });
        },
      },
    });

    if (await isAgentRunCancelled(orgId, runId)) {
      return { text: "任务已取消。" };
    }

    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "response.completed",
      title: "回复已生成",
      payload: { toolCalls: result.toolCalls?.length ?? 0 },
      visibleToUser: false,
    });

    await persistSuccess({
      orgId,
      runId,
      session: input.session,
      userText: input.content,
      assistantText: result.content,
      plan,
    });

    return { text: result.content };
  } catch (error) {
    if (await isAgentRunCancelled(orgId, runId)) {
      return { text: "任务已取消。" };
    }
    if (plan.initialResponse) {
      await failAgentRun(orgId, runId, {
        code: "model_failed",
        message: error instanceof Error ? error.message : "模型调用失败",
      });
      return {
        text: `${plan.initialResponse}\n\n（完整处理未完成，可稍后重试）`,
      };
    }
    await failAgentRun(orgId, runId, {
      code: "model_failed",
      message: error instanceof Error ? error.message : "模型调用失败",
    });
    throw error;
  } finally {
    clearInterval(cancelPoll);
  }
}

async function persistSuccess(input: {
  orgId: string;
  runId: string;
  session: AgentSession;
  userText: string;
  assistantText: string;
  plan: AgentPlan;
}) {
  const responseId = `run:${input.runId}:msg:${Date.now()}`;
  await updateAgentSessionResponseId({
    orgId: input.orgId,
    sessionId: input.session.id,
    lastResponseId: responseId,
  }).catch(() => {});

  const turnLine = buildTurnSummaryLine({
    userText: input.userText,
    assistantText: input.assistantText,
    entities: {
      projectId: input.plan.entities.projectId ?? input.session.currentProjectId,
      customerId:
        input.plan.entities.customerId ?? input.session.currentCustomerId,
      quoteId: input.plan.entities.quoteId ?? input.session.currentQuoteId,
    },
  });
  await updateAgentSessionSummary({
    orgId: input.orgId,
    sessionId: input.session.id,
    summary: mergeSessionSummary(input.session.summary, turnLine),
  }).catch(() => {});

  await completeAgentRunRespectingApprovals(input.orgId, input.runId);
}

export async function resolveUserOrgRole(
  userId: string,
  bindingOrgId: string | null,
) {
  const [membership, user] = await Promise.all([
    bindingOrgId
      ? Promise.resolve({ orgId: bindingOrgId })
      : db.organizationMember.findFirst({
          where: { userId, status: "active" },
          select: { orgId: true },
        }),
    db.user.findUnique({
      where: { id: userId },
      select: { role: true, name: true },
    }),
  ]);
  return {
    orgId: membership?.orgId ?? null,
    userRole: user?.role ?? "user",
    userName: user?.name ?? null,
  };
}
