/**
 * F1 证据/溯源 fail-closed 解析器（S1 Final Review）
 *
 * 纪律与 corporate-memory 的 assertEvidenceRefsInScope 同源（该函数未导出，此处按
 * Final Review 允许的「extract」路径落同一判定：证据引用必须在本 org 内真实存在）——
 * 不发明更弱的第二套实现：非空字符串永远不等于证据。
 */

import type { Prisma } from "@prisma/client";
import { SupplierIntelError } from "./errors";

type Db = Prisma.TransactionClient;

/**
 * F1.1：archiveItemId 必须解析为本 org 的 TenderArchiveItem。
 * 不存在 / 跨 org 一律拒绝（同一错误码，不泄露存在性）。
 */
export async function resolveArchiveEvidence(
  tx: Db,
  orgId: string,
  archiveItemId: string,
): Promise<{ id: string }> {
  const id = archiveItemId.trim();
  if (!id) {
    throw new SupplierIntelError("ARCHIVE_EVIDENCE_NOT_FOUND", "archiveItemId 为空");
  }
  const row = await tx.tenderArchiveItem.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!row) {
    throw new SupplierIntelError(
      "ARCHIVE_EVIDENCE_NOT_FOUND",
      "证据档案不存在或不属于当前组织（非空 ID 不构成证据）",
    );
  }
  return row;
}

/**
 * F1.5：sourceSignalId 溯源指针必须解析为本 org 的信号，且供应商绑定兼容——
 * 已 LINKED 到其它供应商的信号不得作为该供应商的溯源（未 LINKED 的允许：
 * 它只是发现语境，不是正式证据）。不存在 / 跨 org / 跨供应商统一拒绝。
 */
export async function resolveSourceSignalForSupplier(
  tx: Db,
  orgId: string,
  sourceSignalId: string,
  supplierId: string,
): Promise<{ id: string }> {
  const id = sourceSignalId.trim();
  if (!id) {
    throw new SupplierIntelError("SOURCE_SIGNAL_MISMATCH", "sourceSignalId 为空");
  }
  const signal = await tx.supplierDiscoverySignal.findFirst({
    where: { id, orgId },
    select: { id: true, linkedSupplierId: true },
  });
  if (!signal) {
    throw new SupplierIntelError(
      "SOURCE_SIGNAL_MISMATCH",
      "溯源信号不存在或不属于当前组织",
    );
  }
  if (signal.linkedSupplierId !== null && signal.linkedSupplierId !== supplierId) {
    throw new SupplierIntelError(
      "SOURCE_SIGNAL_MISMATCH",
      "溯源信号已关联到其它供应商，不得跨供应商引用",
    );
  }
  return { id: signal.id };
}
