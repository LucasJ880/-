/**
 * W-2b：GET tender-rfq-settings 里「询价节奏」三项的读法（服务端用）
 *
 * 生效值直接用系统本来的读取函数——回复提前量 / 轮次锁天数走 readTenderRfqSettings，催单天数走 resolveChaseAfterDays
 * （只看组织层，个人偏好不属于组织设置）——所以页面显示的就是建轮次、催单扫描此刻会用的值。
 * stored = 库里存的那个值正是生效值（存了但读取不认的坏值算没存）。
 */

import { DEFAULT_CHASE_AFTER_DAYS, resolveChaseAfterDays } from "./chase-pure";
import type { RfqTimingKey } from "./landed-cost";
import { readTenderRfqSettings } from "./round-pure";
import { TENDER_RFQ_DEFAULTS } from "./types";

export type RfqTimingValues = Record<RfqTimingKey, number>;

export const RFQ_TIMING_DEFAULTS: RfqTimingValues = {
  replyLeadDays: TENDER_RFQ_DEFAULTS.replyLeadDays,
  roundLockDays: TENDER_RFQ_DEFAULTS.roundLockDays,
  chaseAfterDays: DEFAULT_CHASE_AFTER_DAYS,
};

export function readRfqTimingView(settingsJson: unknown): {
  timing: RfqTimingValues;
  timingDefaults: RfqTimingValues;
  stored: Record<RfqTimingKey, boolean>;
} {
  const rfq = readTenderRfqSettings(settingsJson);
  const timing: RfqTimingValues = {
    replyLeadDays: rfq.replyLeadDays,
    roundLockDays: rfq.roundLockDays,
    chaseAfterDays: resolveChaseAfterDays(null, settingsJson),
  };
  const raw = ((settingsJson as { tenderRfq?: Record<string, unknown> } | null)?.tenderRfq ?? {}) as Record<string, unknown>;
  return {
    timing,
    timingDefaults: { ...RFQ_TIMING_DEFAULTS },
    stored: {
      replyLeadDays: raw.replyLeadDays === timing.replyLeadDays,
      roundLockDays: raw.roundLockDays === timing.roundLockDays,
      chaseAfterDays: raw.chaseAfterDays === timing.chaseAfterDays,
    },
  };
}
