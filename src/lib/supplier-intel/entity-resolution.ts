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

import { normalizeBuyerName, normalizeWebsiteDomain } from "@/lib/corporate-memory/normalize";
import { db } from "@/lib/db";
import type { SupplierIntelActor } from "./actor";
import { SupplierIntelError } from "./errors";
import { assertSignalAccess } from "./signal-scope";
import { appendResolutionEntry } from "./signal-write-lock";
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
  /** BL-2：身份宇宙扫描完整性（与 decision 分离；不完整时 decision 恒为 NEEDS_HUMAN_REVIEW） */
  scan: IdentityScanStatus;
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

/* ------------------------- BL-2：身份宇宙扫描完整性（与解析结论分离） ------------------------- */

/** 机器可读原因码：返回值 conflicts、scan.reasonCode 与持久快照共用同一常量 */
export const IDENTITY_SCAN_INCOMPLETE = "IDENTITY_SCAN_INCOMPLETE" as const;

/**
 * 生产分页参数（B5 冻结：500/页 × 40 页 = 2 万行/类）。
 * 测试注入（resolveSignalEntityWithPagination）只能在此上限内**收窄**，不能放宽；
 * HTTP 路由只允许调用 resolveSignalEntity（生产常量），不暴露任何分页参数。
 */
export const IDENTITY_SCAN_PAGINATION = { PAGE_SIZE: 500, MAX_PAGES: 40 } as const;

export interface IdentityScanPagination {
  pageSize: number;
  maxPages: number;
}

/** 单类扫描（供应商行 / LINKED 身份史）的真实分页结果 */
export interface IdentityScanPassStatus {
  complete: boolean;
  /** 实际读取的页数 */
  pages: number;
  /** 实际读入身份集合的行数 */
  rows: number;
  /** true = 触及 maxPages 且末页仍满页——余量未读，不得当作扫描完成 */
  capped: boolean;
}

/**
 * 扫描完整性元数据：由服务层真实分页结果产生（不接受客户端声明），
 * 随解析结果返回并原样 append 进 resolutionJson（返回值与持久快照一致）。
 */
export interface IdentityScanStatus {
  suppliers: IdentityScanPassStatus;
  linkedHistory: IdentityScanPassStatus;
  /** 整体完整 = 两类扫描均完整 */
  complete: boolean;
  /** 不完整时恒为 IDENTITY_SCAN_INCOMPLETE；完整时 null */
  reasonCode: typeof IDENTITY_SCAN_INCOMPLETE | null;
  pageSize: number;
  maxPages: number;
}

export function identityScanStatusOf(
  suppliers: IdentityScanPassStatus,
  linkedHistory: IdentityScanPassStatus,
  pagination: IdentityScanPagination,
): IdentityScanStatus {
  const complete = suppliers.complete && linkedHistory.complete;
  return {
    suppliers,
    linkedHistory,
    complete,
    reasonCode: complete ? null : IDENTITY_SCAN_INCOMPLETE,
    pageSize: pagination.pageSize,
    maxPages: pagination.maxPages,
  };
}

/**
 * 纯核默认值：调用方把**整个**身份宇宙以内存数组传入（无分页）——按构造即完整，
 * rows 如实取自传入集合大小（不伪造覆盖率）。服务层永远显式传真实分页状态。
 */
export function inMemoryIdentityScanStatus(rows: {
  suppliers: number;
  linkedHistory: number;
}): IdentityScanStatus {
  return identityScanStatusOf(
    { complete: true, pages: 1, rows: rows.suppliers, capped: false },
    { complete: true, pages: 1, rows: rows.linkedHistory, capped: false },
    { pageSize: IDENTITY_SCAN_PAGINATION.PAGE_SIZE, maxPages: IDENTITY_SCAN_PAGINATION.MAX_PAGES },
  );
}

function isScanPassStatus(v: unknown): v is IdentityScanPassStatus {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.complete === "boolean" &&
    typeof o.pages === "number" &&
    typeof o.rows === "number" &&
    typeof o.capped === "boolean"
  );
}

export type RecordedIdentityScan =
  | { recorded: true; scan: IdentityScanStatus }
  | { recorded: false; reason: "MISSING" | "MALFORMED" };

/**
 * 读取历史 resolutionJson 条目的扫描状态。BL-2 之前写入的条目没有 scan 字段——
 * 按「未记录」处理（recorded:false），绝不默认解释为 COMPLETE；不回填、不改写历史快照。
 */
export function readIdentityScanFromResolutionEntry(entry: unknown): RecordedIdentityScan {
  if (typeof entry !== "object" || entry === null) return { recorded: false, reason: "MISSING" };
  const raw = (entry as { scan?: unknown }).scan;
  if (raw === undefined || raw === null) return { recorded: false, reason: "MISSING" };
  if (typeof raw !== "object") return { recorded: false, reason: "MALFORMED" };
  const o = raw as Record<string, unknown>;
  if (
    !isScanPassStatus(o.suppliers) ||
    !isScanPassStatus(o.linkedHistory) ||
    typeof o.complete !== "boolean" ||
    !(o.reasonCode === null || o.reasonCode === IDENTITY_SCAN_INCOMPLETE) ||
    typeof o.pageSize !== "number" ||
    typeof o.maxPages !== "number"
  ) {
    return { recorded: false, reason: "MALFORMED" };
  }
  return { recorded: true, scan: o as unknown as IdentityScanStatus };
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
     * BL-2：身份宇宙扫描完整性——服务层必须传真实分页结果；纯核调用方省略 = 传入的是
     * 内存全集（按构造完整）。任一必需扫描不完整 → 保守策略：
     *   decision=NEEDS_HUMAN_REVIEW、supplierId=undefined、conflicts 显式记录
     *   IDENTITY_SCAN_INCOMPLETE；已发现的强键命中 / F1 冲突元数据 / 名称与模糊候选全部保留。
     * 「不完整扫描后没找到」绝不显示为「已确认 NEW_SUPPLIER_CANDIDATE」。
     */
    scan?: IdentityScanStatus;
  },
): SupplierEntityResolutionResult {
  const scan =
    opts?.scan ??
    inMemoryIdentityScanStatus({
      suppliers: suppliers.length,
      linkedHistory: [...prior.ownedDomains.values(), ...prior.platformAccounts.values()].reduce(
        (n, set) => n + set.size,
        0,
      ),
    });
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

  // 键 6：模糊相似——只产候选（既有语义：无强键且无归一名等值时才求）；
  // 扫描不完整时同样求值，以便把候选证据一并交给人审（不丢证据）。
  let fuzzyBest: { supplierId: string; name: string; score: number } | null = null;
  if (strongSuppliers.length === 0 && nameEqHits.length === 0) {
    for (const cand of hints.companyNameCandidates) {
      for (const s of suppliers) {
        const score = nameOverlap(cand, s.name);
        if (score >= FUZZY_CANDIDATE_THRESHOLD && (!fuzzyBest || score > fuzzyBest.score)) {
          fuzzyBest = { supplierId: s.id, name: s.name, score };
        }
      }
    }
    if (fuzzyBest) {
      matchedSources.push({ kind: "fuzzy_name", key: fuzzyBest.name, supplierId: fuzzyBest.supplierId });
    }
  }

  // BL-2 保守策略：任一必需扫描不完整 → 一律人审；不返回 MATCHED_EXISTING，也不确认 NEW；
  // 上面已收集的命中 / 冲突 / 候选原样保留（不提前 return 丢证据）。
  if (!scan.complete) {
    conflicts.push(
      `${IDENTITY_SCAN_INCOMPLETE}：身份宇宙扫描未完整（suppliers=${scan.suppliers.complete ? "complete" : "incomplete"} linkedHistory=${scan.linkedHistory.complete ? "complete" : "incomplete"}；触及安全上限 ${scan.maxPages}×${scan.pageSize}）——禁止高置信匹配，也不得确认为新供应商——交人工裁决`,
    );
    const confidence = strongSuppliers.length > 0 ? 0.6 : nameEqHits.length > 0 || fuzzyBest ? 0.5 : 0.3;
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      supplierId: undefined,
      legalName: undefined,
      candidateNames: hints.companyNameCandidates,
      confidence,
      matchedSignals: signalsOf(matchedSources),
      matchedSources,
      conflicts,
      scan,
    };
  }

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
      scan,
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
      scan,
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
      scan,
    };
  }
  if (fuzzyBest) {
    return {
      decision: "NEEDS_HUMAN_REVIEW",
      supplierId: fuzzyBest.supplierId,
      legalName: fuzzyBest.name,
      candidateNames: hints.companyNameCandidates,
      confidence: 0.55,
      matchedSignals: signalsOf(matchedSources),
      matchedSources,
      conflicts,
      scan,
    };
  }
  return {
    decision: "NEW_SUPPLIER_CANDIDATE",
    candidateNames: hints.companyNameCandidates,
    confidence: 0.2,
    matchedSignals: [],
    matchedSources,
    conflicts,
    scan,
  };
}

function clampPagination(p: IdentityScanPagination): IdentityScanPagination {
  const norm = (v: number, max: number) =>
    Number.isFinite(v) ? Math.min(max, Math.max(1, Math.floor(v))) : max;
  return {
    pageSize: norm(p.pageSize, IDENTITY_SCAN_PAGINATION.PAGE_SIZE),
    maxPages: norm(p.maxPages, IDENTITY_SCAN_PAGINATION.MAX_PAGES),
  };
}

/**
 * 稳定键（id asc）游标穷尽分页；返回真实分页结果（页数 / 行数 / 是否触顶）。
 * 触顶（maxPages 用尽且末页仍满页）→ complete=false、capped=true——余量未读，绝不静默截断。
 */
async function fetchAllPages<T extends { id: string }>(
  fetchPage: (cursor: string | null, take: number) => Promise<T[]>,
  pagination: IdentityScanPagination,
): Promise<{ rows: T[]; status: IdentityScanPassStatus }> {
  const all: T[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (let page = 0; page < pagination.maxPages; page++) {
    const rows = await fetchPage(cursor, pagination.pageSize);
    pages += 1;
    all.push(...rows);
    if (rows.length < pagination.pageSize) {
      return { rows: all, status: { complete: true, pages, rows: all.length, capped: false } };
    }
    cursor = rows[rows.length - 1].id;
  }
  return { rows: all, status: { complete: false, pages, rows: all.length, capped: true } };
}

/**
 * 服务：对某条信号做解析预填，结果 append 进 resolutionJson（人工改判也 append）。
 * 生产入口：固定使用 IDENTITY_SCAN_PAGINATION（500/页 × 40 页）。
 */
export async function resolveSignalEntity(actor: SupplierIntelActor, signalId: string) {
  return resolveSignalEntityWithPagination(actor, signalId, {
    pageSize: IDENTITY_SCAN_PAGINATION.PAGE_SIZE,
    maxPages: IDENTITY_SCAN_PAGINATION.MAX_PAGES,
  });
}

/**
 * 内部/测试注入点（BL-2）：以小 fixture 触发与生产同构的触顶路径。
 * 只允许服务端代码调用；分页参数只能在生产上限内收窄（clampPagination），
 * 不暴露为任何 HTTP 参数（governance 守卫断言 resolve 路由不引用本函数）。
 */
export async function resolveSignalEntityWithPagination(
  actor: SupplierIntelActor,
  signalId: string,
  pagination: IdentityScanPagination,
) {
  // R1：resolve 会 append resolutionJson = 业务写入，不是无副作用读取。
  // 先按最小归属元数据断言项目写权限（授权前不读取信号正文、不执行任何写入）。
  await assertSignalAccess(actor, signalId, "write");

  const signal = await db.supplierDiscoverySignal.findFirst({
    where: { id: signalId, orgId: actor.orgId },
  });
  if (!signal) throw new SupplierIntelError("NOT_FOUND", "发现信号不存在");

  // B5：身份裁决禁止「前 500 行局部真相」——按稳定键（id asc）游标分页穷尽
  // org 内相关记录；触及安全上限仍有余量 → 该类扫描 complete=false，resolver 侧
  // fail-closed（BL-2：任一类不完整即整体不完整 → 一律人审）。分页是纯 DB 游标，零 N+1 网络路径。
  //
  // R1 不变量（项目可见性 ≠ 身份裁决完整性）：以下两类扫描**恒为 org 全量**，
  // 绝不按「当前用户可见项目」裁剪。若把受保护项目里的同身份记录过滤掉，扫描仍会
  // 自称 complete，然后返回强匹配——那正是把授权过滤伪装成完整宇宙。
  // 受保护项目的内容不会外泄：本函数只从这些行取 accountUrl/contentUrl 计算身份键，
  // 且身份键来自**当前信号自带的线索**；返回值只含 org 级实体（supplierId）与冲突摘要，
  // 不含其他项目的正文、备注或证据。冲突存在时由 F1 分支降级为 NEEDS_HUMAN_REVIEW。
  const paging = clampPagination(pagination);

  const suppliersScan = await fetchAllPages(
    (cursor, take) =>
      db.supplier.findMany({
        where: { orgId: actor.orgId, status: "active" },
        select: { id: true, name: true, website: true, contactPhone: true },
        orderBy: { id: "asc" },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    paging,
  );
  const linkedScan = await fetchAllPages(
    (cursor, take) =>
      db.supplierDiscoverySignal.findMany({
        where: { orgId: actor.orgId, status: "LINKED", linkedSupplierId: { not: null } },
        select: { id: true, accountUrl: true, contentUrl: true, linkedSupplierId: true },
        orderBy: { id: "asc" },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    paging,
  );
  const scan = identityScanStatusOf(suppliersScan.status, linkedScan.status, paging);

  // B2/B4：LINKED 沉淀**只**产平台精确账号身份。域名一律不沉淀——把一条
  // 新闻/博客/目录页信号 LINK 给供应商，不构成对该域名的所有权
  //（域名所有权唯一 canonical 源 = Supplier.website，在 resolver 内对质）。
  // F1：同一账号键收集全部历史 supplierId（Set 去重）——first-wins 不可能。
  const prior: PriorLinkedIdentities = {
    ownedDomains: new Map<string, Set<string>>(), // B4：生产恒空（见接口注释）
    platformAccounts: new Map<string, Set<string>>(),
  };
  for (const row of linkedScan.rows) {
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
  const result = resolveSupplierEntityPure(hints, suppliersScan.rows, prior, { scan });

  // 返回值与持久快照一致：result.scan 与顶层 scan 是同一对象；历史条目只 append，不改写。
  //
  // S3-A §9B：追加走行锁 + 锁内重读的短事务。上面的分页身份扫描（可能是数万行）与任何
  // 网络调用都发生在事务之外——锁只覆盖「读最新数组 → 追加 → 提交」这一小段，
  // 因此并发的人工 link/reject 与本次预填互相串行，双方条目都不会丢。
  const entry = {
    phase: "AUTO_PREFILL",
    result,
    hints,
    scan,
    at: new Date().toISOString(),
    byUserId: actor.userId,
  };
  await appendResolutionEntry(actor, signal.id, entry);
  return result;
}
