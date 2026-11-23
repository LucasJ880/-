/**
 * 情报调研树的依赖：外部服务（搜索、模型、读网页、时钟、环境）与库（Job、项目、组织设置、审计游标、情报室）。
 *
 * 生产用真实实现；测试经 `__setResearchTreeDepsForTest` 换掉外部服务（只在 NODE_ENV=test 的进程里生效，
 * 别的环境调用直接抛错），库的部分照用真实实现（隔离库测试）或由单元测试直接传入内存实现。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit/logger";
import { createPinnedTenderInvoker } from "@/lib/ai/model-policy";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { tavilySearchDetailed, type TavilyDetailedResult } from "@/lib/tender-intel/tavily-client";
import { patchRoomSummaryTx } from "@/lib/tender-room/summary-json";
import {
  createResearchReadSession,
  readPublicPage,
  type PageReadResult,
  type ResearchReadContext,
  type ResearchReadSession,
} from "@/lib/web-reader";
import { RESEARCH_BRANCH_PROMPT_VERSION } from "./prompt";
import { RESEARCH_TREE_LIMITS } from "./limits";
import type { ResearchTreeSummaryV1 } from "./types";

export const BRANCH_STEP_AUDIT_ACTION = "research.branch_step" as const;
export const RESEARCH_AUDIT_TARGET_TYPE = "research_job" as const;

/* ───────────────────────────── 外部服务 ───────────────────────────── */

export type ResearchSearchFn = (query: string, opts: { timeoutMs: number; maxResults: number }) => Promise<TavilyDetailedResult>;

export type ResearchExternalDeps = {
  now: () => number;
  env: Record<string, string | undefined>;
  search: ResearchSearchFn;
  /** 每一片建一个模型调用器（钉住模型，主备由模型策略决定） */
  invokerFor: (input: { orgId: string; userId: string }) => LlmInvoker;
  openReadSession: (input: { orgId: string; jobId: string }) => Promise<ResearchReadSession>;
  readPage: (url: string, ctx: ResearchReadContext) => Promise<PageReadResult>;
};

const productionExternal: ResearchExternalDeps = {
  now: () => Date.now(),
  get env() {
    return process.env;
  },
  search: (query, opts) => tavilySearchDetailed(query, { maxResults: opts.maxResults, timeoutMs: opts.timeoutMs }),
  invokerFor: ({ orgId, userId }) =>
    createPinnedTenderInvoker({ orgId, userId, promptVersion: RESEARCH_BRANCH_PROMPT_VERSION, defaultStage: "triage" }),
  openReadSession: (input) => createResearchReadSession(input),
  readPage: (url, ctx) => readPublicPage(url, ctx),
};

let testExternal: Partial<ResearchExternalDeps> | null = null;

/** 测试注入：只在 NODE_ENV=test 的进程里可用 */
export function __setResearchTreeDepsForTest(deps: Partial<ResearchExternalDeps> | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("__setResearchTreeDepsForTest 只能在测试进程里调用");
  }
  testExternal = deps;
}

export function externalDeps(): ResearchExternalDeps {
  if (testExternal && process.env.NODE_ENV === "test") return { ...productionExternal, ...testExternal };
  return productionExternal;
}

/* ───────────────────────────── 库 ───────────────────────────── */

export type ResearchJobRow = { id: string; orgId: string; status: string; metadata: unknown };

export type ResearchProjectRow = {
  id: string;
  orgId: string | null;
  workDomain: string;
  name: string;
  clientOrganization: string | null;
  solicitationNumber: string | null;
  location: string | null;
  category: string | null;
  closeDate: Date | null;
  estimatedValue: number | null;
  ourBidPrice: number | null;
  winningBidPrice: number | null;
};

/** 一条 research.branch_step 审计（afterData 的内容） */
export type CursorRow = { branchKey: string; seq: number; kind: string; data: Record<string, unknown> };

export type CursorWrite = {
  orgId: string;
  userId: string;
  jobId: string;
  branchKey: string;
  seq: number;
  kind: string;
  data: Record<string, unknown>;
};

/** 写库用的客户端：生产里是运行时租约防栅栏给的事务；单元测试里随便什么 */
export type StoreClient = unknown;

export type ResearchStore = {
  loadJob: (runId: string) => Promise<ResearchJobRow | null>;
  loadProject: (projectId: string) => Promise<ResearchProjectRow | null>;
  loadOrgSettings: (orgId: string) => Promise<unknown>;
  /** 这棵树的全部游标行（按写入先后；多取一行用来判断超没超上限） */
  loadCursorRows: (orgId: string, jobId: string, take: number) => Promise<CursorRow[]>;
  writeCursorRow: (client: StoreClient, row: CursorWrite) => Promise<void>;
  /** 写情报室摘要；项目没有情报室时返回 false（不新建） */
  writeRoomSummary: (client: StoreClient, projectId: string, summary: ResearchTreeSummaryV1) => Promise<boolean>;
};

function parseAfterData(raw: unknown): Record<string, unknown> | null {
  let d: unknown = raw;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
}

export const productionStore: ResearchStore = {
  loadJob: (runId) => db.agentRun.findUnique({ where: { id: runId }, select: { id: true, orgId: true, status: true, metadata: true } }),
  loadProject: (projectId) =>
    db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        orgId: true,
        workDomain: true,
        name: true,
        clientOrganization: true,
        solicitationNumber: true,
        location: true,
        category: true,
        closeDate: true,
        estimatedValue: true,
        ourBidPrice: true,
        winningBidPrice: true,
      },
    }),
  loadOrgSettings: async (orgId) =>
    (await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson ?? null,
  loadCursorRows: async (orgId, jobId, take) => {
    const rows = await db.auditLog.findMany({
      where: { orgId, action: BRANCH_STEP_AUDIT_ACTION, targetType: RESEARCH_AUDIT_TARGET_TYPE, targetId: jobId },
      select: { afterData: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
    });
    const out: CursorRow[] = [];
    for (const r of rows) {
      const a = parseAfterData(r.afterData) ?? {};
      // 读不出的行也占一个位置（计入行数上限），只是不归到任何一支
      const { branchKey, seq, kind, ...data } = a;
      out.push({
        branchKey: typeof branchKey === "string" ? branchKey : "",
        seq: typeof seq === "number" ? seq : -1,
        kind: typeof kind === "string" ? kind : "",
        data,
      });
    }
    return out;
  },
  writeCursorRow: async (client, row) => {
    await writeAuditLog(client as Prisma.TransactionClient, {
      userId: row.userId,
      orgId: row.orgId,
      action: BRANCH_STEP_AUDIT_ACTION,
      targetType: RESEARCH_AUDIT_TARGET_TYPE,
      targetId: row.jobId,
      afterData: { branchKey: row.branchKey, seq: row.seq, kind: row.kind, ...row.data },
    });
  },
  writeRoomSummary: async (client, projectId, summary) => {
    const res = await patchRoomSummaryTx(client as Prisma.TransactionClient, {
      projectId,
      patch: () => ({ set: { researchTree: summary as unknown as Prisma.InputJsonValue } }),
    });
    return res !== null;
  },
};

export const CURSOR_TAKE = RESEARCH_TREE_LIMITS.CURSOR_MAX_ROWS + 1;
