/**
 * 发起一棵情报调研树（只由人发起：项目页「开始调研」；确认招标要求、「重新查」、补页后重算在后续 change 接入）。
 *
 * 调研 Job 是工作域为 tender 的独立 Job：不设 metadata.projectId（一键分析按它认分析 Job，调研 Job 不能被它认出来），
 * 项目放在 researchProjectId；调研标记（researchTree / researchTreeVersion / researchTrigger）**只在这里写**
 * （守卫测试）。同一项目同时只有一棵在查的树（排队中或运行中）：事务里加不阻塞的项目级咨询锁，已有就复用。
 */

import { db } from "@/lib/db";
import { createWorkforceJob } from "@/lib/workforce-runtime/job";
import { WORKFORCE_ACTIVE_STATUSES, WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";
import { HUMAN_RESEARCH_TRIGGERS } from "@/lib/web-reader";
import type { Prisma } from "@prisma/client";
import { isResearchTreeEnabledForOrg } from "./flags";
import { RESEARCH_PLAN_TOOLS, RESEARCH_TREE_GOAL, buildResearchTreePlan } from "./graph";

export type ResearchTrigger = (typeof HUMAN_RESEARCH_TRIGGERS)[number];

export type StartResearchTreeResult =
  | { ok: true; jobId: string; reused: boolean; status: string }
  | { ok: false; code: "FEATURE_DISABLED" | "INVALID_TRIGGER" | "WORKFORCE_DISABLED" | "BUSY" | "CREATE_FAILED"; error: string };

/**
 * 「在查」的调研 Job：排队中或运行中（运行时的活跃状态）。停在「需要人工处理」的不算——它不会自己再跑，
 * 不能挡住同一项目再发起一棵新的树。
 */
export const OPEN_RESEARCH_STATUSES: readonly string[] = Object.freeze(["queued", "acknowledged", ...WORKFORCE_ACTIVE_STATUSES]);

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

/** 同一项目在查的调研 Job（排队中或运行中） */
export async function findOpenResearchJob(orgId: string, projectId: string): Promise<{ id: string; status: string } | null> {
  return db.agentRun.findFirst({
    where: { ...researchJobWhere(orgId, projectId), status: { in: [...OPEN_RESEARCH_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
}

/** 别的请求正在发起同一项目时，等它建好（每 300 毫秒看一次，最多 2 秒） */
async function waitForOpenJob(orgId: string, projectId: string): Promise<{ id: string; status: string } | null> {
  for (let i = 0; i < 7; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const open = await findOpenResearchJob(orgId, projectId);
    if (open) return open;
  }
  return null;
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
      select: { id: true, status: true },
    });
    if (replayed) return { ok: true, jobId: replayed.id, reused: true, status: replayed.status };
  }

  const lockKey = `tender-research-start:${input.orgId}:${input.projectId}`;
  const result = await db.$transaction(
    async (tx) => {
      // 同项目发起串行化：并发双击收敛为一条。用不阻塞的锁：拿不到就放掉连接、在事务外等对方建好
      // （阻塞等锁会占着一条连接，连接池小的时候两个请求互相卡住）
      const got = await tx.$queryRaw<Array<{ got: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS got`;
      if (!got[0]?.got) return { busy: true as const };
      const open = await findOpenResearchJob(input.orgId, input.projectId);
      if (open) return { ok: true as const, jobId: open.id, reused: true, status: open.status };

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
      return { ok: true as const, jobId: created.jobId, reused: false, status: "queued" };
    },
    { timeout: 20_000 },
  );
  if ("busy" in result) {
    const open = await waitForOpenJob(input.orgId, input.projectId);
    if (open) return { ok: true, jobId: open.id, reused: true, status: open.status };
    return { ok: false, code: "BUSY", error: "正在开始调研，请稍后再看" };
  }
  return result;
}
