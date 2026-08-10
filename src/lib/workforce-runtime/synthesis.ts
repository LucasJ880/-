/**
 * Workforce Native Synthesis（P0 Execution Alignment，#89 Part C）
 *
 * Synthesis 是 Workforce Runtime 的一等执行语义，不是业务工具：
 * taskKind === "synthesis" 的 Task 由 executor 直接进入本执行路径，
 * 不需要 preferredTool、不经过 Tool catalog、不产生 no_tool 失败。
 *
 * 执行链（§16）：
 *   declared dependsOn → validated workforce-handoff/v1（声明序）
 *   → bounded synthesis input → 统一 Model Runtime（createCompletion）
 *   → structured result → schema 校验 → Step result + Handoff 持久化
 *
 * 输入权威（§18）：只消费 executor 传入的 validated 上游 Handoff——
 * 该列表由 collectUpstreamHandoffs 按 step.dependsOn 声明序构建，
 * 本模块不扫库、不读取声明之外的任何 Step。
 *
 * 失败语义（§20）：模型失败 / 输出不合 schema → fail closed（返回
 * ok:false，走既有 step 重试→failed 路径）。禁止字符串拼接冒充综合。
 *
 * 授权边界（§22/§44）：synthesis 不调用业务工具、不读业务表；
 * 上游 Handoff 本身不含授权语义（2B-1 契约保证）。模型调用经统一
 * Model Runtime（内部含租户配额预检与 recordAiCall 遥测）。
 */

import { z } from "zod";
import { createCompletion } from "@/lib/ai/client";
import type { UpstreamHandoff } from "./handoff";

/** 事件/审计中的 synthesis 执行标签（runtime 内部执行模式，非工具，
 *  永不进入 Planner catalog——不受 #88 工具不变量约束） */
export const WORKFORCE_SYNTHESIS_EXECUTION_LABEL = "workforce_synthesis";

export const WORKFORCE_SYNTHESIS_LIMITS = {
  maxSummaryLength: 2000,
  maxListItems: 10,
  maxItemLength: 500,
  maxEvidenceRefs: 20,
  maxRefLength: 200,
  /** 单个上游注入 synthesis 输入的序列化预算（UTF-8 字节） */
  maxUpstreamInputBytes: 4096,
  /** 全部上游注入的总序列化预算（UTF-8 字节） */
  maxTotalInputBytes: 24_576,
  /** 模型输出 token 上限（bounded output） */
  maxModelOutputTokens: 1400,
} as const;

const boundedList = z
  .array(z.string().min(1).max(WORKFORCE_SYNTHESIS_LIMITS.maxItemLength))
  .max(WORKFORCE_SYNTHESIS_LIMITS.maxListItems);

/**
 * Synthesis 输出契约（§19）：structured / bounded / serializable /
 * handoff-compatible。strip：模型输出的未知字段一律丢弃。
 */
export const WorkforceSynthesisResultV1Schema = z
  .object({
    summary: z
      .string()
      .min(1)
      .max(WORKFORCE_SYNTHESIS_LIMITS.maxSummaryLength),
    conclusions: boundedList.min(1),
    risks: boundedList.optional(),
    opportunities: boundedList.optional(),
    recommendations: boundedList.optional(),
    evidenceRefs: z
      .array(z.string().min(1).max(WORKFORCE_SYNTHESIS_LIMITS.maxRefLength))
      .max(WORKFORCE_SYNTHESIS_LIMITS.maxEvidenceRefs)
      .optional(),
  })
  .strip();

export type WorkforceSynthesisResultV1 = z.infer<
  typeof WorkforceSynthesisResultV1Schema
>;

/** 与 AdapterResult 结构完全一致（executor 统一后处理：重试/终态/信封）。
 *  synthesis 永不设置 requiresApproval / pendingActionId（不产生审批动作），
 *  字段存在只为类型兼容。 */
export type SynthesisExecutionResult = {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  pendingActionId?: string;
  requiresApproval?: boolean;
};

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

type BoundedUpstreamEntry = {
  stepKey: string;
  workerKey: string;
  summary: string;
  warnings?: string[];
  businessRefs?: string[];
  outputs?: Record<string, unknown>;
};

/**
 * bounded synthesis input（deterministic）：严格按声明序遍历上游；
 * 单上游超预算先弃 outputs、再压 summary；总预算耗尽后仅保留
 * stepKey+summary 摘要行。任何丢弃都记录在 truncatedSteps（可审计）。
 */
export function buildBoundedSynthesisInput(upstream: UpstreamHandoff[]): {
  entries: BoundedUpstreamEntry[];
  truncatedSteps: string[];
} {
  const entries: BoundedUpstreamEntry[] = [];
  const truncatedSteps: string[] = [];
  let used = 0;

  for (const u of upstream) {
    const full: BoundedUpstreamEntry = {
      stepKey: u.stepKey,
      workerKey: u.payload.source.workerKey,
      summary: u.payload.summary,
      warnings: u.payload.warnings?.length ? u.payload.warnings : undefined,
      businessRefs: u.payload.businessRefs?.length
        ? u.payload.businessRefs
        : undefined,
      outputs:
        u.payload.outputs && Object.keys(u.payload.outputs).length > 0
          ? u.payload.outputs
          : undefined,
    };
    let candidate = full;
    let size = utf8Bytes(JSON.stringify(candidate));
    if (
      size > WORKFORCE_SYNTHESIS_LIMITS.maxUpstreamInputBytes ||
      used + size > WORKFORCE_SYNTHESIS_LIMITS.maxTotalInputBytes
    ) {
      candidate = { ...full, outputs: undefined };
      size = utf8Bytes(JSON.stringify(candidate));
      truncatedSteps.push(u.stepKey);
    }
    if (
      size > WORKFORCE_SYNTHESIS_LIMITS.maxUpstreamInputBytes ||
      used + size > WORKFORCE_SYNTHESIS_LIMITS.maxTotalInputBytes
    ) {
      candidate = {
        stepKey: u.stepKey,
        workerKey: u.payload.source.workerKey,
        summary: truncate(u.payload.summary, 400),
      };
      size = utf8Bytes(JSON.stringify(candidate));
    }
    entries.push(candidate);
    used += size;
  }
  return { entries, truncatedSteps };
}

type SynthesisModelInvoke = (input: {
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

/**
 * 测试接缝：仅 NODE_ENV=test 可注入确定性模型替身（golden test 不依赖
 * 外部 LLM 环境）。生产路径恒走统一 Model Runtime，无任何旁路。
 */
let synthesisModelOverrideForTests: SynthesisModelInvoke | null = null;

export function setWorkforceSynthesisModelForTests(
  fn: SynthesisModelInvoke | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "setWorkforceSynthesisModelForTests 仅允许在 NODE_ENV=test 下调用",
    );
  }
  synthesisModelOverrideForTests = fn;
}

export type ExecuteSynthesisTaskInput = {
  orgId: string;
  userId: string;
  runId: string;
  stepKey: string;
  /** Task 契约中的 objective（server 校验过的 spec 字段） */
  objective: string;
  expectedOutput?: string;
  /** validated 上游 Handoff（collectUpstreamHandoffs 产物，声明序） */
  upstreamHandoffs: UpstreamHandoff[];
};

/**
 * Native Synthesis 执行（§16–§20）。返回与 AdapterResult 兼容的结果，
 * 由 executor 统一持久化（重试 / 终态 / workforce-handoff/v1 信封）。
 */
export async function executeWorkforceSynthesisTask(
  input: ExecuteSynthesisTaskInput,
): Promise<SynthesisExecutionResult> {
  // §18 fail-closed：synthesis 必须有至少一个 validated 上游。
  // dependsOn 为空 / 全部为 true-legacy 上游（无信封）→ 无可综合内容。
  if (input.upstreamHandoffs.length === 0) {
    return {
      ok: false,
      error:
        "SYNTHESIS_NO_UPSTREAM: synthesis 任务没有可消费的 validated 上游 Handoff（必须在 dependsOn 声明至少一个契约任务）",
    };
  }

  const { entries, truncatedSteps } = buildBoundedSynthesisInput(
    input.upstreamHandoffs,
  );

  const systemPrompt = `你是青砚 Workforce Runtime 的综合汇总执行器（synthesis task）。
你收到多个上游任务的结构化产出，请基于且仅基于这些产出完成综合。
规则：
- 不得编造上游产出中不存在的事实、数字或客户
- summary 是面向业务负责人的综合结论（连贯段落，不是罗列）
- conclusions 为关键结论列表（每条独立成立、可追溯到上游）
- 如上游证据不足以支撑某个判断，写入 risks 而不是臆断
- evidenceRefs 引用来源上游的 stepKey
- 只输出 JSON：{"summary": string, "conclusions": string[], "risks": string[], "opportunities": string[], "recommendations": string[], "evidenceRefs": string[]}`;

  const userPrompt = JSON.stringify({
    objective: input.objective,
    expectedOutput: input.expectedOutput,
    upstreamCount: input.upstreamHandoffs.length,
    upstreams: entries,
  });

  let raw: string;
  try {
    if (synthesisModelOverrideForTests) {
      raw = await synthesisModelOverrideForTests({ systemPrompt, userPrompt });
    } else {
      // §20：唯一模型出口 = 统一 Model Runtime（配额预检 + 遥测内建）
      raw = await createCompletion({
        systemPrompt,
        userPrompt,
        temperature: 0,
        maxTokens: WORKFORCE_SYNTHESIS_LIMITS.maxModelOutputTokens,
        orgId: input.orgId,
        userId: input.userId,
      });
    }
  } catch (err) {
    return {
      ok: false,
      error: `SYNTHESIS_MODEL_FAILED: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      ok: false,
      error: "SYNTHESIS_INVALID_OUTPUT: 模型未返回 JSON 结构化综合结果",
    };
  }
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      ok: false,
      error: "SYNTHESIS_INVALID_OUTPUT: 模型返回的 JSON 无法解析",
    };
  }
  const parsed = WorkforceSynthesisResultV1Schema.safeParse(parsedRaw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `SYNTHESIS_INVALID_OUTPUT: 综合结果不符合输出契约（${truncate(
        parsed.error.message,
        300,
      )}）`,
    };
  }

  return {
    ok: true,
    data: {
      ...parsed.data,
      // 审计：综合了哪些上游（声明序）与被截断的输入
      synthesisOf: input.upstreamHandoffs.map((u) => u.stepKey),
      ...(truncatedSteps.length > 0
        ? { synthesisInputTruncated: truncatedSteps }
        : {}),
    },
  };
}
