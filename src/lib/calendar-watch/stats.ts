/**
 * CAL-1 期间日程来源统计取数：读账本（AuditLog），交给纯函数 summarizeCalendarAttribution。
 * 统计接口与 KPI-1 期间汇总共用。
 */

import { db } from "@/lib/db";
import { LEDGER_ACTION, parseLedgerAfterData, STATS_CAP, summarizeCalendarAttribution } from "./pure";
import type { CalendarAttributionSummary, LedgerAfterData } from "./types";

/**
 * 观察总是晚于 Google 创建 / 更新，所以按账本 createdAt ≥ 期间起点取数不漏；
 * 不设上界（观察可能滞后到期间之后）。超过 20,000 行标 truncated。
 */
export async function loadCalendarAttribution(params: {
  orgId: string;
  period: { start: Date; end: Date };
  scope: { kind: "org" } | { kind: "own"; userId: string };
}): Promise<CalendarAttributionSummary> {
  const rows = await db.auditLog.findMany({
    where: { orgId: params.orgId, action: LEDGER_ACTION, createdAt: { gte: params.period.start } },
    orderBy: { createdAt: "asc" },
    take: STATS_CAP + 1,
    select: { afterData: true },
  });
  const truncated = rows.length > STATS_CAP;
  const parsed: LedgerAfterData[] = [];
  for (const r of rows.slice(0, STATS_CAP)) {
    const a = parseLedgerAfterData(r.afterData);
    if (a) parsed.push(a);
  }
  const userIds =
    params.scope.kind === "own"
      ? [params.scope.userId]
      : [...new Set(parsed.map((r) => r.attribution.userId).filter((id): id is string => Boolean(id)))];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return summarizeCalendarAttribution({ rows: parsed, period: params.period, scope: params.scope, names, truncated });
}
