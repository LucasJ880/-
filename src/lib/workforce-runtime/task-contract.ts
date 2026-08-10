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
} as const;

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
