import type { BidPhaseStatus } from "./constants";
import { BID_PHASE_STATUSES } from "./constants";

/**
 * 项目列表投标阶段筛选项（统一分桶，禁止页面硬编码）
 *
 * - 准备投标：发现/资料/资格 + HOLD
 * - 调查中：INTELLIGENCE_IN_PROGRESS
 * - 投标进行中：GO + BID_PREPARATION
 * - 未中标：LOST + NO_GO + WITHDRAWN
 */
export const BID_LIST_FILTERS = [
  { key: "all", label: "全部项目", statuses: null as BidPhaseStatus[] | null },
  {
    key: "prep",
    label: "准备投标",
    statuses: [
      "DISCOVERED",
      "INTAKE_INCOMPLETE",
      "READY_FOR_QUALIFICATION",
      "HOLD",
    ] as BidPhaseStatus[],
  },
  {
    key: "investigating",
    label: "调查中",
    statuses: ["INTELLIGENCE_IN_PROGRESS"] as BidPhaseStatus[],
  },
  {
    key: "bidding",
    label: "投标进行中",
    statuses: ["GO", "BID_PREPARATION"] as BidPhaseStatus[],
  },
  {
    key: "submitted",
    label: "已提交",
    statuses: ["SUBMITTED"] as BidPhaseStatus[],
  },
  {
    key: "awarded",
    label: "已中标",
    statuses: ["AWARDED"] as BidPhaseStatus[],
  },
  {
    key: "lost",
    label: "未中标",
    statuses: ["LOST", "NO_GO", "WITHDRAWN"] as BidPhaseStatus[],
  },
] as const;

export type BidListFilterKey = (typeof BID_LIST_FILTERS)[number]["key"];

export function isBidListFilterKey(v: string | null): v is BidListFilterKey {
  return !!v && BID_LIST_FILTERS.some((f) => f.key === v);
}

export function bidListFilterStatuses(
  key: BidListFilterKey,
): BidPhaseStatus[] | null {
  const found = BID_LIST_FILTERS.find((f) => f.key === key);
  return found?.statuses ?? null;
}

/** 所有已知状态必须落入某一筛选项（all 除外） */
export function assertBidFilterCoverage(): void {
  const covered = new Set<string>();
  for (const f of BID_LIST_FILTERS) {
    if (!f.statuses) continue;
    for (const s of f.statuses) covered.add(s);
  }
  for (const s of BID_PHASE_STATUSES) {
    if (!covered.has(s)) {
      throw new Error(`bidPhaseStatus ${s} missing from BID_LIST_FILTERS`);
    }
  }
}

const PHASE_LABELS: Record<BidPhaseStatus, string> = {
  DISCOVERED: "已发现",
  INTAKE_INCOMPLETE: "资料未齐",
  READY_FOR_QUALIFICATION: "待资格评估",
  INTELLIGENCE_IN_PROGRESS: "调查中",
  GO: "GO",
  HOLD: "HOLD",
  NO_GO: "NO-GO",
  BID_PREPARATION: "投标准备中",
  SUBMITTED: "已提交",
  AWARDED: "已中标",
  LOST: "未中标",
  WITHDRAWN: "已撤回",
};

export function bidPhaseLabel(status: string | null | undefined): string {
  if (!status) return "未启动";
  if ((BID_PHASE_STATUSES as readonly string[]).includes(status)) {
    return PHASE_LABELS[status as BidPhaseStatus];
  }
  return status;
}

export function goDecisionLabel(d: string | null | undefined): string {
  if (!d) return "未决定";
  if (d === "GO") return "GO";
  if (d === "HOLD") return "HOLD";
  if (d === "NO_GO") return "NO-GO";
  return d;
}
