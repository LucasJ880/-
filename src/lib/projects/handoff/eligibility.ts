import { isDeliveryProject, isTenderProject } from "@/lib/projects/work-domain";
import type { BidDataGateResult } from "./bid-data";
import type { HandoffFailureCode, HandoffStatus } from "./types";

export type EligibilityInput = {
  workDomain: string | null | undefined;
  tenderStatus: string | null | undefined;
  orgId: string | null | undefined;
  expectedOrgId: string;
  bidData: BidDataGateResult;
  existingHandoffStatus: HandoffStatus | null;
  useHistoricalOverride: boolean;
  canOverride: boolean;
  overrideReason?: string | null;
};

export type EligibilityResult = {
  ok: boolean;
  blockers: Array<{ code: HandoffFailureCode; message: string }>;
  warnings: string[];
  requiresHistoricalOverride: boolean;
};

export function evaluateHandoffEligibility(
  input: EligibilityInput,
): EligibilityResult {
  const blockers: EligibilityResult["blockers"] = [];
  const warnings: string[] = [];

  if (isDeliveryProject(input.workDomain)) {
    blockers.push({
      code: "NOT_TENDER",
      message: "执行项目不能再次交接",
    });
  } else if (!isTenderProject(input.workDomain)) {
    blockers.push({
      code: "NOT_TENDER",
      message: "仅招投标项目（workDomain=tender）可以交接",
    });
  }

  if (String(input.tenderStatus || "").toLowerCase() !== "won") {
    blockers.push({
      code: "NOT_WON",
      message: "仅 tenderStatus=won 的中标项目可以交接",
    });
  }

  if (!input.orgId || input.orgId !== input.expectedOrgId) {
    blockers.push({
      code: "ORG_MISMATCH",
      message: "项目不属于当前企业",
    });
  }

  if (input.existingHandoffStatus === "completed") {
    blockers.push({
      code: "ALREADY_COMPLETED",
      message: "该中标项目已完成交接，不会重复创建执行项目",
    });
  }

  if (input.existingHandoffStatus === "processing") {
    blockers.push({
      code: "IN_PROGRESS",
      message: "交接正在处理中，请稍后再查看",
    });
  }

  let requiresHistoricalOverride = false;
  if (input.bidData.hasRevisions) {
    if (!input.bidData.ready) {
      blockers.push({
        code: "BID_DATA_INCOMPLETE",
        message: input.bidData.message || "Bid Data 审批/锁定未完成",
      });
    }
  } else {
    requiresHistoricalOverride = true;
    warnings.push("无完整 Bid Data Layer，需管理层历史项目交接 override");
    if (!input.useHistoricalOverride) {
      blockers.push({
        code: "OVERRIDE_REQUIRED",
        message: "历史项目交接需要明确 override 并填写原因",
      });
    } else if (!input.canOverride) {
      blockers.push({
        code: "OVERRIDE_FORBIDDEN",
        message: "普通投标人员不得使用历史项目交接 override",
      });
    } else if (!input.overrideReason?.trim()) {
      blockers.push({
        code: "OVERRIDE_REQUIRED",
        message: "使用历史项目交接必须填写 override reason",
      });
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    requiresHistoricalOverride,
  };
}
