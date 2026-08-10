/**
 * Workforce Job Read Model — 列表只读服务（2D-1 Job Center）
 *
 * listWorkforceJobViews：org 内 workforce_job 的分页列表投影
 * （设计 §18 过滤视图 + §24 `GET /api/workforce/jobs` contract）。
 *
 * 硬性质（与单 Job 服务同构）：
 * - **READ ONLY**：Reader 契约只有 findMany（类型层面不存在写入）；
 * - **租户隔离**：每条查询强制携带 orgId；orgId 缺失 fail-closed 返回空页；
 * - **有界查询**：limit 强制 1..50（默认 20），禁止 unbounded list；
 * - **deterministic 排序**：updatedAt DESC, id DESC（keyset 游标分页，
 *   翻页期间行更新不会造成漏读越页崩溃——最坏重复出现，绝不跨 org）；
 * - **零 Runtime 依赖**：不 import processor / executor / persist / resume；
 * - **可注入 Reader**：测试注入内存 fake（零 DB）；生产默认懒加载 @/lib/db。
 *
 * 状态过滤在 DB 层按 internal status 集合完成（走 [orgId, status] 索引，
 * 分页语义稳定）；QUEUED/WORKING 的细分（continuation 判别）仍由投影层
 * 逐行推导，不影响 tab 归属（两者同属 working 组）。
 */

import { WORKFORCE_JOB_RUN_TYPE } from "../constants";
import { buildWorkforceJobViewModel } from "./projection";
import type {
  WorkforceEventSnapshot,
  WorkforceJobListItem,
  WorkforceJobStatusFilter,
  WorkforcePendingActionSnapshot,
  WorkforceRunSnapshot,
  WorkforceStepSnapshot,
} from "./types";

/* ------------------------------------------------------------------ */
/* 过滤词汇 → internal status 集合（设计 §5/§18 冻结映射）               */
/* ------------------------------------------------------------------ */

const FILTER_INTERNAL_STATUSES: Record<
  Exclude<WorkforceJobStatusFilter, "all">,
  readonly string[]
> = {
  // QUEUED + WORKING 同属"进行中"组（continuation/retry 回队对用户连续）
  working: [
    "queued",
    "acknowledged",
    "planning",
    "planned",
    "executing",
    "verifying",
    "repairing",
    "running",
  ],
  needs_you: ["awaiting_approval", "needs_human"],
  completed: ["completed", "partially_executed"],
  failed: ["failed"],
  cancelled: ["cancelled"],
};

const VALID_FILTERS: ReadonlySet<string> = new Set([
  "all",
  ...Object.keys(FILTER_INTERNAL_STATUSES),
]);

export function isWorkforceJobStatusFilter(
  value: string,
): value is WorkforceJobStatusFilter {
  return VALID_FILTERS.has(value);
}

/* ------------------------------------------------------------------ */
/* 游标（keyset：updatedAt DESC, id DESC；base64url(JSON)）             */
/* ------------------------------------------------------------------ */

export type WorkforceJobsCursor = { updatedAt: Date; id: string };

export function encodeWorkforceJobsCursor(cursor: WorkforceJobsCursor): string {
  return Buffer.from(
    JSON.stringify({ u: cursor.updatedAt.toISOString(), i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

/** 解码失败（篡改/截断/非法时间）一律返回 null——调用方 fail-closed 拒绝 */
export function decodeWorkforceJobsCursor(
  raw: string,
): WorkforceJobsCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const { u, i } = parsed as { u?: unknown; i?: unknown };
    if (typeof u !== "string" || typeof i !== "string" || i.length === 0) {
      return null;
    }
    const updatedAt = new Date(u);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id: i };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Reader 契约（结构性只读；Prisma client 天然满足）                     */
/* ------------------------------------------------------------------ */

type ListRunWhere = {
  orgId: string;
  runType: string;
  status?: { in: string[] };
  /** keyset 翻页条件：updatedAt < c.u OR (updatedAt = c.u AND id < c.i) */
  OR?: Array<
    | { updatedAt: { lt: Date } }
    | { AND: [{ updatedAt: Date }, { id: { lt: string } }] }
  >;
};

export type WorkforceListReader = {
  agentRun: {
    findMany(args: {
      where: ListRunWhere;
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }];
      take: number;
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
    }): Promise<WorkforceRunSnapshot[]>;
  };
  agentRunStep: {
    findMany(args: {
      where: { runId: { in: string[] }; orgId: string };
      orderBy: [{ createdAt: "asc" }, { id: "asc" }];
      select: {
        id: true;
        runId: true;
        stepKey: true;
        title: true;
        status: true;
        inputJson: true;
        startedAt: true;
        completedAt: true;
        createdAt: true;
      };
    }): Promise<Array<WorkforceStepSnapshot & { runId: string }>>;
  };
  agentRunEvent: {
    findMany(args: {
      where: {
        runId: { in: string[] };
        orgId: string;
        eventType: string;
        visibleToUser: true;
      };
      orderBy: { sequence: "asc" };
      select: {
        runId: true;
        sequence: true;
        eventType: true;
        title: true;
        payload: true;
        visibleToUser: true;
        createdAt: true;
      };
    }): Promise<Array<WorkforceEventSnapshot & { runId: string }>>;
  };
  pendingAction: {
    findMany(args: {
      where: { agentRunId: { in: string[] }; orgId: string };
      orderBy: { createdAt: "asc" };
      select: {
        id: true;
        agentRunId: true;
        status: true;
        title: true;
        createdAt: true;
      };
    }): Promise<
      /** 列上可空（历史行）；where 已按 in 过滤，null 行结构性不匹配任何 run */
      Array<WorkforcePendingActionSnapshot & { agentRunId: string | null }>
    >;
  };
};

/** 生产默认 Reader：懒加载 db（测试注入 fake 时全程不触碰 Prisma） */
async function defaultListReader(): Promise<WorkforceListReader> {
  const { db } = await import("@/lib/db");
  return {
    agentRun: {
      findMany: (args) => db.agentRun.findMany(args),
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type ListWorkforceJobViewsInput = {
  orgId: string;
  /** 缺省 = all */
  status?: WorkforceJobStatusFilter;
  /** 缺省 20；强制 clamp 到 1..50（禁止 unbounded list） */
  limit?: number;
  cursor?: WorkforceJobsCursor | null;
};

export type ListWorkforceJobViewsResult = {
  items: WorkforceJobListItem[];
  /** null = 没有下一页 */
  nextCursor: WorkforceJobsCursor | null;
};

export async function listWorkforceJobViews(
  input: ListWorkforceJobViewsInput,
  reader?: WorkforceListReader,
): Promise<ListWorkforceJobViewsResult> {
  const orgId = input.orgId?.trim();
  // fail-closed：无 org 上下文绝不发起无租户条件的查询
  if (!orgId) return { items: [], nextCursor: null };

  const limitRaw = input.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limitRaw)));
  const filter = input.status ?? "all";

  const where: ListRunWhere = { orgId, runType: WORKFORCE_JOB_RUN_TYPE };
  if (filter !== "all") {
    where.status = { in: [...FILTER_INTERNAL_STATUSES[filter]] };
  }
  if (input.cursor) {
    where.OR = [
      { updatedAt: { lt: input.cursor.updatedAt } },
      {
        AND: [
          { updatedAt: input.cursor.updatedAt },
          { id: { lt: input.cursor.id } },
        ],
      },
    ];
  }

  const db = reader ?? (await defaultListReader());

  // take limit+1 判定 hasMore；游标 = 页内最后一行的 (updatedAt, id)
  const runs = await db.agentRun.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
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

  const hasMore = runs.length > limit;
  const pageRuns = hasMore ? runs.slice(0, limit) : runs;
  if (pageRuns.length === 0) return { items: [], nextCursor: null };

  const runIds = pageRuns.map((r) => r.id);

  // 批量取子行（3 条 IN 查询，不做每 Job 的 N+1）。
  // 事件只取 needsYou 投影所需的 job.waiting_human（targeted，防事件放大）。
  const [steps, waitingEvents, pendingActions] = await Promise.all([
    db.agentRunStep.findMany({
      where: { runId: { in: runIds }, orgId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        runId: true,
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
      where: {
        runId: { in: runIds },
        orgId,
        eventType: "job.waiting_human",
        visibleToUser: true,
      },
      orderBy: { sequence: "asc" },
      select: {
        runId: true,
        sequence: true,
        eventType: true,
        title: true,
        payload: true,
        visibleToUser: true,
        createdAt: true,
      },
    }),
    db.pendingAction.findMany({
      where: { agentRunId: { in: runIds }, orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        agentRunId: true,
        status: true,
        title: true,
        createdAt: true,
      },
    }),
  ]);

  const stepsByRun = groupBy(steps, (s) => s.runId);
  const eventsByRun = groupBy(waitingEvents, (e) => e.runId);
  const actionsByRun = groupBy(pendingActions, (a) => a.agentRunId ?? "");

  const items = pageRuns.map((run) => {
    const view = buildWorkforceJobViewModel({
      run,
      steps: stepsByRun.get(run.id) ?? [],
      events: eventsByRun.get(run.id) ?? [],
      pendingActions: actionsByRun.get(run.id) ?? [],
    });
    // Lite 投影：卡片字段子集（timeline / tasks 全量属详情页）
    const item: WorkforceJobListItem = {
      jobId: view.jobId,
      status: view.status,
      progress: view.progress,
      currentTasks: view.currentTasks,
      createdAt: view.createdAt,
      lastActivityAt: view.lastActivityAt,
    };
    if (view.title) item.title = view.title;
    if (view.needsYou) item.needsYou = view.needsYou;
    if (view.businessRefs) item.businessRefs = view.businessRefs;
    if (view.startedAt) item.startedAt = view.startedAt;
    if (view.completedAt) item.completedAt = view.completedAt;
    return item;
  });

  const last = pageRuns[pageRuns.length - 1];
  return {
    items,
    nextCursor: hasMore ? { updatedAt: last.updatedAt, id: last.id } : null,
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}
