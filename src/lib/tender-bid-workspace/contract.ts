/**
 * TI-4a 投标工作区 — 存储与请求的契约（zod；未知字段一律剥除）
 *
 * 存在 BidIntelligenceRoom.summaryJson.bidWorkspace。这个 JSON 位会被既有接口整块返回给
 * 所有能读项目的人，所以这里**只有非财务内容**：价格表行项（公开的招标事实）、拟投品牌型号
 * 与产品尺寸、证书、文件领取方名单、补遗。供应商报价、成本假设、成本、报价、毛利都不在
 * 存储契约里——成本核算请求（costSheetRequestSchema）只用于「带着输入算一次」，不落库。
 */
import { z } from "zod";
import { CERTIFICATE_COVERAGE, CERTIFICATE_STATUSES } from "@/lib/tender-bid-readiness/certification-gate";
import { ALLOCATION_METHODS, FREIGHT_MODES, QUOTE_EVIDENCE_KINDS, SOURCING_TYPES } from "@/lib/tender-bid-cost/contract";
import { HOLDER_SNAPSHOT_SOURCES } from "@/lib/tender-competition/document-holders";
import { QUOTE_BASES } from "@/lib/tender-price-schedule/unit-conversion";

export const BID_WORKSPACE_KEY = "bidWorkspace" as const;
export const BID_WORKSPACE_VERSION = 1 as const;
export const MAX_SCHEDULE_LINES = 300;

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();
/** 数量与金额：数字或数字字符串（定点运算在计算层做；这里只挡类型与长度） */
const decimalLike = z.union([z.number().finite(), z.string().trim().min(1).max(40)]);
const optDecimal = decimalLike.nullable().optional();

export const priceScheduleLineSchema = z.object({
  lineNo: z.number().int(),
  description: text(500),
  quantity: decimalLike,
  uom: text(20),
  packCount: z.number().int().nullable().optional(),
  dimensions: optText(120),
  minimumDimensions: optText(120),
  requirement: optText(1000),
  certificationGate: optText(300),
  source: z.object({
    documentId: optText(80),
    page: z.number().int().nullable().optional(),
    sheet: optText(120),
    row: z.number().int().nullable().optional(),
  }).nullable().optional(),
});

export const certificateSchema = z.object({
  id: text(80).min(1),
  status: z.enum(CERTIFICATE_STATUSES),
  coverage: z.enum(CERTIFICATE_COVERAGE),
  issuer: optText(200),
  issuerAccreditedInCanada: z.boolean().nullable(),
  coveredModels: z.array(text(80)).max(50),
  expiresAt: optText(40),
});

export const lineDetailSchema = z.object({
  product: z.object({ make: optText(120), model: optText(120) }).nullable().optional(),
  offeredDimensions: optText(120),
  certificates: z.array(certificateSchema).max(20).optional(),
});

/** 键 = 行号（字符串形式的正整数） */
export const lineDetailsSchema = z.record(z.string().regex(/^[1-9]\d{0,3}$/), lineDetailSchema);

export const documentHoldersSchema = z.object({
  solicitationId: text(120),
  portal: text(80),
  sourceKind: z.enum(HOLDER_SNAPSHOT_SOURCES),
  capturedAt: text(40),
  entries: z.array(z.object({ name: text(200) })).max(200),
  evidenceRef: optText(300),
});

export const addendumSchema = z.object({
  number: z.number().int().min(1).max(999),
  issuedOn: optText(20),
  affectedLineNos: z.array(z.number().int().min(1)).max(MAX_SCHEDULE_LINES),
  effect: optText(1000),
});

const scheduleBlock = z.object({ lines: z.array(priceScheduleLineSchema).max(MAX_SCHEDULE_LINES) });

/** 已存内容。 */
export const storedWorkspaceSchema = z.object({
  version: z.literal(BID_WORKSPACE_VERSION),
  priceSchedule: scheduleBlock,
  lineDetails: lineDetailsSchema,
  documentHolders: documentHoldersSchema.nullable(),
  addenda: z.array(addendumSchema).max(50),
  updatedAt: z.string().max(40),
  updatedById: z.string().max(80),
});
export type StoredWorkspace = z.infer<typeof storedWorkspaceSchema>;

export const WORKSPACE_BLOCKS = ["priceSchedule", "lineDetails", "documentHolders", "addenda"] as const;
export type WorkspaceBlock = (typeof WORKSPACE_BLOCKS)[number];

/** 保存请求：分块，至少给一块；没给的块保持原值。 */
export const saveWorkspaceRequestSchema = z.object({
  priceSchedule: scheduleBlock.optional(),
  lineDetails: lineDetailsSchema.optional(),
  documentHolders: documentHoldersSchema.nullable().optional(),
  addenda: z.array(addendumSchema).max(50).optional(),
});
export type SaveWorkspaceRequest = z.infer<typeof saveWorkspaceRequestSchema>;

export function blocksIn(req: SaveWorkspaceRequest): WorkspaceBlock[] {
  return WORKSPACE_BLOCKS.filter((b) => req[b] !== undefined);
}

export function emptyWorkspace(userId: string, now: Date): StoredWorkspace {
  return { version: BID_WORKSPACE_VERSION, priceSchedule: { lines: [] }, lineDetails: {}, documentHolders: null, addenda: [], updatedAt: now.toISOString(), updatedById: userId };
}

/** 把保存请求合并进已存内容：只替换给出的块。 */
export function mergeWorkspace(prev: StoredWorkspace | null, req: SaveWorkspaceRequest, userId: string, now: Date): StoredWorkspace {
  const base = prev ?? emptyWorkspace(userId, now);
  return {
    version: BID_WORKSPACE_VERSION,
    priceSchedule: req.priceSchedule ?? base.priceSchedule,
    lineDetails: req.lineDetails ?? base.lineDetails,
    documentHolders: req.documentHolders !== undefined ? req.documentHolders : base.documentHolders,
    addenda: req.addenda ?? base.addenda,
    updatedAt: now.toISOString(),
    updatedById: userId,
  };
}

/** 从情报室 JSON 里读出本键；不存在或不合契约 → null（不抛）。 */
export function readStoredWorkspace(summaryJson: unknown): StoredWorkspace | null {
  const raw = (summaryJson as Record<string, unknown> | null | undefined)?.[BID_WORKSPACE_KEY];
  if (!raw) return null;
  const parsed = storedWorkspaceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** 第一条校验错误的中文说明（给 400 用）。 */
export function firstIssueZh(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "请求内容";
  return `保存内容有误：${path} ${issue?.message ?? "格式不正确"}`;
}

/* ------------------------- 成本核算请求（不落库） ------------------------- */

const costQuoteSchema = z.object({
  unitPrice: decimalLike.nullable(),
  basis: z.enum(QUOTE_BASES),
  currency: text(8).min(3),
  evidenceKind: z.enum(QUOTE_EVIDENCE_KINDS),
  sourceRef: optText(300),
  asOf: optText(40),
  moqPieces: z.number().int().nullable().optional(),
  cartonPieces: z.number().int().nullable().optional(),
});

export const costLineSchema = z.object({
  lineNo: z.number().int().min(1),
  sourcing: z.enum(SOURCING_TYPES),
  quote: costQuoteSchema.nullable(),
  fx: z.object({ rateCadPerUnit: decimalLike.nullable(), source: optText(80), asOf: optText(40) }).nullable().optional(),
  duty: z.object({ ratePct: decimalLike, hsCode: optText(20), origin: optText(60), sourceRef: optText(300), asOf: optText(40) }).nullable().optional(),
  importGstItcEligible: z.boolean().nullable().optional(),
  internationalFreightCad: optDecimal,
  domesticFreightCad: optDecimal,
  localDeliveryCad: optDecimal,
  otherNonRecoverableCad: optDecimal,
  volumeCbm: optDecimal,
  weightKg: optDecimal,
});

const freightPlanSchema = z.object({
  key: text(40).min(1),
  mode: z.enum(FREIGHT_MODES),
  charges: z.array(z.object({ label: text(80), amountCad: decimalLike, allocation: z.enum(ALLOCATION_METHODS) })).max(20),
  sourceRef: optText(300),
  asOf: optText(40),
});

export const costSheetRequestSchema = z.object({
  label: text(120).optional(),
  lines: z.array(costLineSchema).max(MAX_SCHEDULE_LINES),
  importGst: z.object({ ratePct: decimalLike, itcEligible: z.boolean() }),
  freight: z.object({ plans: z.array(freightPlanSchema).max(4), blendNote: optText(300) }).nullable().optional(),
  reserves: z.array(z.union([
    z.object({ key: text(40).min(1), label: text(80), mode: z.literal("ON_SALE"), ratePct: decimalLike }),
    z.object({ key: text(40).min(1), label: text(80), mode: z.literal("IN_COST"), pctOfDirectCost: decimalLike }),
  ])).max(10).optional(),
  pricing: z.union([
    z.object({ method: z.literal("MARGIN_ON_PRICE"), targetMarginPct: decimalLike }),
    z.object({ method: z.literal("MARKUP_ON_COST"), markupPct: decimalLike }),
  ]),
});
export type CostSheetRequest = z.infer<typeof costSheetRequestSchema>;
