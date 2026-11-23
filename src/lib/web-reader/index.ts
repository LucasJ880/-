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
import { checkPublicUrl, normalizePageUrl } from "./pure";

export { readPublicPage, WebReaderContextError, WEB_READER_LIMITS, WEB_READER_USER_AGENT } from "./read-page";
export type { ReadBudget, ResearchReadContext, ResearchReadSession, TreePageCache } from "./read-page";
export type { PageReadOutcome, PageReadReason, PageReadResult, BlockedReason, ResearchJobMarker } from "./types";
export { OUTCOME_ZH, reasonMessageZh } from "./pure";
export { HUMAN_RESEARCH_TRIGGERS } from "./types";

/**
 * 把网址按读页层同一套规则校验并归一（TREE-2 用它比对「本支可读网址」）：读页层收不下的网址返回 null。
 * 与 readPublicPage 交给 allowUrl 的网址是同一个写法。
 */
export function normalizeReadableUrl(raw: string): string | null {
  const checked = checkPublicUrl(String(raw ?? ""));
  return checked.ok ? normalizePageUrl(checked.url) : null;
}

export async function createResearchReadSession(input: CreateResearchReadContextInput): Promise<ResearchReadSession> {
  return createResearchReadSessionWithDeps(input, {
    loadJob: loadResearchJobRow,
    loadOrgSettings: loadOrgSettingsJson,
    loadTreeHistory,
    reader: { net: createNodeNet(), clock: realClock, audit: writeWebReadAudit },
  });
}
