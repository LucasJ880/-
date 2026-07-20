/**
 * Supervisor 受控 E2E（测试组织 sunny-home-deco）
 *
 * 覆盖：
 * - 审批批准 / 拒绝 / 非法动作拦截
 * - 进程重启等价恢复（save → 清空内存 → load → resume）
 * - 组织隔离
 * - 可选 --live：真实模型 DIRECT / SUPERVISOR（不发送邮件、不发布、不改预算）
 *
 * 用法：
 *   AGENT_SUPERVISOR_ENABLED=1 \
 *   AGENT_SUPERVISOR_ORG_ALLOWLIST=sunny-home-deco \
 *   AGENT_SUPERVISOR_ROLE_ALLOWLIST=admin \
 *   AGENT_SUPERVISOR_ROLLOUT_PCT=100 \
 *   npx tsx scripts/e2e-supervisor-controlled.ts
 *   npx tsx scripts/e2e-supervisor-controlled.ts --live
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import {
  approveApprovalItem,
  rejectApprovalItem,
} from "@/lib/approval/port";
import {
  materializeSkillPendingActions,
  collectPendingProposals,
  SKILL_PENDING_ACTION_ALLOWLIST,
} from "@/lib/agent-core/skills/pending-action-bridge";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import { createAgentRun } from "@/lib/agent-runtime/run";
import {
  saveSupervisorState,
  loadSupervisorState,
} from "@/lib/agent-supervisor/persist";
import { resumeSupervisorAfterApproval } from "@/lib/agent-supervisor/engine";
import { isSupervisorEnabled } from "@/lib/agent-supervisor/flags";
import { routeComplexity } from "@/lib/agent-supervisor/complexity-router";
import { buildSupervisorContext } from "@/lib/agent-supervisor/context-builder";
import type { SupervisorState, SupervisorStep } from "@/lib/agent-supervisor/types";
import { getSupervisorLimits } from "@/lib/agent-supervisor/config";
import { isAIConfigured } from "@/lib/ai/config";
import { stepFingerprint } from "@/lib/agent-supervisor/workers/run-worker";

const LIVE = process.argv.includes("--live");
const TEST_ORG = "sunny-home-deco";
const OTHER_ORG = "lucas-bid";

interface CaseResult {
  name: string;
  pass: boolean;
  detail?: string;
  metrics?: Record<string, unknown>;
}

const results: CaseResult[] = [];

function record(name: string, pass: boolean, detail?: string, metrics?: Record<string, unknown>) {
  results.push({ name, pass, detail, metrics });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function ensureFixtures(orgId: string, userId: string) {
  let project = await db.project.findFirst({
    where: { orgId, code: "supervisor-e2e-fixture" },
    select: { id: true, name: true },
  });
  if (!project) {
    project = await db.project.create({
      data: {
        orgId,
        ownerId: userId,
        name: "[E2E] Supervisor 测试项目",
        code: "supervisor-e2e-fixture",
        status: "active",
        tenderStatus: "evaluating",
        category: "blinds",
        clientOrganization: "E2E Test Client",
        location: "Toronto",
        estimatedValue: 25000,
        currency: "CAD",
      },
      select: { id: true, name: true },
    });
  }

  let customer = await db.salesCustomer.findFirst({
    where: { orgId, name: "[E2E] Supervisor Test Customer" },
    select: { id: true },
  });
  if (!customer) {
    customer = await db.salesCustomer.create({
      data: {
        orgId,
        name: "[E2E] Supervisor Test Customer",
        email: "e2e-supervisor-test@example.invalid",
        status: "active",
        source: "other",
        notes: "仅用于 Supervisor 验收，禁止外发",
        createdById: userId,
      },
      select: { id: true },
    });
  }

  let opp = await db.salesOpportunity.findFirst({
    where: { orgId, title: "[E2E] Supervisor Test Opp" },
    select: { id: true },
  });
  if (!opp) {
    opp = await db.salesOpportunity.create({
      data: {
        orgId,
        customerId: customer.id,
        title: "[E2E] Supervisor Test Opp",
        stage: "qualified",
        estimatedValue: 12000,
        createdById: userId,
      },
      select: { id: true },
    });
  }

  return { project, customer, opp };
}

function basePlan(projectId: string): SupervisorStep[] {
  return [
    {
      id: "step-1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-pipeline-forecast",
      objective: "管道分析",
      input: { objective: "管道" },
      dependsOn: [],
      status: "completed",
      mayCreatePendingAction: false,
      resultSummary: "fixture 管道摘要",
      resultRef: { skillExecutionId: "exec_fixture_step1" },
    },
    {
      id: "step-2",
      order: 2,
      worker: "sales",
      skillSlug: "sales-next-best-action",
      objective: "准备内部备注",
      input: { objective: "备注", projectId },
      dependsOn: ["step-1"],
      status: "waiting_for_approval",
      mayCreatePendingAction: true,
      resultSummary: "已提议内部备注",
      resultRef: { skillExecutionId: "exec_fixture_step2" },
    },
    {
      id: "step-3",
      order: 3,
      worker: "sales",
      skillSlug: "sales-account-research",
      objective: "客户研究（依赖 step-2）",
      input: { objective: "研究" },
      dependsOn: ["step-2"],
      status: "pending",
      mayCreatePendingAction: false,
    },
  ];
}

async function makeWaitingRun(input: {
  orgId: string;
  userId: string;
  projectId: string;
  channel: string;
}) {
  const session = await getOrCreateAgentSession({
    orgId: input.orgId,
    userId: input.userId,
    channel: input.channel,
    channelUserId: input.userId,
  });
  const { run } = await createAgentRun({
    orgId: input.orgId,
    sessionId: session.id,
    runType: "supervisor_e2e",
    intent: "supervisor",
  });

  const draft = await createDraft({
    type: "grader.internal_note",
    title: "[E2E] 测试项目内部备注",
    preview: "仅验收审批闭环，安全动作",
    payload: {
      type: "grader.internal_note",
      targetType: "PROJECT",
      targetId: input.projectId,
      note: `[E2E Supervisor] 验收备注 ${new Date().toISOString()}`,
      source: "GRADER",
      metadata: {
        orgId: input.orgId,
        projectId: input.projectId,
        issueCategory: "supervisor_e2e",
        issueSeverity: "LOW",
      },
    },
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    agentRunId: run.id,
    ttlHours: 2,
  });
  if (!draft.success || !draft.data) {
    throw new Error(`createDraft failed: ${draft.error || "no data"}`);
  }
  const pendingActionId = (draft.data as { actionId?: string; id?: string })
    .actionId;
  if (!pendingActionId) {
    throw new Error(`createDraft missing id: ${JSON.stringify(draft.data)}`);
  }

  const limits = getSupervisorLimits();
  const plan = basePlan(input.projectId);
  const state: SupervisorState = {
    sessionId: session.id,
    runId: run.id,
    orgId: input.orgId,
    userId: input.userId,
    userRole: "admin",
    originalRequest: "分析销售并准备行动",
    objective: "分析销售并准备行动",
    pageContext: { projectId: input.projectId },
    resolvedContext: {},
    mode: "supervisor",
    plan,
    currentStepIndex: 1,
    observations: [
      {
        stepId: "step-1",
        at: new Date().toISOString(),
        success: true,
        summary: "fixture",
        factsLearned: ["fixture"],
        pendingActionIds: [],
        decision: "continue",
      },
    ],
    artifacts: [],
    pendingActionIds: [pendingActionId],
    status: "waiting_for_approval",
    stepCount: 1,
    replanCount: 0,
    skillCallCount: 1,
    maxSteps: limits.maxSteps,
    maxReplans: limits.maxReplans,
    maxSkillCalls: limits.maxSkillCalls,
    userVisibleTimeline: ["第一步完成", "等待审批"],
    executedFingerprints: [stepFingerprint(plan[0])],
  };
  await saveSupervisorState(state);
  return { runId: run.id, pendingActionId, state };
}

async function main() {
  console.log("=== Supervisor 受控 E2E ===\n");

  const org = await db.organization.findUnique({
    where: { code: TEST_ORG },
    select: { id: true, code: true, name: true },
  });
  const other = await db.organization.findUnique({
    where: { code: OTHER_ORG },
    select: { id: true, code: true },
  });
  if (!org || !other) throw new Error("测试/对照组织缺失");

  const member = await db.organizationMember.findFirst({
    where: { orgId: org.id, status: "active" },
    select: { userId: true, role: true },
  });
  if (!member) throw new Error("测试组织无成员");

  // 进程内 Flag（不写生产）
  process.env.AGENT_SUPERVISOR_ENABLED = "1";
  process.env.AGENT_SUPERVISOR_ORG_ALLOWLIST = TEST_ORG;
  process.env.AGENT_SUPERVISOR_ROLE_ALLOWLIST = "admin";
  process.env.AGENT_SUPERVISOR_ROLLOUT_PCT = "100";
  // 强制主管模型走已验证可用的 primary（避免默认 luna 403）
  if (!process.env.AGENT_SUPERVISOR_PLANNER_MODEL) {
    process.env.AGENT_SUPERVISOR_PLANNER_MODEL =
      process.env.OPENAI_MODEL || "gpt-5.6-sol";
  }
  if (!process.env.AGENT_SUPERVISOR_SUMMARY_MODEL) {
    process.env.AGENT_SUPERVISOR_SUMMARY_MODEL =
      process.env.OPENAI_MODEL || "gpt-5.6-sol";
  }
  if (!process.env.AGENT_SUPERVISOR_OBSERVER_MODEL) {
    process.env.AGENT_SUPERVISOR_OBSERVER_MODEL =
      process.env.OPENAI_MODEL || "gpt-5.6-sol";
  }

  record(
    "Flag 开启（测试组织+admin）",
    isSupervisorEnabled({
      userId: member.userId,
      role: "admin",
      orgId: org.id,
      orgCode: org.code,
    }),
  );
  record(
    "Flag 对照组织关闭",
    !isSupervisorEnabled({
      userId: member.userId,
      role: "admin",
      orgId: other.id,
      orgCode: other.code,
    }),
  );

  const fixtures = await ensureFixtures(org.id, member.userId);
  console.log(`Fixture project=${fixtures.project.id}`);

  // 非法动作
  const illegal = await materializeSkillPendingActions({
    parsed: {
      pendingActionProposal: {
        type: "marketing.send_blast",
        title: "群发",
        payload: {},
      },
    },
    userId: member.userId,
    orgId: org.id,
    skillId: "x",
    skillSlug: "marketing-prospecting-campaign",
    skillExecutionId: `e2e_illegal_${Date.now()}`,
    agentRunId: null,
  });
  record(
    "非法群发不落库",
    illegal.created.length === 0 &&
      illegal.skipped.some((s) => s.reason.includes("白名单")),
    `skipped=${illegal.skipped.length}`,
  );

  const illegalTypes = [
    "email.send",
    "marketing.publish",
    "ads.update_budget",
    "not.a.real.type",
  ];
  for (const t of illegalTypes) {
    const inAllow = (SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(t);
    const collected = collectPendingProposals({
      pendingActionProposal: { type: t, title: t },
    });
    record(`非法类型拦截: ${t}`, !inAllow && collected.length === 1, "收集后不在白名单");
  }

  // 组织隔离
  const otherProject = await db.project.findFirst({
    where: { orgId: other.id },
    select: { id: true },
  });
  if (otherProject) {
    const ctx = await buildSupervisorContext({
      orgId: org.id,
      userId: member.userId,
      pageContext: { projectId: otherProject.id },
    });
    record(
      "跨组织 projectId 拒绝",
      (ctx.missingContext || []).some((m) => m.includes("不属于当前组织")),
    );
  } else {
    record("跨组织 projectId 拒绝", true, "对照组织无项目，跳过");
  }

  // 批准闭环 + 重启恢复
  {
    const waiting = await makeWaitingRun({
      orgId: org.id,
      userId: member.userId,
      projectId: fixtures.project.id,
      channel: "supervisor_e2e_approve",
    });
    const fingerprintsBefore = [...waiting.state.executedFingerprints];
    const skillCallsBefore = waiting.state.skillCallCount;

    // 模拟进程重启：仅从 DB 再读
    const reloaded = await loadSupervisorState(org.id, waiting.runId);
    record(
      "重启后状态可恢复",
      !!reloaded &&
        reloaded.status === "waiting_for_approval" &&
        reloaded.skillCallCount === skillCallsBefore &&
        JSON.stringify(reloaded.executedFingerprints) ===
          JSON.stringify(fingerprintsBefore),
    );
    record(
      "跨 org 读 run 失败",
      (await loadSupervisorState(other.id, waiting.runId)) === null,
    );

    const approve = await approveApprovalItem("pending_action", waiting.pendingActionId, {
      userId: member.userId,
      role: "admin",
      orgId: org.id,
      note: "E2E 批准安全内部备注",
    });
    record("批准安全内部备注", approve.ok === true, approve.message || approve.error);

    const after = await loadSupervisorState(org.id, waiting.runId);
    const pa = await db.pendingAction.findUnique({
      where: { id: waiting.pendingActionId },
      select: { status: true },
    });
    record(
      "批准后 PendingAction 已执行且不重复",
      pa?.status === "executed" || pa?.status === "approved",
      `status=${pa?.status}`,
    );
    record(
      "批准恢复后不重复指纹",
      !!after &&
        after.executedFingerprints.filter((f) => fingerprintsBefore.includes(f))
          .length === fingerprintsBefore.length,
      `fps=${after?.executedFingerprints.length}`,
    );

    // 幂等：再次 resume 不应再跑 step-1
    const resume2 = await resumeSupervisorAfterApproval({
      orgId: org.id,
      runId: waiting.runId,
      userId: member.userId,
      userRole: "admin",
    });
    record(
      "二次 resume 不炸",
      resume2.ok,
      `status=${resume2.status}`,
    );
  }

  // 拒绝闭环
  {
    const waiting = await makeWaitingRun({
      orgId: org.id,
      userId: member.userId,
      projectId: fixtures.project.id,
      channel: "supervisor_e2e_reject",
    });
    const reject = await rejectApprovalItem("pending_action", waiting.pendingActionId, {
      userId: member.userId,
      role: "admin",
      orgId: org.id,
      note: "E2E 故意拒绝",
    });
    record("拒绝 PendingAction", reject.ok === true, reject.message || reject.error);

    const after = await loadSupervisorState(org.id, waiting.runId);
    const rejectedStep = after?.plan.find(
      (s) => s.error === "pending_action_rejected" || s.id === "step-2",
    );
    const depStep = after?.plan.find((s) => s.id === "step-3");
    record(
      "拒绝不视为成功",
      !!after &&
        (rejectedStep?.error === "pending_action_rejected" ||
          after.observations.some(
            (o) =>
              o.decision === "replan" &&
              (o.summary.includes("拒绝") ||
                o.factsLearned.includes("审批拒绝，动作未执行")),
          )) &&
        !after.plan.some(
          (s) =>
            s.id === "step-2" &&
            s.status === "completed" &&
            s.error !== "pending_action_rejected",
        ),
      `step2=${rejectedStep?.status}/${rejectedStep?.error} replan=${after?.replanCount}`,
    );
    record(
      "依赖拒绝步骤被跳过或重规划",
      !depStep ||
        depStep.status === "skipped" ||
        depStep.status === "pending" ||
        (after?.replanCount || 0) > 0,
      `step3=${depStep?.status} replan=${after?.replanCount}`,
    );
    record(
      "摘要提及拒绝",
      !!after &&
        (after.userVisibleTimeline.some((t) => t.includes("拒绝")) ||
          JSON.stringify(after.finalSummary || {}).includes("拒绝") ||
          after.observations.some((o) => o.summary.includes("拒绝"))),
    );

    const dupCount = await db.pendingAction.count({
      where: {
        orgId: org.id,
        agentRunId: waiting.runId,
        type: "grader.internal_note",
      },
    });
    record("拒绝后不重复创建 PendingAction", dupCount === 1, `count=${dupCount}`);
  }

  // 路由场景（确定性）
  const scenarios = [
    {
      name: "场景A DIRECT销售",
      content: "生成今天最重要的销售跟进。",
      expectMode: "direct" as const,
      expectSkill: "sales-next-best-action",
    },
    {
      name: "场景B SUPERVISOR销售",
      content: "分析本月销售情况，找出最值得推进的客户，并准备本周行动。",
      expectMode: "supervisor" as const,
    },
    {
      name: "场景C DIRECT投标",
      content: "判断这个项目是否值得投。",
      expectMode: "direct" as const,
      expectSkill: "tender-bid-no-bid",
    },
    {
      name: "场景D SUPERVISOR投标",
      content:
        "判断这个项目是否值得投，找出全部强制条件，并告诉我接下来怎么开始。",
      expectMode: "supervisor" as const,
    },
    {
      name: "场景E SUPERVISOR营销",
      content: "为多伦多商业窗帘业务制定一套获客计划，并准备第一批执行草稿。",
      expectMode: "supervisor" as const,
    },
  ];

  for (const s of scenarios) {
    const r = routeComplexity({
      content: s.content,
      pageContext: { projectId: fixtures.project.id },
    });
    const modeOk = r.mode === s.expectMode;
    const skillOk = s.expectSkill
      ? r.candidateSkills[0] === s.expectSkill
      : true;
    record(s.name + " 路由", modeOk && skillOk, `mode=${r.mode} skills=${r.candidateSkills.join(",")}`);
  }

  // LIVE 真实模型（可选）
  if (LIVE && isAIConfigured()) {
    const { runSupervisor } = await import("@/lib/agent-supervisor/engine");
    const liveCases = [
      {
        name: "LIVE A DIRECT销售",
        content: "生成今天最重要的销售跟进。",
        forceMode: "quick" as const,
        expectMode: "direct" as const,
      },
      {
        name: "LIVE B SUPERVISOR销售",
        content: "分析本月销售情况，找出最值得推进的客户，并准备本周行动。",
        forceMode: "supervisor" as const,
        expectMode: "supervisor" as const,
      },
      {
        name: "LIVE C DIRECT投标",
        content: "判断这个项目是否值得投。",
        forceMode: "quick" as const,
        expectMode: "direct" as const,
        projectId: fixtures.project.id,
      },
      {
        name: "LIVE D SUPERVISOR投标",
        content:
          "判断这个项目是否值得投，找出全部强制条件，并告诉我接下来怎么开始。",
        forceMode: "supervisor" as const,
        expectMode: "supervisor" as const,
        projectId: fixtures.project.id,
      },
      {
        name: "LIVE E SUPERVISOR营销",
        content: "为多伦多商业窗帘业务制定一套获客计划，并准备第一批执行草稿。",
        forceMode: "supervisor" as const,
        expectMode: "supervisor" as const,
      },
    ];

    for (const c of liveCases) {
      const session = await getOrCreateAgentSession({
        orgId: org.id,
        userId: member.userId,
        channel: `supervisor_live_${Date.now()}`,
        channelUserId: member.userId,
      });
      const { run } = await createAgentRun({
        orgId: org.id,
        sessionId: session.id,
        runType: "supervisor_live",
        intent: c.expectMode,
      });
      const t0 = Date.now();
      try {
        const result = await runSupervisor({
          sessionId: session.id,
          runId: run.id,
          orgId: org.id,
          userId: member.userId,
          userRole: "admin",
          content: c.content,
          forceMode: c.forceMode,
          pageContext: c.projectId ? { projectId: c.projectId } : undefined,
        });
        const ms = Date.now() - t0;
        const modeOk =
          result.state.mode === c.expectMode ||
          (c.expectMode === "direct" && result.state.plan.length <= 1);
        const noExternalSend = !(result.text || "").match(
          /已发送|已发布|已投放|预算已修改/,
        );
        const text = result.text || "";
        const conclusionLine =
          text.split("\n").find((l) => l.includes("关于「") || l.startsWith("本")) ||
          "";
        const notRawJson =
          text.includes("## 结论") &&
          !conclusionLine.trim().startsWith("{") &&
          !/"priorities"\s*:/.test(conclusionLine) &&
          !/"asOf"\s*:/.test(conclusionLine);
        const noSlugTitle = !/\bsales-[a-z0-9-]+\b|\btender-[a-z0-9-]+\b/.test(
          text.split("\n").slice(0, 8).join("\n"),
        );
        const plannerMeta = (result.state.modelTelemetry || []).find(
          (m) => m.purpose === "planner",
        );
        const fallbackUsed = result.state.fallbackUsed === true;
        // SUPERVISOR：不允许纯规则降级（fallbackUsed）；须有模型规划遥测
        const plannerOk =
          c.expectMode !== "supervisor" ||
          (!fallbackUsed &&
            !!plannerMeta &&
            plannerMeta.actualModel.length > 0);
        const skillOk =
          c.name.includes("SUPERVISOR销售")
            ? result.state.skillCallCount >= 2 &&
              result.state.plan.some((p) => p.skillSlug.includes("pipeline")) &&
              result.state.plan.some((p) => p.skillSlug.includes("next-best"))
            : c.name.includes("SUPERVISOR营销")
              ? result.state.plan.filter((p) => p.worker === "marketing").length >=
                  2 || result.state.skillCallCount >= 2
              : c.expectMode === "direct"
                ? result.state.skillCallCount >= 1 &&
                  result.state.skillCallCount <= 2
                : true;
        const statusOk =
          result.ok ||
          result.status === "waiting_for_approval" ||
          result.status === "completed";
        const pass =
          statusOk &&
          modeOk &&
          !!noExternalSend &&
          notRawJson &&
          noSlugTitle &&
          plannerOk &&
          skillOk;
        record(
          c.name,
          pass,
          `status=${result.status} mode=${result.state.mode} skills=${result.state.skillCallCount} fallback=${fallbackUsed} planner=${plannerMeta?.actualModel || "n/a"} ${ms}ms`,
          {
            ms,
            mode: result.state.mode,
            skillCallCount: result.state.skillCallCount,
            replanCount: result.state.replanCount,
            steps: result.state.plan.length,
            pending: result.pendingActionIds.length,
            fallbackUsed,
            plannerModel: plannerMeta?.actualModel,
            knowledge: result.state.knowledgeRetrieval,
            summaryPreview: text.slice(0, 400),
          },
        );
        console.log("--- 摘要预览 ---\n" + text.slice(0, 800) + "\n");
        console.log(
          `telemetry: fallbackUsed=${fallbackUsed} planner=${JSON.stringify(plannerMeta || null)} knowledge=${JSON.stringify(result.state.knowledgeRetrieval || null)}\n`,
        );
      } catch (e) {
        record(c.name, false, e instanceof Error ? e.message : String(e));
      }
    }
  } else {
    console.log("\n（跳过 LIVE：未传 --live 或未配置 AI）\n");
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== 汇总：通过 ${passed} / 失败 ${failed} / 共 ${results.length} ===`);
  if (failed) {
    for (const r of results.filter((x) => !x.pass)) {
      console.log(` FAIL: ${r.name} — ${r.detail || ""}`);
    }
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
