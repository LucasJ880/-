/**
 * 内部供应商源 Adapter（M1-S2，任务书 §12–§15/§31–§34）
 *
 * 检索优先级 1–3 的实现：Qyane Supplier Memory → 历史成功 → 供应商库。
 * 统一输出 SupplierSourceResult（上层不关心 MemoryClaim/Supplier 表形状）。
 *
 * §31 铁律：Corporate Memory 检索必须走 canonical searchMemoryClaims（B4 裁决：
 * active membership / org scope / server-side accessClass / ACTIVE 默认）——
 * 本模块禁止 db.memoryClaim.* 直查。
 * §32：memory 不只搜供应商名——product/category/capability 词一并检索 statement。
 * §33/§34：历史/已存供应商只进 Discovery 池并标 originSource，不改评分、
 * 不自动 compliant、不豁免当前 Tender 的 Mandatory Gate（S4 一视同仁）。
 */

import { searchMemoryClaims } from "@/lib/corporate-memory/retrieval";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import type { SupplierSearchBrief } from "./search-brief";

export interface SupplierSourceResult {
  sourceType: "MEMORY" | "HISTORICAL_SUCCESS" | "SAVED";
  supplierId: string;
  supplierName: string;
  legalName?: string | null;
  country?: string | null;
  region?: string | null;
  website?: string | null;
  sourceUrl?: string | null;
  rawAttributes?: Record<string, unknown>;
  discoveryConfidence?: number | null;
  reasonFound: string;
}

export interface SupplierSearchContext {
  actor: SupplierIntelActor;
  limit?: number;
}

export interface SupplierSourceAdapter {
  readonly id: string;
  search(brief: SupplierSearchBrief, context: SupplierSearchContext): Promise<SupplierSourceResult[]>;
}

const DEFAULT_INTERNAL_LIMIT = 100;

function memorySearchTerms(brief: SupplierSearchBrief): string[] {
  // §32：产品词 / 类目 / 能力词 / 强制要求头（不只搜供应商名）
  const terms = [
    ...brief.productKeywords,
    brief.productCategory ?? "",
    ...brief.capabilitySearchTermsZh.slice(0, 3),
    ...brief.mandatoryRequirements.slice(0, 3).map((r) => r.text.slice(0, 40)),
  ]
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return [...new Set(terms)].slice(0, 5);
}

/** 优先级 1：企业记忆里有 VENDOR 主题 ACTIVE 断言的供应商（canonical 服务检索） */
export const qyaneSupplierMemoryAdapter: SupplierSourceAdapter = {
  id: "memory",
  async search(brief, context) {
    const { actor } = context;
    const limit = context.limit ?? DEFAULT_INTERNAL_LIMIT;
    const terms = memorySearchTerms(brief);
    const claimBatches = await Promise.all([
      // 基线：该 org 全部 VENDOR ACTIVE 断言（数量有限，claim 本身是稀缺人工资产）
      searchMemoryClaims({ orgId: actor.orgId, actor: { userId: actor.userId }, subjectType: "VENDOR", limit: 100 }),
      ...terms.map((q) =>
        searchMemoryClaims({
          orgId: actor.orgId,
          actor: { userId: actor.userId },
          subjectType: "VENDOR",
          query: q,
          limit: 50,
        }),
      ),
    ]);
    const reasonByKey = new Map<string, string>();
    for (let i = 0; i < claimBatches.length; i++) {
      for (const claim of claimBatches[i]) {
        if (!reasonByKey.has(claim.subjectKey)) {
          reasonByKey.set(
            claim.subjectKey,
            i === 0 ? "corporate memory VENDOR claim" : `corporate memory hit: ${terms[i - 1]}`,
          );
        }
      }
    }
    if (reasonByKey.size === 0) return [];
    const suppliers = await db.supplier.findMany({
      where: { orgId: actor.orgId, id: { in: [...reasonByKey.keys()].slice(0, limit) } },
      select: { id: true, name: true, region: true, website: true },
    });
    return suppliers.map((s) => ({
      sourceType: "MEMORY" as const,
      supplierId: s.id,
      supplierName: s.name,
      region: s.region,
      website: s.website,
      reasonFound: reasonByKey.get(s.id) ?? "corporate memory VENDOR claim",
    }));
  },
};

/** 优先级 2：询价史上有中选记录的供应商（历史经验只用于 Discovery，不带任何合规豁免） */
export const historicalSupplierAdapter: SupplierSourceAdapter = {
  id: "historical",
  async search(_brief, context) {
    const { actor } = context;
    const rows = await db.inquiryItem.findMany({
      where: { isSelected: true, supplier: { orgId: actor.orgId, status: "active" } },
      select: { supplier: { select: { id: true, name: true, region: true, website: true } } },
      distinct: ["supplierId"],
      take: context.limit ?? DEFAULT_INTERNAL_LIMIT,
    });
    return rows.map((r) => ({
      sourceType: "HISTORICAL_SUCCESS" as const,
      supplierId: r.supplier.id,
      supplierName: r.supplier.name,
      region: r.supplier.region,
      website: r.supplier.website,
      reasonFound: "历史询价中选记录（仅作发现优先级，不代表当前合规）",
    }));
  },
};

/** 优先级 3：供应商库其余 active 供应商（SAVED ≠ APPROVED/COMPLIANT/PRIMARY） */
export const savedSupplierAdapter: SupplierSourceAdapter = {
  id: "saved",
  async search(_brief, context) {
    const { actor } = context;
    const suppliers = await db.supplier.findMany({
      where: { orgId: actor.orgId, status: "active" },
      select: { id: true, name: true, region: true, website: true },
      orderBy: { name: "asc" },
      take: context.limit ?? DEFAULT_INTERNAL_LIMIT,
    });
    return suppliers.map((s) => ({
      sourceType: "SAVED" as const,
      supplierId: s.id,
      supplierName: s.name,
      region: s.region,
      website: s.website,
      reasonFound: "供应商库已存供应商",
    }));
  },
};

export const INTERNAL_SOURCE_ADAPTERS: SupplierSourceAdapter[] = [
  qyaneSupplierMemoryAdapter,
  historicalSupplierAdapter,
  savedSupplierAdapter,
];
