/**
 * 审核相关纯函数（无 DB 依赖，可供单测）
 */

import type { TenderAnalysisStatus } from "./constants";
import { assertTransition, canTransition } from "./status";

/** 纯函数：是否允许批准 */
export function canApproveRun(status: TenderAnalysisStatus | string): boolean {
  return canTransition(status as TenderAnalysisStatus, "APPROVED");
}

export function assertCanApprove(status: TenderAnalysisStatus | string): void {
  assertTransition(status as TenderAnalysisStatus, "APPROVED");
}
