/**
 * Workforce Controlled Parallel Task Execution（Phase 2B-2 §5–§14）
 *
 * 本模块只做两件事，全部是纯函数（server-owned，planner 只能提供信息、
 * 不能决定安全策略）：
 *
 * 1. classifyTaskExecutionPolicy：对单个 ready Task 判定执行策略。
 *    只有 SAFE_PARALLEL 允许真正并行；其余（SEQUENTIAL / EXCLUSIVE_RESOURCE /
 *    REQUIRES_APPROVAL）保持受控串行。任何不确定 → SEQUENTIAL（fail-safe）。
 *
 * 2. buildParallelBatch：从 ready 队列组装一个 bounded batch。
 *    - maxParallelTasks <= 1：恒为 [队首]（与 2B-1 之前的单步语义一致，
 *      production default 回滚保证）；
 *    - 队首为 REQUIRES_APPROVAL / SEQUENTIAL：单独成 batch（§8：审批任务
 *      绝不与其他任务同批启动）；
 *    - 队首为 SAFE_PARALLEL：继续收集资源不相交的 SAFE_PARALLEL 任务，
 *      直到 maxParallelTasks；资源相交者跳过（留在 ready，后续轮次串行）；
 *    - EXCLUSIVE_RESOURCE（资源与 running/awaiting 占用相交）：本轮不启动。
 *
 * 资源冲突只控制 same Job 内部 batch（§9），不做 distributed global lock。
 */

import { isRuntimeV2ToolExecutable } from "@/lib/agent-runtime-v2/adapters";
import { getRuntimeV2Tool } from "@/lib/agent-runtime-v2/tool-catalog";
import { readWorkforceTaskSpec } from "./task-contract";

export type TaskExecutionPolicy =
  | "SAFE_PARALLEL"
  | "SEQUENTIAL"
  | "EXCLUSIVE_RESOURCE"
  | "REQUIRES_APPROVAL";

/** 并行上限（§11）：default=1（production 不变），hard max=4 */
export const WORKFORCE_JOB_MAX_PARALLEL_TASKS_DEFAULT = 1;
export const WORKFORCE_JOB_MAX_PARALLEL_TASKS_HARD_MAX = 4;

export function getWorkforceMaxParallelTasksWithEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.WORKFORCE_JOB_MAX_PARALLEL_TASKS;
  if (!raw || !raw.trim()) return WORKFORCE_JOB_MAX_PARALLEL_TASKS_DEFAULT;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return WORKFORCE_JOB_MAX_PARALLEL_TASKS_DEFAULT;
  return Math.max(
    1,
    Math.min(WORKFORCE_JOB_MAX_PARALLEL_TASKS_HARD_MAX, Math.floor(n)),
  );
}

export function getWorkforceMaxParallelTasks(): number {
  return getWorkforceMaxParallelTasksWithEnv(process.env);
}

/** classify 需要的 Step 字段投影（列 + inputJson.workforceTask） */
export type TaskPolicyStepInput = {
  stepKey: string;
  executionMode: string | null;
  riskLevel: string | null;
  requiresApproval: boolean;
  preferredTool: string | null;
  inputJson: unknown;
};

/**
 * 声明资源读取（§10）：只认 server 校验后的 workforce-task/v1
 * `resources` 可选字段；spec absent / invalid → 无声明（策略层由
 * SEQUENTIAL fail-safe 兜底，执行层由 gate fail-closed 兜底）。
 */
export function readTaskResources(inputJson: unknown): string[] {
  const spec = readWorkforceTaskSpec(inputJson);
  if (spec.kind !== "valid") return [];
  return spec.spec.resources ?? [];
}

function hasResourceConflict(
  resources: string[],
  occupied: ReadonlySet<string>,
): boolean {
  return resources.some((r) => occupied.has(r));
}

/**
 * classifyTaskExecutionPolicy（§6/§7/§8/§9）——server-owned 纯函数。
 *
 * 判定顺序（先命中先生效）：
 * 1. REQUIRES_APPROVAL：step.requiresApproval ∨ executionMode ∈ {write,
 *    approval} ∨ server tool catalog 判定该工具需审批 / 非只读
 *    （catalog 是 server-authoritative：planner 声称 read 不可信）；
 * 2. SEQUENTIAL（fail-safe 全集）：无 workforce-task/v1 spec（legacy /
 *    损坏）、taskKind=synthesis（含 native synthesis——Final Gate §2 保守
 *    策略，本阶段 synthesis 不并行）、executionMode ∉ {read, analysis}、
 *    riskLevel ∉ {LOW, MEDIUM}、preferredTool 缺失 / 不在 server catalog /
 *    不在 authoritative executable registry（#94 #88）/ catalog 未显式标注
 *    parallelSafe —— 任何不确定一律串行；
 * 3. EXCLUSIVE_RESOURCE：声明资源与 occupiedResourceKeys（running ∪
 *    awaiting_approval ∪ 本 batch 已选任务的资源）相交 → 本轮禁止启动；
 * 4. SAFE_PARALLEL：以上全部通过（含"声明了资源但无冲突"，§28 P4）。
 *
 * 永久不变量（Final Gate §8）：
 *   SAFE_PARALLEL ⇒ planner-visible ∧ executable ∧ readOnly ∧
 *                    no approval ∧ server parallelSafe=true
 * （planner-visible = catalog ∩ executable，见 plannerVisibleRuntimeV2Tools；
 *  本函数逐项检查 catalog 存在性 + isRuntimeV2ToolExecutable + readOnly +
 *  审批双源 + parallelSafe，四者合取即该不变量。）
 */
export function classifyTaskExecutionPolicy(
  step: TaskPolicyStepInput,
  context?: { occupiedResourceKeys?: ReadonlySet<string> },
): TaskExecutionPolicy {
  const occupied = context?.occupiedResourceKeys ?? new Set<string>();

  const descriptor = step.preferredTool
    ? getRuntimeV2Tool(step.preferredTool)
    : undefined;

  // 1. 审批类（planner 声明与 server catalog 任一命中即算）
  if (
    step.requiresApproval === true ||
    step.executionMode === "write" ||
    step.executionMode === "approval" ||
    (descriptor && (descriptor.requiresApproval || !descriptor.readOnly))
  ) {
    return "REQUIRES_APPROVAL";
  }

  // 2. fail-safe → SEQUENTIAL
  const spec = readWorkforceTaskSpec(step.inputJson);
  if (spec.kind !== "valid") return "SEQUENTIAL";
  // Final Gate §2：synthesis（含 #94 native synthesis）保守串行——
  // 它是 join 点（消费全部声明上游），单独成批与并行无收益差
  if (spec.spec.taskKind === "synthesis") return "SEQUENTIAL";
  if (step.executionMode !== "read" && step.executionMode !== "analysis") {
    return "SEQUENTIAL";
  }
  if (step.riskLevel !== "LOW" && step.riskLevel !== "MEDIUM") {
    return "SEQUENTIAL";
  }
  if (!descriptor) return "SEQUENTIAL";
  // Final Gate §8：可执行事实源 = adapters handler map（#94 #88）。
  // parallelSafe 标记绝不能让 non-executable 工具进入 SAFE_PARALLEL。
  if (!isRuntimeV2ToolExecutable(step.preferredTool!)) return "SEQUENTIAL";
  if (descriptor.parallelSafe !== true) return "SEQUENTIAL";

  // 3. 资源冲突 → 受控串行（同 Job 内 batch 排他，§9）
  const resources = readTaskResources(step.inputJson);
  if (hasResourceConflict(resources, occupied)) {
    return "EXCLUSIVE_RESOURCE";
  }

  // 4. 全条件满足才允许真正并行
  return "SAFE_PARALLEL";
}

export type ParallelBatchSelection<T extends TaskPolicyStepInput> = {
  /** 本轮要 CAS 认领并执行的任务（带判定策略） */
  selected: Array<{ step: T; policy: TaskExecutionPolicy }>;
  /** 本轮被资源冲突/策略排除、留在 ready 的任务（审计用） */
  deferred: Array<{ step: T; policy: TaskExecutionPolicy }>;
};

/**
 * buildParallelBatch（§14）：bounded、deterministic（按传入 ready 顺序）。
 *
 * - maxParallelTasks <= 1：恒 [队首]（回滚保证：与单步调度语义一致，
 *   策略仅记录不改变选择）；
 * - 队首 REQUIRES_APPROVAL / SEQUENTIAL：单独成 batch；
 * - 队首 EXCLUSIVE_RESOURCE：本轮空 batch（资源占用清除后自然恢复）；
 * - 队首 SAFE_PARALLEL：向后收集 SAFE_PARALLEL（对 occupied ∪ 已选资源
 *   逐个重判），资源相交/非 SAFE 者 deferred，收满 maxParallelTasks 为止。
 *
 * 绝不返回超过 maxParallelTasks 的 batch；绝不把 REQUIRES_APPROVAL 与
 * 其他任务放进同一 batch（§8/§20）。
 */
export function buildParallelBatch<T extends TaskPolicyStepInput>(input: {
  ready: T[];
  occupiedResourceKeys: ReadonlySet<string>;
  maxParallelTasks: number;
}): ParallelBatchSelection<T> {
  const { ready, occupiedResourceKeys } = input;
  const maxParallel = Math.max(
    1,
    Math.min(WORKFORCE_JOB_MAX_PARALLEL_TASKS_HARD_MAX, input.maxParallelTasks),
  );
  if (ready.length === 0) return { selected: [], deferred: [] };

  const head = ready[0];
  const headPolicy = classifyTaskExecutionPolicy(head, {
    occupiedResourceKeys,
  });

  // 回滚保证（§11/§14）：上限=1 时调度选择与单步语义一致——恒执行队首
  if (maxParallel <= 1) {
    return {
      selected: [{ step: head, policy: headPolicy }],
      deferred: [],
    };
  }

  if (headPolicy === "REQUIRES_APPROVAL" || headPolicy === "SEQUENTIAL") {
    return {
      selected: [{ step: head, policy: headPolicy }],
      deferred: [],
    };
  }

  if (headPolicy === "EXCLUSIVE_RESOURCE") {
    // 队首资源被占用：本轮不启动任何任务（占用来自 running/awaiting，
    // 清除后（park→resume / stale reset）自然恢复推进）
    return {
      selected: [],
      deferred: [{ step: head, policy: headPolicy }],
    };
  }

  // 队首 SAFE_PARALLEL：收集资源不相交的 SAFE_PARALLEL 同批
  const selected: Array<{ step: T; policy: TaskExecutionPolicy }> = [
    { step: head, policy: headPolicy },
  ];
  const deferred: Array<{ step: T; policy: TaskExecutionPolicy }> = [];
  const combined = new Set<string>(occupiedResourceKeys);
  for (const r of readTaskResources(head.inputJson)) combined.add(r);

  for (let i = 1; i < ready.length && selected.length < maxParallel; i++) {
    const candidate = ready[i];
    const policy = classifyTaskExecutionPolicy(candidate, {
      occupiedResourceKeys: combined,
    });
    if (policy === "SAFE_PARALLEL") {
      selected.push({ step: candidate, policy });
      for (const r of readTaskResources(candidate.inputJson)) combined.add(r);
    } else {
      // REQUIRES_APPROVAL / SEQUENTIAL / EXCLUSIVE_RESOURCE：
      // 不与 SAFE batch 同批（§8）；留在 ready 等待自己的轮次
      deferred.push({ step: candidate, policy });
    }
  }
  return { selected, deferred };
}

/**
 * 资源占用集（§9/§14）：same Job 内 status ∈ {running, awaiting_approval}
 * 的任务所声明的资源。awaiting_approval 占用资源键——审批窗口内不得
 * 并行产生同资源的第二份草稿（设计文档 §3.3）。
 */
export function collectOccupiedResourceKeys(
  steps: Array<{ status: string; inputJson: unknown }>,
): Set<string> {
  const occupied = new Set<string>();
  for (const s of steps) {
    if (s.status !== "running" && s.status !== "awaiting_approval") continue;
    for (const r of readTaskResources(s.inputJson)) occupied.add(r);
  }
  return occupied;
}
