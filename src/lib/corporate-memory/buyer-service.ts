// ============================================================
// Buyer canonical identity service（T3）
//
// 身份规则（§10/§11）：
// - canonical identity 不得仅靠名字；匹配優先级 = externalIdentifier > websiteDomain > normalizedName/alias
// - 同 normalizedName 但强身份信号（域名）冲突 → 绝不合并：新建独立记录并标 NEEDS_REVIEW
// - 禁止 fuzzy similarity 阈值合并；禁止 LLM 合并
// - Buyer merge 本轮 NOT_IMPLEMENTED（见 mergeBuyers 的未来契约注释）
// ============================================================

import type { Buyer, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { requireMemoryReadAccess, requireMemoryWriteAccess } from "./access";
import { normalizeBuyerName, normalizeWebsiteDomain } from "./normalize";
import {
  BUYER_TYPES,
  CorporateMemoryError,
  MEMORY_LIMITS,
  requireBoundedJson,
  requireBoundedString,
  requireVocab,
  type MemoryActorInput,
} from "./types";

export type BuyerMatchedBy =
  | "external_identifier"
  | "website_domain"
  | "normalized_name"
  | "alias";

export interface BuyerMatch {
  buyer: Buyer;
  matchedBy: BuyerMatchedBy;
}

export interface CreateBuyerInput {
  orgId: string;
  actor: MemoryActorInput;
  canonicalName: string;
  buyerType?: string;
  country?: string;
  province?: string;
  city?: string;
  /// 域名或完整 URL；确定性归一后存 websiteDomain
  websiteDomain?: string;
  officialWebsite?: string;
  aliases?: string[];
  /// { sourceSystem: identifier }，如 { bidtogo: "B-1029" }
  externalIdentifiers?: Record<string, string>;
  metadata?: unknown;
}

export interface CreateBuyerResult {
  buyer: Buyer;
  /// false = 命中既有 canonical 记录（幂等返回，未新建）
  created: boolean;
  matchedBy?: BuyerMatchedBy;
  /// 同名但强身份信号冲突时：新记录 NEEDS_REVIEW 并回指冲突的既有记录
  identityConflictBuyerId?: string;
}

/// dedupe 匹配只考虑可作为 canonical 目标的状态（MERGED/INACTIVE 不吸收新记录）
const MATCHABLE_STATUSES = ["ACTIVE", "NEEDS_REVIEW"] as const;
/// alias normalized 比对的候选扫描上限（确定性有界；超界场景记录于报告 Known Gaps）
const ALIAS_SCAN_CAP = 200;

interface NormalizedBuyerIdentity {
  canonicalName: string;
  normalizedName: string;
  websiteDomain: string | null;
  externalIdentifiers: Record<string, string> | null;
}

type DbClient = typeof db | Prisma.TransactionClient;

/**
 * 确定性 canonical 匹配（无 fuzzy、无 LLM）：
 * 1. externalIdentifier 精确命中（按 key 排序遍历，保证确定性）
 * 2. websiteDomain 精确命中
 * 3. normalizedName 精确命中
 * 4. 显式 alias（normalize 后精确等值）命中
 * 均按 createdAt asc 取最早记录；无命中返回 null。
 */
export async function findBuyerMatch(
  client: DbClient,
  orgId: string,
  identity: NormalizedBuyerIdentity,
): Promise<BuyerMatch | null> {
  const baseWhere = { orgId, status: { in: [...MATCHABLE_STATUSES] } };

  if (identity.externalIdentifiers) {
    for (const key of Object.keys(identity.externalIdentifiers).sort()) {
      const value = identity.externalIdentifiers[key];
      const hit = await client.buyer.findFirst({
        where: {
          ...baseWhere,
          externalIdentifiers: { path: [key], equals: value },
        },
        orderBy: { createdAt: "asc" },
      });
      if (hit) return { buyer: hit, matchedBy: "external_identifier" };
    }
  }

  if (identity.websiteDomain) {
    const hit = await client.buyer.findFirst({
      where: { ...baseWhere, websiteDomain: identity.websiteDomain },
      orderBy: { createdAt: "asc" },
    });
    if (hit) return { buyer: hit, matchedBy: "website_domain" };
  }

  const nameHit = await client.buyer.findFirst({
    where: { ...baseWhere, normalizedName: identity.normalizedName },
    orderBy: { createdAt: "asc" },
  });
  if (nameHit) return { buyer: nameHit, matchedBy: "normalized_name" };

  const aliasCandidates = await client.buyer.findMany({
    where: { ...baseWhere, NOT: { aliases: { isEmpty: true } } },
    orderBy: { createdAt: "asc" },
    take: ALIAS_SCAN_CAP,
  });
  for (const candidate of aliasCandidates) {
    if (
      candidate.aliases.some(
        (alias) => normalizeBuyerName(alias) === identity.normalizedName,
      )
    ) {
      return { buyer: candidate, matchedBy: "alias" };
    }
  }
  return null;
}

function validateCreateBuyerInput(input: CreateBuyerInput): {
  identity: NormalizedBuyerIdentity;
  data: Omit<
    Prisma.BuyerUncheckedCreateInput,
    "orgId" | "createdById" | "status"
  >;
} {
  const canonicalName = requireBoundedString(
    input.canonicalName,
    "canonicalName",
    MEMORY_LIMITS.CANONICAL_NAME_MAX_CHARS,
  ) as string;
  const normalizedName = normalizeBuyerName(canonicalName);
  if (!normalizedName) {
    throw new CorporateMemoryError(
      "INVALID_INPUT",
      "canonicalName 归一化后为空",
    );
  }

  const buyerType =
    input.buyerType === undefined || input.buyerType === null
      ? null
      : requireVocab(input.buyerType, BUYER_TYPES, "buyerType");

  let websiteDomain: string | null = null;
  if (input.websiteDomain !== undefined && input.websiteDomain !== null) {
    websiteDomain = normalizeWebsiteDomain(input.websiteDomain);
    if (!websiteDomain) {
      throw new CorporateMemoryError("INVALID_INPUT", "websiteDomain 非法");
    }
  } else if (input.officialWebsite) {
    // officialWebsite 可派生域名；派生失败不报错（officialWebsite 本身另存）
    websiteDomain = normalizeWebsiteDomain(input.officialWebsite);
  }

  const aliases: string[] = [];
  if (input.aliases !== undefined && input.aliases !== null) {
    if (!Array.isArray(input.aliases)) {
      throw new CorporateMemoryError("INVALID_INPUT", "aliases 必须是字符串数组");
    }
    if (input.aliases.length > MEMORY_LIMITS.ALIASES_MAX_COUNT) {
      throw new CorporateMemoryError(
        "INVALID_INPUT",
        `aliases 超出上限 ${MEMORY_LIMITS.ALIASES_MAX_COUNT} 条`,
      );
    }
    for (const raw of input.aliases) {
      const alias = requireBoundedString(
        raw,
        "aliases[]",
        MEMORY_LIMITS.ALIAS_MAX_CHARS,
      ) as string;
      if (!aliases.includes(alias)) aliases.push(alias);
    }
  }

  let externalIdentifiers: Record<string, string> | null = null;
  if (
    input.externalIdentifiers !== undefined &&
    input.externalIdentifiers !== null
  ) {
    if (
      typeof input.externalIdentifiers !== "object" ||
      Array.isArray(input.externalIdentifiers)
    ) {
      throw new CorporateMemoryError(
        "INVALID_INPUT",
        "externalIdentifiers 必须是 { sourceSystem: identifier } 对象",
      );
    }
    const entries = Object.entries(input.externalIdentifiers);
    if (entries.length > 0) {
      externalIdentifiers = {};
      for (const [key, value] of entries) {
        const k = requireBoundedString(key, "externalIdentifiers key", 100) as string;
        const v = requireBoundedString(
          value,
          `externalIdentifiers.${k}`,
          300,
        ) as string;
        externalIdentifiers[k] = v;
      }
      requireBoundedJson(externalIdentifiers, "externalIdentifiers");
    }
  }

  const metadata = requireBoundedJson(input.metadata, "metadata");

  return {
    identity: { canonicalName, normalizedName, websiteDomain, externalIdentifiers },
    data: {
      canonicalName,
      normalizedName,
      buyerType,
      country: requireBoundedString(input.country, "country", 100, { optional: true }),
      province: requireBoundedString(input.province, "province", 100, { optional: true }),
      city: requireBoundedString(input.city, "city", 100, { optional: true }),
      websiteDomain,
      officialWebsite: requireBoundedString(
        input.officialWebsite,
        "officialWebsite",
        MEMORY_LIMITS.URL_MAX_CHARS,
        { optional: true },
      ),
      aliases,
      externalIdentifiers:
        externalIdentifiers === null
          ? undefined
          : (externalIdentifiers as Prisma.InputJsonValue),
      metadata: metadata === null ? undefined : (metadata as Prisma.InputJsonValue),
    },
  };
}

/**
 * 创建 canonical Buyer（含受控 dedupe）：
 * - 强身份命中（externalIdentifier / websiteDomain）→ 幂等返回既有记录
 * - normalizedName / alias 命中且无域名冲突 → 幂等返回既有记录
 * - normalizedName / alias 命中但双方域名均存在且不同 → 不合并：新建 NEEDS_REVIEW 记录并回指冲突记录
 * - 无命中 → 新建 ACTIVE
 */
export async function createBuyer(
  input: CreateBuyerInput,
): Promise<CreateBuyerResult> {
  const access = await requireMemoryWriteAccess({
    orgId: input.orgId,
    actor: input.actor,
  });
  const { identity, data } = validateCreateBuyerInput(input);

  return db.$transaction(async (tx) => {
    const match = await findBuyerMatch(tx, access.orgId, identity);

    if (match) {
      const strong =
        match.matchedBy === "external_identifier" ||
        match.matchedBy === "website_domain";
      const domainConflict =
        !strong &&
        identity.websiteDomain !== null &&
        match.buyer.websiteDomain !== null &&
        match.buyer.websiteDomain !== identity.websiteDomain;

      if (!domainConflict) {
        return { buyer: match.buyer, created: false, matchedBy: match.matchedBy };
      }

      const conflicted = await tx.buyer.create({
        data: {
          ...data,
          orgId: access.orgId,
          status: "NEEDS_REVIEW",
          createdById: access.userId,
          metadata: {
            ...(data.metadata as Record<string, unknown> | undefined),
            identityConflict: {
              conflictBuyerId: match.buyer.id,
              matchedBy: match.matchedBy,
              reason: "same_normalized_name_different_domain",
            },
          } as Prisma.InputJsonValue,
        },
      });
      await writeAuditLog(tx, {
        userId: access.userId,
        orgId: access.orgId,
        action: "buyer_created",
        targetType: "buyer",
        targetId: conflicted.id,
        afterData: {
          normalizedName: identity.normalizedName,
          websiteDomain: identity.websiteDomain,
          status: "NEEDS_REVIEW",
          identityConflictBuyerId: match.buyer.id,
        },
      });
      return {
        buyer: conflicted,
        created: true,
        matchedBy: match.matchedBy,
        identityConflictBuyerId: match.buyer.id,
      };
    }

    const created = await tx.buyer.create({
      data: {
        ...data,
        orgId: access.orgId,
        status: "ACTIVE",
        createdById: access.userId,
      },
    });
    await writeAuditLog(tx, {
      userId: access.userId,
      orgId: access.orgId,
      action: "buyer_created",
      targetType: "buyer",
      targetId: created.id,
      afterData: {
        normalizedName: identity.normalizedName,
        websiteDomain: identity.websiteDomain,
        status: "ACTIVE",
      },
    });
    return { buyer: created, created: true };
  });
}

/** org 内读取单个 Buyer；cross-org 一律按不存在处理（不可枚举）。 */
export async function getBuyer(params: {
  orgId: string;
  actor: MemoryActorInput;
  buyerId: string;
}): Promise<Buyer | null> {
  const access = await requireMemoryReadAccess({
    orgId: params.orgId,
    actor: params.actor,
  });
  if (typeof params.buyerId !== "string" || !params.buyerId.trim()) {
    throw new CorporateMemoryError("INVALID_INPUT", "buyerId 必填");
  }
  return db.buyer.findFirst({
    where: { id: params.buyerId, orgId: access.orgId },
  });
}

/**
 * Buyer merge —— 本轮 NOT_IMPLEMENTED（§11）。
 *
 * 未来 merge contract（冻结方向，实施须单独批准）：
 * - 输入：{ orgId, actor(admin), survivorBuyerId, mergedBuyerId, reason }
 * - 语义：merged 记录 status → MERGED（不删行），canonicalName 加入 survivor.aliases，
 *   externalIdentifiers 并入 survivor（冲突 fail-closed），metadata 记录 mergeOf 链；
 * - 引用修复：MemoryClaim(subjectType=BUYER, subjectKey=mergedId) 不批量改写历史行——
 *   由读取层按 merge 链解析，或经 claim supersession 逐条迁移；
 * - 全程人工发起 + 审计事件 buyer_merged；禁止自动 fuzzy 触发。
 */
export async function mergeBuyers(): Promise<never> {
  throw new CorporateMemoryError(
    "BUYER_MERGE_NOT_IMPLEMENTED",
    "Buyer merge 本轮未实现（NOT_IMPLEMENTED）；见 mergeBuyers 契约注释",
  );
}
