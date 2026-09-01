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
import {
  classifyPublicUrlPlatform,
  isPlatformOrMarketplaceHost,
  validatePublicHttpUrl,
} from "./submission-parser";

/* ------------------------- B2：URL 身份分级 ------------------------- */

/**
 * S2 Final Review B2 冻结：URL 对「供应商身份」的四级分类。
 * 平台/市场 host（douyin/xiaohongshu/1688/alibaba/made-in-china/…）的域名本身
 * 永不构成供应商身份——两家工厂的抖音主页同为 douyin.com，域名等值毫无身份意义。
 */
export type UrlIdentityKind =
  | "SUPPLIER_OWNED_DOMAIN" // 供应商自有官网域名（唯一可作强键的 URL 形态）
  | "PLATFORM_ACCOUNT_IDENTITY" // 平台上的**精确账号页**（人工 LINKED 沉淀后可作已验证身份提示）
  | "CONTENT_URL" // 平台上的单条视频/帖子/商品页——最多是 provenance，永不身份
  | "UNKNOWN_URL";

export interface UrlIdentity {
  kind: UrlIdentityKind;
  /** SUPPLIER_OWNED_DOMAIN：归一化域名 */
  domain?: string;
  /** PLATFORM_ACCOUNT_IDENTITY：平台 + 精确账号键 */
  platform?: string;
  accountKey?: string;
}

/** 平台账号页识别（保守：认不出精确账号 = CONTENT_URL，绝不猜） */
function extractPlatformAccountIdentity(url: URL): { platform: string; accountKey: string } | null {
  const platform = classifyPublicUrlPlatform(url);
  const path = url.pathname.replace(/\/+$/, "");
  if (platform === "DOUYIN") {
    const m = path.match(/^\/user\/([\w.-]{4,})$/);
    if (m) return { platform, accountKey: `DOUYIN:user:${m[1].toLowerCase()}` };
    return null;
  }
  if (platform === "XIAOHONGSHU") {
    const m = path.match(/^\/user\/profile\/([\w-]{4,})$/);
    if (m) return { platform, accountKey: `XIAOHONGSHU:user:${m[1].toLowerCase()}` };
    return null;
  }
  if (platform === "ONE688") {
    // 店铺子域（shop1234.1688.com）；www/detail/m 等公共子域不是账号
    const host = url.hostname.toLowerCase();
    const m = host.match(/^([\w-]{3,})\.1688\.com$/);
    if (m && !["www", "detail", "m", "s", "page", "offer", "air"].includes(m[1])) {
      return { platform, accountKey: `ONE688:shop:${m[1]}` };
    }
    return null;
  }
  return null; // WECHAT_CHANNELS 及其它：无可靠公开账号页形态
}

/** 纯函数：URL → 身份分级（解析失败 = UNKNOWN_URL） */
export function classifyUrlForIdentity(raw: string | null | undefined): UrlIdentity {
  const t = raw?.trim();
  if (!t) return { kind: "UNKNOWN_URL" };
  let url: URL;
  try {
    url = validatePublicHttpUrl(t);
  } catch {
    return { kind: "UNKNOWN_URL" };
  }
  if (isPlatformOrMarketplaceHost(url)) {
    const account = extractPlatformAccountIdentity(url);
    if (account) return { kind: "PLATFORM_ACCOUNT_IDENTITY", ...account };
    return { kind: "CONTENT_URL" };
  }
  const domain = normalizeWebsiteDomain(url.toString());
  return domain ? { kind: "SUPPLIER_OWNED_DOMAIN", domain } : { kind: "UNKNOWN_URL" };
}

// 统一社会信用代码字符集（GB 32100-2015；不含 I/O/S/V/Z）
const USCC_RE = /\b[0-9A-HJ-NPQRTUWXY]{18}\b/g;
const CN_PHONE_RE = /\b1[3-9]\d{9}\b/g;
// 公司名候选：汉字开头、允许夹拉丁/数字（如「佛山市XX家具有限公司」），企业后缀收尾
const CN_COMPANY_RE = /[一-龥][一-龥A-Za-z0-9]{1,20}(?:有限公司|股份公司|家具厂|制品厂|工厂|厂)/g;

export interface ExtractedEntityHints {
  companyNameCandidates: string[];
  unifiedSocialCreditCode: string | null;
  phones: string[];
  /** 仅供应商自有域名（B2：平台/市场 host 永不入列） */
  domains: string[];
  /** 平台精确账号身份（仅账号页可解析时；内容页绝不入列） */
  platformAccounts: Array<{ platform: string; accountKey: string }>;
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

  // B2：URL 按身份分级——自有域名与平台账号分流；内容页/未知一律弃
  const domains: string[] = [];
  const platformAccounts: Array<{ platform: string; accountKey: string }> = [];
  for (const u of [signal.accountUrl, signal.contentUrl]) {
    const identity = classifyUrlForIdentity(u);
    if (identity.kind === "SUPPLIER_OWNED_DOMAIN" && identity.domain) {
      domains.push(identity.domain);
    } else if (identity.kind === "PLATFORM_ACCOUNT_IDENTITY" && identity.accountKey) {
      platformAccounts.push({ platform: identity.platform!, accountKey: identity.accountKey });
    }
  }

  return {
    companyNameCandidates: names,
    unifiedSocialCreditCode: uscc,
    phones,
    domains: take(domains, 3),
    platformAccounts: take(platformAccounts, 3),
  };
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

export interface PriorLinkedIdentities {
  /**
   * 已 LINKED 信号沉淀的供应商**自有域名** → 该身份历史上关联过的全部 supplierId 集合。
   * F1（Identity Collision Closure）：绝不允许 first-wins/last-wins 把冲突历史静默
   * 折叠成单一供应商——同一强身份出现 >1 家即冲突，交人审。（平台域名永不入此表，B2）
   */
  ownedDomains: Map<string, Set<string>>;
  /** 已 LINKED 信号沉淀的平台**精确账号键** → supplierId 集合（exact account，非裸 host；同上冲突纪律） */
  platformAccounts: Map<string, Set<string>>;
}

/** F1.3：确定性冲突元数据（supplierIds 排序，跨 org 数据永不入内——builder 本身 org-scoped） */
function identityCollisionConflict(identityType: string, identityKey: string, supplierIds: string[]): string {
  return `强身份冲突 identityType=${identityType} identityKey=${identityKey} supplierIds=[${[...supplierIds].sort().join(",")}]——不得自动挑选，需人工裁决`;
}

/**
 * 纯函数解析核心（B2 重构）：强键 = 自有域名（官网/已档）、联系电话、
 * 已人工验证的平台精确账号；平台 host 与内容页永不构成身份。
 */
export function resolveSupplierEntityPure(
  hints: ExtractedEntityHints,
  suppliers: SupplierRowForResolution[],
  prior: PriorLinkedIdentities,
): SupplierEntityResolutionResult {
  const matchedSources: SupplierEntityResolutionResult["matchedSources"] = [];
  const conflicts: string[] = [];

  // 键 2a：供应商自有域名（官网字段 or 已档 LINKED 来源）——强键。
  // 供应商主表 website 若填的是平台链接（如抖音主页），不算自有域名（B2 守卫）。
  // F1：同一身份键的历史关联集 size>1 = 冲突——全部 id 逐个计入 matchedSources
  //（让 strongSuppliers>1 分支确定性接管 → NEEDS_HUMAN_REVIEW）+ 冲突元数据入 conflicts。
  for (const domain of hints.domains) {
    const priorSet = prior.ownedDomains.get(domain);
    if (priorSet && priorSet.size > 0) {
      for (const sid of [...priorSet].sort()) {
        matchedSources.push({ kind: "archived_supplier_domain", key: domain, supplierId: sid });
      }
      if (priorSet.size > 1) {
        conflicts.push(identityCollisionConflict("archived_supplier_domain", domain, [...priorSet]));
      }
    }
    for (const s of suppliers) {
      if (!s.website) continue;
      const siteIdentity = classifyUrlForIdentity(s.website);
      if (siteIdentity.kind !== "SUPPLIER_OWNED_DOMAIN") continue;
      if (siteIdentity.domain === domain) {
        matchedSources.push({ kind: "supplier_owned_domain", key: domain, supplierId: s.id });
      }
    }
  }
  // 键 2b：平台精确账号（仅人工 LINKED 沉淀过的 exact account）——已验证身份提示。
  // 同平台不同账号（同为 douyin.com）绝不互相匹配（S2-FR-T4）；
  // 同一精确账号历史上关联过多家（S2-FR-T10）→ 冲突，同上纪律。
  for (const account of hints.platformAccounts) {
    const priorSet = prior.platformAccounts.get(account.accountKey);
    if (priorSet && priorSet.size > 0) {
      for (const sid of [...priorSet].sort()) {
        matchedSources.push({ kind: "platform_account", key: account.accountKey, supplierId: sid });
      }
      if (priorSet.size > 1) {
        conflicts.push(identityCollisionConflict("platform_account", account.accountKey, [...priorSet]));
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
  // B2：LINKED 沉淀按身份分级入库——自有域名与平台精确账号分表；
  // 平台裸 host / 内容页 URL 什么都不沉淀（同 host ≠ 同供应商）。
  // F1：同一身份键收集**全部**历史 supplierId（Set 去重）——绝不 first-wins，
  // 冲突历史必须原样暴露给 resolver 裁决（历史脏数据可读、可判、不折叠）。
  const prior: PriorLinkedIdentities = {
    ownedDomains: new Map<string, Set<string>>(),
    platformAccounts: new Map<string, Set<string>>(),
  };
  const addTo = (map: Map<string, Set<string>>, key: string, supplierId: string) => {
    const set = map.get(key);
    if (set) set.add(supplierId);
    else map.set(key, new Set([supplierId]));
  };
  for (const row of linked) {
    if (!row.linkedSupplierId) continue;
    for (const u of [row.accountUrl, row.contentUrl]) {
      const identity = classifyUrlForIdentity(u);
      if (identity.kind === "SUPPLIER_OWNED_DOMAIN" && identity.domain) {
        addTo(prior.ownedDomains, identity.domain, row.linkedSupplierId);
      } else if (identity.kind === "PLATFORM_ACCOUNT_IDENTITY" && identity.accountKey) {
        addTo(prior.platformAccounts, identity.accountKey, row.linkedSupplierId);
      }
    }
  }

  const hints = extractEntityHints(signal);
  const result = resolveSupplierEntityPure(hints, suppliers, prior);

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
