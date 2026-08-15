/**
 * Tender T1B — 一键 AI 分析触发服务（任务书 §8/§10/§11/§29）
 *
 * start：幂等启动（advisory-lock 串行化 check-then-create；同项目
 *   at-most-one active tender 分析 Job；requestId 命中直接复用——HTTP
 *   重试/双击安全）。restart：先取消既有活跃 Job 再启动新 Job。
 * cancel：项目上下文校验（org + project + workDomain=tender + runType）
 *   后复用既有 cancelAgentRun 原语（绝不只拿 runId 就 cancel），并
 *   同步终态化域侧 AGENT_ANALYZING run。
 * status：项目上下文的安全投影（复用 read-model getWorkforceJobView）。
 *
 * Workforce Job 创建唯一入口 = createWorkforceJob（含 WORKFORCE_RUNTIME
 * flag/allowlist 与 org 配额治理）；本服务不直写 AgentRun。
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createWorkforceJob } from "@/lib/workforce-runtime/job";
import { cancelAgentRun } from "@/lib/agent-runtime/run";
import { WORKFORCE_JOB_RUN_TYPE } from "@/lib/workforce-runtime/constants";
import { getWorkforceJobView } from "@/lib/workforce-runtime/read-model/service";
import type { WorkforceJobViewModel } from "@/lib/workforce-runtime/read-model/types";
import {
  isTenderWorkforceAnalysisEnabled,
  isTenderDeterministicPlanEnabled,
} from "./flags";
import { buildTenderDeterministicPlan } from "./deterministic-plan";
import { tenderWorkforceDeterministicTools } from "./tools";
import {
  failWorkforceTenderAnalysisRun,
  TENDER_AGENT_RUN_STATUS,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
} from "./analysis-run-service";

/**
 * "同类活跃分析 Job"判定集（§10）：queued/planning/planned/running/
 * executing/verifying/repairing/awaiting_approval/needs_human 都视为
 * 活跃（needs_human 需用户显式「重新分析」= restart 才会替换）。
 */
export const TENDER_JOB_BLOCKING_STATUSES = [
  "queued",
  "acknowledged",
  "planning",
  "planned",
  "running",
  "executing",
  "verifying",
  "repairing",
  "awaiting_approval",
  "needs_human",
] as const;

export type StartTenderAnalysisResult =
  | { ok: true; jobId: string; reused: boolean; restarted: boolean }
  | {
      ok: false;
      code:
        | "FEATURE_DISABLED"
        | "WORKFORCE_DISABLED"
        | "ACTIVE_JOB_EXISTS"
        | "CREATE_FAILED";
      error: string;
      jobId?: string;
    };

function tenderJobWhere(
  orgId: string,
  projectId: string,
): Prisma.AgentRunWhereInput {
  // AgentRun 无 projectId 列：项目关联按 metadata correlation 契约
  // （traceContextToMetadata 写入 metadata.projectId）
  return {
    orgId,
    runType: WORKFORCE_JOB_RUN_TYPE,
    AND: [
      { metadata: { path: ["projectId"], equals: projectId } },
      { metadata: { path: ["workDomain"], equals: "tender" } },
    ],
  };
}

async function findActiveTenderJob(orgId: string, projectId: string) {
  return db.agentRun.findFirst({
    where: {
      ...tenderJobWhere(orgId, projectId),
      status: { in: [...TENDER_JOB_BLOCKING_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
}

/** goal 同时是 Job Center 标题来源与 planner 输入（§15：结构化上下文进 goal） */
export function buildTenderAnalysisGoal(projectName: string): string {
  return [
    `对投标项目「${projectName.slice(0, 80)}」执行一键 AI 投标分析。`,
    // Segment 3 §5：本 goal 只服务 **flag OFF 的 LLM 兼容路径**（旧 T1B 语义）。
    // 刻意不要求"生成交付物"——grounded 交付物严格投影 canonical
    // summaryJson.submissionChecklist，而兼容路径的 legacy 抽取根本不产出该字段，
    // 写进 goal 只会诱导 planner 去调一个在这条路径上必然 fail-closed 的工具。
    // flag ON 时 planner 不读 goal，goal 仅作 Job Center 标题。
    "流程：校验输入并建立分析清单 → 解析投标文件 → 提取要求与报告章节 → 证据与合规覆盖分析 → 风险分析 → 澄清问题草稿 → 综合汇总（synthesis）→ 写回最终分析结果。",
    "约束：总计不超过 8 个任务；每个任务在 dependsOn 中声明其真实消费的上游；全部步骤 executionMode=analysis 且 requiresApproval=false——这些工具只产生机器分析记录，不属于需要人工审批的业务写操作（不发邮件、不建日历、不改客户数据），任何步骤都不要标记 requiresApproval=true 或 executionMode=write；每个分析任务除声明直接上游外，还应把第一步（分析清单）列入 dependsOn；综合任务 taskKind=synthesis、不设 preferredTool、依赖全部分析任务；最后一个任务用 tender_finalize_analysis 并依赖综合任务。",
  ].join("");
}

export async function startTenderWorkforceAnalysis(input: {
  orgId: string;
  projectId: string;
  projectName: string;
  userId: string;
  /** 平台角色（透传 workforce flag role allowlist） */
  role?: string | null;
  requestId?: string | null;
  /** true = 「重新分析」：取消既有活跃 Job 后启动新 Job */
  restart?: boolean;
}): Promise<StartTenderAnalysisResult> {
  if (!isTenderWorkforceAnalysisEnabled({ orgId: input.orgId })) {
    return {
      ok: false,
      code: "FEATURE_DISABLED",
      error: "投标 AI 分析（数字员工）尚未在当前环境开放",
    };
  }

  const requestId = (input.requestId ?? "").trim() || null;

  // requestId 幂等（§10/§36）：同一请求身份重放（双击/HTTP retry）直接
  // 返回已创建的 Job，不产生第二个 Job / 第二次 token 消耗
  if (requestId) {
    const replayed = await db.agentRun.findFirst({
      where: {
        ...tenderJobWhere(input.orgId, input.projectId),
        metadata: { path: ["requestId"], equals: requestId },
      },
      select: { id: true },
    });
    if (replayed) {
      return { ok: true, jobId: replayed.id, reused: true, restarted: false };
    }
  }

  const lockKey = `tender-workforce-start:${input.orgId}:${input.projectId}`;

  return db.$transaction(
    async (tx) => {
      // 同项目启动临界区串行化（§36：并发双触发收敛为 at-most-one）。
      // $executeRaw：pg_advisory_xact_lock 返回 void，不可走 $queryRaw 反序列化
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const active = await findActiveTenderJob(input.orgId, input.projectId);
      if (active && !input.restart) {
        return {
          ok: true as const,
          jobId: active.id,
          reused: true,
          restarted: false,
        };
      }
      if (active && input.restart) {
        await cancelAgentRun(input.orgId, active.id);
        await failWorkforceTenderAnalysisRun({
          orgId: input.orgId,
          jobId: active.id,
          errorCode: "cancelled",
          errorMessage: "用户重新发起分析，旧的分析已取消",
        });
      }

      // T5-P1 §19：**同一入口、同一 runtime、同一 UI、同一产物**——
      // flag 只切换"计划从哪来"，不新建按钮也不新建 API。
      const deterministic = isTenderDeterministicPlanEnabled({
        orgId: input.orgId,
      });
      const serverPlan = deterministic
        ? buildTenderDeterministicPlan({
            projectId: input.projectId,
            projectName: input.projectName,
          })
        : undefined;

      const created = await createWorkforceJob({
        orgId: input.orgId,
        userId: input.userId,
        role: input.role,
        // goal 仍然保留：它同时是 Job Center 标题来源（flag ON 时 planner 不会读它）
        goal: buildTenderAnalysisGoal(input.projectName),
        channel: "workforce",
        projectId: input.projectId,
        source: "tender_ui",
        ...(serverPlan
          ? {
              plan: serverPlan,
              // Segment 3 §3：确定性计划用**确定性工具白名单**（含 canonical V2
              // 工具、不含 legacy extract）。绝不为了让确定性计划编译通过
              // 而把 canonical V2 工具塞进 LLM planner 可见面。
              planTools: tenderWorkforceDeterministicTools(),
            }
          : {}),
        // T5-P0C-C：workDomain 走具名 server 参数（不再经 generic metadata 通道）
        workDomain: "tender",
        extraMetadata: {
          trigger: "user",
          analysisMode: "full",
          analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
          ...(requestId ? { requestId } : {}),
        },
      });
      if (!created.ok) {
        return {
          ok: false as const,
          code:
            created.error === "WORKFORCE_RUNTIME_DISABLED"
              ? ("WORKFORCE_DISABLED" as const)
              : ("CREATE_FAILED" as const),
          error:
            created.error === "WORKFORCE_RUNTIME_DISABLED"
              ? "Workforce Runtime 未开启，无法启动 AI 分析"
              : `启动失败：${created.error}`,
        };
      }
      return {
        ok: true as const,
        jobId: created.jobId,
        reused: created.reused,
        restarted: Boolean(active && input.restart),
      };
    },
    { timeout: 20_000 },
  );
}

export type CancelTenderAnalysisResult =
  | { ok: true; jobId: string }
  | { ok: false; code: "NOT_FOUND" | "NOT_CANCELLABLE"; error: string };

export async function cancelTenderWorkforceAnalysis(input: {
  orgId: string;
  projectId: string;
  jobId: string;
}): Promise<CancelTenderAnalysisResult> {
  // §29：org + project + workDomain + runType 全量归属校验，
  // 绝不允许"只拿 runId 就 cancel"
  const job = await db.agentRun.findFirst({
    where: { ...tenderJobWhere(input.orgId, input.projectId), id: input.jobId },
    select: { id: true, status: true },
  });
  if (!job) {
    return {
      ok: false,
      code: "NOT_FOUND",
      error: "分析任务不存在或不属于当前项目",
    };
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return {
      ok: false,
      code: "NOT_CANCELLABLE",
      error: "分析任务已结束，无需取消",
    };
  }
  await cancelAgentRun(input.orgId, job.id);
  await failWorkforceTenderAnalysisRun({
    orgId: input.orgId,
    jobId: job.id,
    errorCode: "cancelled",
    errorMessage: "用户已取消本次 AI 分析",
  });
  return { ok: true, jobId: job.id };
}

/* ══════════════════ 状态投影（卡片 VM；§26/§33 人话映射在 UI 层） ══════════════════ */

export type TenderAnalysisAgentStatus = {
  enabled: boolean;
  job: {
    jobId: string;
    status: WorkforceJobViewModel["status"];
    title?: string;
    progress: WorkforceJobViewModel["progress"];
    currentTaskTitle?: string;
    needsYou?: { title?: string; detail?: string };
    finalSummary?: string;
    createdAt: string;
    completedAt?: string;
  } | null;
  latestAnalysisRun: {
    id: string;
    status: string;
    summaryText: string | null;
    completedAt: string | null;
  } | null;
};

export async function getTenderWorkforceAnalysisStatus(input: {
  orgId: string;
  projectId: string;
}): Promise<TenderAnalysisAgentStatus> {
  const enabled = isTenderWorkforceAnalysisEnabled({ orgId: input.orgId });

  const latestJob = await db.agentRun.findFirst({
    where: tenderJobWhere(input.orgId, input.projectId),
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  let job: TenderAnalysisAgentStatus["job"] = null;
  if (latestJob) {
    const view = await getWorkforceJobView({
      orgId: input.orgId,
      jobId: latestJob.id,
    });
    if (view.ok) {
      const v = view.view;
      job = {
        jobId: v.jobId,
        status: v.status,
        title: v.title,
        progress: v.progress,
        currentTaskTitle: v.currentTasks[0]?.title,
        needsYou: v.needsYou
          ? { title: v.needsYou.title, detail: v.needsYou.detail }
          : undefined,
        finalSummary: v.finalSummary,
        createdAt: v.createdAt,
        completedAt: v.completedAt,
      };
    }
  }

  const latestRun = await db.tenderAnalysisRun.findFirst({
    where: {
      orgId: input.orgId,
      projectId: input.projectId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      summaryText: true,
      completedAt: true,
    },
  });

  return {
    enabled,
    job,
    latestAnalysisRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          summaryText: latestRun.summaryText,
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export { TENDER_AGENT_RUN_STATUS };
