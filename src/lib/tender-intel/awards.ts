/**
 * T4-P1 — 组织级 canonical 授标情报 service（AwardRecord / AwardRecordSource 唯一合法写路径）。
 *
 * 铁律（与 T3 corporate-memory 同纪律）：
 * - Research ≠ Fact：检索/AI 产物只能以 AI_EXTRACTED / NEEDS_REVIEW 落地；
 *   HUMAN_CONFIRMED 必须有人工 actor；SYSTEM_VERIFIED 仅限权威公开 open-data 记录
 *   （CANADABUYS_OPEN_DATA + solicitationNumber）。
 * - ai/agent actor 直写一律拒绝（对齐 AI_AUTO_MEMORY_WRITE gate）。
 * - org 隔离 fail-closed：所有查询/写入强制 orgId。
 * - 幂等：同一 (orgId, sourceType, sourceKey) 重复摄取 → 返回既有观察，不产生第二行。
 * - 去重只做确定性匹配（solicitationNumber / winner+date+amount 精确）；弱信号 → NEEDS_REVIEW
 *   + possibleDuplicateOfId 留人工裁决，绝不 fuzzy merge。
 * - API/UI 禁止绕过本 service 直接 prisma.awardRecord.* 写。
 *
 * 词表复用 T3（不建第二套）：confidence HIGH|MEDIUM|LOW；
 * verificationStatus AI_EXTRACTED|HUMAN_CONFIRMED|SYSTEM_VERIFIED|NEEDS_REVIEW。
 */

import { db } from "@/lib/db";
import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";
import { isT4AwardSchemaReadyWithEnv } from "./award-flags";

/* ------------------------------- 词表/类型 ------------------------------- */

export const AWARD_SOURCE_TYPES = [
  "CANADABUYS_OPEN_DATA",
  "WEB_SEARCH",
  "PROJECT_RECORD",
  "USER_ENTRY",
  "OTHER_PUBLIC",
] as const;
export type AwardSourceType = (typeof AWARD_SOURCE_TYPES)[number];

export const AWARD_VERIFICATION_STATUSES = [
  "AI_EXTRACTED",
  "HUMAN_CONFIRMED",
  "SYSTEM_VERIFIED",
  "NEEDS_REVIEW",
] as const;
export type AwardVerificationStatus = (typeof AWARD_VERIFICATION_STATUSES)[number];

export const AWARD_CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;
export type AwardConfidence = (typeof AWARD_CONFIDENCE_LEVELS)[number];

export const AWARD_RECORD_STATUSES = ["ACTIVE", "NEEDS_REVIEW", "RETRACTED"] as const;

const TEXT_CAP = 2000;
const LIST_CAP = 200;

export type AwardActor = {
  /** user | system（ai / agent / ai:* 一律拒绝） */
  actorType: string;
  userId: string | null;
};

export class AwardIntelError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AwardIntelError";
  }
}

/** 与 Prisma 生成类型解耦的最小行形状（DI 供纯测注入；金额统一 number|null 暴露） */
export type AwardRecordRow = {
  id: string;
  orgId: string;
  buyerId: string | null;
  buyerNameRaw: string | null;
  buyerNameNormalized: string | null;
  projectId: string | null;
  winnerName: string;
  winnerNameNormalized: string;
  solicitationNumber: string | null;
  awardDate: Date | null;
  contractAmount: unknown;
  currency: string | null;
  scopeSummary: string | null;
  confidence: string;
  verificationStatus: string;
  status: string;
  possibleDuplicateOfId: string | null;
  confirmedById: string | null;
  confirmedAt: Date | null;
  createdByType: string;
  createdById: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type AwardSourceRow = {
  id: string;
  orgId: string;
  awardRecordId: string;
  sourceType: string;
  sourceKey: string;
  sourceUrl: string | null;
  evidenceSnippet: string | null;
  archiveItemId: string | null;
  capturedAt: Date;
  metadata: unknown;
  createdById: string | null;
  createdAt: Date;
};

/** 最小 DB 依赖面（默认全局 db；纯测注入内存 fake） */
export type AwardsDbClient = {
  awardRecord: {
    findFirst: (args: Record<string, unknown>) => Promise<AwardRecordRow | null>;
    findMany: (args: Record<string, unknown>) => Promise<AwardRecordRow[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<AwardRecordRow>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<AwardRecordRow>;
  };
  awardRecordSource: {
    findFirst: (args: Record<string, unknown>) => Promise<AwardSourceRow | null>;
    findMany: (args: Record<string, unknown>) => Promise<AwardSourceRow[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<AwardSourceRow>;
  };
};

function client(c?: AwardsDbClient): AwardsDbClient {
  return c ?? (db as unknown as AwardsDbClient);
}

/* ------------------------------- 守门 ------------------------------- */

function assertOrg(orgId: string | null | undefined): asserts orgId is string {
  if (!orgId || typeof orgId !== "string") {
    throw new AwardIntelError("ORG_REQUIRED", "AwardRecord 操作必须提供 orgId（fail closed）");
  }
}

function assertWriteActor(actor: AwardActor): void {
  const t = (actor?.actorType ?? "").toLowerCase();
  if (t === "ai" || t.startsWith("ai:") || t === "agent") {
    throw new AwardIntelError(
      "AWARD_AI_WRITE_DISABLED",
      "AI/agent 不允许直写 canonical AwardRecord（对齐 T3 AI_AUTO_MEMORY_WRITE gate）",
    );
  }
  if (t !== "user" && t !== "system") {
    throw new AwardIntelError("INVALID_ACTOR", `未知 actorType: ${actor?.actorType}`);
  }
  if (t === "user" && !actor.userId) {
    throw new AwardIntelError("INVALID_ACTOR", "user actor 必须携带 userId");
  }
}

function clip(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  return v ? v.slice(0, TEXT_CAP) : null;
}

/** 供应商名确定性规范化（与 buyer 同纪律；normalizeBuyerName 足够通用：小写+去公司后缀+空白折叠） */
export function normalizeVendorName(name: string): string {
  return normalizeBuyerName(name);
}

export function toAmountNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------- 写路径 ------------------------------- */

export type ObserveAwardInput = {
  orgId: string;
  actor: AwardActor;
  award: {
    winnerName: string;
    buyerNameRaw?: string | null;
    projectId?: string | null;
    solicitationNumber?: string | null;
    awardDate?: Date | null;
    contractAmount?: number | null;
    currency?: string | null;
    scopeSummary?: string | null;
  };
  source: {
    sourceType: AwardSourceType;
    /** 来源域自然键（幂等锚点）；如 canadabuys:{reference} / web:{url} / project:{id} */
    sourceKey: string;
    sourceUrl?: string | null;
    evidenceSnippet?: string | null;
    archiveItemId?: string | null;
    capturedAt: Date;
  };
  confidence: AwardConfidence;
  /** 期望落地状态；service 白名单强制（见文件头铁律） */
  verificationStatus: AwardVerificationStatus;
};

export type ObserveAwardResult = {
  outcome: "CREATED" | "ALREADY_OBSERVED" | "ATTACHED_EXISTING" | "NEEDS_REVIEW";
  record: AwardRecordRow;
  sourceId: string;
};

function assertVerificationRules(input: ObserveAwardInput): void {
  const vs = input.verificationStatus;
  if (!AWARD_VERIFICATION_STATUSES.includes(vs)) {
    throw new AwardIntelError("INVALID_VERIFICATION", `非法 verificationStatus: ${vs}`);
  }
  if (!AWARD_CONFIDENCE_LEVELS.includes(input.confidence)) {
    throw new AwardIntelError("INVALID_CONFIDENCE", `非法 confidence: ${input.confidence}`);
  }
  if (!AWARD_SOURCE_TYPES.includes(input.source.sourceType)) {
    throw new AwardIntelError("INVALID_SOURCE_TYPE", `非法 sourceType: ${input.source.sourceType}`);
  }
  if (vs === "HUMAN_CONFIRMED") {
    if (input.actor.actorType !== "user" || !input.actor.userId) {
      throw new AwardIntelError(
        "HUMAN_CONFIRM_REQUIRES_USER",
        "HUMAN_CONFIRMED 必须由人工 user actor 落地（AI/system 不可）",
      );
    }
  }
  if (vs === "SYSTEM_VERIFIED") {
    if (
      input.source.sourceType !== "CANADABUYS_OPEN_DATA" ||
      !(input.award.solicitationNumber ?? "").trim()
    ) {
      throw new AwardIntelError(
        "SYSTEM_VERIFIED_REQUIRES_AUTHORITATIVE_SOURCE",
        "SYSTEM_VERIFIED 仅限带 reference number 的权威公开 open-data 记录",
      );
    }
  }
}

/**
 * 观察/落地一条授标情报（幂等）。
 * 同 sourceKey 重放 → ALREADY_OBSERVED；确定性强匹配 → 挂源到既有记录；
 * 确定性弱信号 → 新记录 NEEDS_REVIEW + possibleDuplicateOfId；否则新建。
 */
export async function createOrObserveAwardRecord(
  input: ObserveAwardInput,
  opts?: { client?: AwardsDbClient },
): Promise<ObserveAwardResult> {
  assertOrg(input.orgId);
  assertWriteActor(input.actor);
  assertVerificationRules(input);
  const c = client(opts?.client);

  const winnerName = (input.award.winnerName ?? "").trim();
  if (!winnerName) throw new AwardIntelError("WINNER_REQUIRED", "缺少中标方名称");
  const winnerNorm = normalizeVendorName(winnerName);
  const buyerRaw = (input.award.buyerNameRaw ?? "").trim() || null;
  const buyerNorm = buyerRaw ? normalizeBuyerName(buyerRaw) : null;
  const sourceKey = (input.source.sourceKey ?? "").trim();
  if (!sourceKey) throw new AwardIntelError("SOURCE_KEY_REQUIRED", "缺少来源自然键 sourceKey");
  const solicitation = (input.award.solicitationNumber ?? "").trim() || null;

  // 1) 幂等：同源重放
  const existingSource = await c.awardRecordSource.findFirst({
    where: { orgId: input.orgId, sourceType: input.source.sourceType, sourceKey },
  });
  if (existingSource) {
    const record = await c.awardRecord.findFirst({
      where: { id: existingSource.awardRecordId, orgId: input.orgId },
    });
    if (!record) {
      throw new AwardIntelError("SOURCE_ORPHANED", "观察记录存在但 AwardRecord 缺失（数据异常）");
    }
    return { outcome: "ALREADY_OBSERVED", record, sourceId: existingSource.id };
  }

  // 2) 确定性同一性匹配（强信号才挂靠；全部 org 内）
  let target: AwardRecordRow | null = null;
  if (solicitation) {
    target = await c.awardRecord.findFirst({
      where: {
        orgId: input.orgId,
        solicitationNumber: solicitation,
        winnerNameNormalized: winnerNorm,
        status: { not: "RETRACTED" },
      },
    });
  }
  if (!target && input.award.awardDate && input.award.contractAmount != null) {
    const sameKey = await c.awardRecord.findMany({
      where: {
        orgId: input.orgId,
        winnerNameNormalized: winnerNorm,
        awardDate: input.award.awardDate,
        status: { not: "RETRACTED" },
      },
      take: 10,
    });
    target =
      sameKey.find(
        (r) => toAmountNumber(r.contractAmount) === toAmountNumber(input.award.contractAmount),
      ) ?? null;
  }

  const sourceData = {
    orgId: input.orgId,
    sourceType: input.source.sourceType,
    sourceKey,
    sourceUrl: input.source.sourceUrl?.trim() || null,
    evidenceSnippet: clip(input.source.evidenceSnippet),
    archiveItemId: input.source.archiveItemId ?? null,
    capturedAt: input.source.capturedAt,
    createdById: input.actor.userId,
  };

  if (target) {
    // 挂源到既有记录；verificationStatus 只升不降（HUMAN_CONFIRMED 提升必须 user actor —— 上面已断言）
    const src = await c.awardRecordSource.create({
      data: { ...sourceData, awardRecordId: target.id },
    });
    const promote =
      input.verificationStatus === "HUMAN_CONFIRMED" && target.verificationStatus !== "HUMAN_CONFIRMED"
        ? {
            verificationStatus: "HUMAN_CONFIRMED",
            confirmedById: input.actor.userId,
            confirmedAt: new Date(),
            status: "ACTIVE",
          }
        : input.verificationStatus === "SYSTEM_VERIFIED" &&
            target.verificationStatus === "AI_EXTRACTED"
          ? { verificationStatus: "SYSTEM_VERIFIED" }
          : null;
    const record = promote
      ? await c.awardRecord.update({ where: { id: target.id }, data: promote })
      : target;
    return { outcome: "ATTACHED_EXISTING", record, sourceId: src.id };
  }

  // 3) 确定性弱信号：同 winner+buyer 已有记录但日期/金额对不上 → NEEDS_REVIEW 留人工
  let weak: AwardRecordRow | null = null;
  if (buyerNorm) {
    weak = await c.awardRecord.findFirst({
      where: {
        orgId: input.orgId,
        winnerNameNormalized: winnerNorm,
        buyerNameNormalized: buyerNorm,
        status: { not: "RETRACTED" },
      },
    });
  }

  const record = await c.awardRecord.create({
    data: {
      orgId: input.orgId,
      buyerId: null,
      buyerNameRaw: buyerRaw,
      buyerNameNormalized: buyerNorm,
      projectId: input.award.projectId ?? null,
      winnerName,
      winnerNameNormalized: winnerNorm,
      solicitationNumber: solicitation,
      awardDate: input.award.awardDate ?? null,
      contractAmount: input.award.contractAmount ?? null,
      currency: input.award.currency?.trim() || null,
      scopeSummary: clip(input.award.scopeSummary),
      confidence: input.confidence,
      verificationStatus: input.verificationStatus,
      status: weak ? "NEEDS_REVIEW" : "ACTIVE",
      possibleDuplicateOfId: weak?.id ?? null,
      confirmedById: input.verificationStatus === "HUMAN_CONFIRMED" ? input.actor.userId : null,
      confirmedAt: input.verificationStatus === "HUMAN_CONFIRMED" ? new Date() : null,
      createdByType: input.actor.actorType,
      createdById: input.actor.userId,
    },
  });
  const src = await c.awardRecordSource.create({
    data: { ...sourceData, awardRecordId: record.id },
  });
  return { outcome: weak ? "NEEDS_REVIEW" : "CREATED", record, sourceId: src.id };
}

export type MaterializeWinnerResult =
  | { materialized: true; record: AwardRecordRow; sourceId: string; outcome: ObserveAwardResult["outcome"] }
  | { materialized: false; reason: "SCHEMA_NOT_READY" };

/**
 * 人工确认 → canonical materialize 的 schema-ready gate 入口（生产激活闸）。
 *
 * T4_AWARD_INTELLIGENCE_SCHEMA_READY=false（默认）→ 兼容策略 B：
 * 返回 { materialized:false, reason:"SCHEMA_NOT_READY" }，对 T4 表 **0 次访问**
 * （调用方保持 merge 前行为：仅写 room.summaryJson.externalConfirmed）。
 * ready=true → 正常 createOrObserveAwardRecord（幂等/去重/verification 铁律不变）。
 */
export async function materializeWinnerConfirmation(
  input: ObserveAwardInput,
  opts?: { client?: AwardsDbClient; env?: Record<string, string | undefined> },
): Promise<MaterializeWinnerResult> {
  if (!isT4AwardSchemaReadyWithEnv(opts?.env ?? process.env)) {
    return { materialized: false, reason: "SCHEMA_NOT_READY" };
  }
  const observed = await createOrObserveAwardRecord(input, { client: opts?.client });
  return {
    materialized: true,
    record: observed.record,
    sourceId: observed.sourceId,
    outcome: observed.outcome,
  };
}

/** 人工确认既有记录（AI_EXTRACTED / NEEDS_REVIEW → HUMAN_CONFIRMED；唯一提升入口之二） */
export async function confirmAwardRecord(
  input: {
    orgId: string;
    actor: AwardActor;
    awardRecordId: string;
    patch?: Partial<{
      contractAmount: number | null;
      currency: string | null;
      awardDate: Date | null;
      scopeSummary: string | null;
      buyerNameRaw: string | null;
    }>;
  },
  opts?: { client?: AwardsDbClient },
): Promise<AwardRecordRow> {
  assertOrg(input.orgId);
  assertWriteActor(input.actor);
  if (input.actor.actorType !== "user" || !input.actor.userId) {
    throw new AwardIntelError("HUMAN_CONFIRM_REQUIRES_USER", "确认必须由人工 user actor 执行");
  }
  const c = client(opts?.client);
  const record = await c.awardRecord.findFirst({
    where: { id: input.awardRecordId, orgId: input.orgId },
  });
  if (!record) throw new AwardIntelError("NOT_FOUND", "AwardRecord 不存在或不属于该组织");
  if (record.status === "RETRACTED") {
    throw new AwardIntelError("RETRACTED_IMMUTABLE", "已撤回记录不可确认");
  }

  const data: Record<string, unknown> = {
    verificationStatus: "HUMAN_CONFIRMED",
    confirmedById: input.actor.userId,
    confirmedAt: new Date(),
    status: "ACTIVE",
  };
  const p = input.patch ?? {};
  if ("contractAmount" in p) data.contractAmount = p.contractAmount;
  if ("currency" in p) data.currency = p.currency?.trim() || null;
  if ("awardDate" in p) data.awardDate = p.awardDate;
  if ("scopeSummary" in p) data.scopeSummary = clip(p.scopeSummary);
  if ("buyerNameRaw" in p) {
    const raw = (p.buyerNameRaw ?? "").trim() || null;
    data.buyerNameRaw = raw;
    data.buyerNameNormalized = raw ? normalizeBuyerName(raw) : null;
  }
  return c.awardRecord.update({ where: { id: record.id }, data });
}

/* ------------------------------- 读路径 ------------------------------- */

export type ListAwardsFilters = {
  buyerName?: string | null;
  winnerName?: string | null;
  from?: Date | null;
  to?: Date | null;
  verificationStatus?: AwardVerificationStatus | null;
};

export async function listAwardsForOrg(
  input: { orgId: string; filters?: ListAwardsFilters; take?: number },
  opts?: { client?: AwardsDbClient },
): Promise<AwardRecordRow[]> {
  assertOrg(input.orgId);
  const c = client(opts?.client);
  const f = input.filters ?? {};
  const where: Record<string, unknown> = { orgId: input.orgId, status: { not: "RETRACTED" } };
  if (f.buyerName?.trim()) where.buyerNameNormalized = normalizeBuyerName(f.buyerName);
  if (f.winnerName?.trim()) where.winnerNameNormalized = normalizeVendorName(f.winnerName);
  if (f.verificationStatus) where.verificationStatus = f.verificationStatus;
  if (f.from || f.to) {
    where.awardDate = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
  }
  return c.awardRecord.findMany({
    where,
    orderBy: [{ awardDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: Math.min(input.take ?? LIST_CAP, LIST_CAP),
  });
}

export async function listAwardsForBuyer(
  input: { orgId: string; buyerName: string; take?: number },
  opts?: { client?: AwardsDbClient },
): Promise<AwardRecordRow[]> {
  return listAwardsForOrg(
    { orgId: input.orgId, filters: { buyerName: input.buyerName }, take: input.take },
    opts,
  );
}

export async function getAwardEvidence(
  input: { orgId: string; awardRecordId: string },
  opts?: { client?: AwardsDbClient },
): Promise<AwardSourceRow[]> {
  assertOrg(input.orgId);
  const c = client(opts?.client);
  const record = await c.awardRecord.findFirst({
    where: { id: input.awardRecordId, orgId: input.orgId },
  });
  if (!record) throw new AwardIntelError("NOT_FOUND", "AwardRecord 不存在或不属于该组织");
  return c.awardRecordSource.findMany({
    where: { awardRecordId: record.id, orgId: input.orgId },
    orderBy: [{ capturedAt: "asc" }],
  });
}
