/**
 * Revenue Spine — RFQ 抽取合并层：启发式为底，LLM 补缺/择优（证据必须接地）
 */

import type { RevenueSpinePolicy } from "../policy";
import { extractRfqHeuristic } from "./heuristic-extractor";
import { extractRfqLlm } from "./llm-extractor";
import { RFQ_FIELDS, type RfqEvidence, type RfqExtraction, type RfqField, type RfqFields } from "./types";

export interface ExtractRfqInput {
  text: string;
  policy: RevenueSpinePolicy;
  orgId: string;
  userId: string;
  agentRunId?: string;
  /** 默认 true；测试或无 key 时自动退化为纯启发式 */
  useLlm?: boolean;
  now?: Date;
}

/** 纯函数：合并两份抽取（可单测） */
export function mergeRfqExtractions(base: RfqExtraction, llm: RfqExtraction | null): RfqExtraction {
  if (!llm) return base;
  const fields: RfqFields = { ...base.fields };
  const evidence: RfqEvidence[] = [...base.evidence];
  const bestOf = (ev: RfqEvidence[], f: RfqField) =>
    ev.filter((e) => e.field === f).sort((a, b) => b.confidence - a.confidence)[0];
  for (const field of RFQ_FIELDS) {
    const h = bestOf(base.evidence, field);
    const l = bestOf(llm.evidence, field);
    if (!l) continue;
    const llmValue = llm.fields[field];
    if (llmValue === null || llmValue === undefined) continue;
    const take = !h ? l.confidence >= 0.5 : l.confidence > h.confidence + 0.1;
    if (take) {
      (fields as unknown as Record<string, unknown>)[field] = llmValue;
      evidence.push(l);
    } else if (h && l.confidence >= 0.5) {
      // 同意见时也保留 LLM 证据（多源佐证）
      evidence.push(l);
    }
  }
  return {
    fields,
    evidence,
    language: base.language,
    method: "merged",
    notes: [...base.notes, ...llm.notes],
  };
}

export async function extractRfq(input: ExtractRfqInput): Promise<RfqExtraction> {
  const heuristic = extractRfqHeuristic(input.text, {
    productKeywords: input.policy.businessProfile.productKeywords,
    now: input.now,
  });
  if (input.useLlm === false) return heuristic;
  const llm = await extractRfqLlm(input.text, {
    orgId: input.orgId,
    userId: input.userId,
    agentRunId: input.agentRunId,
    productCategories: input.policy.businessProfile.productCategories,
    language: heuristic.language,
  });
  return mergeRfqExtractions(heuristic, llm);
}
