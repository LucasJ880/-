/**
 * bidPhaseStatus 状态转换 — 集中在 domain，禁止 API/UI 散落硬编码。
 */

import {
  BID_PHASE_STATUSES,
  type BidPhaseStatus,
  isBidPhaseStatus,
} from "./constants";

/** 人工决策与后续推进态：start 调查不得回退覆盖 */
export const PROTECTED_BID_PHASES = [
  "GO",
  "HOLD",
  "NO_GO",
  "BID_PREPARATION",
  "SUBMITTED",
  "AWARDED",
  "LOST",
  "WITHDRAWN",
] as const;

export type ProtectedBidPhase = (typeof PROTECTED_BID_PHASES)[number];

/** 允许被 start 推进到 INTELLIGENCE_IN_PROGRESS 的前置态 */
export const START_ADVANCEABLE_BID_PHASES = [
  "DISCOVERED",
  "INTAKE_INCOMPLETE",
  "READY_FOR_QUALIFICATION",
] as const;

export function isProtectedBidPhase(
  status: string | null | undefined,
): status is ProtectedBidPhase {
  return (
    !!status &&
    (PROTECTED_BID_PHASES as readonly string[]).includes(status)
  );
}

export function isStartAdvanceableBidPhase(
  status: string | null | undefined,
): boolean {
  if (status == null || status === "") return true;
  return (START_ADVANCEABLE_BID_PHASES as readonly string[]).includes(status);
}

export type IntelligenceStartPhaseResolution = {
  /** 事务结束后应呈现的阶段 */
  bidPhaseStatus: BidPhaseStatus | string;
  /** 是否需要写回 Project.bidPhaseStatus */
  shouldWrite: boolean;
  /** 是否由 start 新推进到调查中 */
  advancedToIntelligence: boolean;
};

/**
 * 解析「确认进入投标调查」对 bidPhaseStatus 的影响。
 * - 空 / 准备态 → 可推进到 INTELLIGENCE_IN_PROGRESS
 * - 已在调查中 → 不写（保持）
 * - GO/HOLD/NO_GO 及后续态 → 绝不回退
 * - 未知非保护态 → 保守不覆盖
 */
export function resolveBidPhaseOnIntelligenceStart(
  current: string | null | undefined,
): IntelligenceStartPhaseResolution {
  const cur = current?.trim() || null;

  if (cur == null) {
    return {
      bidPhaseStatus: "INTELLIGENCE_IN_PROGRESS",
      shouldWrite: true,
      advancedToIntelligence: true,
    };
  }

  if (isProtectedBidPhase(cur)) {
    return {
      bidPhaseStatus: cur,
      shouldWrite: false,
      advancedToIntelligence: false,
    };
  }

  if (cur === "INTELLIGENCE_IN_PROGRESS") {
    return {
      bidPhaseStatus: cur,
      shouldWrite: false,
      advancedToIntelligence: false,
    };
  }

  if (isStartAdvanceableBidPhase(cur)) {
    return {
      bidPhaseStatus: "INTELLIGENCE_IN_PROGRESS",
      shouldWrite: true,
      advancedToIntelligence: true,
    };
  }

  // 未知字符串：不覆盖，避免误回退
  return {
    bidPhaseStatus: isBidPhaseStatus(cur) ? cur : cur,
    shouldWrite: false,
    advancedToIntelligence: false,
  };
}

export function assertKnownBidPhasesComplete(): void {
  const covered = new Set<string>([
    ...START_ADVANCEABLE_BID_PHASES,
    "INTELLIGENCE_IN_PROGRESS",
    ...PROTECTED_BID_PHASES,
  ]);
  for (const s of BID_PHASE_STATUSES) {
    if (!covered.has(s)) {
      throw new Error(`bidPhaseStatus ${s} missing from transition sets`);
    }
  }
}
