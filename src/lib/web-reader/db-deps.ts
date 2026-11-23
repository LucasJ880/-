/**
 * 读公开网页（TREE-1）的生产依赖：真实时钟、读调研 Job 与组织设置、写审计。
 * 只给 index.ts 与测试用（守卫测试拦住别处直接 import：别处不能伪造 research.web_read 审计、也不能绕开入口）。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  WEB_READER_LIMITS,
  WEB_READ_AUDIT_ACTION,
  type ResearchJobRow,
  type TreeHistoryRow,
  type WebReadAuditEntry,
  type WebReaderClock,
} from "./read-page";

export const realClock: WebReaderClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    }),
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
      robotsRequests: entry.robotsRequests,
      robotsFetches: entry.robotsFetches,
      site: entry.site,
      blockedSite: entry.blockedSite,
      fromCache: entry.fromCache,
    },
  });
}

/** 读调研 Job 的行（只取校验要用的四列） */
export async function loadResearchJobRow(id: string): Promise<ResearchJobRow | null> {
  return db.agentRun.findUnique({ where: { id }, select: { id: true, orgId: true, status: true, metadata: true } });
}

/** 读组织设置（站点名单的组织覆盖在 settingsJson.researchTree.sites） */
export async function loadOrgSettingsJson(orgId: string): Promise<unknown> {
  return (await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }))?.settingsJson ?? null;
}

/**
 * 这棵树过去的读页审计（按 jobId）：重建会话时恢复每支的已用额度、取 robots 次数与被挡站、数分支。
 * 多取一行：超过上限时调用方据此判为历史不可信（这棵树不再读页），不按部分历史放行。
 */
export async function loadTreeHistory(orgId: string, jobId: string): Promise<TreeHistoryRow[]> {
  const rows = await db.auditLog.findMany({
    where: { orgId, action: WEB_READ_AUDIT_ACTION, targetType: "research_job", targetId: jobId },
    select: { afterData: true },
    orderBy: { createdAt: "asc" },
    take: WEB_READER_LIMITS.HISTORY_MAX_ROWS + 1,
  });
  const out: TreeHistoryRow[] = [];
  for (const r of rows) {
    let d: unknown = r.afterData;
    if (typeof d === "string") {
      try {
        d = JSON.parse(d);
      } catch {
        d = null;
      }
    }
    const a = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    // 读不出的行也占一个位置（计入行数上限），只是不归到任何一支
    out.push({
      branchKey: typeof a.branchKey === "string" ? a.branchKey : "",
      attempts: typeof a.attempts === "number" ? a.attempts : 0,
      robotsFetches: typeof a.robotsFetches === "number" ? a.robotsFetches : 0,
      blockedSite: typeof a.blockedSite === "string" ? a.blockedSite : null,
    });
  }
  return out;
}
