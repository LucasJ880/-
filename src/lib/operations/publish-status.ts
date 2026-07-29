/**
 * PublishJob 状态机（Phase C）
 *
 * 应用层兼容旧状态 `review` → 规范化为 `pending_human_approval`。
 * 写库时一律写新状态；读时 normalize。
 */

export const PUBLISH_STATUSES = [
  "draft",
  "ai_reviewed",
  "needs_revision",
  "pending_human_approval",
  "approved",
  "blocked",
  "queued",
  "processing",
  "published",
  "failed",
  "canceled",
  "paused_by_safety",
] as const;

export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

/** 旧状态 → 新状态（读兼容；不批量改生产数据） */
const LEGACY_MAP: Record<string, PublishStatus> = {
  review: "pending_human_approval",
};

export function normalizePublishStatus(status: string): PublishStatus | string {
  if (status in LEGACY_MAP) return LEGACY_MAP[status];
  return status;
}

export function isPublishStatus(status: string): status is PublishStatus {
  const n = normalizePublishStatus(status);
  return (PUBLISH_STATUSES as readonly string[]).includes(n);
}

/** 审核队列查询应同时包含新旧值 */
export const HUMAN_REVIEW_STATUSES = [
  "pending_human_approval",
  "review", // legacy read
  "blocked",
  "needs_revision",
  "ai_reviewed",
] as const;

const TRANSITIONS: Record<PublishStatus, PublishStatus[]> = {
  draft: ["ai_reviewed", "pending_human_approval", "blocked", "canceled", "needs_revision"],
  ai_reviewed: [
    "pending_human_approval",
    "approved",
    "needs_revision",
    "blocked",
    "canceled",
  ],
  needs_revision: ["draft", "pending_human_approval", "canceled"],
  pending_human_approval: ["approved", "needs_revision", "blocked", "canceled"],
  approved: ["queued", "canceled", "blocked"],
  /** 人工改文后可回到待审；受审计恢复可进 approved */
  blocked: ["needs_revision", "draft", "pending_human_approval", "canceled"],
  queued: ["processing", "published", "failed", "canceled"],
  processing: ["published", "failed", "paused_by_safety"],
  published: [],
  failed: ["queued", "canceled"], // 受控重试：回到 queued
  canceled: [],
  paused_by_safety: ["queued", "canceled"], // Phase D 完整熔断前仅预留
};

export function canTransition(
  fromRaw: string,
  toRaw: string,
): { ok: true } | { ok: false; error: string } {
  const from = normalizePublishStatus(fromRaw) as PublishStatus;
  const to = normalizePublishStatus(toRaw) as PublishStatus;
  if (!isPublishStatus(from) || !isPublishStatus(to)) {
    return { ok: false, error: `未知状态 ${fromRaw} → ${toRaw}` };
  }
  if (from === to) return { ok: true };
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `非法状态跳转：${from} → ${to}`,
    };
  }
  return { ok: true };
}

/** 禁止直接跳入队列的源状态（需先 approved） */
export function assertCanEnterQueue(fromRaw: string): {
  ok: true;
} | { ok: false; error: string } {
  const from = normalizePublishStatus(fromRaw);
  if (from === "approved" || from === "failed") return { ok: true };
  // failed 重试：failed → queued 已在 TRANSITIONS
  if (from === "queued") return { ok: true };
  return {
    ok: false,
    error: `仅 approved（或 failed 重试）可进入 queued，当前为 ${from}`,
  };
}

export function buildIdempotencyKey(
  orgId: string,
  publishJobId: string,
  contentVersion: number,
): string {
  return `${orgId}:${publishJobId}:v${contentVersion}`;
}
