/**
 * Workforce Job Read Model — 只读服务层
 *
 * getWorkforceJobView：把五个现有模型（AgentRun / AgentRunStep /
 * AgentRunEvent / PendingAction / planJson）聚合成 WorkforceJobViewModel。
 *
 * 硬性质：
 * - **READ ONLY**：Reader 接口只有 findFirst / findMany（类型层面不存在
 *   create / update / delete——服务想写也写不了）；
 * - **租户隔离**：所有查询强制 orgId + runId 双条件（Reader 的 where 类型
 *   要求 orgId 必填）；跨 org 访问与不存在同样返回 NOT_FOUND，不区分二者；
 * - **零 Runtime 依赖**：不 import processor / executor / persist / resume，
 *   不触发任何执行语义；
 * - **可注入 Reader**：测试注入内存 fake（零 DB）；生产默认懒加载 @/lib/db
 *   （与 processor.ts 动态 import 同模式，纯测试进程不实例化 Prisma）。
 */

import { WORKFORCE_JOB_RUN_TYPE } from "../constants";
import { buildWorkforceJobViewModel } from "./projection";
import type {
  WorkforceEventSnapshot,
  WorkforceJobViewModel,
  WorkforcePendingActionSnapshot,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
} from "./types";

/* ------------------------------------------------------------------ */
/* Reader 契约（结构性只读；Prisma client 天然满足）                     */
/* ------------------------------------------------------------------ */

export type WorkforceReadModelReader = {
  agentRun: {
    findFirst(args: {
      where: { id: string; orgId: string; runType: string };
      select: {
        id: true;
        orgId: true;
        runType: true;
        status: true;
        attempts: true;
        errorCode: true;
        errorMessage: true;
        planJson: true;
        metadata: true;
        startedAt: true;
        completedAt: true;
        cancelledAt: true;
        createdAt: true;
        updatedAt: true;
      };
    }): Promise<WorkforceRunSnapshot | null>;
  };
  agentRunStep: {
    findMany(args: {
      where: { runId: string; orgId: string };
      orderBy: [{ createdAt: "asc" }, { id: "asc" }];
      select: {
        id: true;
        stepKey: true;
        title: true;
        status: true;
        inputJson: true;
        startedAt: true;
        completedAt: true;
        createdAt: true;
      };
    }): Promise<WorkforceStepSnapshot[]>;
  };
  agentRunEvent: {
    findMany(args: {
      where: { runId: string; orgId: string };
      orderBy: { sequence: "asc" };
      select: {
        sequence: true;
        eventType: true;
        title: true;
        payload: true;
        visibleToUser: true;
        createdAt: true;
      };
    }): Promise<WorkforceEventSnapshot[]>;
  };
  pendingAction: {
    findMany(args: {
      where: { agentRunId: string; orgId: string };
      orderBy: { createdAt: "asc" };
      select: {
        id: true;
        status: true;
        title: true;
        createdAt: true;
      };
    }): Promise<WorkforcePendingActionSnapshot[]>;
  };
};

/** 生产默认 Reader：懒加载 db（测试注入 fake 时全程不触碰 Prisma） */
async function defaultReader(): Promise<WorkforceReadModelReader> {
  const { db } = await import("@/lib/db");
  return {
    agentRun: {
      findFirst: (args) => db.agentRun.findFirst(args),
    },
    agentRunStep: {
      findMany: (args) => db.agentRunStep.findMany(args),
    },
    agentRunEvent: {
      findMany: (args) => db.agentRunEvent.findMany(args),
    },
    pendingAction: {
      findMany: (args) => db.pendingAction.findMany(args),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 服务入口                                                             */
/* ------------------------------------------------------------------ */

export type GetWorkforceJobViewInput = {
  orgId: string;
  /** jobId = rootRunId = AgentRun.id（2A 冻结等式） */
  jobId: string;
  /**
   * Admin/Operator 内部视图（附 internalTimeline 全量事件）。
   * 默认 false；本阶段任何 API 均不透出该开关（2D 再做 RBAC 面）。
   */
  includeInternal?: boolean;
};

export type GetWorkforceJobViewResult =
  | { ok: true; view: WorkforceJobViewModel }
  /** 不存在 / 非本 org / 非 workforce_job —— 统一 NOT_FOUND，不区分（防枚举） */
  | { ok: false; error: "NOT_FOUND" };

export async function getWorkforceJobView(
  input: GetWorkforceJobViewInput,
  reader?: WorkforceReadModelReader,
): Promise<GetWorkforceJobViewResult> {
  const orgId = input.orgId?.trim();
  const jobId = input.jobId?.trim();
  if (!orgId || !jobId) return { ok: false, error: "NOT_FOUND" };

  const db = reader ?? (await defaultReader());

  // 租户隔离：orgId + runId + runType 三条件；缺一不可
  const run = await db.agentRun.findFirst({
    where: { id: jobId, orgId, runType: WORKFORCE_JOB_RUN_TYPE },
    select: {
      id: true,
      orgId: true,
      runType: true,
      status: true,
      attempts: true,
      errorCode: true,
      errorMessage: true,
      planJson: true,
      metadata: true,
      startedAt: true,
      completedAt: true,
      cancelledAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!run) return { ok: false, error: "NOT_FOUND" };

  const [steps, events, pendingActions] = await Promise.all([
    db.agentRunStep.findMany({
      where: { runId: run.id, orgId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        stepKey: true,
        title: true,
        status: true,
        inputJson: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    }),
    db.agentRunEvent.findMany({
      where: { runId: run.id, orgId },
      orderBy: { sequence: "asc" },
      select: {
        sequence: true,
        eventType: true,
        title: true,
        payload: true,
        visibleToUser: true,
        createdAt: true,
      },
    }),
    db.pendingAction.findMany({
      where: { agentRunId: run.id, orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        title: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    ok: true,
    view: buildWorkforceJobViewModel({
      run,
      steps,
      events,
      pendingActions,
      includeInternal: input.includeInternal === true,
    }),
  };
}
