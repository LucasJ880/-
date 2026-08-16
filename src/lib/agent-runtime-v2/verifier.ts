import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import {
  fenceGuardedWrite,
  LostLeaseError,
  type RunFence,
} from "@/lib/agent-runtime/lease";
import { getRuntimeV2Limits } from "./flags";
import { emitRuntimeV2Event } from "./events";
import {
  VerifierOutputSchema,
  type PlannerOutput,
  type VerifierOutput,
} from "./schemas";

async function deterministicVerify(input: {
  orgId: string;
  runId: string;
  plan: PlannerOutput;
}): Promise<VerifierOutput> {
  const steps = await db.agentRunStep.findMany({
    where: { orgId: input.orgId, runId: input.runId },
  });

  const satisfied: string[] = [];
  const unsatisfied: string[] = [];
  const evidence: string[] = [];
  const repairs: string[] = [];

  // ── P0 #90A Required Task Failure Rule（§24–§25）──
  // 任何 required Task 的 terminal failure（failed / blocked）都必须进入
  // failedRequired，无论 requiresApproval 取值。审批语义不豁免执行失败：
  // Approval Outcome ≠ Execution Outcome——审批拒绝走 skipped（合法 skip，
  // 2C-1 冻结语义，不在此列），而"审批通过后执行失败 / 写步骤工具失败"
  // 是真实 terminal failure，绝不能对 verifier 不可见。
  // 当前 Task contract 无 optional 标记 ⇒ 所有 Task 均为 required。
  const failedRequired = steps.filter(
    (s) => s.status === "failed" || s.status === "blocked",
  );
  // 自动修复只覆盖非审批步骤（repair 重置 requiresApproval=false 的
  // failed step）；审批类失败不可自动修复 → 必须转人工，禁止空转 REPAIR
  const failedRepairable = failedRequired.filter(
    (s) => s.requiresApproval === false,
  );
  const failedNonRepairable = failedRequired.filter(
    (s) => s.requiresApproval === true,
  );
  if (failedRequired.length > 0) {
    if (failedRepairable.length > 0) {
      unsatisfied.push("必要只读/分析步骤失败");
      repairs.push("重新执行失败的分析步骤");
    }
    if (failedNonRepairable.length > 0) {
      unsatisfied.push(
        "必需写任务终态失败（requiresApproval 不豁免执行失败）",
      );
    }
    evidence.push(...failedRequired.map((s) => `step:${s.stepKey}:failed`));
  } else {
    satisfied.push("必需任务无未恢复失败");
  }

  const writeSteps = steps.filter((s) => s.requiresApproval);
  const pendingWrites = writeSteps.filter((s) => s.status === "awaiting_approval");
  if (pendingWrites.length > 0) {
    return {
      verdict: "BLOCKED",
      summary: "仍有写操作等待审批，暂不验证完成",
      satisfiedCriteria: satisfied,
      unsatisfiedCriteria: ["写操作尚未全部决策"],
      evidenceReferences: pendingWrites.map((s) => `step:${s.stepKey}:awaiting`),
      repairInstructions: [],
    };
  }

  // 检查 PendingAction 执行结果
  const pendingIds = writeSteps
    .flatMap((s) => {
      const ev = s.evidenceJson as { pendingActionIds?: string[] } | null;
      return ev?.pendingActionIds ?? (s.pendingActionId ? [s.pendingActionId] : []);
    })
    .filter(Boolean);

  if (pendingIds.length > 0) {
    const actions = await db.pendingAction.findMany({
      where: { id: { in: pendingIds }, orgId: input.orgId },
      select: { id: true, status: true, type: true, resultRef: true },
    });
    const executed = actions.filter((a) => a.status === "executed");
    const rejected = actions.filter((a) => a.status === "rejected");
    const failed = actions.filter((a) => a.status === "failed");
    evidence.push(
      `pending:executed=${executed.length}`,
      `pending:rejected=${rejected.length}`,
      `pending:failed=${failed.length}`,
    );

    for (const a of executed) {
      if (a.type === "grader.email_draft" && !a.resultRef) {
        unsatisfied.push(`Gmail 草稿 ${a.id} 缺少 resultRef`);
        repairs.push("重新创建 Gmail 草稿 PendingAction 并确认执行");
      }
    }
    if (failed.length > 0) {
      unsatisfied.push("部分 PendingAction 执行失败");
      repairs.push("检查失败原因后重试对应写步骤");
    }
    if (executed.length + rejected.length + failed.length === actions.length) {
      satisfied.push("写操作均已决策");
    }
  } else {
    satisfied.push("无待验证写操作或均已跳过");
  }

  const readDone = steps
    .filter((s) => !s.requiresApproval)
    .every(
      (s) =>
        s.status === "completed" ||
        s.status === "skipped" ||
        s.status === "partially_executed",
    );
  if (readDone) satisfied.push("读取与分析步骤完成");
  else unsatisfied.push("仍有未完成的读取/分析步骤");

  // PARTIAL / degraded 证据不得当作完整完成依据
  const partialEvidenceSteps = steps.filter((s) => {
    const out = s.outputJson as {
      evidenceQuality?: string;
      degraded?: boolean;
    } | null;
    return out?.evidenceQuality === "PARTIAL" || out?.degraded === true;
  });
  if (partialEvidenceSteps.length > 0) {
    unsatisfied.push("存在 PARTIAL/degraded 分析证据，不能视为完整完成");
    evidence.push(
      ...partialEvidenceSteps.map((s) => `step:${s.stepKey}:PARTIAL`),
    );
    repairs.push("在完整 Grader 证据可用后重新分析并验证");
  }

  // T5-P1 §4：tool_result + evidenceStepIds 的 criterion 由 deterministic verifier
  // 逐项核验（step 存在 / completed / 有 outputJson / 非 PARTIAL / 非 degraded），
  // 满足即写入 evidenceReferences——修掉"成功路径证据恒为空 → 模型 PASS 被强制
  // 降级为 NEEDS_HUMAN"的 Runtime evidence contract 缺陷。
  const byKey = new Map(steps.map((s) => [s.stepKey, s]));
  for (const c of input.plan.completionCriteria ?? []) {
    const ids = (c as { evidenceStepIds?: string[] }).evidenceStepIds ?? [];
    if (c.verificationType !== "tool_result" || ids.length === 0) continue;
    const problems: string[] = [];
    for (const id of ids) {
      const st = byKey.get(id);
      if (!st) { problems.push(`${id}:missing`); continue; }
      if (st.status !== "completed") { problems.push(`${id}:${st.status}`); continue; }
      if (!st.outputJson) { problems.push(`${id}:no_output`); continue; }
      const out = st.outputJson as { evidenceQuality?: string; degraded?: boolean };
      if (out?.evidenceQuality === "PARTIAL" || out?.degraded === true) {
        problems.push(`${id}:PARTIAL`); continue;
      }
      evidence.push(`criterion:${c.id} step:${id}:tool_result`);
    }
    if (problems.length === 0) satisfied.push(`完成标准「${c.id}」已由工具结果证实`);
    else unsatisfied.push(`完成标准「${c.id}」证据不成立：${problems.join(",")}`);
  }

  if (unsatisfied.length === 0) {
    return {
      verdict: "PASS",
      summary: "确定性检查通过：步骤与审批结果一致",
      satisfiedCriteria: satisfied,
      unsatisfiedCriteria: [],
      evidenceReferences: evidence,
      repairInstructions: [],
    };
  }

  // #90A：存在不可自动修复的必需任务失败、且无可修复失败可先处理时，
  // REPAIR 只会空转（repair 不重置审批步骤）→ 直接 NEEDS_HUMAN。
  if (failedNonRepairable.length > 0 && failedRepairable.length === 0) {
    return {
      verdict: "NEEDS_HUMAN",
      summary: "确定性检查发现不可自动修复的必需任务失败，需要人工处理",
      satisfiedCriteria: satisfied,
      unsatisfiedCriteria: unsatisfied,
      evidenceReferences: evidence,
      repairInstructions: repairs,
    };
  }

  return {
    verdict: "REPAIR",
    summary: "确定性检查发现问题，需要修复",
    satisfiedCriteria: satisfied,
    unsatisfiedCriteria: unsatisfied,
    evidenceReferences: evidence,
    repairInstructions: repairs,
  };
}

/**
 * P0 #90A（§27）Deterministic Rule Engine = hard floor：
 * 确定性引擎已判非 PASS 时，模型复核（LLM verifier）绝不允许把最终
 * verdict 升回 PASS——模型只能补充解释/风险/narrative，不能解除
 * deterministic failure。纯函数导出供永久 invariant 测试。
 *
 * 结构上 modelVerify 仅在 deterministic=PASS 时运行（下方 gate），
 * 本函数是最终 verdict 前的第二道防线（defense in depth）。
 */
export function applyDeterministicHardFloor(
  deterministic: VerifierOutput,
  model: VerifierOutput,
): VerifierOutput {
  if (deterministic.verdict !== "PASS" && model.verdict === "PASS") {
    return {
      ...deterministic,
      summary: `${deterministic.summary}（模型复核不得解除确定性失败）`,
    };
  }
  return model;
}

async function modelVerify(input: {
  orgId: string;
  userId: string;
  runId: string;
  plan: PlannerOutput;
  deterministic: VerifierOutput;
}): Promise<VerifierOutput> {
  if (input.deterministic.verdict !== "PASS") return input.deterministic;
  try {
    const text = await createCompletion({
      systemPrompt:
        "你是青砚 Agent Runtime Verifier。只根据给定证据判断是否完成用户目标。不得臆造证据。仅输出 JSON：verdict(PASS|REPAIR|NEEDS_HUMAN|BLOCKED), summary, satisfiedCriteria[], unsatisfiedCriteria[], evidenceReferences[], repairInstructions[]。",
      userPrompt: JSON.stringify({
        objective: input.plan.objective,
        criteria: input.plan.completionCriteria,
        deterministic: input.deterministic,
      }),
      temperature: 0,
      maxTokens: 800,
      orgId: input.orgId,
      userId: input.userId,
      agentRunId: input.runId,
    });
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return input.deterministic;
    const parsed = VerifierOutputSchema.safeParse(JSON.parse(m[0]));
    if (!parsed.success) return input.deterministic;
    // 模型不得在证据不足时升级为 PASS
    if (
      parsed.data.verdict === "PASS" &&
      input.deterministic.evidenceReferences.length === 0
    ) {
      return {
        ...parsed.data,
        verdict: "NEEDS_HUMAN",
        summary: "证据不足，不能判定完成",
      };
    }
    return parsed.data;
  } catch {
    return input.deterministic;
  }
}

/**
 * fence（可选，Phase 2A Final）：workforce_job 传入 RunFence——
 * verification 落库与所有 run 终态/修复转换经原子防栅栏；model call
 *（长 await）之后重新验证 lease ownership，fence 丢失抛 LostLeaseError
 *（由调用方转成 lost_lease，不写任何状态）。不传 fence 行为不变。
 */
export async function verifyRuntimeV2Run(input: {
  orgId: string;
  runId: string;
  userId: string;
  fence?: RunFence;
}): Promise<VerifierOutput> {
  const fence = input.fence;
  const run = await db.agentRun.findFirst({
    where: { id: input.runId, orgId: input.orgId, runtimeVersion: "v2" },
  });
  if (!run?.planJson) {
    return {
      verdict: "NEEDS_HUMAN",
      summary: "缺少计划，无法验证",
      satisfiedCriteria: [],
      unsatisfiedCriteria: ["planJson missing"],
      evidenceReferences: [],
      repairInstructions: [],
    };
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRun.update({
      where: { id: input.runId },
      data: { status: "verifying" },
    }),
  );
  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "verification.started",
    title: "正在验证执行结果",
  });

  const plan = run.planJson as unknown as PlannerOutput;
  const deterministic = await deterministicVerify({
    orgId: input.orgId,
    runId: input.runId,
    plan,
  });
  // T5-P1 §5：若全部 completionCriteria 都已被 deterministic verifier 完整核验
  // （tool_result + evidenceStepIds），不再让模型重新猜"是否完成"——
  // 确定性事实不交给概率模型复判。model verifier 仍保留给 model_judgement
  // 及无法确定性验证的 criterion（legacy LLM plan 行为不变）。
  const criteria = plan.completionCriteria ?? [];
  const fullyDeterministic =
    criteria.length > 0 &&
    criteria.every(
      (c) =>
        c.verificationType === "tool_result" &&
        ((c as { evidenceStepIds?: string[] }).evidenceStepIds ?? []).length > 0,
    );
  const modeled = fullyDeterministic
    ? deterministic
    : await modelVerify({
        orgId: input.orgId,
        userId: input.userId,
        // #112 Autopilot A1-P1：runId 透传给运行时事件遥测
        runId: input.runId,
        plan,
        deterministic,
      });
  // #90A §27：deterministic hard floor——LLM 不得解除确定性失败
  const final = applyDeterministicHardFloor(deterministic, modeled);

  // ── 关键 fence 检查点（Phase 2A Final BLOCKER 1）──
  // modelVerify 是潜在长 await（LLM 调用）：verification 落库与任何终态
  // 转换之前重新验证 lease ownership。
  if (fence && !(await fence.check())) {
    throw new LostLeaseError(input.runId);
  }

  const prior = await db.agentRunVerification.count({
    where: { orgId: input.orgId, runId: input.runId },
  });
  const attempt = prior + 1;
  await fenceGuardedWrite(fence, (c) =>
    c.agentRunVerification.create({
      data: {
        orgId: input.orgId,
        runId: input.runId,
        attempt,
        verdict: final.verdict,
        summary: final.summary,
        satisfiedCriteriaJson: final.satisfiedCriteria,
        unsatisfiedCriteriaJson: final.unsatisfiedCriteria,
        evidenceReferencesJson: final.evidenceReferences,
        repairInstructionsJson: final.repairInstructions,
      },
    }),
  );

  const { maxRepairs } = getRuntimeV2Limits();

  if (final.verdict === "PASS") {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.update({
        where: { id: input.runId },
        data: { status: "completed", completedAt: new Date() },
      }),
    );
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "verification.passed",
      title: "验证通过",
      payload: { summary: final.summary },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "run.completed",
      title: "任务已完成",
      payload: { summary: final.summary },
    });
    return final;
  }

  if (final.verdict === "BLOCKED") {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.update({
        where: { id: input.runId },
        data: { status: "awaiting_approval" },
      }),
    );
    return final;
  }

  if (final.verdict === "REPAIR" && attempt <= maxRepairs) {
    await fenceGuardedWrite(fence, (c) =>
      c.agentRun.update({
        where: { id: input.runId },
        data: { status: "repairing" },
      }),
    );
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "verification.repair_required",
      title: "发现未完成项，正在修复",
      payload: { attempt, instructions: final.repairInstructions },
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "repair.started",
      title: `修复轮次 ${attempt}`,
    });
    // 最小 repair：将 failed 的非审批步骤重置为 ready
    await fenceGuardedWrite(fence, async (c) => {
      await c.agentRunStep.updateMany({
        where: {
          orgId: input.orgId,
          runId: input.runId,
          status: "failed",
          requiresApproval: false,
        },
        data: { status: "ready", errorCode: null, errorMessage: null },
      });
      await c.agentRun.update({
        where: { id: input.runId },
        data: { status: "executing" },
      });
    });
    await emitRuntimeV2Event({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "repair.completed",
      title: "已安排修复重试",
    });
    return final;
  }

  await fenceGuardedWrite(fence, (c) =>
    c.agentRun.update({
      where: { id: input.runId },
      data: {
        status: "needs_human",
        // P0：durable errorCode 补全（此前保持 null/残留旧值；
        // 非 MANUAL_RESUMABLE_PERMISSION_CODES ⇒ 2C-1 resume 白名单
        // 行为不变，仍 fail-closed）
        errorCode: "verification_failed",
        errorMessage: final.summary,
      },
    }),
  );
  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "verification.needs_human",
    title: "需要人工处理",
    payload: { summary: final.summary, attempt },
  });
  await emitRuntimeV2Event({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "run.needs_human",
    title: "需要人工处理",
  });
  return final;
}
