/**
 * 发起一棵情报调研树（只由人发起：项目页「开始调研」；确认招标要求、「重新查」、补页后重算在后续 change 接入）。
 *
 * 调研 Job 是工作域为 tender 的独立 Job：不设 metadata.projectId（一键分析按它认分析 Job，调研 Job 不能被它认出来），
 * 项目放在 researchProjectId；调研标记（researchTree / researchTreeVersion / researchTrigger）**只在这里写**
 * （守卫测试）。同一项目同时只有一棵没结束的树：事务里加项目级咨询锁，已有就复用。
 */

import { db } from "@/lib/db";
import { createWorkforceJob } from "@/lib/workforce-runtime/job";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";
import { AGENT_RUN_TERMINAL_STATUSES } from "@/lib/agent-runtime/types";
import { HUMAN_RESEARCH_TRIGGERS } from "@/lib/web-reader";
import type { Prisma } from "@prisma/client";
import { isResearchTreeEnabledForOrg } from "./flags";
import { RESEARCH_PLAN_TOOLS, RESEARCH_TREE_GOAL, buildResearchTreePlan } from "./graph";

export type ResearchTrigger = (typeof HUMAN_RESEARCH_TRIGGERS)[number];

export type StartResearchTreeResult =
  | { ok: true; jobId: string; reused: boolean }
  | { ok: false; code: "FEATURE_DISABLED" | "INVALID_TRIGGER" | "WORKFORCE_DISABLED" | "CREATE_FAILED"; error: string };

function researchJobWhere(orgId: string, projectId: string): Prisma.AgentRunWhereInput {
  return {
    orgId,
    runType: WORKFORCE_JOB_RUN_TYPE,
    AND: [
      { metadata: { path: ["researchTree"], equals: true } },
      { metadata: { path: ["researchProjectId"], equals: projectId } },
      { metadata: { path: ["workDomain"], equals: "tender" } },
    ],
  };
}

/** 同一项目没结束的调研 Job（完成、失败、取消之外的都算没结束） */
export async function findOpenResearchJob(orgId: string, projectId: string): Promise<{ id: string; status: string } | null> {
  return db.agentRun.findFirst({
    where: { ...researchJobWhere(orgId, projectId), status: { notIn: [...AGENT_RUN_TERMINAL_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
}

export async function startResearchTree(input: {
  orgId: string;
  projectId: string;
  userId: string;
  role?: string | null;
  trigger: ResearchTrigger;
  requestId?: string | null;
}): Promise<StartResearchTreeResult> {
  if (!isResearchTreeEnabledForOrg(input.orgId)) {
    return { ok: false, code: "FEATURE_DISABLED", error: "情报调研树尚未对当前组织开放" };
  }
  if (!(HUMAN_RESEARCH_TRIGGERS as readonly string[]).includes(input.trigger)) {
    return { ok: false, code: "INVALID_TRIGGER", error: "调研树只能由人发起" };
  }
  const requestId = (input.requestId ?? "").trim().slice(0, 200) || null;

  // requestId 重放（双击 / 重试）：直接返回已建的那条
  if (requestId) {
    const base = researchJobWhere(input.orgId, input.projectId);
    const replayed = await db.agentRun.findFirst({
      where: {
        ...base,
        AND: [...(base.AND as Prisma.AgentRunWhereInput[]), { metadata: { path: ["requestId"], equals: requestId } }],
      },
      select: { id: true },
    });
    if (replayed) return { ok: true, jobId: replayed.id, reused: true };
  }

  const lockKey = `tender-research-start:${input.orgId}:${input.projectId}`;
  return db.$transaction(
    async (tx) => {
      // 同项目发起串行化：并发双击收敛为一条
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const open = await findOpenResearchJob(input.orgId, input.projectId);
      if (open) return { ok: true as const, jobId: open.id, reused: true };

      const created = await createWorkforceJob({
        orgId: input.orgId,
        userId: input.userId,
        role: input.role,
        goal: RESEARCH_TREE_GOAL,
        channel: "workforce",
        projectId: null,
        source: "tender_research_tree",
        plan: buildResearchTreePlan(),
        planTools: [...RESEARCH_PLAN_TOOLS],
        workDomain: "tender",
        extraMetadata: {
          researchTree: true,
          researchTreeVersion: 1,
          researchTrigger: input.trigger,
          researchProjectId: input.projectId,
          researchStartedAt: new Date().toISOString(),
          ...(requestId ? { requestId } : {}),
        },
      });
      if (!created.ok) {
        return created.error === "WORKFORCE_RUNTIME_DISABLED"
          ? { ok: false as const, code: "WORKFORCE_DISABLED" as const, error: "任务运行时未开启，无法开始调研" }
          : { ok: false as const, code: "CREATE_FAILED" as const, error: `开始调研失败：${created.error.slice(0, 200)}` };
      }
      return { ok: true as const, jobId: created.jobId, reused: false };
    },
    { timeout: 20_000 },
  );
}
