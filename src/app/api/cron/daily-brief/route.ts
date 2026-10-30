/**
 * GET /api/cron/daily-brief
 *
 * 每日主动简报 Cron：
 * 为所有活跃组织的成员生成当日简报 →
 * 写入 Notification + 置顶「每日简报」对话线程 + 微信推送（既有链路）。
 *
 * 调度：每小时唤醒，只处理当地时间 07:00 的组织（组织时区 settingsJson.timezone，默认多伦多）。
 * 同一时刻把前一个展会日的展会小结发给管理层（当天没录速记卡的组织不发）；
 * 随后发老板询盘早报（今日新询盘 / 超时 / 待审批 / 样品报价到期；四栏全为 0 或未启用外贸模块不发）。
 * 每个组织的结果里：ownerBriefSent = 新写入的青砚通知数，ownerBriefWechatDelivered = 微信实际送达人数，
 * ownerBriefSkipped = 没发的原因（no_trade_module：modulesJson.enabled 未显式含 trade；empty：四栏全为 0）。
 * INSTALL-2f：同一时刻对该组织过了目标日、没人推进的维修单发返修逾期提醒（repairOverdueSent = 提醒的维修单数；
 * 独立一步，失败不影响简报与其他组织；不新增 cron 条目）。
 * A-5：同一定时任务里，在简报之后对处于当地 00:00 / 01:00（补一次）的组织为前一个本地日写岗位日结
 * （审计 cockpit.post_daily_digest，只含计数，同日幂等），作为自动化 post-daily-digest 另记一次运行；
 * 单个组织失败不影响其他组织，日结异常不影响简报。两组都没有组织到点才 skipped。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { orgsAtLocalHour } from "@/lib/automation/registry";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { generateBriefingsForOrg } from "@/lib/secretary/briefing";
import { boothDayOf, sendBoothSummary } from "@/lib/trade/booth-summary";
import { sendOwnerInquiryBrief } from "@/lib/revenue-spine/owner-brief";
import { remindOverdueRepairs } from "@/lib/install/repair-service";
import { runPostDailyDigests } from "@/lib/cockpit/daily-digest";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const now = new Date();
  const activeOrgs = await db.organization.findMany({
    where: { status: "active" },
    select: { id: true, name: true, ownerId: true, settingsJson: true },
  });
  const orgs = orgsAtLocalHour(activeOrgs, now, [7]);
  const digestOrgs = orgsAtLocalHour(activeOrgs, now, [0, 1]);
  if (orgs.length === 0 && digestOrgs.length === 0) {
    return NextResponse.json({ skipped: true, reason: "没有组织处于当地 07:00、00:00 或 01:00", checkedAt: now.toISOString() });
  }

  // 岗位日结：排在简报之后；逐组织收错，整段异常也收住（01:00 会补一次）
  const runPostDailyDigest = () =>
    runTrackedAutomation("post-daily-digest", () => runPostDailyDigests(digestOrgs, now)).catch((e) => {
      console.error("[cron/daily-brief] Post daily digest failed:", e);
      return { error: String(e) };
    });
  if (orgs.length === 0) {
    return NextResponse.json({ skipped: true, reason: "没有组织处于当地 07:00", checkedAt: now.toISOString(), postDailyDigest: await runPostDailyDigest() });
  }

  type OwnerBriefFields = { ownerBriefSent?: number; ownerBriefWechatDelivered?: number; ownerBriefSkipped?: string | null };
  const data = await runTrackedAutomation("daily-brief", async () => {
    const results: Array<
      { orgId: string; orgName: string; generated?: number; boothSummarySent?: number; repairOverdueSent?: number; error?: string } & OwnerBriefFields
    > = [];

    for (const org of orgs) {
      let boothSummarySent: number | undefined;
      let repairOverdueSent: number | undefined;
      let owner: OwnerBriefFields = {};
      try {
        // 07:xx 往前一小时就是刚结束的展会日（07:00 到次日 07:00）
        const day = boothDayOf(new Date(now.getTime() - 3_600_000), org.timezone);
        boothSummarySent = (await sendBoothSummary(org.id, day, org.timezone)).sent;
      } catch (e) {
        console.error(`[cron/daily-brief] Booth summary failed for org ${org.name}:`, e);
      }
      try {
        const brief = await sendOwnerInquiryBrief(org.id, org.timezone, { now });
        owner = { ownerBriefSent: brief.sent, ownerBriefWechatDelivered: brief.wechatDelivered, ownerBriefSkipped: brief.skipped };
      } catch (e) {
        console.error(`[cron/daily-brief] Owner inquiry brief failed for org ${org.name}:`, e);
      }
      try {
        repairOverdueSent = (await remindOverdueRepairs(org.id, org.timezone, now)).repairs;
      } catch (e) {
        console.error(`[cron/daily-brief] Repair overdue reminder failed for org ${org.name}:`, e);
      }
      try {
        const count = await generateBriefingsForOrg(org.id);
        results.push({ orgId: org.id, orgName: org.name, generated: count, boothSummarySent, repairOverdueSent, ...owner });
      } catch (e) {
        console.error(`[cron/daily-brief] Failed for org ${org.name}:`, e);
        results.push({ orgId: org.id, orgName: org.name, error: String(e), boothSummarySent, repairOverdueSent, ...owner });
      }
    }

    const failedCount = results.filter((result) => result.error).length;
    return {
      data: { generatedAt: new Date().toISOString(), orgs: results },
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
    };
  });
  return NextResponse.json(digestOrgs.length ? { ...data, postDailyDigest: await runPostDailyDigest() } : data);
}
