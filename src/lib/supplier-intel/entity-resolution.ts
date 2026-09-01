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
  /**
   * 非平台/非市场的普通 web 域名。B4 冻结：这只说明「URL 形态是个网站」，
   * **不证明供应商拥有该域名**——新闻/行业目录/博客/经销商页都长这样。
   * 域名要成为强身份，只能与 canonical 所有权源（Supplier.website）对质成立；
   * LINK 历史永不把 WEB_DOMAIN 沉淀为 owned。
   */
  | "WEB_DOMAIN"
  | "PLATFORM_ACCOUNT_IDENTITY" // 平台上的**精确账号页**（人工 LINKED 沉淀后可作已验证身份提示）
  | "CONTENT_URL" // 平台上的单条视频/帖子/商品页——最多是 provenance，永不身份
  | "UNKNOWN_URL";

export interface UrlIdentity {
  kind: UrlIdentityKind;
  /** WEB_DOMAIN：归一化域名（观察级，所有权未证） */
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
  return domain ? { kind: "WEB_DOMAIN", domain } : { kind: "UNKNOWN_URL" };
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
  /**
   * 观察到的普通 web 域名（B2：平台/市场 host 永不入列；B4：这是**观察级**线索，
   * 不自证所有权——只允许与 canonical Supplier.website 对质产生强匹配，
   * 永不与 LINK 历史沉淀出的任何「owned」集合对质）。
   */
  observedWebDomains: string[];
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

  // B2/B4：URL 按身份分级——观察级 web 域名与平台精确账号分流；内容页/未知一律弃
  const observedWebDomains: string[] = [];
  const platformAccounts: Array<{ platform: string; accountKey: string }> = [];
  for (const u of [signal.accountUrl, signal.contentUrl]) {
    const identity = classifyUrlForIdentity(u);
    if (identity.kind === "WEB_DOMAIN" && identity.domain) {
      observedWebDomains.push(identity.domain);
    } else if (identity.kind === "PLATFORM_ACCOUNT_IDENTITY" && identity.accountKey) {
      platformAccounts.push({ platform: identity.platform!, accountKey: identity.accountKey });
    }
  }

  return {
    companyNameCandidates: names,
    unifiedSocialCreditCode: uscc,
    phones,
    observedWebDomains: take(observedWebDomains, 3),
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
   * 显式复核过的「官方站域名」→ supplierId 集合。
   * B4 冻结：**LINK 历史永不填充本表**——把信号（尤其 PUBLIC_WEB 的 contentUrl：
   * 新闻/行业目录/博客/经销商页）关联到供应商，不构成对该域名的所有权；
   * M1 生产路径本表恒空，域名所有权唯一 canonical 源 = Supplier.website。
   * 保留此位是给未来「显式复核的官方站身份」用，且沿用 F1 冲突纪律
   *（Set 收集全量、>1 家即人审、first-wins 不可能）。
   */
  ownedDomains: Map<string, Set<string>>;
  /** 已 LINKED 信号沉淀的平台**精确账号键** → supplierId 集合（exact account，非裸 host；F1 冲突纪律） */
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
  opts?: {
    /**
     * B5：身份宇宙是否已被**完整**扫描（供应商行 + LINKED 身份史全量）。
     * false = 明知不完整——此时禁止给出高置信 MATCHED_EXISTING（局部真相可能漏掉
     * 冲突的另一半），一律降级 NEEDS_HUMAN_REVIEW 并显式标 IDENTITY_SCAN_INCOMPLETE。
     */
    scanComplete?: boolean;
  },
): SupplierEntityResolutionResult {
  const scanComplete = opts?.scanComplete !== false;
  const matchedSources: SupplierEntityResolutionResult["matchedSources"] = [];
  const conflicts: string[] = [];

  // 键 2a：域名。B4 语义拆分：
  //   观察级 web 域名（hints.observedWebDomains）只能与 canonical 所有权源对质——
  //   (i) 显式复核集 prior.ownedDomains（M1 生产恒空，LINK 永不填充）；
  //   (ii) Supplier.website（且 website 本身必须是 WEB_DOMAIN 形态——填平台链接不算，B2 守卫）。
  //   仅凭「某内容页长在域名 X 上」永远推不出「供应商拥有 X」。
  // F1：同一身份键关联集 size>1 = 冲突——全部 id 计入 matchedSources
  //（strongSuppliers>1 分支确定性接管 → NEEDS_HUMAN_REVIEW）+ 冲突元数据入 conflicts。
  for (const domain of hints.observedWebDomains) {
    const priorSet = prior.ownedDomains.get(domain);
    if (priorSet && priorSet.size > 0) {
      for (const sid of [...priorSet].sort()) {
        matchedSources.push({ kind: "reviewed_owned_domain", key: domain, supplierId: sid });
      }
      if (priorSet.size > 1) {
        conflicts.push(identityCollisionConflict("reviewed_owned_domain", domain, [...priorSet]));
      }
    }
    for (const s of suppliers) {
      if (!s.website) continue;
      const siteIdentity = classifyUrlForIdentity(s.website);
      if (siteIdentity.kind !== "WEB_DOMAIN") continue;
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
    if (!scanComplete) {
      // B5 fail-closed：扫描不完整时绝不高置信匹配（漏页可能藏着冲突的另一半）
      conflicts.push(
        "IDENTITY_SCAN_INCOMPLETE：身份历史扫描未完整（触及安全上限），禁止高置信匹配——交人工裁决",
      );
      return {
        decision: "NEEDS_HUMAN_REVIEW",
        supplierId: undefined,
        legalName: undefined,
        candidateNames: hints.companyNameCandidates,
        confidence: 0.6,
        matchedSignals: signalsOf(matchedSources),
        matchedSources,
        conflicts,
      };
    }
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

  // B5：身份裁决禁止「前 500 行局部真相」——按稳定键（id asc）游标分页穷尽
  // org 内相关记录；触及安全上限仍有余量 → scanComplete=false（resolver 侧
  // fail-closed，绝不基于已知不完整的身份宇宙给高置信匹配）。分页是纯 DB 游标，
  // 零 N+1 网络路径。
  const PAGE_SIZE = 500;
  const MAX_PAGES = 40; // 安全上限（40×500=2 万行/类）；触顶即 fail-closed，绝不静默截断
  let scanComplete = true;

  async function fetchAllPages<T extends { id: string }>(
    fetchPage: (cursor: string | null) => Promise<T[]>,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await fetchPage(cursor);
      all.push(...rows);
      if (rows.length < PAGE_SIZE) return all;
      cursor = rows[rows.length - 1].id;
    }
    scanComplete = false; // 还有余量没读完
    return all;
  }

  const suppliers = await fetchAllPages((cursor) =>
    db.supplier.findMany({
      where: { orgId: actor.orgId, status: "active" },
      select: { id: true, name: true, website: true, contactPhone: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  );
  const linked = await fetchAllPages((cursor) =>
    db.supplierDiscoverySignal.findMany({
      where: { orgId: actor.orgId, status: "LINKED", linkedSupplierId: { not: null } },
      select: { id: true, accountUrl: true, contentUrl: true, linkedSupplierId: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
  );

  // B2/B4：LINKED 沉淀**只**产平台精确账号身份。域名一律不沉淀——把一条
  // 新闻/博客/目录页信号 LINK 给供应商，不构成对该域名的所有权
  //（域名所有权唯一 canonical 源 = Supplier.website，在 resolver 内对质）。
  // F1：同一账号键收集全部历史 supplierId（Set 去重）——first-wins 不可能。
  const prior: PriorLinkedIdentities = {
    ownedDomains: new Map<string, Set<string>>(), // B4：生产恒空（见接口注释）
    platformAccounts: new Map<string, Set<string>>(),
  };
  for (const row of linked) {
    if (!row.linkedSupplierId) continue;
    for (const u of [row.accountUrl, row.contentUrl]) {
      const identity = classifyUrlForIdentity(u);
      if (identity.kind === "PLATFORM_ACCOUNT_IDENTITY" && identity.accountKey) {
        const set = prior.platformAccounts.get(identity.accountKey);
        if (set) set.add(row.linkedSupplierId);
        else prior.platformAccounts.set(identity.accountKey, new Set([row.linkedSupplierId]));
      }
    }
  }

  const hints = extractEntityHints(signal);
  const result = resolveSupplierEntityPure(hints, suppliers, prior, { scanComplete });

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
