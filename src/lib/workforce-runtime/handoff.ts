/**
 * Workforce Structured Handoff V1（Phase 2B-1 §15–§24）
 *
 * Handoff = business context，绝不是 authorization context（§16）。
 * 信封落在 AgentRunStep.outputJson.workforceHandoff（namespaced，保留原
 * 业务 output，零迁移，§20）。
 *
 * 安全不变量：
 * - schema .strip()：白名单之外的字段（admin/role/scope/authorized/...）
 *   在 parse 时全部丢弃，受信对象永远重建、绝不 spread 原始 payload（§16–17）；
 * - source（runId/stepKey/workerKey）由 server 注入；消费端与真实上游行
 *   交叉核对，payload 自述不可信（§21）；
 * - unknown contractVersion / malformed / oversize → fail closed（§18–19）；
 * - 构建 deterministic：createdAt 取 Step durable completion time，
 *   无 new Date()/random —— 同一 (runId, stepKey, result) 重复构建
 *   语义等同（§31）。
 */

import { z } from "zod";
import {
  readWorkforceTaskSpec,
  type WorkforceTaskSpecV1,
} from "./task-contract";
import type { WorkforceTaskKind } from "./workers";

export const WORKFORCE_HANDOFF_CONTRACT_VERSION = "workforce-handoff/v1";

/** Handoff 尺寸边界（§19）：Worker 不得向下游 dump 未加约束的原始内容 */
export const WORKFORCE_HANDOFF_LIMITS = {
  maxSummaryLength: 2000,
  maxEvidenceRefs: 20,
  maxBusinessRefs: 20,
  maxWarnings: 10,
  maxOpenQuestions: 10,
  maxRefLength: 200,
  maxNoteLength: 500,
  /** outputs 单字段序列化上限 */
  maxOutputValueBytes: 4_096,
  /** outputs 总序列化预算 */
  maxOutputsTotalBytes: 16_384,
  /** 整个信封序列化硬上限（读写两侧都校验） */
  maxSerializedBytes: 32_768,
  /** synthesis 上游摘要条数上限（maxSteps=16 之内） */
  maxUpstreamSummaries: 16,
} as const;

/**
 * 授权语义字段黑名单（§17）：仅用于测试断言与审计说明。
 * 真正的防线是 .strip() 白名单——这些字段根本不在 schema 中，
 * parse 后必然不存在于受信对象。
 */
export const FORBIDDEN_HANDOFF_AUTH_FIELDS = [
  "userId",
  "actorUserId",
  "orgId",
  "workspaceId",
  "role",
  "orgRole",
  "scope",
  "capabilities",
  "permissions",
  "authorized",
  "approved",
  "canWrite",
  "toolPolicy",
  "approvalBypass",
  "admin",
] as const;

/**
 * Handoff = business context only（Final Review FIX 2）：
 * Step.outputJson 可以保留以下内部身份 / authorization / runtime control
 * metadata 供审计，但它们**绝不进入** workforceHandoff.outputs——
 * PendingAction 关联经 evidenceRefs 传递引用，不复制身份/控制状态。
 */
export const HANDOFF_INTERNAL_CONTEXT_FIELDS = [
  ...FORBIDDEN_HANDOFF_AUTH_FIELDS,
  "approvalActorUserId",
  "executionPrincipalUserId",
  "approvalStatuses",
  "reconcile",
  "traceId",
  "runtimeCorrelation",
  "leaseToken",
] as const;

const HANDOFF_INTERNAL_CONTEXT_FIELD_SET: ReadonlySet<string> = new Set(
  HANDOFF_INTERNAL_CONTEXT_FIELDS,
);

/** UTF-8 字节数（Final Review FIX 3：所有 *Bytes 上限按真实字节算） */
function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

const HandoffSourceSchema = z
  .object({
    runId: z.string().min(1),
    stepKey: z.string().min(1),
    workerKey: z.string().min(1),
  })
  .strip();

export const WorkforceHandoffPayloadV1Schema = z
  .object({
    contractVersion: z.literal(WORKFORCE_HANDOFF_CONTRACT_VERSION),
    source: HandoffSourceSchema,
    summary: z
      .string()
      .min(1)
      .max(WORKFORCE_HANDOFF_LIMITS.maxSummaryLength),
    outputs: z.record(z.string(), z.unknown()).optional(),
    evidenceRefs: z
      .array(z.string().min(1).max(WORKFORCE_HANDOFF_LIMITS.maxRefLength))
      .max(WORKFORCE_HANDOFF_LIMITS.maxEvidenceRefs)
      .optional(),
    businessRefs: z
      .array(z.string().min(1).max(WORKFORCE_HANDOFF_LIMITS.maxRefLength))
      .max(WORKFORCE_HANDOFF_LIMITS.maxBusinessRefs)
      .optional(),
    warnings: z
      .array(z.string().min(1).max(WORKFORCE_HANDOFF_LIMITS.maxNoteLength))
      .max(WORKFORCE_HANDOFF_LIMITS.maxWarnings)
      .optional(),
    openQuestions: z
      .array(z.string().min(1).max(WORKFORCE_HANDOFF_LIMITS.maxNoteLength))
      .max(WORKFORCE_HANDOFF_LIMITS.maxOpenQuestions)
      .optional(),
    /** Step durable completion time（ISO）；builder 不使用 wall clock */
    createdAt: z.string().min(1),
  })
  .strip();

export type WorkforceHandoffPayloadV1 = z.infer<
  typeof WorkforceHandoffPayloadV1Schema
>;

/** Handoff 允许存在的 Step 终态（§33：awaiting_approval 期间无业务 Handoff） */
export const HANDOFF_TERMINAL_STEP_STATUSES = [
  "completed",
  "skipped",
  "partially_executed",
] as const;

export type HandoffTerminalStepStatus =
  (typeof HANDOFF_TERMINAL_STEP_STATUSES)[number];

export type HandoffFailureCode =
  | "HANDOFF_MISSING"
  | "HANDOFF_VERSION_UNSUPPORTED"
  | "HANDOFF_MALFORMED"
  | "HANDOFF_TOO_LARGE"
  | "HANDOFF_SOURCE_MISMATCH"
  | "HANDOFF_UPSTREAM_MISSING"
  | "HANDOFF_UPSTREAM_SPEC_INVALID";

export type HandoffParseResult =
  | { ok: true; payload: WorkforceHandoffPayloadV1 }
  | { ok: false; code: HandoffFailureCode; error: string };

/**
 * parse / validate / sanitize（§18）：
 * known version → parse（.strip() 丢弃一切未知字段，含伪造授权字段）；
 * unknown version / malformed / oversize → fail closed。
 */
export function parseWorkforceHandoff(raw: unknown): HandoffParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      code: "HANDOFF_MALFORMED",
      error: "handoff payload 不是对象",
    };
  }
  const version = (raw as Record<string, unknown>).contractVersion;
  if (version !== WORKFORCE_HANDOFF_CONTRACT_VERSION) {
    return {
      ok: false,
      code: "HANDOFF_VERSION_UNSUPPORTED",
      error: `不支持的 handoff contractVersion: ${String(version)}`,
    };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(raw) ?? "";
  } catch {
    return {
      ok: false,
      code: "HANDOFF_MALFORMED",
      error: "handoff payload 无法序列化",
    };
  }
  const serializedBytes = utf8Bytes(serialized);
  if (serializedBytes > WORKFORCE_HANDOFF_LIMITS.maxSerializedBytes) {
    return {
      ok: false,
      code: "HANDOFF_TOO_LARGE",
      error: `handoff payload 超出大小上限（${serializedBytes} bytes > ${WORKFORCE_HANDOFF_LIMITS.maxSerializedBytes}）`,
    };
  }
  const parsed = WorkforceHandoffPayloadV1Schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "HANDOFF_MALFORMED",
      error: parsed.error.message,
    };
  }
  return { ok: true, payload: parsed.data };
}

/** 从 Step.outputJson 提取 namespaced 信封（不校验，配合 parse 使用） */
export function extractHandoffFromStepOutput(
  outputJson: unknown,
): unknown | undefined {
  if (
    !outputJson ||
    typeof outputJson !== "object" ||
    Array.isArray(outputJson)
  ) {
    return undefined;
  }
  const raw = (outputJson as Record<string, unknown>).workforceHandoff;
  return raw === null ? undefined : raw;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * outputs 有界投影（deterministic，无时钟/随机）：
 * - 超预算字段替换为占位（*Bytes 一律按 UTF-8 字节计，FIX 3）；
 * - 内部身份/授权/runtime control 字段整体排除（FIX 2）——
 *   Step.outputJson 保留供审计，信封 outputs 不携带。
 */
function boundedOutputsProjection(businessOutput: unknown): {
  outputs: Record<string, unknown>;
  truncatedKeys: string[];
} {
  if (
    !businessOutput ||
    typeof businessOutput !== "object" ||
    Array.isArray(businessOutput)
  ) {
    return { outputs: {}, truncatedKeys: [] };
  }
  const outputs: Record<string, unknown> = {};
  const truncatedKeys: string[] = [];
  let used = 0;
  for (const [key, value] of Object.entries(businessOutput)) {
    if (key === "workforceHandoff") continue; // 信封不得嵌套自身
    if (HANDOFF_INTERNAL_CONTEXT_FIELD_SET.has(key)) continue; // FIX 2
    let serialized: string;
    try {
      serialized = JSON.stringify(value) ?? "null";
    } catch {
      truncatedKeys.push(key);
      continue;
    }
    const size = utf8Bytes(serialized);
    if (
      size <= WORKFORCE_HANDOFF_LIMITS.maxOutputValueBytes &&
      used + size <= WORKFORCE_HANDOFF_LIMITS.maxOutputsTotalBytes
    ) {
      outputs[key] = JSON.parse(serialized);
      used += size;
    } else {
      truncatedKeys.push(key);
      outputs[key] = Array.isArray(value)
        ? { truncated: true, count: value.length }
        : { truncated: true, approxBytes: size };
      used += 64;
    }
  }
  return { outputs, truncatedKeys };
}

/** 已知业务 id 字段 → businessRefs（{entity}:{id} 词汇表，capped） */
function deriveBusinessRefs(businessOutput: unknown): string[] {
  if (
    !businessOutput ||
    typeof businessOutput !== "object" ||
    Array.isArray(businessOutput)
  ) {
    return [];
  }
  const record = businessOutput as Record<string, unknown>;
  const mapping: Array<[string, string]> = [
    ["customerId", "customer"],
    ["opportunityId", "opportunity"],
    ["quoteId", "quote"],
    ["projectId", "project"],
    ["tenderId", "tender"],
  ];
  const refs: string[] = [];
  for (const [field, entity] of mapping) {
    const v = record[field];
    if (typeof v === "string" && v.length > 0) {
      refs.push(
        truncate(`${entity}:${v}`, WORKFORCE_HANDOFF_LIMITS.maxRefLength),
      );
    }
  }
  return refs.slice(0, WORKFORCE_HANDOFF_LIMITS.maxBusinessRefs);
}

export type UpstreamHandoff = {
  stepKey: string;
  payload: WorkforceHandoffPayloadV1;
};

export type BuildWorkforceHandoffInput = {
  /** server 注入的来源（§21），不信任模型自述 */
  runId: string;
  stepKey: string;
  workerKey: string;
  taskKind: WorkforceTaskKind;
  stepStatus: HandoffTerminalStepStatus;
  taskObjective: string;
  /** Step 原业务 output（保留原样持久化；此处仅做有界投影） */
  businessOutput: unknown;
  /** evidenceJson 中的 pendingActionIds（可选，转 evidenceRefs） */
  pendingActionIds?: string[];
  /** Step durable completion time（§31：不得每次 builder new Date()） */
  completedAt: Date;
  /** synthesis 任务的上游 handoff（按依赖声明序，§27） */
  upstreamHandoffs?: UpstreamHandoff[];
};

function deriveSummary(input: BuildWorkforceHandoffInput): string {
  const objective = input.taskObjective;
  if (input.stepStatus === "skipped") {
    return truncate(
      `任务未执行（skipped）：${objective}`,
      WORKFORCE_HANDOFF_LIMITS.maxSummaryLength,
    );
  }
  if (input.stepStatus === "partially_executed") {
    return truncate(
      `任务部分执行（partially_executed）：${objective}`,
      WORKFORCE_HANDOFF_LIMITS.maxSummaryLength,
    );
  }
  if (input.taskKind === "synthesis") {
    const chain = (input.upstreamHandoffs ?? [])
      .map((u) => u.stepKey)
      .join(" + ");
    return truncate(
      `综合 ${input.upstreamHandoffs?.length ?? 0} 个上游任务（${chain}）：${objective}`,
      WORKFORCE_HANDOFF_LIMITS.maxSummaryLength,
    );
  }
  const record =
    input.businessOutput &&
    typeof input.businessOutput === "object" &&
    !Array.isArray(input.businessOutput)
      ? (input.businessOutput as Record<string, unknown>)
      : {};
  if (typeof record.summary === "string" && record.summary.length > 0) {
    return truncate(record.summary, WORKFORCE_HANDOFF_LIMITS.maxSummaryLength);
  }
  const keys = Object.keys(record)
    .filter(
      (k) =>
        k !== "workforceHandoff" && !HANDOFF_INTERNAL_CONTEXT_FIELD_SET.has(k),
    )
    .slice(0, 8);
  return truncate(
    keys.length > 0
      ? `已完成：${objective}（产出字段：${keys.join(", ")}）`
      : `已完成：${objective}`,
    WORKFORCE_HANDOFF_LIMITS.maxSummaryLength,
  );
}

/**
 * server Handoff builder（§21）：raw Task result → V1 → validate。
 * 全程无 wall clock / random：同一 durable 输入 → 语义等同输出（§31）。
 */
export function buildWorkforceHandoffV1(
  input: BuildWorkforceHandoffInput,
): HandoffParseResult {
  const { outputs, truncatedKeys } = boundedOutputsProjection(
    input.businessOutput,
  );

  if (input.taskKind === "synthesis" && input.upstreamHandoffs) {
    outputs.upstreamSummaries = input.upstreamHandoffs
      .slice(0, WORKFORCE_HANDOFF_LIMITS.maxUpstreamSummaries)
      .map((u) => ({
        stepKey: u.stepKey,
        workerKey: u.payload.source.workerKey,
        summary: truncate(u.payload.summary, 200),
      }));
  }

  const evidenceRefs: string[] = [`step:${input.stepKey}`];
  for (const id of input.pendingActionIds ?? []) {
    if (typeof id === "string" && id.length > 0) {
      evidenceRefs.push(
        truncate(`pendingAction:${id}`, WORKFORCE_HANDOFF_LIMITS.maxRefLength),
      );
    }
  }

  const warnings: string[] = [];
  if (input.stepStatus === "skipped") {
    warnings.push("该任务未产生业务写入（审批拒绝或无可写对象）");
  }
  if (input.stepStatus === "partially_executed") {
    warnings.push("部分待审批动作被拒绝，产出不完整");
  }
  const record =
    input.businessOutput &&
    typeof input.businessOutput === "object" &&
    !Array.isArray(input.businessOutput)
      ? (input.businessOutput as Record<string, unknown>)
      : {};
  if (record.degraded === true) {
    warnings.push("上游证据为降级结果（evidenceQuality=PARTIAL）");
  }
  if (truncatedKeys.length > 0) {
    warnings.push(
      truncate(
        `outputs 超出大小预算，以下字段被截断：${truncatedKeys.join(", ")}`,
        WORKFORCE_HANDOFF_LIMITS.maxNoteLength,
      ),
    );
  }
  if (evidenceRefs.length > WORKFORCE_HANDOFF_LIMITS.maxEvidenceRefs) {
    warnings.push(
      `evidenceRefs 超出上限，仅保留前 ${WORKFORCE_HANDOFF_LIMITS.maxEvidenceRefs} 条`,
    );
  }

  const candidate: WorkforceHandoffPayloadV1 = {
    contractVersion: WORKFORCE_HANDOFF_CONTRACT_VERSION,
    source: {
      runId: input.runId,
      stepKey: input.stepKey,
      workerKey: input.workerKey,
    },
    summary: deriveSummary(input),
    outputs,
    evidenceRefs: evidenceRefs.slice(
      0,
      WORKFORCE_HANDOFF_LIMITS.maxEvidenceRefs,
    ),
    businessRefs: deriveBusinessRefs(input.businessOutput),
    warnings: warnings.slice(0, WORKFORCE_HANDOFF_LIMITS.maxWarnings),
    openQuestions: [],
    createdAt: input.completedAt.toISOString(),
  };

  const first = parseWorkforceHandoff(candidate);
  if (first.ok) return first;

  if (first.code === "HANDOFF_TOO_LARGE") {
    // 有界降级：丢弃 outputs（引用仍在），deterministic
    const reduced: WorkforceHandoffPayloadV1 = {
      ...candidate,
      outputs: {},
      warnings: [
        ...(candidate.warnings ?? []).slice(
          0,
          WORKFORCE_HANDOFF_LIMITS.maxWarnings - 1,
        ),
        "outputs 超出信封大小硬上限，已整体省略",
      ].slice(0, WORKFORCE_HANDOFF_LIMITS.maxWarnings),
    };
    return parseWorkforceHandoff(reduced);
  }
  return first;
}

export type CollectUpstreamHandoffsResult =
  | { ok: true; upstream: UpstreamHandoff[] }
  | {
      ok: false;
      code: HandoffFailureCode;
      error: string;
      upstreamStepKey?: string;
    };

/**
 * Dependency → Handoff（§22–§24）：
 * 下游 Task 只按 dependsOn 声明读取上游 Step 的 validated Handoff，
 * 不自由读取整个 Run / DB / prompt history。
 * 顺序 deterministic = dependsOnJson 数组声明序（plan 产物，稳定），
 * 禁止依赖 DB 行序。
 *
 * fail-closed 边界（Final Review FIX 1：true legacy ≠ missing new handoff）：
 * - 上游步骤缺行 / 未达终态 → fail closed；
 * - 上游 workforceTask spec 存在但损坏 → fail closed（HANDOFF_UPSTREAM_SPEC_INVALID）；
 * - 信封缺失 + 上游 spec 也缺失 → TRUE LEGACY（2B-1 之前规划的存量 Step），
 *   跳过注入、允许执行——Handoff 不承载授权（§16），legacy 缺失只意味着
 *   少业务上下文；
 * - 信封缺失 + 上游是 2B-1 任务（spec valid）→ HANDOFF_MISSING fail closed
 *   ——新契约任务必须产信封，缺失即 durable 状态被破坏，不得放行；
 * - 信封存在但 unknown version / malformed / oversize / 来源不符 → fail closed。
 */
export function collectUpstreamHandoffs(input: {
  runId: string;
  dependsOnJson: unknown;
  steps: Array<{
    stepKey: string;
    status: string;
    inputJson: unknown;
    outputJson: unknown;
  }>;
}): CollectUpstreamHandoffsResult {
  const deps = Array.isArray(input.dependsOnJson)
    ? input.dependsOnJson.filter((x): x is string => typeof x === "string")
    : [];
  const byKey = new Map(input.steps.map((s) => [s.stepKey, s]));
  const upstream: UpstreamHandoff[] = [];
  for (const depKey of deps) {
    const dep = byKey.get(depKey);
    if (!dep) {
      return {
        ok: false,
        code: "HANDOFF_UPSTREAM_MISSING",
        error: `依赖步骤不存在：${depKey}`,
        upstreamStepKey: depKey,
      };
    }
    if (
      !(HANDOFF_TERMINAL_STEP_STATUSES as readonly string[]).includes(
        dep.status,
      )
    ) {
      return {
        ok: false,
        code: "HANDOFF_UPSTREAM_MISSING",
        error: `依赖步骤未达 Handoff 终态：${depKey}（${dep.status}）`,
        upstreamStepKey: depKey,
      };
    }
    // FIX 1：先读上游任务契约，区分 true legacy 与 missing new handoff
    const depSpec = readWorkforceTaskSpec(dep.inputJson);
    if (depSpec.kind === "invalid") {
      return {
        ok: false,
        code: "HANDOFF_UPSTREAM_SPEC_INVALID",
        error: `上游 workforceTask spec 损坏：${depKey}（${depSpec.error}）`,
        upstreamStepKey: depKey,
      };
    }
    const raw = extractHandoffFromStepOutput(dep.outputJson);
    if (raw === undefined) {
      if (depSpec.kind === "absent") {
        // TRUE LEGACY：2B-1 之前规划的上游（无契约、无信封）→ 不注入、不阻断
        continue;
      }
      // 2B-1 契约任务缺信封 → fail closed（运行时保证信封与终态同写；
      // 缺失即 durable 状态被破坏）
      return {
        ok: false,
        code: "HANDOFF_MISSING",
        error: `上游为 workforce-task/v1 任务但缺少 workforceHandoff：${depKey}`,
        upstreamStepKey: depKey,
      };
    }
    const parsed = parseWorkforceHandoff(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        code: parsed.code,
        error: `${depKey}: ${parsed.error}`,
        upstreamStepKey: depKey,
      };
    }
    // §21：source 与真实上游行交叉核对（payload 自述不可信）
    if (
      parsed.payload.source.runId !== input.runId ||
      parsed.payload.source.stepKey !== depKey
    ) {
      return {
        ok: false,
        code: "HANDOFF_SOURCE_MISMATCH",
        error: `handoff source 与上游步骤不符：${depKey}`,
        upstreamStepKey: depKey,
      };
    }
    if (
      depSpec.kind === "valid" &&
      depSpec.spec.worker.workerKey !== parsed.payload.source.workerKey
    ) {
      return {
        ok: false,
        code: "HANDOFF_SOURCE_MISMATCH",
        error: `handoff workerKey 与上游任务指派不符：${depKey}`,
        upstreamStepKey: depKey,
      };
    }
    upstream.push({ stepKey: depKey, payload: parsed.payload });
  }
  return { ok: true, upstream };
}

/**
 * Worker 执行上下文（§13）：只注入必要内容（workerKey/role/objective/
 * taskKind/上游 handoff），不注入完整 Worker 对象、不注入任何授权语义。
 */
export type WorkforceExecutionContext = {
  workerKey: string;
  role: string;
  taskKind: WorkforceTaskKind;
  objective: string;
  spec: WorkforceTaskSpecV1;
  upstreamHandoffs: UpstreamHandoff[];
};

/**
 * Final Job Result（§28）：workforce run 若存在已完成的 synthesis Task，
 * 其 Handoff summary 作为最终报告的综合结论（复用现有 buildFinalReport，
 * 不重写 Final Report 系统）。多个 synthesis 时取步骤创建序最后一个。
 */
export function extractSynthesisHandoffSummary(
  runId: string,
  steps: Array<{
    stepKey: string;
    status: string;
    inputJson: unknown;
    outputJson: unknown;
  }>,
): { stepKey: string; summary: string } | null {
  let found: { stepKey: string; summary: string } | null = null;
  for (const step of steps) {
    if (step.status !== "completed") continue;
    const spec = readWorkforceTaskSpec(step.inputJson);
    if (spec.kind !== "valid" || spec.spec.taskKind !== "synthesis") continue;
    const raw = extractHandoffFromStepOutput(step.outputJson);
    if (raw === undefined) continue;
    const parsed = parseWorkforceHandoff(raw);
    if (!parsed.ok) continue;
    if (parsed.payload.source.runId !== runId) continue;
    found = { stepKey: step.stepKey, summary: parsed.payload.summary };
  }
  return found;
}
