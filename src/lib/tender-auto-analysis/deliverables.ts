/**
 * Phase G — 投标交付物清单（幂等 upsert by deliverableKey）
 */

import { db } from "@/lib/db";
import { DELIVERABLE_DEFINITIONS } from "./constants";

export type BuildDeliverablesInput = {
  runId: string;
};

export type BuildDeliverablesResult = {
  deliverableCount: number;
  keys: string[];
};

export async function buildDeliverables(
  input: BuildDeliverablesInput,
): Promise<BuildDeliverablesResult> {
  const run = await db.tenderAnalysisRun.findUnique({
    where: { id: input.runId },
    select: { projectId: true },
  });
  if (!run) throw new Error(`buildDeliverables: run not found ${input.runId}`);

  const keys: string[] = [];
  for (const def of DELIVERABLE_DEFINITIONS) {
    await db.tenderDeliverable.upsert({
      where: {
        analysisRunId_deliverableKey: {
          analysisRunId: input.runId,
          deliverableKey: def.key,
        },
      },
      create: {
        projectId: run.projectId,
        analysisRunId: input.runId,
        deliverableKey: def.key,
        title: def.title,
        mandatory: def.mandatory,
        status: "PENDING",
      },
      update: {
        title: def.title,
        mandatory: def.mandatory,
      },
    });
    keys.push(def.key);
  }

  return { deliverableCount: keys.length, keys };
}

/** 纯函数：交付物 key 列表（单测） */
export function listDeliverableKeys(): string[] {
  return DELIVERABLE_DEFINITIONS.map((d) => d.key);
}
