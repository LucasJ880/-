/**
 * CAL-2：判断一个 Google 事件是否由"网站预约转入"建成青砚预约。
 *
 * 这类预约以 Google 共享日历为准（CAL-1 继续观察）：青砚侧的修改 / 取消 / 删除不回写 Google，
 * 否则会用青砚模板覆盖网站预约原文，或把共享日历里的预约删掉。appointment-gcal-sync 据此跳过同步。
 */
import { db } from "@/lib/db";
import { CONVERT_ACTION } from "./intake-pure";
import { LEDGER_TARGET_TYPE } from "./pure";

export async function isWebsiteBookingEvent(googleEventId: string): Promise<boolean> {
  const row = await db.auditLog.findFirst({
    where: { action: CONVERT_ACTION, targetType: LEDGER_TARGET_TYPE, targetId: googleEventId },
    select: { id: true },
  });
  return Boolean(row);
}
