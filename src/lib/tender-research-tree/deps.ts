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
import { searchAwardHistory } from "@/lib/tender-intel/canadabuys";
import { patchRoomSummaryTx } from "@/lib/tender-room/summary-json";
import { loadTenderPackageInventory } from "@/lib/tender-understanding/load-package";
import { buildTenderPackage } from "@/lib/tender-understanding/package-input";
import { normalizeFactValue } from "@/lib/tender-understanding/normalize";
import { readCriticalFactSlot } from "@/lib/tender-rfq/round-pure";
import {
  createResearchReadSession,
  readPublicPage,
  type PageReadResult,
  type ResearchReadContext,
  type ResearchReadSession,
} from "@/lib/web-reader";
import { RESEARCH_BRANCH_PROMPT_VERSION } from "./prompt";
import { RESEARCH_TREE_LIMITS, RESEARCH_TREE_TIMING } from "./limits";
import type { OpenDataRow } from "./awards";
import type { ClausePage } from "./clauses";
import type { ResearchTreeSummaryV1 } from "./types";

export const BRANCH_STEP_AUDIT_ACTION = "research.branch_step" as const;
export const RESEARCH_AUDIT_TARGET_TYPE = "research_job" as const;

/* ───────────────────────────── 外部服务 ───────────────────────────── */

export type ResearchSearchFn = (query: string, opts: { timeoutMs: number; maxResults: number }) => Promise<TavilyDetailedResult>;

/** 联邦合同公开数据的一次查询（`canadabuys.ts` 的 searchAwardHistory；内部先判外部情报开关，超时 25 秒） */
export type OpenDataResult = { ok: boolean; rows: OpenDataRow[]; note: string | null };
export type ResearchOpenDataFn = (
  query: string,
  env: Record<string, string | undefined>,
  opts?: { timeoutMs?: number },
) => Promise<OpenDataResult>;

/**
 * 给联邦数据查询用的 fetch：超时一直管到正文读完（`canadabuys.ts` 自己的 25 秒定时器在拿到响应头时就清掉了，
 * 读正文没有时限）
 */
export function fetchWithBodyTimeout(timeoutMs: number, base: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const signals = [AbortSignal.timeout(Math.max(1, timeoutMs))];
    if (init?.signal) signals.push(init.signal);
    return base(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

export type ResearchExternalDeps = {
  now: () => number;
  env: Record<string, string | undefined>;
  search: ResearchSearchFn;
  openData: ResearchOpenDataFn;
  /** 每一片建一个模型调用器（钉住模型，主备由模型策略决定）；promptVersion 缺省为分支循环的 */
  invokerFor: (input: { orgId: string; userId: string; promptVersion?: string }) => LlmInvoker;
  openReadSession: (input: { orgId: string; jobId: string }) => Promise<ResearchReadSession>;
  readPage: (url: string, ctx: ResearchReadContext) => Promise<PageReadResult>;
};

const productionExternal: ResearchExternalDeps = {
  now: () => Date.now(),
  get env() {
    return process.env;
  },
  search: (query, opts) => tavilySearchDetailed(query, { maxResults: opts.maxResults, timeoutMs: opts.timeoutMs }),
  openData: async (query, env, opts) => {
    const r = await searchAwardHistory({
      query,
      env: env as NodeJS.ProcessEnv,
      fetchImpl: fetchWithBodyTimeout(opts?.timeoutMs ?? RESEARCH_TREE_TIMING.OPEN_DATA_TIMEOUT_MS),
    });
    return {
      ok: r.ok,
      note: r.note,
      rows: r.findings.map((f) => ({
        vendorName: f.vendorName,
        descriptionEn: f.descriptionEn,
        contractValue: f.contractValue,
        contractDate: f.contractDate,
        buyerName: f.buyerName,
        ownerOrg: f.ownerOrg,
        referenceNumber: f.referenceNumber,
        sourceUrl: f.sourceUrl,
      })),
    };
  },
  invokerFor: ({ orgId, userId, promptVersion }) =>
    createPinnedTenderInvoker({ orgId, userId, promptVersion: promptVersion ?? RESEARCH_BRANCH_PROMPT_VERSION, defaultStage: "triage" }),
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

/** 测试里会发出外部请求的几项：注入时缺了哪一项就直接报错，不悄悄走生产实现（免得测试真的去连外网） */
const NETWORK_DEPS = ["search", "openData", "invokerFor", "openReadSession", "readPage"] as const;

export function externalDeps(): ResearchExternalDeps {
  if (testExternal && process.env.NODE_ENV === "test") {
    const t = testExternal;
    const strict: Partial<ResearchExternalDeps> = {};
    for (const k of NETWORK_DEPS) {
      if (t[k] === undefined) {
        (strict as Record<string, unknown>)[k] = () => {
          throw new Error(`测试没有注入 ${k}（调研树测试里一律不发真实的外部请求）`);
        };
      }
    }
    return { ...productionExternal, ...strict, ...t };
  }
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

/** 条款员读的标书（与一键分析同一口径的「哪些是标书」） */
export type TenderPagesRow = {
  /** 能用的标书文件数（有文字的） */
  documentCount: number;
  /** 解析好了、却一页文字都没有的标书文件数（扫描件） */
  emptyDocumentCount: number;
  /** 没有文字的页数（扫描件页） */
  scannedPages: number;
  pages: ClausePage[];
};

/** 交给模型与可比度用的招标要求（最新一次可用分析的关键事实，只读） */
export type RequirementFactsRow = { quantity: number | null; contractDays: number | null };

export type ResearchStore = {
  loadJob: (runId: string) => Promise<ResearchJobRow | null>;
  loadProject: (projectId: string) => Promise<ResearchProjectRow | null>;
  loadOrgSettings: (orgId: string) => Promise<unknown>;
  /** 这棵树的全部游标行（按写入先后；多取一行用来判断超没超上限） */
  loadCursorRows: (orgId: string, jobId: string, take: number) => Promise<CursorRow[]>;
  writeCursorRow: (client: StoreClient, row: CursorWrite) => Promise<void>;
  /** 写情报室摘要；项目没有情报室时返回 false（不新建） */
  writeRoomSummary: (client: StoreClient, projectId: string, summary: ResearchTreeSummaryV1) => Promise<boolean>;
  /** 条款员：本项目的标书页（只读） */
  loadTenderPages: (projectId: string) => Promise<TenderPagesRow>;
  /** 授标支：数量与合同期（只读；没有可用分析或读不出 → null） */
  loadRequirementFacts: (projectId: string) => Promise<RequirementFactsRow>;
};

/** 关键事实槽 → 归一化前的原文（factId 形状再读那条事实；只认这一次分析运行里的） */
async function criticalFactText(runId: string, summaryJson: unknown, type: string): Promise<{ raw: string | null; claim: string } | null> {
  const slot = readCriticalFactSlot(summaryJson, type);
  if (!slot) return null;
  if ("text" in slot) return { raw: null, claim: slot.text };
  const f = await db.tenderAnalysisFact.findFirst({ where: { id: slot.factId, runId }, select: { contentZh: true, contentOriginal: true } });
  return f ? { raw: f.contentOriginal, claim: f.contentZh } : null;
}

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
  loadTenderPages: async (projectId) => {
    const inventory = await loadTenderPackageInventory(projectId);
    const pkg = buildTenderPackage({ projectId, inventory });
    const pages: ClausePage[] = [];
    let scannedPages = 0;
    for (const doc of pkg.includedDocuments) {
      for (const p of doc.pages) {
        if (!p.contentText.trim()) {
          scannedPages += 1;
          continue;
        }
        pages.push({
          documentId: doc.documentId,
          documentTitle: doc.name,
          pageNumber: p.pageNumber,
          unitKind: p.unitKind ?? null,
          unitLabel: p.unitLabel ?? null,
          text: p.contentText,
        });
      }
    }
    const emptyDocs = pkg.manifest.filter((m) => m.exclusionReason === "EMPTY_TEXT");
    for (const m of emptyDocs) {
      const inv = inventory.find((d) => d.documentId === m.documentId);
      scannedPages += Math.max(inv?.pageCount ?? 0, inv?.pages.length ?? 0, 1);
    }
    return { documentCount: pkg.includedDocuments.length, emptyDocumentCount: emptyDocs.length, scannedPages, pages };
  },
  loadRequirementFacts: async (projectId) => {
    const run = await db.tenderAnalysisRun.findFirst({
      where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, summaryJson: true },
    });
    if (!run) return { quantity: null, contractDays: null };
    const q = await criticalFactText(run.id, run.summaryJson, "quantity");
    const d = await criticalFactText(run.id, run.summaryJson, "contract_duration");
    const qv = q ? normalizeFactValue("quantity", q.raw, q.claim) : null;
    const dv = d ? normalizeFactValue("contract_duration", d.raw, d.claim) : null;
    const quantity = qv && qv.kind === "quantity" && Number.isFinite(qv.value) && qv.value > 0 ? qv.value : null;
    const contractDays = dv && dv.kind === "duration_days" && Number.isFinite(dv.days) && dv.days > 0 ? dv.days : null;
    return { quantity, contractDays };
  },
};

export const CURSOR_TAKE = RESEARCH_TREE_LIMITS.CURSOR_MAX_ROWS + 1;
