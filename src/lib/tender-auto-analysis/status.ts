/**
 * TenderAnalysisRun 状态机 — 纯函数，禁止 API/UI 散落硬编码。
 */

import {
  CLAIMABLE_STATUSES,
  TERMINAL_STATUSES,
  type TenderAnalysisStatus,
} from "./constants";
import { InvalidTransitionError } from "./errors";

export const ALLOWED_TRANSITIONS: Record<
  TenderAnalysisStatus,
  readonly TenderAnalysisStatus[]
> = {
  PENDING: ["EXTRACTING", "FAILED", "SUPERSEDED"],
  EXTRACTING: ["ANALYZING", "FAILED", "SUPERSEDED"],
  ANALYZING: ["REVIEW_REQUIRED", "FAILED", "SUPERSEDED"],
  REVIEW_REQUIRED: ["APPROVED", "FAILED", "SUPERSEDED"],
  APPROVED: ["SUPERSEDED"],
  // Worker 重试可直接 FAILED → EXTRACTING；也可经 PENDING 人工重置
  FAILED: ["PENDING", "EXTRACTING", "SUPERSEDED"],
  SUPERSEDED: [],
};

export function canTransition(
  from: TenderAnalysisStatus,
  to: TenderAnalysisStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(
  from: TenderAnalysisStatus,
  to: TenderAnalysisStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: TenderAnalysisStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type ClaimLeaseInput = {
  status: TenderAnalysisStatus;
  leaseExpiresAt?: Date | string | null;
  nextAttemptAt?: Date | string | null;
};

function toTime(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Cron 是否可认领该 Run。
 * - 终态 / REVIEW_REQUIRED：不可认领
 * - nextAttemptAt 未到：不可认领
 * - PENDING / FAILED：可认领
 * - EXTRACTING / ANALYZING：仅租约过期或无租约时可认领（重入）
 */
export function canClaim(input: ClaimLeaseInput, now: Date = new Date()): boolean {
  const { status } = input;
  if (isTerminal(status)) return false;
  if (status === "REVIEW_REQUIRED") return false;
  if (!(CLAIMABLE_STATUSES as readonly string[]).includes(status)) {
    return false;
  }

  const nextAt = toTime(input.nextAttemptAt);
  if (nextAt != null && nextAt > now.getTime()) return false;

  if (status === "PENDING" || status === "FAILED") return true;

  const leaseExp = toTime(input.leaseExpiresAt);
  if (leaseExp == null) return true;
  return leaseExp <= now.getTime();
}
