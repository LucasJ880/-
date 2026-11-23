/**
 * 一支的处理结果（分支循环与条款员共用）：交单，或让出到下一片。
 */

import type { AdapterResult } from "@/lib/agent-runtime-v2/adapters";
import { foundCountOf } from "./fork-rules";
import type { ResearchHandoffV1 } from "./types";

/** 交单：业务输出里放摘要与整张交接单 */
export function branchDone(handoff: ResearchHandoffV1): AdapterResult {
  return {
    ok: true,
    data: {
      researchSummary: {
        branchKey: handoff.branchKey,
        status: handoff.status,
        statusZh: handoff.statusZh,
        foundCount: foundCountOf(handoff),
        usage: handoff.usage,
      },
      researchHandoff: handoff,
    },
  };
}

/** 让出：快到这一片的截止，下一片接着做（运行时退还这一次尝试） */
export function branchYield(branchKey: string, ticks: number): AdapterResult {
  return { ok: true, continuation: { reason: "TIME_BUDGET_YIELD", phase: `branch:${branchKey}`, ticks } };
}
