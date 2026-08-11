/**
 * V2 单测共享工具 — 脚本化 LlmInvoker
 *
 * 说明：deterministic 单测注入脚本化 invoker 提供"候选"，被测对象是 V2 的
 * 确定性机件（证据校验/去重/优先级/未知策略/澄清纪律）。真实 LLM lane
 * 由 benchmark runner --lane=v2 单独执行（不得 mock），两者不可混淆。
 */

import type {
  AnalyzerDocument,
  AnalyzerInput,
  ExtractionOutputV2,
  ResolutionOutputV2,
} from "../contract";
import type { LlmInvoker } from "../llm";

export function doc(
  documentId: string,
  sourceRole: AnalyzerDocument["sourceRole"],
  pages: Record<number, string>,
  name = documentId,
): AnalyzerDocument {
  return {
    documentId,
    name,
    type: "pdf",
    sourceRole,
    pages: Object.entries(pages).map(([n, contentText]) => ({
      pageNumber: Number(n),
      contentText,
    })),
    contentHash: null,
  };
}

export function input(...documents: AnalyzerDocument[]): AnalyzerInput {
  return { projectId: "proj_test", documents };
}

type ExtractScript = (userPrompt: string) => Partial<ExtractionOutputV2>;
type ResolveScript = (userPrompt: string) => ResolutionOutputV2;

export function scriptedInvoker(script: {
  extract?: ExtractScript;
  resolve?: ResolveScript;
}): LlmInvoker {
  return async (req) => {
    if (req.promptName.includes("extract")) {
      const out = script.extract?.(req.userPrompt) ?? {};
      return {
        content: JSON.stringify({
          facts: [],
          requirements: [],
          potentialRisks: [],
          ambiguities: [],
          ...out,
        }),
        model: "scripted-test-model",
        elapsedMs: 1,
      };
    }
    if (req.promptName.includes("resolve")) {
      const out: ResolutionOutputV2 = script.resolve?.(req.userPrompt) ?? {
        resolved: false,
        answerSummary: null,
        answerDocumentId: null,
        answerPageNumber: null,
        answerSnippet: null,
      };
      return {
        content: JSON.stringify(out),
        model: "scripted-test-model",
        elapsedMs: 1,
      };
    }
    throw new Error(`unexpected prompt: ${req.promptName}`);
  };
}

/** 便捷断言计数器（与 repo 既有测试风格一致） */
export function makeOk(): { ok: (name: string, fn: () => void | Promise<void>) => Promise<void>; count: () => number } {
  let passed = 0;
  return {
    ok: async (name, fn) => {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    },
    count: () => passed,
  };
}
