/**
 * S3-A §9B：resolutionJson 追加的并发保护（多人操作入口开放后的直接支撑）。
 *
 * 债务背景（S2 已披露）：`resolutionJson` 是 read-modify-write 的追加数组，两个写路径
 * 各自「先读整段、再整段写回」，没有任何串行化：
 *   - 自动预填 `resolveSignalEntity` → 追加 AUTO_PREFILL 条目；
 *   - 人工流转 `reviewSignal / rejectSignal / linkSignalToSupplier` → 追加 HUMAN_LINKED 条目。
 * 两者并发时后写者会用自己读到的旧数组覆盖对方刚追加的条目——审计记录静默丢失。
 *
 * 修法（不新增 schema、不新建审计框架，复用既有 `SELECT … FOR UPDATE` 短锁模式，
 * 与 run-service.lockSupplierSearchRunForWrite 同形）：
 *   1. 网络与大范围身份扫描**保持锁外**（B5 的穷尽扫描仍在事务之前完成，锁不跨网络）；
 *   2. 只有「最终写入」进短事务：锁住信号行 → **重新读取**最新 resolutionJson → 追加 → 提交。
 * 于是两个写路径互相串行，历史条目永不被改写，谁都不会覆盖对方。
 *
 * 状态语义不变：追加条目本身不改 status / linkedSupplierId，因此并发的预填不会复活
 * 已 REJECTED 的信号，也不会覆盖人工 LINKED 结果——状态迁移仍由既有状态机独占裁决。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SupplierIntelError } from "./errors";

/**
 * 行级写锁（与 Run 的锁序同形）：锁住本 org 内的信号行并返回最新快照。
 * 必须在事务内调用；锁在事务提交时释放。
 */
export async function lockSignalForWrite(
  tx: Prisma.TransactionClient,
  orgId: string,
  signalId: string,
) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "SupplierDiscoverySignal"
    WHERE "id" = ${signalId} AND "orgId" = ${orgId}
    FOR UPDATE`;
  if (locked.length === 0) {
    throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");
  }
  const signal = await tx.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId },
  });
  if (!signal) throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");
  return signal;
}

/** 读出既有追加数组（非数组的历史值按空数组处理，不改写历史） */
export function existingResolutionEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/**
 * 安全追加一条 resolutionJson 记录：短事务 + 行锁 + 锁内重读。
 * 返回追加后的条目总数（供调用方断言「没有丢条目」）。
 */
export async function appendResolutionEntry(
  actor: { orgId: string },
  signalId: string,
  entry: Record<string, unknown>,
): Promise<{ total: number }> {
  return db.$transaction(async (tx) => {
    const signal = await lockSignalForWrite(tx, actor.orgId, signalId);
    const prev = existingResolutionEntries(signal.resolutionJson);
    const next = [...prev, entry];
    await tx.supplierDiscoverySignal.update({
      where: { id: signal.id },
      data: { resolutionJson: next as unknown as Prisma.InputJsonValue },
    });
    return { total: next.length };
  });
}
