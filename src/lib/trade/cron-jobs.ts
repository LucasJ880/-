/**
 * Trade 外贸获客 — 定时任务
 *
 * 可通过 Vercel Cron 或外部调度器每日调用一次
 * 任务：
 * 1. 跟进提醒 — 标记逾期线索、生成汇总
 * 2. 报价过期 — 自动标记过期报价
 * 3. 无回复检测 — 发出后 7 天无回复的线索标记为 no_response
 */

import { db } from "@/lib/db";
import { logActivity } from "./activity-log";
import { runWatchTargetsCron } from "./watch-service";

export interface CronResult {
  overdueFollowUps: number;
  expiredQuotes: number;
  noResponseProspects: number;
  watchChecked: number;
  watchSignalsCreated: number;
  /** 同 target + signalType 在 24h 冷却内已存在信号，本次未新建 */
  watchSignalsSuppressed: number;
  watchFetchErrors: number;
  timestamp: string;
}

export async function runDailyCron(): Promise<CronResult> {
  const now = new Date();
  const result: CronResult = {
    overdueFollowUps: 0,
    expiredQuotes: 0,
    noResponseProspects: 0,
    watchChecked: 0,
    watchSignalsCreated: 0,
    watchSignalsSuppressed: 0,
    watchFetchErrors: 0,
    timestamp: now.toISOString(),
  };

  // ── 1. Overdue follow-ups ──
  const overdueProspects = await db.tradeProspect.findMany({
    where: {
      nextFollowUpAt: { lt: now },
      stage: { notIn: ["won", "lost", "unqualified", "new", "no_response"] },
    },
    select: { id: true, companyName: true, orgId: true, campaignId: true },
  });
  result.overdueFollowUps = overdueProspects.length;

  if (overdueProspects.length > 0) {
    for (const p of overdueProspects.slice(0, 5)) {
      await logActivity({
        orgId: p.orgId,
        campaignId: p.campaignId,
        prospectId: p.id,
        action: "overdue_reminder",
        detail: `${p.companyName} 跟进已逾期`,
      });
    }

    if (overdueProspects.length > 0) {
      await logActivity({
        orgId: overdueProspects[0].orgId,
        action: "daily_cron",
        detail: `每日检查: ${overdueProspects.length} 条线索跟进已逾期`,
      });
    }
  }

  // ── 2. Expired quotes ──
  const expiredQuotes = await db.tradeQuote.updateMany({
    where: {
      status: { in: ["draft", "sent"] },
      expiresAt: { lt: now },
    },
    data: { status: "expired" },
  });
  result.expiredQuotes = expiredQuotes.count;

  // ── 3. No-response detection (7 days after outreach) ──
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const noResponseProspects = await db.tradeProspect.findMany({
    where: {
      stage: "outreach_sent",
      outreachSentAt: { lt: sevenDaysAgo },
    },
    select: { id: true },
  });

  if (noResponseProspects.length > 0) {
    await db.tradeProspect.updateMany({
      where: { id: { in: noResponseProspects.map((p) => p.id) } },
      data: { stage: "no_response" },
    });
    result.noResponseProspects = noResponseProspects.length;
  }

  // ── 4. P1-alpha：页面监控（低频批量，与 research 无关）──
  try {
    const w = await runWatchTargetsCron();
    result.watchChecked = w.checked;
    result.watchSignalsCreated = w.signalsCreated;
    result.watchSignalsSuppressed = w.signalsSuppressed;
    result.watchFetchErrors = w.fetchErrors;
  } catch (e) {
    console.error("[cron] watch targets:", e);
  }

  return result;
}
