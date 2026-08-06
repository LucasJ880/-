/**
 * Phase 1.1 Tender Auto Analysis — 类型化错误
 */

import type { TenderAnalysisStatus } from "./constants";

export type TenderAnalysisErrorCode =
  | "INVALID_TRANSITION"
  | "GATE_CLOSED"
  | "IDEMPOTENCY_CONFLICT"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_CLAIMABLE"
  | "ORG_MISMATCH"
  | "FORBIDDEN"
  | "INVALID_INPUT";

export class TenderAnalysisError extends Error {
  constructor(
    message: string,
    public code: TenderAnalysisErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TenderAnalysisError";
  }
}

export class InvalidTransitionError extends TenderAnalysisError {
  constructor(from: TenderAnalysisStatus, to: TenderAnalysisStatus) {
    super(`不允许的状态流转：${from} → ${to}`, "INVALID_TRANSITION", {
      from,
      to,
    });
    this.name = "InvalidTransitionError";
  }
}

export class GateClosedError extends TenderAnalysisError {
  constructor(message = "项目不满足自动分析触发条件") {
    super(message, "GATE_CLOSED");
    this.name = "GateClosedError";
  }
}

export class RunNotClaimableError extends TenderAnalysisError {
  constructor(runId: string, status: string) {
    super(`Run 不可认领：${runId} (${status})`, "RUN_NOT_CLAIMABLE", {
      runId,
      status,
    });
    this.name = "RunNotClaimableError";
  }
}
