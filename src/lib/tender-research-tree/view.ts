/**
 * 调研树的读取（TREE-3：只给条款结果；TREE-5 在同一个读取上加整棵树）。只读：不写任何数据。
 *
 * 取本项目最新一棵调研树（按建立时间）的 Job 状态与「① 条款」那一步的结果。不读情报室（条款一支完成就能看到，
 * 不等树干）；不给金额、网页内容与网址（条款结果只有标书文件名、页码、标书摘录与答案枚举）。
 */

import { db } from "@/lib/db";
import { RESEARCH_STEP_IDS, TEXT_ZH, handoffFromOutput } from "./fork-rules";
import { OPEN_RESEARCH_STATUSES, researchJobWhere } from "./start";
import type { BranchStatus, ClauseFindingsV1 } from "./types";

export type ResearchClausesView =
  | { state: "pending" }
  /** 调研已经停下（完成、失败、取消、需要人工处理）而条款一步没有结果，或结果读不出来 */
  | { state: "stopped"; messageZh: string }
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

/** 条款一步的业务输出 → 视图（形状不对的：结果读不出来） */
export function clausesViewOf(outputJson: unknown): ResearchClausesView {
  const h = handoffFromOutput(outputJson);
  if (!h || h.kind !== "clauses") return { state: "stopped", messageZh: TEXT_ZH.clausesUnreadable };
  return {
    state: "done",
    status: h.status,
    statusZh: h.statusZh,
    reasonZh: typeof h.reasonZh === "string" ? h.reasonZh : null,
    messagesZh: h.notFound.filter((n) => typeof n.messageZh === "string").map((n) => n.messageZh),
    findings: h.clauses ?? null,
  };
}

/** 步骤停下、不会再跑的状态 */
const STOPPED_STEP_STATUSES: ReadonlySet<string> = new Set(["failed", "skipped", "cancelled", "blocked"]);

/**
 * Job 与条款一步的状态 → 条款视图：步骤完成 → 读结果；Job 还在排队或运行中、步骤也没停 → 在查；
 * 其余（Job 完成 / 失败 / 取消 / 需要人工处理、步骤失败或跳过）→ 停下了（不会自己再跑，不能一直说「在查」）
 */
export function clausesViewFor(jobStatus: string, step: { status: string; outputJson: unknown } | null): ResearchClausesView {
  if (step && step.status === "completed") return clausesViewOf(step.outputJson);
  const jobOpen = (OPEN_RESEARCH_STATUSES as readonly string[]).includes(jobStatus);
  if (jobOpen && !(step && STOPPED_STEP_STATUSES.has(step.status))) return { state: "pending" };
  return { state: "stopped", messageZh: TEXT_ZH.clausesStopped };
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
    clauses: clausesViewFor(job.status, step),
  };
}
