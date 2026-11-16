/**
 * P2-3b「今日新标」早报：挂在 daily-brief（组织当地 07:00）里，每个组织一次。
 *
 * - 只对已启用采购监控的组织；暗合并闸关闭不发；
 * - 新标口径与 P2-1 新标视图相同（招标公告、未截标或未知、未忽略 / 归档 / 历史），且过去 24 小时内首次发现；
 * - 发给监控开启人与创建人（去重、仍是该组织在用成员），同一当地日期每人一条；没有新标不发；
 * - 不调模型、不发外部请求；通知照常进 COLLAB-2 每日未读汇总邮件。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { isProcurementSchemaReady } from "./flags";
import { localDateOf } from "./schedule";
import {
  NOTICE_BRIEF_CATEGORY,
  NOTICE_BRIEF_ENTITY_TYPE,
  NOTICE_BRIEF_MAX_LINES,
  NOTICE_BRIEF_TYPE,
  briefWindowStart,
  formatNoticeBrief,
  noticeBriefSourceKey,
} from "./notice-brief-pure";

export type NoticeBriefResult = {
  skipped: null | "schema_not_ready" | "watch_disabled" | "no_new_notices" | "no_recipients";
  day: string;
  total: number;
  recipients: number;
  sent: number;
};

export async function sendNoticeBrief(orgId: string, timeZone: string, opts: { now?: Date } = {}): Promise<NoticeBriefResult> {
  const now = opts.now ?? new Date();
  const day = localDateOf(now, timeZone);
  const empty = (skipped: NoticeBriefResult["skipped"], total = 0): NoticeBriefResult => ({ skipped, day, total, recipients: 0, sent: 0 });
  if (!isProcurementSchemaReady()) return empty("schema_not_ready");

  const watch = await db.procurementWatch.findFirst({ where: { orgId, enabled: true }, orderBy: { createdAt: "asc" }, select: { enabledById: true, createdById: true } });
  if (!watch) return empty("watch_disabled");

  const where = {
    orgId,
    instrumentClass: "SOLICITATION",
    triageStatus: { notIn: ["IGNORED", "ARCHIVED", "HISTORY"] },
    firstSeenAt: { gt: briefWindowStart(now), lte: now },
    OR: [{ closingAt: null }, { closingAt: { gt: now } }],
  };
  const [total, items] = await Promise.all([
    db.procurementInstrument.count({ where }),
    db.procurementInstrument.findMany({
      where,
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { firstSeenAt: "desc" }],
      take: NOTICE_BRIEF_MAX_LINES,
      select: { title: true, officialNumber: true, closingAt: true },
    }),
  ]);
  if (total === 0) return empty("no_new_notices");

  const candidates = [...new Set([watch.enabledById, watch.createdById].filter((x): x is string => !!x))];
  const active = candidates.length
    ? await db.organizationMember.findMany({ where: { orgId, userId: { in: candidates }, status: "active" }, select: { userId: true } })
    : [];
  const recipients = candidates.filter((u) => active.some((m) => m.userId === u));
  if (!recipients.length) return empty("no_recipients", total);

  const { title, summary } = formatNoticeBrief(items, total);
  let sent = 0;
  for (const userId of recipients) {
    const sourceKey = noticeBriefSourceKey(orgId, day, userId);
    const existing = await db.notification.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) continue;
    await createNotification({
      userId,
      orgId,
      type: NOTICE_BRIEF_TYPE,
      category: NOTICE_BRIEF_CATEGORY,
      title,
      summary,
      entityType: NOTICE_BRIEF_ENTITY_TYPE,
      entityId: day,
      priority: "medium",
      sourceKey,
      metadata: { day, total },
    });
    sent++;
  }
  return { skipped: null, day, total, recipients: recipients.length, sent };
}
