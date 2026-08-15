/**
 * T2-P1.6 成本阶段推导 —— PRE_AWARD（投标期）vs POST_AWARD（交付期）
 *
 * 设计前提（任务书 §8：「不要为了一个报表新建第二套 project phase」）：
 *   `ProjectCost` 没有 phase 列，本模块也**不新增**任何 phase 列 / phase 表 / phase 状态机。
 *   阶段一律在**读时**由既有 canonical 字段推导，单一函数、单一口径。
 *
 * 边界来源优先级（boundarySource，全部是既有事实）：
 *   1. `delivery`   —— workDomain=delivery 的项目本身就是「中标后交付项目」，其上全部成本 = POST_AWARD；
 *                      该项目的投标期成本在 sourceTenderProjectId 指向的投标项目上（跨项目归集见 profitability.ts）
 *   2. `handoff`    —— 已完成的 ProjectHandoff.completedAt（中标→交付交接实际发生时刻，最强信号）
 *   3. `awardDate`  —— 仅当项目 award-eligible 时才采用（awardDate 对 LOST 项目也可能非空，
 *                      单独使用会把落标项目的成本错分成交付成本）
 *   4. `none`       —— 无可用边界：**全部计入 PRE_AWARD**，并置 phaseSplitAvailable=false，
 *                      由调用方如实上报「无法切分」，而不是猜一个边界
 *
 * 落标项目（LOST）永远没有边界 → 全部成本 = 投标成本（TENDER-COST-01）。
 */
import type { CostPhase } from "./types";
import { isProjectAwardEligible } from "./types";

export type PhaseBoundarySource = "delivery" | "handoff" | "awardDate" | "none";

export interface CostPhaseBoundary {
  /** 该时刻（含）及之后的成本 = POST_AWARD；null = 无边界 */
  boundaryAt: Date | null;
  source: PhaseBoundarySource;
  /** false = 该项目无法做投标/交付切分，全部按 PRE_AWARD 计入并如实标注 */
  phaseSplitAvailable: boolean;
  /** true = 该项目的全部成本恒为 POST_AWARD（交付项目） */
  allPostAward: boolean;
}

export interface PhaseInputProject {
  workDomain?: string | null;
  bidPhaseStatus?: string | null;
  tenderStatus?: string | null;
  awardDate?: Date | null;
}

/**
 * 解析项目的阶段边界。
 * `handoffCompletedAt` 由调用方从 ProjectHandoff 读入（本模块不查库，保持可纯测）。
 */
export function resolveCostPhaseBoundary(
  project: PhaseInputProject,
  handoffCompletedAt?: Date | null,
): CostPhaseBoundary {
  if (project.workDomain === "delivery") {
    return {
      boundaryAt: null,
      source: "delivery",
      phaseSplitAvailable: true,
      allPostAward: true,
    };
  }
  if (handoffCompletedAt) {
    return {
      boundaryAt: handoffCompletedAt,
      source: "handoff",
      phaseSplitAvailable: true,
      allPostAward: false,
    };
  }
  // awardDate 只在「我方确实中标」时才是有效边界（LOST 也可能有 awardDate = 结果公布日）
  if (isProjectAwardEligible(project) && project.awardDate) {
    return {
      boundaryAt: project.awardDate,
      source: "awardDate",
      phaseSplitAvailable: true,
      allPostAward: false,
    };
  }
  return {
    boundaryAt: null,
    source: "none",
    phaseSplitAvailable: false,
    allPostAward: false,
  };
}

/** 单条成本的阶段判定（incurredAt 相对边界）。 */
export function resolveCostPhase(boundary: CostPhaseBoundary, incurredAt: Date): CostPhase {
  if (boundary.allPostAward) return "POST_AWARD";
  if (!boundary.boundaryAt) return "PRE_AWARD";
  return incurredAt.getTime() >= boundary.boundaryAt.getTime() ? "POST_AWARD" : "PRE_AWARD";
}
