/**
 * eventKey 构造（#96 §5.5 / P1 任务书 §10）
 *
 * 纪律：deterministic / idempotent / short / server-authored。
 * 禁止 Math.random() / Date.now() / randomUUID() 参与可重试业务动作的 key。
 * 同一业务动作 retry → 同一 eventKey；新动作 → 新 eventKey。
 */
import { createHash } from "node:crypto";

function shortHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 24);
}

/** 项目创建：projectId 即动作身份（重试同事务回滚后重建 = 新 id = 新动作） */
export function projectCreatedEventKey(projectId: string): string {
  return `project.created:${projectId}`;
}

/**
 * 项目字段更新：内容寻址 + 前置行版本。
 * prevUpdatedAtIso = 修改前行的 updatedAt（持久化的先前状态，非当前墙钟）——
 * 同一逻辑动作的事务重试读到相同前置状态 → 相同 key；
 * A→B→A→B 的第三次变更因前置 updatedAt 不同 → 新 key。
 */
export function projectUpdatedEventKey(
  projectId: string,
  prevUpdatedAtIso: string,
  changedFields: readonly string[],
  afterSubset: Record<string, unknown>,
): string {
  const digest = shortHash(
    JSON.stringify({
      prev: prevUpdatedAtIso,
      fields: [...changedFields].sort(),
      after: afterSubset,
    }),
  );
  return `project.updated:${projectId}:${digest}`;
}

/**
 * 成员加入/移除：membershipRowId + 事务内账本计数派生的 membership-version。
 * 同一成员行可反复 加入→移除→再加入（行复用 status 翻转），version 使每次动作得到新 key；
 * 事务重试回滚后计数不变 → key 稳定。
 */
export function projectMemberAddedEventKey(
  membershipRowId: string,
  membershipVersion: number,
): string {
  return `project.member.added:${membershipRowId}:v${membershipVersion}`;
}

export function projectMemberRemovedEventKey(
  membershipRowId: string,
  membershipVersion: number,
): string {
  return `project.member.removed:${membershipRowId}:v${membershipVersion}`;
}

/** 成本状态事件：每状态至多一次（#96 §5.5） */
export function costStatusEventKey(costId: string, costStatus: string): string {
  return `cost:${costId}:${costStatus}`;
}

/**
 * 报价状态事件（B3）：quoteId + 目标状态 + 前置行版本摘要。
 * QUOTE_TRANSITIONS 存在 review→draft→review 循环，单纯 quote:{id}:{status}
 * 会吞掉第二次提交；采用与 projectUpdatedEventKey 相同的纪律——
 * prevUpdatedAtIso = 迁移前行的 updatedAt（持久化先前状态，非墙钟）：
 * 同一逻辑动作的事务重试 → 相同 key；再次进入同一状态（新动作）→ 新 key。
 */
export function quoteStatusEventKey(
  quoteId: string,
  toStatus: string,
  prevUpdatedAtIso: string,
): string {
  return `quote:${quoteId}:${toStatus}:${shortHash(prevUpdatedAtIso)}`;
}

/** 成本计划修订：revisionCount 为 retry-stable 幂等号（#96 §6.3） */
export function costRevisionEventKey(
  costId: string,
  revisionCount: number,
): string {
  return `cost:${costId}:revision:${revisionCount}`;
}
