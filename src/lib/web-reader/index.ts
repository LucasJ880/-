/**
 * 读公开网页（TREE-1）对外入口。
 *
 * 读网页只有一个函数：`readPublicPage(url, ctx)`。上下文只能这样建：
 *   const session = await createResearchReadSession({ orgId, jobId });   // 从库里核对调研 Job
 *   const ctx = session.forBranch({ branchKey, budget: { remaining: 12, used: 0 }, deadlineAt, allowUrl });
 *   const page = await readPublicPage(url, ctx);                         // page.untrusted === true
 * 定时任务、没有调研 Job、开关关着时 createResearchReadSession 抛错，不发任何请求。
 */

import { createResearchReadSessionWithDeps, type CreateResearchReadContextInput, type ResearchReadSession } from "./read-page";
import { loadOrgSettingsJson, loadResearchJobRow, loadTreeHistory, realClock, writeWebReadAudit } from "./db-deps";
import { createNodeNet } from "./transport";

export { readPublicPage, WebReaderContextError, WEB_READER_LIMITS, WEB_READER_USER_AGENT } from "./read-page";
export type { ReadBudget, ResearchReadContext, ResearchReadSession, TreePageCache } from "./read-page";
export type { PageReadOutcome, PageReadReason, PageReadResult, BlockedReason, ResearchJobMarker } from "./types";
export { OUTCOME_ZH, reasonMessageZh } from "./pure";
export { HUMAN_RESEARCH_TRIGGERS } from "./types";

export async function createResearchReadSession(input: CreateResearchReadContextInput): Promise<ResearchReadSession> {
  return createResearchReadSessionWithDeps(input, {
    loadJob: loadResearchJobRow,
    loadOrgSettings: loadOrgSettingsJson,
    loadTreeHistory,
    reader: { net: createNodeNet(), clock: realClock, audit: writeWebReadAudit },
  });
}
