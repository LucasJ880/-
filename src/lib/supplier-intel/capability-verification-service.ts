/**
 * S4-B：能力证据的**唯一** VERIFIED 写路径（人工动作 + 独立档案证据）。
 *
 * 为什么需要它：正式 Import Readiness（15）只接受 VERIFIED 的出口能力证据（任务书 §35），
 * 而 social / discovery 写路径按 S3-B 铁律永远产不出 VERIFIED。没有人工核验路径，
 * 进口准备度永远 null、没有任何供应商能进入排名——所以这里镜像 verifyCertification：
 *   - 必须给出本 org 的 TenderArchiveItem 作为独立证据（1688 文案 / 抖音视频 / 官网自述不算）；
 *   - 只允许 CLAIMED / OBSERVED / UNKNOWN → VERIFIED，VERIFIED 不重复写；
 *   - 挂靠线索的项目写权限（与 createCapabilitySignal 同一判定树）+ 档案所在项目读权限；
 *   - 事务内写审计。
 * 无 schema：只改既有 evidenceStatus / explanation。
 */

import { writeAuditLog } from "@/lib/audit/logger";
import { db } from "@/lib/db";
import { assertProjectAccessForActor } from "./access";
import type { SupplierIntelActor } from "./actor";
import { SUPPLIER_INTEL_AUDIT_ACTIONS } from "./constants";
import { SupplierIntelError } from "./errors";
import { assertSignalAccess } from "./signal-scope";

export async function verifyCapabilitySignal(
  actor: SupplierIntelActor,
  capabilityId: string,
  input: { archiveItemId: string; note?: string | null },
) {
  const archiveItemId = input.archiveItemId?.trim();
  if (!archiveItemId) {
    throw new SupplierIntelError("CAPABILITY_VERIFY_REQUIRES_EVIDENCE", "VERIFIED 需要独立证据：档案（archiveItemId）；平台文案 / 视频 / 自述不构成证据");
  }
  const cap = await db.supplierCapabilitySignal.findFirst({
    where: { id: capabilityId, orgId: actor.orgId },
    include: { discoverySignal: { select: { id: true, linkedSupplierId: true, status: true } } },
  });
  if (!cap) throw new SupplierIntelError("NOT_FOUND", "能力记录不存在");
  if (cap.evidenceStatus === "VERIFIED") throw new SupplierIntelError("INVALID_INPUT", "该能力已是 VERIFIED");
  if (cap.discoverySignal.status !== "LINKED" || !cap.discoverySignal.linkedSupplierId) {
    throw new SupplierIntelError("SOURCE_SIGNAL_NOT_LINKED", "出处线索尚未归属到供应商，不能核验其能力");
  }
  // 挂靠线索的项目写权限
  await assertSignalAccess(actor, cap.discoverySignal.id, "write");
  // 档案：本 org + 所在项目可读（看不见的项目里的档案不能拿来核验）
  const archive = await db.tenderArchiveItem.findFirst({ where: { id: archiveItemId, orgId: actor.orgId }, select: { id: true, projectId: true, kind: true, capturedAt: true } });
  if (!archive) throw new SupplierIntelError("ARCHIVE_EVIDENCE_NOT_FOUND", "证据档案不存在");
  try { await assertProjectAccessForActor(actor, archive.projectId, "read"); }
  catch { throw new SupplierIntelError("ARCHIVE_EVIDENCE_NOT_FOUND", "证据档案不存在"); }

  return db.$transaction(async (tx) => {
    const note = input.note?.trim() || null;
    const explanation = [cap.explanation?.trim() || null, `[VERIFIED by human; archive=${archive.id}${note ? `; ${note}` : ""}]`].filter(Boolean).join(" ");
    const updated = await tx.supplierCapabilitySignal.updateMany({
      where: { id: cap.id, orgId: actor.orgId, evidenceStatus: cap.evidenceStatus },
      data: { evidenceStatus: "VERIFIED", explanation: explanation.slice(0, 2000) },
    });
    if (updated.count !== 1) throw new SupplierIntelError("INVALID_INPUT", "能力状态已被并发修改");
    await writeAuditLog(tx, {
      userId: actor.userId,
      orgId: actor.orgId,
      projectId: archive.projectId,
      action: SUPPLIER_INTEL_AUDIT_ACTIONS.CAPABILITY_VERIFIED,
      targetType: "supplier_capability_signal",
      targetId: cap.id,
      beforeData: { evidenceStatus: cap.evidenceStatus },
      afterData: { evidenceStatus: "VERIFIED", type: cap.type, archiveItemId: archive.id, supplierId: cap.discoverySignal.linkedSupplierId },
    });
    return tx.supplierCapabilitySignal.findFirstOrThrow({ where: { id: cap.id } });
  });
}
