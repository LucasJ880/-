/**
 * V2 LLM 边界 — 统一模型运行时适配 + 结构化输出校验 + 有界重试
 *
 * - 生产调用只经 createPinnedTenderInvoker（Tender QUALITY_FIRST）：
 *   总开关打开时主模型 gpt-6-astra，与 generic researcher 独立。
 * - LlmInvoker 是显式注入缝：deterministic 单测注入脚本化 invoker 测确定性机件；
 *   REAL_LLM_LANE 用 createUnifiedRuntimeInvoker()（禁止 mock 冒充真实 lane）。
 * - 重试分类：transient model error → 1 次重试；invalid structured output →
 *   带 schema 错误反馈重试（有界）；内容不足（合法空数组）→ 不重试
 *   （unknown 不应触发重复调用直到模型"猜一个"）。
 */

import type { z } from "zod";
import {
  createPinnedTenderInvoker,
  type TenderStage,
} from "@/lib/ai/model-policy";
import { PROMPT_EXTRACT } from "./prompts";

export type LlmCallRequest = {
  promptName: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
  tenderStage?: TenderStage;
};

export type LlmCallResponse = {
  content: string;
  model: string;
  elapsedMs: number;
  /** 供观测：length = token 预算截断（结构化输出失败的常见根因） */
  finishReason?: string | null;
  fallbackUsed?: boolean;
  requestedModel?: string;
};

export type LlmInvoker = (req: LlmCallRequest) => Promise<LlmCallResponse>;

export type LlmCallLog = {
  promptName: string;
  promptVersion: string;
  model: string;
  elapsedMs: number;
  inputChars: number;
  outputChars: number;
  ok: boolean;
  errorCode: string | null;
  fallbackUsed?: boolean;
  requestedModel?: string;
};

/** 生产 invoker：Tender 角色，一次 run 钉住模型，禁止百分比随机拆模型。 */
export function createUnifiedRuntimeInvoker(ctx: {
  orgId?: string | null;
  userId?: string | null;
} = {}): LlmInvoker {
  return createPinnedTenderInvoker({
    orgId: ctx.orgId?.trim() || undefined,
    userId: ctx.userId?.trim() || undefined,
    promptVersion: PROMPT_EXTRACT.version,
    defaultStage: "understanding",
  });
}

/* ---------------------------------- JSON 提取 ---------------------------------- */

export function extractJsonObject(content: string): string | null {
  const stripped = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = stripped.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}

/* ---------------------------------- 结构化调用 ---------------------------------- */

export type StructuredCallResult<T> =
  | { ok: true; value: T; logs: LlmCallLog[] }
  | {
      ok: false;
      errorCode:
        | "TRANSIENT_MODEL_ERROR"
        | "INVALID_STRUCTURED_OUTPUT"
        | "EMPTY_OUTPUT";
      logs: LlmCallLog[];
    };

export async function callStructured<T>(
  invoker: LlmInvoker,
  req: LlmCallRequest,
  schema: z.ZodType<T>,
  opts: { maxAttempts?: number } = {},
): Promise<StructuredCallResult<T>> {
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? 2, 3));
  const logs: LlmCallLog[] = [];
  let userPrompt = req.userPrompt;
  let transientRetried = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: LlmCallResponse;
    try {
      res = await invoker({ ...req, userPrompt });
    } catch (err) {
      logs.push({
        promptName: req.promptName,
        promptVersion: req.promptVersion,
        model: "unknown",
        elapsedMs: 0,
        inputChars: req.systemPrompt.length + userPrompt.length,
        outputChars: 0,
        ok: false,
        errorCode: "TRANSIENT_MODEL_ERROR",
      });
      // transient 只额外重试一次（有界）
      if (!transientRetried && attempt < maxAttempts) {
        transientRetried = true;
        continue;
      }
      void err;
      return { ok: false, errorCode: "TRANSIENT_MODEL_ERROR", logs };
    }

    const jsonText = extractJsonObject(res.content);
    let parsed: unknown = null;
    let parseError: string | null = null;
    if (!jsonText) {
      parseError = res.content.trim().length === 0 ? "EMPTY" : "NO_JSON_OBJECT";
    } else {
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parseError = `JSON_PARSE: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`;
      }
    }

    if (parseError === null) {
      const validated = schema.safeParse(parsed);
      if (validated.success) {
        logs.push({
          promptName: req.promptName,
          promptVersion: req.promptVersion,
          model: res.model,
          elapsedMs: res.elapsedMs,
          inputChars: req.systemPrompt.length + userPrompt.length,
          outputChars: res.content.length,
          ok: true,
          errorCode: null,
          fallbackUsed: res.fallbackUsed,
          requestedModel: res.requestedModel,
        });
        return { ok: true, value: validated.data, logs };
      }
      parseError = `SCHEMA: ${validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
        .slice(0, 300)}`;
    }

    logs.push({
      promptName: req.promptName,
      promptVersion: req.promptVersion,
      model: res.model,
      elapsedMs: res.elapsedMs,
      inputChars: req.systemPrompt.length + userPrompt.length,
      outputChars: res.content.length,
      ok: false,
      errorCode:
        parseError === "EMPTY"
          ? "EMPTY_OUTPUT"
          : res.finishReason === "length"
            ? "TRUNCATED_OUTPUT"
            : "INVALID_STRUCTURED_OUTPUT",
      fallbackUsed: res.fallbackUsed,
      requestedModel: res.requestedModel,
    });

    if (attempt < maxAttempts) {
      userPrompt = `${req.userPrompt}\n\nYOUR PREVIOUS OUTPUT WAS INVALID (${parseError}). Output ONLY one valid JSON object matching the schema. No prose, no code fences.`;
    }
  }

  const last = logs[logs.length - 1];
  return {
    ok: false,
    errorCode:
      last?.errorCode === "EMPTY_OUTPUT"
        ? "EMPTY_OUTPUT"
        : "INVALID_STRUCTURED_OUTPUT",
    logs,
  };
}
