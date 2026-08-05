/**
 * Phase E 将填充：从页级文本抽取结构化 facts / requirements。
 * 本阶段仅提供可调用 stub，保证 worker 管线可重入推进。
 */

export type ExtractFromPagesInput = {
  runId: string;
  documentIds: string[];
};

export type ExtractFromPagesResult = {
  factCount: number;
  requirementCount: number;
  stub: true;
};

/** TODO(Phase E): 真实 LLM/规则抽取 */
export async function extractFromPages(
  _input: ExtractFromPagesInput,
): Promise<ExtractFromPagesResult> {
  return { factCount: 0, requirementCount: 0, stub: true };
}
