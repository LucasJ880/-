/**
 * FR1：Run 执行声明的**纯**读取与分类。
 *
 * 单独成模块的原因：采购工作台的客户端组件要按执行态渲染「继续执行 / 取消 / 只能新建」，
 * 而 run-service 依赖 db（server-only）。客户端 import 会把 node:crypto 拖进浏览器包
 * （S3-A 已经踩过一次，只有 build 抓得到）。这里保持零依赖，服务端与客户端共用同一份判定。
 *
 * 注意：客户端算出来的执行态只用于**渲染**；每个写操作仍在服务端独立裁决。
 */

import { isRunTerminal } from "./constants";

export interface RunExecutionClaim {
  /** FR1-A：每次认领唯一。同一个人的两次执行也是两个不同的 owner。 */
  claimId: string;
  claimedAt: string;
  expiresAt: string;
  byUserId: string;
}

/** 解析出声明本体（不判断是否过期）——恢复策略需要看到已过期的声明 */
export function readExecutionClaimRecord(statusDetail: unknown): RunExecutionClaim | null {
  if (typeof statusDetail !== "object" || statusDetail === null || Array.isArray(statusDetail)) {
    return null;
  }
  const raw = (statusDetail as { executionClaim?: unknown }).executionClaim;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const c = raw as {
    claimId?: unknown;
    claimedAt?: unknown;
    expiresAt?: unknown;
    byUserId?: unknown;
  };
  if (
    typeof c.claimId !== "string" ||
    c.claimId.length === 0 ||
    typeof c.expiresAt !== "string" ||
    typeof c.claimedAt !== "string" ||
    typeof c.byUserId !== "string"
  ) {
    return null;
  }
  if (!Number.isFinite(Date.parse(c.expiresAt))) return null;
  return {
    claimId: c.claimId,
    claimedAt: c.claimedAt,
    expiresAt: c.expiresAt,
    byUserId: c.byUserId,
  };
}

/** 仍然有效（未过期）的执行声明；过期返回 null */
export function readActiveExecutionClaim(
  statusDetail: unknown,
  now: Date,
): RunExecutionClaim | null {
  const claim = readExecutionClaimRecord(statusDetail);
  if (!claim) return null;
  return Date.parse(claim.expiresAt) > now.getTime() ? claim : null;
}

/**
 * 该 Run 现在处于什么执行态：
 *   IDLE              — 没有在跑，可以（继续）执行
 *   IN_PROGRESS       — 有未过期声明，正在跑
 *   RECOVERY_REQUIRED — 声明已过期且从未正常释放：上一次执行**结果未知**（FR1-C）
 *   TERMINAL          — 终态，不可重入；重搜 = 新建 Run
 */
export type RunExecutionState = "IDLE" | "IN_PROGRESS" | "RECOVERY_REQUIRED" | "TERMINAL";

export function classifyRunExecutionState(
  run: { status: string; statusDetailJson: unknown },
  now: Date,
): RunExecutionState {
  if (isRunTerminal(run.status)) return "TERMINAL";
  const claim = readExecutionClaimRecord(run.statusDetailJson);
  if (!claim) return "IDLE";
  return Date.parse(claim.expiresAt) > now.getTime() ? "IN_PROGRESS" : "RECOVERY_REQUIRED";
}
