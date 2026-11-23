/**
 * 读公开网页（TREE-1）对外入口。
 *
 * 读网页只有一个函数：`readPublicPage(url, ctx)`。上下文只能这样建：
 *   const session = await createResearchReadSession({ orgId, jobId });   // 从库里核对调研 Job
 *   const ctx = session.forBranch({ branchKey, budget: { remaining: 12, used: 0 }, deadlineAt });
 *   const page = await readPublicPage(url, ctx);                         // page.untrusted === true
 * 定时任务、没有调研 Job、开关关着时 createResearchReadSession 抛错，不发任何请求。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  WEB_READ_AUDIT_ACTION,
  createResearchReadSessionWithDeps,
  type CreateResearchReadContextInput,
  type ResearchJobRow,
  type ResearchReadSession,
  type WebReadAuditEntry,
  type WebReaderClock,
} from "./read-page";
import { createNodeNet } from "./transport";

export { readPublicPage, WebReaderContextError, WEB_READER_LIMITS, WEB_READER_USER_AGENT } from "./read-page";
export type { ReadBudget, ResearchReadContext, ResearchReadSession, TreePageCache } from "./read-page";
export type { PageReadOutcome, PageReadReason, PageReadResult, BlockedReason, ResearchJobMarker } from "./types";
export { HUMAN_RESEARCH_TRIGGERS } from "./types";

const realClock: WebReaderClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** 审计只记网址、状态、字数；不记正文与请求 / 响应头 */
export async function writeWebReadAudit(entry: WebReadAuditEntry): Promise<void> {
  await logAudit({
    userId: entry.userId,
    orgId: entry.orgId,
    action: WEB_READ_AUDIT_ACTION,
    targetType: "research_job",
    targetId: entry.jobId,
    afterData: {
      branchKey: entry.branchKey,
      url: entry.url,
      finalUrl: entry.finalUrl,
      outcome: entry.outcome,
      httpStatus: entry.httpStatus,
      chars: entry.chars,
      truncated: entry.truncated,
      reason: entry.reason,
      attempts: entry.attempts,
      site: entry.site,
    },
  });
}

async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
  return Array.isArray(text) ? text.map((t) => String(t ?? "")) : [String(text ?? "")];
}

/** 读调研 Job 的行（只取校验要用的三列） */
export async function loadResearchJobRow(id: string): Promise<ResearchJobRow | null> {
  return db.agentRun.findUnique({ where: { id }, select: { id: true, orgId: true, metadata: true } });
}

/** 读组织设置（站点名单的组织覆盖在 settingsJson.researchTree.sites） */
export async function loadOrgSettingsJson(orgId: string): Promise<unknown> {
  return (await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson ?? null;
}

export async function createResearchReadSession(input: CreateResearchReadContextInput): Promise<ResearchReadSession> {
  return createResearchReadSessionWithDeps(input, {
    loadJob: loadResearchJobRow,
    loadOrgSettings: loadOrgSettingsJson,
    reader: { net: createNodeNet(), clock: realClock, audit: writeWebReadAudit, extractPdf: extractPdfPages },
  });
}
