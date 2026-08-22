/**
 * AI 补充分类（仅低置信度行；只改 suggestedCategory / suggestedDescription / confidence，绝不改数字）。
 * 失败语义：任何异常 → 行保持启发式结果；整个导入不因 AI 失败而失败。
 */

import { z } from "zod";
import { callStructured, createUnifiedRuntimeInvoker, type LlmInvoker } from "@/lib/tender-understanding/llm";
import { COST_CATEGORIES } from "../contract";
import { LOW_CONFIDENCE_THRESHOLD, type ImportRow } from "./contract";

export const IMPORT_CLASSIFY_PROMPT = { name: "quote-import-classify", version: "1" } as const;

const resultSchema = z.object({
  items: z.array(z.object({ i: z.number().int().min(0), category: z.string(), description: z.string().min(1).max(200), confidence: z.number().min(0).max(1) })),
});

const SYSTEM_PROMPT = `You classify supplier quotation / cost spreadsheet rows into cost categories for a Canadian supply & install contractor.
Allowed categories: ${COST_CATEGORIES.join(", ")}.
Rules:
- Output ONLY the category and a short clean English description for each input index. Never output amounts or quantities.
- MATERIAL/PROCUREMENT = purchased products (windows, doors, glass, hardware). FREIGHT = ocean/inland transport. LABOUR = installation/removal/caulking/site labour.
- If unsure, choose the closest category and lower the confidence.
- Output strict JSON: {"items":[{"i":<index>,"category":"<CATEGORY>","description":"<text>","confidence":<0..1>}]} covering every input index once.`;

export async function classifyLowConfidenceRows(rows: ImportRow[], opts: { invoker?: LlmInvoker; timeoutMs?: number; maxRows?: number } = {}): Promise<{ updated: number; llmCalls: number }> {
  const targets = rows.map((r, idx) => ({ r, idx })).filter(({ r }) => r.confidence < LOW_CONFIDENCE_THRESHOLD && r.include).slice(0, opts.maxRows ?? 60);
  if (targets.length === 0) return { updated: 0, llmCalls: 0 };
  const invoker = opts.invoker ?? createUnifiedRuntimeInvoker();
  try {
    const res = await callStructured(
      invoker,
      {
        promptName: IMPORT_CLASSIFY_PROMPT.name,
        promptVersion: IMPORT_CLASSIFY_PROMPT.version,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: JSON.stringify({ items: targets.map(({ r }, j) => ({ i: j, text: r.sourceDescription.slice(0, 200), hint: r.suggestedCategory })) }),
        maxTokens: 6000,
        timeoutMs: opts.timeoutMs ?? 20_000,
      },
      resultSchema,
    );
    if (!res.ok) return { updated: 0, llmCalls: res.logs.length };
    let updated = 0;
    const seen = new Set<number>();
    for (const item of res.value.items) {
      if (item.i < 0 || item.i >= targets.length || seen.has(item.i)) continue;
      seen.add(item.i);
      if (!(COST_CATEGORIES as readonly string[]).includes(item.category)) continue;
      const row = targets[item.i]!.r;
      row.suggestedCategory = item.category;
      row.suggestedDescription = item.description.trim().slice(0, 300) || row.suggestedDescription;
      row.confidence = Math.max(row.confidence, Math.min(item.confidence, 0.8));
      row.aiSuggested = true;
      row.warnings = row.warnings.filter((w) => w !== "AMBIGUOUS_CATEGORY");
      if (row.confidence >= LOW_CONFIDENCE_THRESHOLD) row.warnings = row.warnings.filter((w) => w !== "LOW_CONFIDENCE");
      updated += 1;
    }
    return { updated, llmCalls: res.logs.length };
  } catch {
    return { updated: 0, llmCalls: 1 };
  }
}
