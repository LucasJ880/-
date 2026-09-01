/**
 * Entity Resolution（M1-S2，DESIGN §8）
 *
 * 运行期 DTO，不建表；结果 append 进 SupplierDiscoverySignal.resolutionJson。
 * 铁律：解析只做**预填**——M1 全部 LINKED 动作都是人工点按；永不自动合并；
 * 归一名等值不算强键单独放行（Buyer 纪律：同 normalizedName 不同实体可合法共存）；
 * 多个供应商命中强键 = 冲突 → NEEDS_HUMAN_REVIEW，绝不自动挑一个。
 *
 * S2 已知边界（诚实声明）：Supplier 主表没有统一社会信用代码字段——USCC 只进 hints
 * 与冲突说明，暂无法作为匹配键落地（SupplierIdentity 身份层 = M2 议题）。
 */

import type { Prisma } from "@prisma/client";
import { normalizeBuyerName, normalizeWebsiteDomain } from "@/lib/corporate-memory/normalize";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import { SupplierIntelError } from "./errors";

// 统一社会信用代码字符集（GB 32100-2015；不含 I/O/S/V/Z）
const USCC_RE = /\b[0-9A-HJ-NPQRTUWXY]{18}\b/g;
const CN_PHONE_RE = /\b1[3-9]\d{9}\b/g;
// 公司名候选：汉字开头、允许夹拉丁/数字（如「佛山市XX家具有限公司」），企业后缀收尾
const CN_COMPANY_RE = /[一-龥][一-龥A-Za-z0-9]{1,20}(?:有限公司|股份公司|家具厂|制品厂|工厂|厂)/g;

export interface ExtractedEntityHints {
  companyNameCandidates: string[];
  unifiedSocialCreditCode: string | null;
  phones: string[];
  domains: string[];
}

export interface SignalLikeForExtraction {
  accountName: string | null;
  accountUrl: string | null;
  contentUrl: string | null;
  title: string | null;
  description: string | null;
  rawText: string | null;
}

function take<T>(arr: T[], cap: number): T[] {
  return [...new Set(arr)].slice(0, cap);
}

/** 纯函数：从信号字段保守抽取实体线索（抽不出=空，不猜） */
export function extractEntityHints(signal: SignalLikeForExtraction): ExtractedEntityHints {
  const corpus = [signal.rawText, signal.description, signal.title]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);

  const names = take(
    [
      signal.accountName?.trim() || null,
      ...(corpus.match(CN_COMPANY_RE) ?? []),
    ].filter((v): v is string => Boolean(v)),
    4,
  );
  const uscc = corpus.match(USCC_RE)?.[0] ?? null;
  const phones = take(corpus.match(CN_PHONE_RE) ?? [], 3);
  const domains = take(
    [signal.accountUrl, signal.contentUrl]
      .map((u) => normalizeWebsiteDomain(u))
      .filter((v): v is string => Boolean(v)),
    3,
  );

  return { companyNameCandidates: names, unifiedSocialCreditCode: uscc, phones, domains };
}

export interface SupplierRowForResolution {
  id: string;
  name: string;
  website: string | null;
  contactPhone: string | null;
}

export interface SupplierEntityResolutionResult {
  /** S2 任务书 §27 词表：预填三态；AUTO_MERGE 不存在 */
  decision: "MATCHED_EXISTING" | "NEW_SUPPLIER_CANDIDATE" | "NEEDS_HUMAN_REVIEW";
  supplierId?: string;
  legalName?: string;
  candidateNames: string[];
  confidence: number;
  /** 人读得懂的命中键摘要（kind:key） */
  matchedSignals: string[];
  /** 机器可用的命中明细（预填/审计） */
  matchedSources: Array<{ kind: string; key: string; supplierId: string }>;
  conflicts: string[];
}

/**
 * 名称重叠（仅用于模糊候选，永不单独 MATCHED）：
 * normalizeBuyerName 做大小写/空白归一（实测不剥中文修饰词），再按字/词求包含度
 *（min 分母）——「XX家具源头工厂」应能把「佛山市XX家具有限公司」召回为人审候选。
 */
const FUZZY_CANDIDATE_THRESHOLD = 0.4; // 只产 NEEDS_HUMAN_REVIEW 候选，宁可多召回给人筛

function nameOverlap(a: string, b: string): number {
  const tok = (s: string) =>
    new Set(
      normalizeBuyerName(s)
        .toLowerCase()
        .split(/[^a-z0-9一-龥]+/)
        .flatMap((w) => (/[一-龥]/.test(w) ? [...w] : [w]))
        .filter(Boolean),
    );
  const ta = tok(a);
  const tb = tok(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.min(ta.size, tb.size);
}

/**
 * 纯函数解析核心。priorLinkedDomains = 本 org 此前 LINKED 信号沉淀的 域名→supplierId
 * （DESIGN §8.3 键 2 的「已档 URL」半边）。
 */
export function resolveSupplierEntityPure(
  hints: ExtractedEntityHints,
  suppliers: SupplierRowForResolution[],
  priorLinkedDomains: Map<string, string>,
): SupplierEntityResolutionResult {
  const matchedSources: SupplierEntityResolutionResult["matchedSources"] = [];
  const conflicts: string[] = [];

  // 键 2：域名（官网 or 已档来源）——强键
  for (const domain of hints.domains) {
    const prior = priorLinkedDomains.get(domain);
    if (prior) matchedSources.push({ kind: "archived_domain", key: domain, supplierId: prior });
    for (const s of suppliers) {
      if (normalizeWebsiteDomain(s.website) === domain) {
        matchedSources.push({ kind: "website_domain", key: domain, supplierId: s.id });
      }
    }
  }
  // 键 4：联系方式——强键
  for (const phone of hints.phones) {
    for (const s of suppliers) {
      if (s.contactPhone && s.contactPhone.replace(/\D/g, "").endsWith(phone)) {
        matchedSources.push({ kind: "contact_phone", key: phone, supplierId: s.id });
      }
    }
  }
  // 键 3：法名归一等值——非强键（不单独放行）
  const nameEqHits: Array<{ supplierId: string; name: string; key: string }> = [];
  for (const cand of hints.companyNameCandidates) {
    const n = normalizeBuyerName(cand);
    if (!n) continue;
    for (const s of suppliers) {
      if (normalizeBuyerName(s.name) === n) {
        nameEqHits.push({ supplierId: s.id, name: s.name, key: cand });
        matchedSources.push({ kind: "normalized_name", key: cand, supplierId: s.id });
      }
    }
  }
  if (hints.unifiedSocialCreditCode) {
    conflicts.push(
      `检出统一社会信用代码 ${hints.unifiedSocialCreditCode}，但供应商主表暂无该字段可比对（SupplierIdentity=M2）`,
    );
  }

  const signalsOf = (sources: typeof matchedSources) => sources.map((m) => `${m.kind}:${m.key}`);
  const strong = matchedSources.filter((m) => m.kind !== "normalized_name");
  const strongSuppliers = [...new Set(strong.map((m) => m.supplierId))];

  if (strongSuppliers.length === 1) {
    const sid = strongSuppliers[0];
    const legal = suppliers.find((s) => s.id === sid)?.name;
    return {
      decision: "MATCHED_EXISTING", // 仅预填：LINKED 仍需人工点按
      supplierId: sid,
      legalName: legal,
      candidateNames: hints.companyNameCandidates,
      confidence: 0.92,
      matchedSignals: signalsOf(matchedSources),
      matchedSources,
      conflicts,
    };
  }
  if (strongSuppliers.length > 1) {
    conflicts.push(`多个供应商命中强键（${strongSuppliers.length} 家）——不得自动挑选`);
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      candidateNames: hints.companyNameCandidates,
      confidence: 0.6,
      matchedSignals: signalsOf(matchedSources),
      matchedSources,
      conflicts,
    };
  }
  if (nameEqHits.length > 0) {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      supplierId: nameEqHits.length === 1 ? nameEqHits[0].supplierId : undefined,
      legalName: nameEqHits.length === 1 ? nameEqHits[0].name : undefined,
      candidateNames: hints.companyNameCandidates,
      confidence: 0.72, // 归一名等值 ≠ 强键（同名不同实体可合法共存）
      matchedSignals: signalsOf(matchedSources),
      matchedSources,
      conflicts,
    };
  }
  // 键 6：模糊相似——只产候选，只能 NEEDS_HUMAN_REVIEW
  let best: { supplierId: string; name: string; score: number } | null = null;
  for (const cand of hints.companyNameCandidates) {
    for (const s of suppliers) {
      const score = nameOverlap(cand, s.name);
      if (score >= FUZZY_CANDIDATE_THRESHOLD && (!best || score > best.score)) {
        best = { supplierId: s.id, name: s.name, score };
      }
    }
  }
  if (best) {
    matchedSources.push({ kind: "fuzzy_name", key: best.name, supplierId: best.supplierId });
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      supplierId: best.supplierId,
      legalName: best.name,
      candidateNames: hints.companyNameCandidates,
      confidence: 0.55,
      matchedSignals: signalsOf(matchedSources),
      matchedSources,
      conflicts,
    };
  }
  return {
    decision: "NEW_SUPPLIER_CANDIDATE",
    candidateNames: hints.companyNameCandidates,
    confidence: 0.2,
    matchedSignals: [],
    matchedSources,
    conflicts,
  };
}

/** 服务：对某条信号做解析预填，结果 append 进 resolutionJson（人工改判也 append） */
export async function resolveSignalEntity(actor: SupplierIntelActor, signalId: string) {
  const signal = await db.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId: actor.orgId },
  });
  if (!signal) throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");

  const suppliers = await db.supplier.findMany({
    where: { orgId: actor.orgId, status: "active" },
    select: { id: true, name: true, website: true, contactPhone: true },
    take: 500,
  });
  const linked = await db.supplierDiscoverySignal.findMany({
    where: { orgId: actor.orgId, status: "LINKED", linkedSupplierId: { not: null } },
    select: { accountUrl: true, contentUrl: true, linkedSupplierId: true },
    take: 500,
  });
  const priorLinkedDomains = new Map<string, string>();
  for (const row of linked) {
    for (const u of [row.accountUrl, row.contentUrl]) {
      const d = normalizeWebsiteDomain(u);
      if (d && row.linkedSupplierId && !priorLinkedDomains.has(d)) {
        priorLinkedDomains.set(d, row.linkedSupplierId);
      }
    }
  }

  const hints = extractEntityHints(signal);
  const result = resolveSupplierEntityPure(hints, suppliers, priorLinkedDomains);

  const entry = {
    phase: "AUTO_PREFILL",
    result,
    hints,
    at: new Date().toISOString(),
    byUserId: actor.userId,
  };
  await db.supplierDiscoverySignal.updateMany({
    where: { id: signal.id, orgId: actor.orgId },
    data: {
      resolutionJson: [
        ...(Array.isArray(signal.resolutionJson) ? (signal.resolutionJson as unknown[]) : []),
        entry,
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  return result;
}
