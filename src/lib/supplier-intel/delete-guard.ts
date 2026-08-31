/**
 * Supplier 删除守卫（B.1 §6）：被情报域引用的供应商不得硬删——
 * 受控失败（SUPPLIER_HAS_INTELLIGENCE_HISTORY，409），而不是让 DB 抛 FK 500；
 * DB 侧的 ON DELETE RESTRICT 是第二道防线，不是主判定。
 */

import { db } from "@/lib/db";

export interface SupplierIntelReferenceCounts {
  signals: number;
  offerings: number;
  candidates: number;
  certifications: number;
  total: number;
}

export async function countSupplierIntelReferences(
  supplierId: string,
): Promise<SupplierIntelReferenceCounts> {
  const [signals, offerings, candidates, certifications] = await Promise.all([
    db.supplierDiscoverySignal.count({ where: { linkedSupplierId: supplierId } }),
    db.supplierOffering.count({ where: { supplierId } }),
    db.supplierCandidate.count({ where: { supplierId } }),
    db.supplierCertification.count({ where: { supplierId } }),
  ]);
  return {
    signals,
    offerings,
    candidates,
    certifications,
    total: signals + offerings + candidates + certifications,
  };
}
