/**
 * Tender T2-P1 — Project Ledger 类型与错误
 *
 * ProjectEvent = AUTHORITATIVE BUSINESS LEDGER（#96 Final Contract §5）。
 * 写入语义与 runtime telemetry（AgentRunEvent 的 best-effort）完全相反：
 * 追加失败必须 THROW 并使业务事务回滚，禁止 log-and-continue / return null。
 */
import type { Prisma } from "@prisma/client";

/** 记账主体（触发者）；来源必须是服务端可信上下文，禁止客户端伪造 */
export type LedgerActorType = "user" | "system" | "ai";

export const LEDGER_ACTOR_TYPES: readonly LedgerActorType[] = [
  "user",
  "system",
  "ai",
];

export interface LedgerActor {
  actorType: LedgerActorType;
  /** User.id / 可信系统标识；system 事件可空 */
  actorId?: string | null;
}

/** 参与者（ProjectEventActor 行；仅当参与人 ≠ 记账人或人数 > 1 时提供） */
export interface LedgerParticipant {
  /** "user:{userId}" | "external:{规范化名}" */
  actorKey: string;
  userId?: string | null;
  /** performer | participant | approver */
  role?: string;
}

export interface AppendProjectEventInput {
  /** 必传：与业务写同一事务（AUTHORITATIVE_EVENT_ATOMICITY = REQUIRED） */
  tx: Prisma.TransactionClient;
  orgId: string;
  projectId: string;
  eventType: string;
  /** 确定性幂等键（§10 契约）；同一业务动作 retry → 同一 key */
  eventKey: string;
  /** 业务发生时间（显式传入） */
  occurredAt: Date;
  actor: LedgerActor;
  actors?: LedgerParticipant[];
  title: string;
  summary?: string | null;
  result?: string | null;
  stage?: string | null;
  /** server-authored、minimal、versionable；禁止 dump 全量对象/秘密 */
  payload?: Prisma.InputJsonValue;
  refs?: Prisma.InputJsonValue;
  relatedDocumentId?: string | null;
  relatedCostId?: string | null;
  sourceRef?: string | null;
  traceId?: string | null;
  correctionOfEventId?: string | null;
  /** seq 竞争有界重试上限（#96 冻结值 8；测试可下调） */
  maxSeqRetries?: number;
}

export interface AppendProjectEventResult {
  event: {
    id: string;
    projectId: string;
    seq: number;
    eventKey: string;
    eventType: string;
  };
  /** false = eventKey 幂等命中，返回既有事件（未新建） */
  created: boolean;
}

/** 租户/授权失败：项目不存在或不属于该 org（不泄露存在性，统一 not found 语义） */
export class LedgerTenantError extends Error {
  readonly code = "LEDGER_TENANT_MISMATCH";
  constructor(message = "project not found in organization") {
    super(message);
    this.name = "LedgerTenantError";
  }
}

/** seq 有界重试耗尽：必须导致业务事务回滚 */
export class LedgerSeqContentionError extends Error {
  readonly code = "LEDGER_SEQ_CONTENTION_EXHAUSTED";
  constructor(readonly attempts: number) {
    super(`project event seq contention not resolved after ${attempts} attempts`);
    this.name = "LedgerSeqContentionError";
  }
}

/** 契约违规（非法 actorType / 空 eventKey / 缺 tx 等编程错误） */
export class LedgerContractError extends Error {
  readonly code = "LEDGER_CONTRACT_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "LedgerContractError";
  }
}

/** ProjectCost 生命周期违规（如 ACTUAL 后实质修改） */
export class CostLifecycleError extends Error {
  readonly code = "COST_LIFECYCLE_VIOLATION";
  constructor(
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "CostLifecycleError";
  }
}

/** #96 §6.5 冻结类别词表 */
export const PROJECT_COST_CATEGORIES = [
  "INTERNAL_LABOR",
  "SITE_VISIT",
  "MILEAGE",
  "PARKING",
  "SAMPLE",
  "COURIER",
  "BOND_INSURANCE",
  "CONSULTANT",
  "SUPPLIER",
  "SUBCONTRACTOR",
  "AI",
  "DATA_API",
  "OTHER",
] as const;

export type ProjectCostCategory = (typeof PROJECT_COST_CATEGORIES)[number];

/**
 * AI/模型成本唯一权威 = AiUsageLedger（#96 §6.4）。
 * P1 默认写入路径拒绝这两类，防止 ProjectCost 成为第二 AI 成本源。
 */
export const COST_CATEGORIES_RESERVED_FOR_AI_LEDGER: readonly ProjectCostCategory[] =
  ["AI", "DATA_API"];

export type ProjectCostStatus = "PLANNED" | "COMMITTED" | "ACTUAL" | "VOIDED";

/** PLANNED 阶段可修订的实质商业字段（#96 §6.3） */
export const COST_MATERIAL_FIELDS = [
  "amount",
  "category",
  "description",
  "quantity",
  "unit",
  "unitRate",
  "currency",
  "supplierId",
  "incurredAt",
] as const;
