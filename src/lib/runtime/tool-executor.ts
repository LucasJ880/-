import type { ToolExecutionResult } from "./types";
import { db } from "@/lib/db";

interface ToolDef {
  id?: string;
  key: string;
  name: string;
  category: string;
  type: string;
}

export async function executeTool(
  tool: ToolDef,
  argsJson: string,
  toolCallId: string,
  context: { knowledgeBaseId?: string | null }
): Promise<ToolExecutionResult> {
  const start = Date.now();
  let input: Record<string, unknown> = {};

  try {
    input = JSON.parse(argsJson);
  } catch {
    input = { raw: argsJson };
  }

  try {
    if (tool.category === "builtin" || tool.type === "builtin") {
      const result = await executeBuiltin(tool.key, input, context);
      return {
        toolCallId,
        toolKey: tool.key,
        toolName: tool.name,
        input,
        output: result,
        status: "success",
        durationMs: Date.now() - start,
      };
    }

    return {
      toolCallId,
      toolKey: tool.key,
      toolName: tool.name,
      input,
      output: { message: `工具类型 '${tool.type}' (${tool.category}) 暂不支持执行` },
      status: "skipped",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      toolCallId,
      toolKey: tool.key,
      toolName: tool.name,
      input,
      output: null,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function executeBuiltin(
  key: string,
  input: Record<string, unknown>,
  context: { knowledgeBaseId?: string | null }
): Promise<unknown> {
  switch (key) {
    case "echo":
      return { echo: input };

    case "calculator": {
      const expr = String(input.expression ?? input.input ?? "");
      return { result: safeCalculate(expr), expression: expr };
    }

    case "kb_lookup": {
      const query = String(input.query ?? input.input ?? "");
      return await kbLookup(query, context.knowledgeBaseId ?? null);
    }

    default:
      return { message: `未知的内置工具: ${key}` };
  }
}

function safeCalculate(expr: string): string {
  const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, "");
  if (!sanitized || sanitized.length > 100) return "无效表达式";
  try {
    const fn = new Function(`"use strict"; return (${sanitized})`);
    const result = fn();
    if (typeof result !== "number" || !isFinite(result)) return "计算结果无效";
    return String(result);
  } catch {
    return "计算错误";
  }
}

async function kbLookup(query: string, knowledgeBaseId: string | null): Promise<unknown> {
  if (!knowledgeBaseId || !query.trim()) {
    return { results: [], message: "未绑定知识库或查询为空" };
  }

  const docs = await db.knowledgeDocument.findMany({
    where: {
      knowledgeBaseId,
      status: "active",
      title: { contains: query.slice(0, 50), mode: "insensitive" },
    },
    take: 3,
    select: { title: true, id: true },
  });

  if (docs.length === 0) {
    const fallback = await db.knowledgeDocument.findMany({
      where: { knowledgeBaseId, status: "active" },
      take: 3,
      select: { title: true, id: true },
    });
    return {
      results: fallback.map((d) => ({ title: d.title })),
      message: `未精确匹配「${query}」，返回最近文档`,
    };
  }

  return { results: docs.map((d) => ({ title: d.title })) };
}
