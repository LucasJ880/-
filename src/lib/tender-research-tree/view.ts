/**
 * 调研树的读取（TREE-3：只给条款结果；TREE-5 在同一个读取上加整棵树）。只读：不写任何数据。
 *
 * 取本项目最新一棵调研树（按建立时间）的 Job 状态与「① 条款」那一步的结果。不读情报室（条款一支完成就能看到，
 * 不等树干）；不给金额、网页内容与网址（条款结果只有标书文件名、页码、标书摘录与答案枚举）。
 */

import { db } from "@/lib/db";
import { RESEARCH_STEP_IDS, handoffFromOutput } from "./fork-rules";
import { researchJobWhere } from "./start";
import type { BranchStatus, ClauseFindingsV1 } from "./types";

export type ResearchClausesView =
  | { state: "pending" }
  | {
      state: "done";
      status: BranchStatus;
      statusZh: string;
      reasonZh: string | null;
      /** 没查到 / 未接通 / 到上限的原因句 */
      messagesZh: string[];
      findings: ClauseFindingsV1 | null;
    };

export type ResearchTreeView = {
  job: { id: string; status: string; createdAt: string } | null;
  clauses: ResearchClausesView | null;
};

/** 条款一步的业务输出 → 视图（形状不对的当作还没交单） */
export function clausesViewOf(outputJson: unknown): ResearchClausesView {
  const h = handoffFromOutput(outputJson);
  if (!h || h.kind !== "clauses") return { state: "pending" };
  return {
    state: "done",
    status: h.status,
    statusZh: h.statusZh,
    reasonZh: typeof h.reasonZh === "string" ? h.reasonZh : null,
    messagesZh: h.notFound.filter((n) => typeof n.messageZh === "string").map((n) => n.messageZh),
    findings: h.clauses ?? null,
  };
}

export async function loadResearchTreeView(orgId: string, projectId: string): Promise<ResearchTreeView> {
  const job = await db.agentRun.findFirst({
    where: researchJobWhere(orgId, projectId),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, status: true, createdAt: true },
  });
  if (!job) return { job: null, clauses: null };
  const step = await db.agentRunStep.findFirst({
    where: { orgId, runId: job.id, stepKey: RESEARCH_STEP_IDS.clauses },
    select: { status: true, outputJson: true },
  });
  return {
    job: { id: job.id, status: job.status, createdAt: job.createdAt.toISOString() },
    clauses: step && step.status === "completed" ? clausesViewOf(step.outputJson) : { state: "pending" },
  };
}
