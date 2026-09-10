/**
 * FR1：Run 执行声明的**纯**读取与分类。
 *
 * 单独成模块的原因：采购工作台的客户端组件要按执行态渲染「继续执行 / 取消 / 只能新建」，
 * 而 run-service 依赖 db（server-only）。客户端 import 会把 node:crypto 拖进浏览器包
 * （S3-A 已经踩过一次，只有 build 抓得到）。这里保持零依赖，服务端与客户端共用同一份判定。
 *
 * 注意：客户端算出来的执行态只用于**渲染**；每个写操作仍在服务端独立裁决。
 *
 * ── 核心不变量（FR1 最终收口）────────────────────────────────
 *
 *     「无法证明 Run 安全空闲」 ≠ 「Run 空闲」
 *
 * 因此**必须**把这两件事分开：
 *   - `statusDetailJson` 里压根没有 executionClaim 这个键  → 真空闲，可以认领；
 *   - 键在、但值不可验证（旧格式缺 claimId / 时间戳非法 / 类型不对）
 *       → **不可判定**：有人在这个 Run 上执行过，而我们无法证明它已经停手。
 *
 * 早期实现把后者也解析成 `null`，于是「解析失败」被当成「没有声明」，
 * 新的 executor 就能直接认领——这正好绕开了 no-takeover 想守的那条线。
 * 修法是引入 marker 三态，并且**只**在 NO_CLAIM 时才允许认领。
 */

import { isRunTerminal } from "./constants";

export interface RunExecutionClaim {
  /** FR1-A：每次认领唯一。同一个人的两次执行也是两个不同的 owner。 */
  claimId: string;
  claimedAt: string;
  expiresAt: string;
  byUserId: string;
}

/** 声明为什么不可验证——写进错误信息/审计，便于人判断这是旧数据还是被改过 */
export type InvalidClaimReason =
  | "NOT_AN_OBJECT"
  | "MISSING_CLAIM_ID"
  | "EMPTY_CLAIM_ID"
  | "MISSING_TIMESTAMPS"
  | "INVALID_EXPIRES_AT"
  | "MISSING_USER";

/**
 * 三态标记。`raw` 一律带上原值：整块重写 statusDetailJson 时要**原样**搬运它，
 * 否则一次工作数据写入就能把不可验证的声明洗成「没有声明」。
 */
export type ExecutionClaimMarker =
  | { kind: "NO_CLAIM" }
  | { kind: "VALID_CLAIM"; claim: RunExecutionClaim; raw: unknown }
  | { kind: "INVALID_CLAIM"; raw: unknown; reason: InvalidClaimReason };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaim(
  raw: unknown,
): { ok: true; claim: RunExecutionClaim } | { ok: false; reason: InvalidClaimReason } {
  if (!isPlainObject(raw)) return { ok: false, reason: "NOT_AN_OBJECT" };
  const c = raw as {
    claimId?: unknown;
    claimedAt?: unknown;
    expiresAt?: unknown;
    byUserId?: unknown;
  };
  // 旧格式（claimedAt/expiresAt/byUserId，无 claimId）走这里 → 不可验证，不是「空闲」
  if (typeof c.claimId !== "string") return { ok: false, reason: "MISSING_CLAIM_ID" };
  if (c.claimId.length === 0) return { ok: false, reason: "EMPTY_CLAIM_ID" };
  if (typeof c.expiresAt !== "string" || typeof c.claimedAt !== "string") {
    return { ok: false, reason: "MISSING_TIMESTAMPS" };
  }
  if (typeof c.byUserId !== "string") return { ok: false, reason: "MISSING_USER" };
  if (!Number.isFinite(Date.parse(c.expiresAt))) return { ok: false, reason: "INVALID_EXPIRES_AT" };
  return {
    ok: true,
    claim: {
      claimId: c.claimId,
      claimedAt: c.claimedAt,
      expiresAt: c.expiresAt,
      byUserId: c.byUserId,
    },
  };
}

/**
 * 判定 statusDetailJson 上的执行声明标记。
 *
 * 判「有没有」用的是**结构化的自有属性检查**（`hasOwnProperty`），不是字符串搜索：
 * 后者会被别处随便一个含 "executionClaim" 字样的文本骗到。
 */
export function readExecutionClaimMarker(statusDetail: unknown): ExecutionClaimMarker {
  // statusDetailJson 本身不是对象（null / 数组 / 标量）→ 不可能挂着声明键
  if (!isPlainObject(statusDetail)) return { kind: "NO_CLAIM" };
  if (!Object.prototype.hasOwnProperty.call(statusDetail, "executionClaim")) {
    return { kind: "NO_CLAIM" };
  }
  const raw = statusDetail.executionClaim;
  const parsed = parseClaim(raw);
  if (parsed.ok) return { kind: "VALID_CLAIM", claim: parsed.claim, raw };
  return { kind: "INVALID_CLAIM", raw, reason: parsed.reason };
}

/**
 * 解析出**可验证**的声明本体（不判断是否过期）——恢复策略需要看到已过期的声明。
 *
 * 注意语义：返回 `null` 只代表「拿不到可验证的声明」，**不代表 Run 空闲**。
 * 要判断能不能认领，用 `readExecutionClaimMarker` / `classifyRunExecutionState`。
 */
export function readExecutionClaimRecord(statusDetail: unknown): RunExecutionClaim | null {
  const marker = readExecutionClaimMarker(statusDetail);
  return marker.kind === "VALID_CLAIM" ? marker.claim : null;
}

/** 仍然有效（未过期）的执行声明；过期或不可验证都返回 null */
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
 *   IDLE              — 没有任何声明标记，可以（继续）执行
 *   IN_PROGRESS       — 声明可验证且未过期，正在跑
 *   RECOVERY_REQUIRED — 声明可验证但已过期（上一次执行结果未知），
 *                       **或**声明标记存在却不可验证（旧格式 / 被改过 / 类型不对）
 *   TERMINAL          — 终态，不可重入；重搜 = 新建 Run
 *
 * 对用户来说后两种是同一件事：「上一次执行没有正常结束，结果无法确认」，
 * 出路都是取消后新建。所以不引入第五种用户可见状态。
 */
export type RunExecutionState = "IDLE" | "IN_PROGRESS" | "RECOVERY_REQUIRED" | "TERMINAL";

export function classifyRunExecutionState(
  run: { status: string; statusDetailJson: unknown },
  now: Date,
): RunExecutionState {
  if (isRunTerminal(run.status)) return "TERMINAL";
  const marker = readExecutionClaimMarker(run.statusDetailJson);
  if (marker.kind === "NO_CLAIM") return "IDLE";
  // 不可验证 = 不可判定 = 按最坏情况处理（可能仍有 executor 在跑）
  if (marker.kind === "INVALID_CLAIM") return "RECOVERY_REQUIRED";
  return Date.parse(marker.claim.expiresAt) > now.getTime() ? "IN_PROGRESS" : "RECOVERY_REQUIRED";
}
