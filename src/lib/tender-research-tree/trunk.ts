/**
 * 情报调研树的树干（`tender_research_trunk` 的处理函数）：确定性汇总五个分支的交接单，不调模型。
 *
 * 写进情报室 summaryJson.researchTree 的只有摘要：每支的状态、条数、未查到原因与用量，待反查的中标方名，
 * 未追的线索，全树用量。不放金额、摘录、正文与网址（详情留在各支步骤的结果里，TREE-5 的读取接口按 jobId 取）。
 * 项目还没有情报室时不新建（新建会让情报页签出现一个空房间），结果里写明没写入。
 */

import type { AdapterContext, AdapterResult } from "@/lib/agent-runtime-v2/adapters";
import { LostLeaseError } from "@/lib/agent-runtime/lease";
import { isResearchTreeEnabledForOrgWithEnv } from "./flags";
import { checkResearchJob, defaultBranchRunDeps, type BranchRunDeps } from "./branch-run";
import {
  BRANCH_DEFS,
  BRANCH_STEP_IDS,
  RESEARCH_STEP_IDS,
  TEXT_ZH,
  handoffFromOutput,
  pendingReverseOf,
  statusLineZh,
  unchasedLeadsOf,
} from "./fork-rules";
import {
  RESEARCH_TREE_SUMMARY_VERSION,
  type ResearchHandoffV1,
  type ResearchTreeSummaryV1,
  type TrunkBranchSummary,
  type TrunkUsage,
} from "./types";

const ZERO_USAGE: TrunkUsage = { searches: 0, reads: 0, modelCalls: 0, elapsedMs: 0 };

function addUsage(a: TrunkUsage, b: TrunkUsage): TrunkUsage {
  return {
    searches: a.searches + b.searches,
    reads: a.reads + b.reads,
    modelCalls: a.modelCalls + b.modelCalls,
    elapsedMs: a.elapsedMs + b.elapsedMs,
  };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const REASONS: ReadonlySet<string> = new Set(["none", "unavailable", "blocked", "limit"]);

/** 纯函数：从五个上游的输出算出树干摘要（不含金额、摘录、正文与网址；文字只取代码写的那几句） */
export function summarizeTree(input: {
  jobId: string;
  startedAt: string | null;
  finishedAt: string;
  priorEvidence: Record<string, unknown> | undefined;
}): ResearchTreeSummaryV1 {
  const handoffs = new Map<string, ResearchHandoffV1 | null>();
  for (const id of BRANCH_STEP_IDS) handoffs.set(id, handoffFromOutput(input.priorEvidence?.[id]));
  const branches: TrunkBranchSummary[] = BRANCH_STEP_IDS.map((id) => {
    const def = BRANCH_DEFS[id];
    const h = handoffs.get(id) ?? null;
    if (!h) {
      return {
        key: id,
        kind: def.kind,
        labelZh: def.labelZh,
        status: "unavailable",
        statusZh: statusLineZh("unavailable", 0),
        reasonZh: null,
        foundCount: 0,
        notFound: [{ reason: "unavailable", messageZh: TEXT_ZH.internalError }],
        usage: { ...ZERO_USAGE },
      };
    }
    return {
      key: id,
      kind: def.kind,
      labelZh: def.labelZh,
      status: h.status,
      statusZh: statusLineZh(h.status, h.found.length),
      reasonZh: typeof h.reasonZh === "string" ? h.reasonZh.slice(0, 200) : null,
      foundCount: h.found.length,
      notFound: h.notFound
        .filter((n) => REASONS.has(n.reason) && typeof n.messageZh === "string")
        .map((n) => ({ reason: n.reason, messageZh: n.messageZh.slice(0, 200) })),
      usage: {
        searches: num(h.usage?.searches),
        reads: num(h.usage?.reads),
        modelCalls: num(h.usage?.modelCalls),
        elapsedMs: num(h.usage?.elapsedMs),
      },
    };
  });
  return {
    version: RESEARCH_TREE_SUMMARY_VERSION,
    jobId: input.jobId,
    status: "done",
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    branches,
    pendingReverse: pendingReverseOf(handoffs.get(RESEARCH_STEP_IDS.priorAwards) ?? null),
    unchasedLeads: unchasedLeadsOf([...handoffs.values()]),
    usage: branches.reduce((acc, b) => addUsage(acc, b.usage), { ...ZERO_USAGE }),
  };
}

export async function handleResearchTrunk(ctx: AdapterContext): Promise<AdapterResult> {
  return runResearchTrunk(ctx, defaultBranchRunDeps());
}

export async function runResearchTrunk(ctx: AdapterContext, deps: BranchRunDeps): Promise<AdapterResult> {
  const { external: ext, store } = deps;
  // 开关关：不写情报室
  if (!isResearchTreeEnabledForOrgWithEnv(ctx.orgId, ext.env)) {
    return { ok: true, data: { researchTrunk: { status: "flag_off", roomWritten: false, messageZh: TEXT_ZH.flagOff } } };
  }
  let job: Awaited<ReturnType<typeof store.loadJob>>;
  try {
    job = await store.loadJob(ctx.runId);
  } catch {
    return { ok: true, data: { researchTrunk: { status: "error", roomWritten: false, messageZh: "树干没汇总：读库出错，可以重新查" } } };
  }
  const jc = checkResearchJob(job, ctx.orgId);
  if (!jc.ok) return { ok: false, error: jc.error };

  const meta = job && job.metadata && typeof job.metadata === "object" ? (job.metadata as Record<string, unknown>) : {};
  const summary = summarizeTree({
    jobId: ctx.runId,
    startedAt: typeof meta.researchStartedAt === "string" ? meta.researchStartedAt : null,
    finishedAt: new Date(ext.now()).toISOString(),
    priorEvidence: ctx.priorEvidence,
  });

  let roomWritten = false;
  let writeFailed = false;
  const fence = ctx.runFence;
  if (fence) {
    try {
      roomWritten = await fence.guard((client) => store.writeRoomSummary(client, jc.projectId, summary));
    } catch (err) {
      if (err instanceof LostLeaseError) throw err;
      writeFailed = true;
    }
  } else {
    writeFailed = true;
  }
  return {
    ok: true,
    data: {
      researchTrunk: {
        status: "done",
        roomWritten,
        messageZh: roomWritten
          ? "树干已汇总，写进了情报室"
          : writeFailed
            ? "树干已汇总，但写进情报室时出错；摘要只留在这一步的结果里"
            : "树干已汇总；项目还没有情报室，摘要只留在这一步的结果里",
      },
      researchTree: summary,
    },
  };
}
