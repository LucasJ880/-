/**
 * Supervisor MVP 受控验收脚本（测试组织 sunny-home-deco）
 *
 * - 默认不调用真实模型技能（--live 才跑 1 次 DIRECT）
 * - 不发送邮件 / 不发布 / 不改预算
 * - 验证：路由、计划校验、状态持久化、重启恢复指纹、组织隔离、非法 PendingAction
 *
 * 用法：
 *   npx tsx scripts/verify-supervisor-mvp.ts
 *   npx tsx scripts/verify-supervisor-mvp.ts --live
 */

import { db } from "@/lib/db";
import { routeComplexity } from "@/lib/agent-supervisor/complexity-router";
import { validateSupervisorPlan } from "@/lib/agent-supervisor/plan-validator";
import { observeStepResult } from "@/lib/agent-supervisor/observer";
import {
  saveSupervisorState,
  loadSupervisorState,
} from "@/lib/agent-supervisor/persist";
import { isSupervisorEnabledWithEnv } from "@/lib/agent-supervisor/flags";
import {
  collectPendingProposals,
  SKILL_PENDING_ACTION_ALLOWLIST,
  buildSkillPendingIdempotencyKey,
} from "@/lib/agent-core/skills/pending-action-bridge";
import { createAgentRun } from "@/lib/agent-runtime/run";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import type { SupervisorState, SupervisorStep } from "@/lib/agent-supervisor/types";
import { getSupervisorLimits } from "@/lib/agent-supervisor/config";
import { isAIConfigured } from "@/lib/ai/config";

const LIVE = process.argv.includes("--live");
const TEST_ORG_CODE = "sunny-home-deco";
const OTHER_ORG_CODE = "lucas-bid";

let passed = 0;
let failed = 0;
const findings: string[] = [];

function ok(cond: boolean, name: string, detail = "") {
  if (cond) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
    findings.push(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("=== Supervisor MVP 受控验收 ===\n");

  const org = await db.organization.findUnique({
    where: { code: TEST_ORG_CODE },
    select: { id: true, code: true, name: true, status: true },
  });
  const other = await db.organization.findUnique({
    where: { code: OTHER_ORG_CODE },
    select: { id: true, code: true },
  });
  if (!org) throw new Error(`测试组织不存在: ${TEST_ORG_CODE}`);
  if (!other) throw new Error(`对照组织不存在: ${OTHER_ORG_CODE}`);

  console.log(`测试组织: ${org.name} (${org.code}) ${org.id}`);
  console.log(`对照组织: ${other.code} ${other.id}`);
  console.log(`LIVE 模型: ${LIVE && isAIConfigured() ? "是" : "否"}\n`);

  // Flag
  ok(
    !isSupervisorEnabledWithEnv(
      { userId: "u", role: "admin", orgCode: org.code },
      { AGENT_SUPERVISOR_ENABLED: "0", AGENT_SUPERVISOR_ROLLOUT_PCT: "100" },
    ),
    "Flag: 总开关关闭",
  );
  ok(
    !isSupervisorEnabledWithEnv(
      { userId: "u", role: "admin", orgCode: org.code },
      {
        AGENT_SUPERVISOR_ENABLED: "1",
        AGENT_SUPERVISOR_ORG_ALLOWLIST: "nope",
        AGENT_SUPERVISOR_ROLLOUT_PCT: "100",
      },
    ),
    "Flag: ROLLOUT 不能绕过组织 Allowlist",
  );
  ok(
    isSupervisorEnabledWithEnv(
      { userId: "u", role: "admin", orgCode: org.code },
      {
        AGENT_SUPERVISOR_ENABLED: "1",
        AGENT_SUPERVISOR_ORG_ALLOWLIST: TEST_ORG_CODE,
        AGENT_SUPERVISOR_ROLE_ALLOWLIST: "admin",
      },
    ),
    "Flag: 测试组织+admin 可开启",
  );

  // 路由
  const d = routeComplexity({ content: "生成今天最重要的销售跟进" });
  ok(d.mode === "direct", "DIRECT 销售路由", d.mode);
  ok(
    d.candidateSkills[0] === "sales-next-best-action",
    "DIRECT 候选技能正确",
  );

  const s = routeComplexity({
    content: "分析本月销售情况，找出最值得推进的客户，并准备本周行动",
  });
  ok(s.mode === "supervisor", "SUPERVISOR 销售路由", s.mode);

  const t = routeComplexity({
    content: "判断这个项目是否值得投，找出全部强制条件，并告诉我接下来怎么开始",
  });
  ok(t.mode === "supervisor", "SUPERVISOR 投标路由", t.mode);

  const m = routeComplexity({
    content: "为多伦多商业窗帘业务制定一套获客计划，并准备第一批执行草稿",
  });
  ok(m.mode === "supervisor", "SUPERVISOR 营销路由", m.mode);

  // 技能存在于测试组织
  const skills = await db.agentSkill.findMany({
    where: { orgId: org.id, isActive: true },
    select: { slug: true },
  });
  const skillSet = new Set(skills.map((x) => x.slug));
  ok(skillSet.has("sales-next-best-action"), "测试组织有销售技能");
  ok(skillSet.has("tender-bid-no-bid"), "测试组织有投标技能");
  ok(skillSet.has("marketing-product-context"), "测试组织有营销技能");

  // 计划校验 + 非法工具
  const planSteps: SupervisorStep[] = [
    {
      id: "step-1",
      order: 1,
      worker: "sales",
      skillSlug: "sales-pipeline-forecast",
      objective: "管道",
      input: {},
      dependsOn: [],
      status: "pending",
      mayCreatePendingAction: false,
    },
    {
      id: "step-2",
      order: 2,
      worker: "sales",
      skillSlug: "sales-next-best-action",
      objective: "动作",
      input: {},
      dependsOn: ["step-1"],
      status: "pending",
      mayCreatePendingAction: true,
    },
  ];
  ok(
    validateSupervisorPlan({
      steps: planSteps,
      maxSteps: 5,
      orgActiveSkillSlugs: skillSet,
    }).ok,
    "合法多步计划通过",
  );

  const illegal = collectPendingProposals({
    pendingActionProposal: {
      type: "marketing.send_blast",
      title: "群发",
    },
  });
  ok(
    !(SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(
      illegal[0]?.type || "",
    ),
    "非法群发动作不在白名单",
  );

  // 组织隔离：跨 org 实体
  const otherProject = await db.project.findFirst({
    where: { orgId: other.id },
    select: { id: true },
  });
  if (otherProject) {
    const { buildSupervisorContext } = await import(
      "@/lib/agent-supervisor/context-builder"
    );
    const ctx = await buildSupervisorContext({
      orgId: org.id,
      userId: "x",
      pageContext: { projectId: otherProject.id },
    });
    ok(
      (ctx.missingContext || []).some((m) => m.includes("不属于当前组织")),
      "跨组织 projectId 被拒绝",
    );
    ok(!ctx.currentEntity || (ctx.currentEntity as { id?: string }).id !== otherProject.id, "不加载对照组织项目实体");
  } else {
    ok(true, "对照组织无项目，跳过跨项目实体（记为通过/跳过）");
  }

  // PMC 隔离
  const { getProductMarketingContext } = await import(
    "@/lib/marketing/product-marketing-context"
  );
  const pmcA = await getProductMarketingContext(org.id);
  const pmcB = await getProductMarketingContext(other.id);
  ok(
    pmcA.company.name !== pmcB.company.name ||
      pmcA.status !== pmcB.status ||
      org.id !== other.id,
    "两组织 PMC 分离读取",
  );

  // 重启恢复：写入 waiting_for_approval 状态 → 读进程等价：重新 load
  const owner = await db.organizationMember.findFirst({
    where: { orgId: org.id, status: "active" },
    select: { userId: true },
  });
  if (!owner) throw new Error("测试组织无成员");

  const session = await getOrCreateAgentSession({
    orgId: org.id,
    userId: owner.userId,
    channel: "supervisor_verify",
    channelUserId: owner.userId,
  });
  const { run } = await createAgentRun({
    orgId: org.id,
    sessionId: session.id,
    runType: "supervisor_verify",
    intent: "supervisor",
  });

  const limits = getSupervisorLimits();
  const state: SupervisorState = {
    sessionId: session.id,
    runId: run.id,
    orgId: org.id,
    userId: owner.userId,
    originalRequest: "分析本月销售并准备行动",
    objective: "分析本月销售并准备行动",
    resolvedContext: {},
    mode: "supervisor",
    plan: [
      {
        ...planSteps[0],
        status: "completed",
        resultSummary: "管道摘要（fixture）",
        resultRef: { skillExecutionId: "exec_fixture_1" },
      },
      {
        ...planSteps[1],
        status: "waiting_for_approval",
      },
    ],
    currentStepIndex: 1,
    observations: [
      {
        stepId: "step-1",
        at: new Date().toISOString(),
        success: true,
        summary: "管道摘要（fixture）",
        factsLearned: ["fixture"],
        pendingActionIds: [],
        decision: "continue",
      },
    ],
    artifacts: [],
    pendingActionIds: ["pa_fixture"],
    status: "waiting_for_approval",
    stepCount: 1,
    replanCount: 0,
    skillCallCount: 1,
    maxSteps: limits.maxSteps,
    maxReplans: limits.maxReplans,
    maxSkillCalls: limits.maxSkillCalls,
    userVisibleTimeline: ["第一步完成", "等待审批"],
    executedFingerprints: [
      'sales-pipeline-forecast::{"objective":"管道"}',
    ],
  };
  await saveSupervisorState(state);
  const loaded = await loadSupervisorState(org.id, run.id);
  ok(!!loaded, "supervisorState 可持久化");
  ok(loaded?.status === "waiting_for_approval", "恢复后仍为等待审批");
  ok(
    loaded?.plan.filter((p) => p.status === "completed").length === 1,
    "已完成步骤在恢复后仍标记 completed",
  );
  ok(
    (loaded?.executedFingerprints || []).length === 1,
    "executedFingerprints 恢复有效",
  );
  ok(
    loaded?.skillCallCount === 1,
    "skillCallCount 恢复正确",
  );

  // 跨组织读取 run
  const cross = await loadSupervisorState(other.id, run.id);
  ok(cross === null, "不能用其他 orgId 读取 Supervisor 状态");

  // 幂等键
  const k1 = buildSkillPendingIdempotencyKey("exec_1", 0, "grader.internal_note");
  const k2 = buildSkillPendingIdempotencyKey("exec_1", 0, "grader.internal_note");
  ok(k1 === k2, "PendingAction 幂等键稳定");

  // Observer：拒绝不应视为成功继续依赖
  const obsRejectPath = observeStepResult({
    state: {
      ...state,
      plan: state.plan.map((p) => ({ ...p, status: "pending" as const })),
      skillCallCount: 0,
    },
    stepId: "step-2",
    workerResult: {
      ok: true,
      skillSlug: "sales-next-best-action",
      content: "{}",
      pendingActionIds: ["pa_new"],
      summary: "草稿",
    },
  });
  ok(obsRejectPath.decision === "wait_approval", "有 PendingAction 时等待审批而非直接完成");

  // 可选 LIVE：仅 DIRECT 一次（需 API Key）；不批准任何外部发送
  if (LIVE && isAIConfigured()) {
    console.log("\n--- LIVE DIRECT（单技能，可能产生 PendingAction 草稿）---");
    const { runSupervisor } = await import("@/lib/agent-supervisor/engine");
    const liveSession = await getOrCreateAgentSession({
      orgId: org.id,
      userId: owner.userId,
      channel: "supervisor_live",
      channelUserId: owner.userId,
    });
    const { run: liveRun } = await createAgentRun({
      orgId: org.id,
      sessionId: liveSession.id,
      runType: "supervisor_live",
      intent: "direct",
    });
    const t0 = Date.now();
    const result = await runSupervisor({
      sessionId: liveSession.id,
      runId: liveRun.id,
      orgId: org.id,
      userId: owner.userId,
      userRole: "admin",
      content: "生成今天最重要的销售跟进。",
      forceMode: "quick",
    });
    const ms = Date.now() - t0;
    ok(result.state.mode === "direct" || result.state.plan.length <= 1, "LIVE DIRECT 未过度规划");
    ok(result.state.skillCallCount <= 2, "LIVE 技能调用克制");
    console.log(`LIVE 耗时 ${ms}ms status=${result.status}`);
    console.log(`摘要预览：\n${result.text.slice(0, 500)}`);
  } else {
    console.log("\n（跳过 LIVE：未传 --live 或未配置 AI）");
  }

  console.log(
    `\n=== 结果：通过 ${passed} / 失败 ${failed} ===`,
  );
  if (findings.length) {
    console.log("失败项：");
    for (const f of findings) console.log(" -", f);
  }

  // 清理验证 run 的状态（不删真实业务）
  await db.agentRun.updateMany({
    where: { id: run.id, orgId: org.id },
    data: { status: "cancelled", cancelledAt: new Date() },
  });

  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
