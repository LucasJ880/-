/**
 * Workforce Task Contract V1（Phase 2B-1 §11）
 *
 * Task = AgentRunStep（架构冻结，零迁移）。Workforce 语义以 namespaced
 * envelope 落在 AgentRunStep.inputJson.workforceTask，不新建表、不加列。
 *
 * 指派链（§10/§12）：
 *   LLM proposed workerKey → server registry validation → sanitized assignment
 * unknown workerKey → FAIL VALIDATION（进入现有 planner failure path，
 * 不得静默替换为任意 worker）。
 *
 * spec 中的 workerKey/role 只用于 task routing / prompt context / display /
 * audit，绝不参与 RBAC / tool permission / scope / approval（§12）。
 */

import { z } from "zod";
import type { PlannerOutput, PlanStep } from "@/lib/agent-runtime-v2/schemas";
import {
  defaultWorkerKeyForTaskKind,
  getWorkforceWorker,
  workerSupportsTaskKind,
  type WorkforceTaskKind,
} from "./workers";

export const WORKFORCE_TASK_CONTRACT_VERSION = "workforce-task/v1";

export const WORKFORCE_TASK_LIMITS = {
  maxObjectiveLength: 1000,
  maxExpectedOutputLength: 1000,
  /** Phase 2B-2（§10）：声明资源上限（同 Job 冲突对比，无需索引） */
  maxResources: 8,
  maxResourceKeyLength: 200,
} as const;

/**
 * Phase 2B-2（§9/§10）资源键词汇格式：`{entity}:{id}`，如 customer:{id} /
 * opportunity:{id} / quote:{id} / project:{id} / tender:{id} /
 * email-thread:{id}。entity 小写字母开头（允许数字/下划线/连字符），
 * id 为无空白字符串。冲突判定按精确字符串相等。
 */
export const WORKFORCE_RESOURCE_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}:\S{1,160}$/;

/**
 * strip：未知字段一律丢弃（spec 不承载任何白名单之外的数据，
 * 授权类字段无法经此进入受信对象）。
 */
export const WorkforceTaskSpecV1Schema = z
  .object({
    contractVersion: z.literal(WORKFORCE_TASK_CONTRACT_VERSION),
    worker: z
      .object({
        workerKey: z.string().min(1),
        role: z.string().min(1),
      })
      .strip(),
    taskKind: z.enum(["work", "synthesis"]),
    objective: z
      .string()
      .min(1)
      .max(WORKFORCE_TASK_LIMITS.maxObjectiveLength),
    expectedOutput: z
      .string()
      .max(WORKFORCE_TASK_LIMITS.maxExpectedOutputLength)
      .optional(),
    // Phase 2B-2（§10）：backward-compatible optional field——旧 V1 记录无
    // 该字段照常 parse；老 reader（.strip()）遇到新字段安全丢弃。
    // 不改 contractVersion（V1 内向后兼容扩展，任务书 §10 明确允许）。
    resources: z
      .array(
        z
          .string()
          .max(WORKFORCE_TASK_LIMITS.maxResourceKeyLength)
          .regex(WORKFORCE_RESOURCE_KEY_PATTERN),
      )
      .max(WORKFORCE_TASK_LIMITS.maxResources)
      .optional(),
  })
  .strip();

export type WorkforceTaskSpecV1 = z.infer<typeof WorkforceTaskSpecV1Schema>;

/** plan step + 服务端已校验的 workforce spec（persist 落 inputJson） */
export type WorkforcePlannedStep = PlanStep & {
  workforceTask?: WorkforceTaskSpecV1;
};

export type ApplyWorkforceTaskSpecsResult =
  | { ok: true; plan: PlannerOutput }
  | {
      ok: false;
      code: "WORKFORCE_WORKER_INVALID" | "WORKFORCE_TASK_SPEC_INVALID";
      error: string;
    };

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * server-authoritative assignment（§10/§12）：
 * - planner 提议的 workerKey 必须存在于 registry 且支持该 taskKind，
 *   否则整个 plan FAIL VALIDATION（fail-closed，交回现有 planner 失败路径）；
 * - 未提议时按 taskKind 走 server 默认指派（deterministic）；
 * - spec.worker.role 由 server registry 注入（不信任 LLM 输出的 role）。
 */
export function applyWorkforceTaskSpecs(
  plan: PlannerOutput,
): ApplyWorkforceTaskSpecsResult {
  const steps: WorkforcePlannedStep[] = [];
  for (const step of plan.steps) {
    const proposedKind = step.taskKind;
    if (proposedKind && proposedKind !== "work" && proposedKind !== "synthesis") {
      return {
        ok: false,
        code: "WORKFORCE_TASK_SPEC_INVALID",
        error: `step ${step.id}: 非法 taskKind "${String(proposedKind)}"`,
      };
    }
    const taskKind: WorkforceTaskKind = proposedKind ?? "work";

    // P0 #89 Native Synthesis 契约（§17–§18）：synthesis 由 Runtime 原生
    // 执行——不需要 preferredTool；必须声明 ≥1 个上游依赖（输入唯一权威）；
    // 不产生 PendingAction，requiresApproval=true 会造成审批死锁，fail-closed。
    if (taskKind === "synthesis") {
      if (!step.dependsOn || step.dependsOn.length === 0) {
        return {
          ok: false,
          code: "WORKFORCE_TASK_SPEC_INVALID",
          error: `step ${step.id}: synthesis 任务必须在 dependsOn 声明至少一个上游任务`,
        };
      }
      if (step.requiresApproval) {
        return {
          ok: false,
          code: "WORKFORCE_TASK_SPEC_INVALID",
          error: `step ${step.id}: synthesis 任务不产生待审批动作，requiresApproval 必须为 false`,
        };
      }
    }

    const proposedWorkerKey = step.workerKey?.trim();
    const workerKey =
      proposedWorkerKey && proposedWorkerKey.length > 0
        ? proposedWorkerKey
        : defaultWorkerKeyForTaskKind(taskKind);

    const worker = getWorkforceWorker(workerKey);
    if (!worker) {
      return {
        ok: false,
        code: "WORKFORCE_WORKER_INVALID",
        error: `step ${step.id}: unknown workerKey "${workerKey}"（不在 server registry）`,
      };
    }
    if (!workerSupportsTaskKind(workerKey, taskKind)) {
      return {
        ok: false,
        code: "WORKFORCE_WORKER_INVALID",
        error: `step ${step.id}: worker "${workerKey}" 不支持 taskKind "${taskKind}"`,
      };
    }

    // Phase 2B-2（§10）：planner 提议的资源声明 → server 消毒。
    // 声明影响并行安全（漏声明→误并行），malformed 一律 fail-closed
    // （整计划 FAIL VALIDATION，与 unknown worker 同路径），绝不静默丢弃。
    let resources: string[] | undefined;
    if (step.resources !== undefined) {
      const trimmed = step.resources.map((r) => r.trim());
      const deduped = Array.from(new Set(trimmed));
      const malformed = deduped.filter(
        (r) =>
          r.length === 0 ||
          r.length > WORKFORCE_TASK_LIMITS.maxResourceKeyLength ||
          !WORKFORCE_RESOURCE_KEY_PATTERN.test(r),
      );
      if (malformed.length > 0) {
        return {
          ok: false,
          code: "WORKFORCE_TASK_SPEC_INVALID",
          error: `step ${step.id}: 非法资源键 ${JSON.stringify(malformed.slice(0, 3))}（格式须为 {entity}:{id}）`,
        };
      }
      if (deduped.length > WORKFORCE_TASK_LIMITS.maxResources) {
        return {
          ok: false,
          code: "WORKFORCE_TASK_SPEC_INVALID",
          error: `step ${step.id}: 资源声明超出上限（${deduped.length} > ${WORKFORCE_TASK_LIMITS.maxResources}）`,
        };
      }
      resources = deduped.length > 0 ? deduped : undefined;
    }

    const parsed = WorkforceTaskSpecV1Schema.safeParse({
      contractVersion: WORKFORCE_TASK_CONTRACT_VERSION,
      worker: { workerKey: worker.workerKey, role: worker.role },
      taskKind,
      objective: truncate(
        step.description,
        WORKFORCE_TASK_LIMITS.maxObjectiveLength,
      ),
      expectedOutput: step.expectedOutput
        ? truncate(
            step.expectedOutput,
            WORKFORCE_TASK_LIMITS.maxExpectedOutputLength,
          )
        : undefined,
      resources,
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "WORKFORCE_TASK_SPEC_INVALID",
        error: `step ${step.id}: ${parsed.error.message}`,
      };
    }
    steps.push({ ...step, workforceTask: parsed.data });
  }
  return { ok: true, plan: { ...plan, steps } };
}

export type ReadWorkforceTaskSpecResult =
  | { kind: "absent" }
  | { kind: "valid"; spec: WorkforceTaskSpecV1 }
  | { kind: "invalid"; error: string };

/**
 * 执行期读取 step 的 workforce spec：
 * - absent：2B-1 之前规划的旧 workforce run / legacy runtime_v2 —— 按
 *   legacy 行为执行（向后兼容，不强制旧 Step 拥有 workerKey，§51）；
 * - invalid：spec 存在但损坏 —— 调用方必须 fail-closed；
 * - valid：进入 workforce Task 执行语义。
 */
export function readWorkforceTaskSpec(
  inputJson: unknown,
): ReadWorkforceTaskSpecResult {
  if (!inputJson || typeof inputJson !== "object" || Array.isArray(inputJson)) {
    return { kind: "absent" };
  }
  const raw = (inputJson as Record<string, unknown>).workforceTask;
  if (raw === undefined || raw === null) return { kind: "absent" };
  const parsed = WorkforceTaskSpecV1Schema.safeParse(raw);
  if (!parsed.success) {
    return { kind: "invalid", error: parsed.error.message };
  }
  return { kind: "valid", spec: parsed.data };
}
