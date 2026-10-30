/**
 * Revenue Spine — 评分校准读模型（B-4，openspec change fde-score-calibration）
 *
 * 只读：窗口内的评估 → 每个商机取最早一条（窗口前已评估的整体剔除）→ 合并商机当前阶段、入驻测试判定、
 * 是否有 QUOTE_SENT，交给纯函数 computeScoreCalibration（score-calibration.ts）。
 * 依赖可注入；生产查询条件全部由本文件导出的纯函数构造。评估读取有行数上限，触顶即 truncated；IN 列表分批。
 * 只取统计需要的列：不读客户名 / 邮箱 / 金额 / 评估理由，响应只含计数、比率与权重。
 */

import {
  computeScoreCalibration,
  parseCalibrationDays,
  type CalibrationRow,
  type ScoreCalibrationReport,
} from "./score-calibration";

const DAY_MS = 86_400_000;

/** 窗口内评估的读取上限；读满即视为触顶 */
export const CALIBRATION_ROW_LIMIT = 5000;
/** IN 列表每批 id 数 */
export const CALIBRATION_ID_BATCH = 1000;

/** 与 src/lib/revenue-spine/fde/actions.ts FDE_EMPLOYEE_KEY 一致（测试对照源码） */
export const CALIBRATION_FDE_EMPLOYEE_KEY = "inbound_sales_fde";
/** 与 src/lib/revenue-spine/sla-metrics.ts INBOUND_INQUIRY_ACTION_TYPE 一致 */
export const CALIBRATION_INQUIRY_ACTION_TYPE = "inbound_inquiry";
/** 与 src/lib/revenue-spine/outcomes.ts OUTCOME_ENTITY_TYPE 一致 */
export const CALIBRATION_OUTCOME_ENTITY_TYPE = "sales_opportunity";
export const CALIBRATION_QUOTE_SENT_OUTCOME = "QUOTE_SENT";

// ── 查询条件（纯函数） ────────────────────────────────────

export function calibrationAssessmentWhere(orgId: string, since: Date, now: Date) {
  return { orgId, createdAt: { gte: since, lte: now } };
}

export function earlierAssessmentWhere(orgId: string, opportunityIds: string[], since: Date) {
  return { orgId, opportunityId: { in: opportunityIds }, createdAt: { lt: since } };
}

export function calibrationOpportunityWhere(orgId: string, opportunityIds: string[]) {
  return { orgId, id: { in: opportunityIds } };
}

export function calibrationInquiryWhere(orgId: string, opportunityIds: string[]) {
  return {
    orgId,
    employeeKey: CALIBRATION_FDE_EMPLOYEE_KEY,
    actionType: CALIBRATION_INQUIRY_ACTION_TYPE,
    opportunityId: { in: opportunityIds },
  };
}

export function quoteSentOutcomeWhere(orgId: string, opportunityIds: string[]) {
  return {
    orgId,
    entityType: CALIBRATION_OUTCOME_ENTITY_TYPE,
    outcomeType: CALIBRATION_QUOTE_SENT_OUTCOME,
    entityId: { in: opportunityIds },
  };
}

// ── 来源行与依赖 ──────────────────────────────────────────

export interface AssessmentSource {
  id: string;
  opportunityId: string;
  createdAt: Date;
  grade: string | null;
  dimensionsJson: unknown;
}

export interface OpportunitySource {
  id: string;
  orgId: string;
  stage: string;
  lostReason: string | null;
  customer: { tags: string | null } | null;
}

/** 每个商机最早的 FDE 询盘行动（UTM 在 inputContext.meta.utm） */
export interface InquirySource {
  opportunityId: string | null;
  inputContext: unknown;
}

/** 询盘 SLA 指标的入驻测试判定（默认依赖从 sla-metrics.ts 取同一组函数） */
export interface CalibrationClassifier {
  isOnboardingTestInquiry(m: { utmSource?: string | null; customerTags?: string | null; lostReason?: string | null }): boolean;
  utmSourceOf(inputContext: unknown): string | null;
}

export interface CalibrationDeps {
  now(): Date;
  /** 现有 policy 的 scoring.weights */
  loadWeights(orgId: string): Promise<Partial<Record<string, unknown>>>;
  /** 按 (createdAt, id) 升序，最多 limit 行 */
  assessments(orgId: string, since: Date, now: Date, limit: number): Promise<AssessmentSource[]>;
  /** 窗口前已有评估的商机 id */
  earlierAssessed(orgId: string, opportunityIds: string[], since: Date): Promise<string[]>;
  opportunities(orgId: string, opportunityIds: string[]): Promise<OpportunitySource[]>;
  /** 每个商机最早的 FDE 询盘行动（按 createdAt 升序；同一商机多条时取第一条） */
  firstInquiries(orgId: string, opportunityIds: string[]): Promise<InquirySource[]>;
  /** 有 QUOTE_SENT 业务结果的商机 id（可重复） */
  quoteSentOpportunities(orgId: string, opportunityIds: string[]): Promise<string[]>;
  classifier(): Promise<CalibrationClassifier>;
}

// ── 行拼装（纯函数） ──────────────────────────────────────

/** 每个商机取 (createdAt, id) 最小的一条评估 */
export function firstAssessments(rows: readonly AssessmentSource[]): AssessmentSource[] {
  const first = new Map<string, AssessmentSource>();
  for (const r of rows) {
    const cur = first.get(r.opportunityId);
    const t = r.createdAt.getTime();
    if (!cur || t < cur.createdAt.getTime() || (t === cur.createdAt.getTime() && r.id < cur.id)) first.set(r.opportunityId, r);
  }
  return [...first.values()];
}

export function buildCalibrationRows(input: {
  orgId: string;
  firsts: readonly AssessmentSource[];
  earlier: ReadonlySet<string>;
  opportunities: readonly OpportunitySource[];
  inquiries: readonly InquirySource[];
  quoteSent: ReadonlySet<string>;
  classifier: CalibrationClassifier;
}): CalibrationRow[] {
  // 关联商机必须属于本组织（防御性：评估与商机理论上同组织）
  const opps = new Map(input.opportunities.filter((o) => o.orgId === input.orgId).map((o) => [o.id, o]));
  const inquiryCtx = new Map<string, unknown>();
  for (const q of input.inquiries) if (q.opportunityId && !inquiryCtx.has(q.opportunityId)) inquiryCtx.set(q.opportunityId, q.inputContext);
  const rows: CalibrationRow[] = [];
  for (const a of input.firsts) {
    if (input.earlier.has(a.opportunityId)) continue;
    const o = opps.get(a.opportunityId);
    if (!o) continue;
    rows.push({
      grade: a.grade,
      dimensions: a.dimensionsJson,
      stage: o.stage,
      quoteSent: input.quoteSent.has(o.id),
      onboardingTest: input.classifier.isOnboardingTestInquiry({
        utmSource: input.classifier.utmSourceOf(inquiryCtx.get(o.id) ?? null),
        customerTags: o.customer?.tags ?? null,
        lostReason: o.lostReason,
      }),
    });
  }
  return rows;
}

export function chunkIds(ids: readonly string[], size = CALIBRATION_ID_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

async function inBatches<T>(ids: readonly string[], fn: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const batch of chunkIds(ids)) out.push(...(await fn(batch)));
  return out;
}

// ── 入口 ──────────────────────────────────────────────────

export async function getScoreCalibration(
  orgId: string,
  days: unknown,
  deps: CalibrationDeps = defaultCalibrationDeps(),
): Promise<ScoreCalibrationReport> {
  const now = deps.now();
  const windowDays = parseCalibrationDays(days);
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const [weights, raw] = await Promise.all([
    deps.loadWeights(orgId),
    deps.assessments(orgId, since, now, CALIBRATION_ROW_LIMIT + 1),
  ]);
  const truncated = raw.length > CALIBRATION_ROW_LIMIT;
  const firsts = firstAssessments(truncated ? raw.slice(0, CALIBRATION_ROW_LIMIT) : raw);
  const ids = firsts.map((a) => a.opportunityId);
  const [earlier, opportunities, inquiries, quoteSent, classifier] = await Promise.all([
    inBatches(ids, (b) => deps.earlierAssessed(orgId, b, since)),
    inBatches(ids, (b) => deps.opportunities(orgId, b)),
    inBatches(ids, (b) => deps.firstInquiries(orgId, b)),
    inBatches(ids, (b) => deps.quoteSentOpportunities(orgId, b)),
    deps.classifier(),
  ]);
  const rows = buildCalibrationRows({
    orgId,
    firsts,
    earlier: new Set(earlier),
    opportunities,
    inquiries,
    quoteSent: new Set(quoteSent),
    classifier,
  });
  return computeScoreCalibration(rows, { weights, windowDays, now, truncated });
}

export function defaultCalibrationDeps(): CalibrationDeps {
  return {
    now: () => new Date(),

    loadWeights: async (orgId) => {
      const { loadRevenueSpinePolicy } = await import("./policy");
      return (await loadRevenueSpinePolicy(orgId)).scoring.weights;
    },

    assessments: async (orgId, since, now, limit) => {
      const { db } = await import("@/lib/db");
      return db.salesOpportunityAssessment.findMany({
        where: calibrationAssessmentWhere(orgId, since, now),
        select: { id: true, opportunityId: true, createdAt: true, grade: true, dimensionsJson: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },

    earlierAssessed: async (orgId, opportunityIds, since) => {
      const { db } = await import("@/lib/db");
      const rows = await db.salesOpportunityAssessment.findMany({
        where: earlierAssessmentWhere(orgId, opportunityIds, since),
        select: { opportunityId: true },
        distinct: ["opportunityId"],
      });
      return rows.map((r) => r.opportunityId);
    },

    opportunities: async (orgId, opportunityIds) => {
      const { db } = await import("@/lib/db");
      return db.salesOpportunity.findMany({
        where: calibrationOpportunityWhere(orgId, opportunityIds),
        select: { id: true, orgId: true, stage: true, lostReason: true, customer: { select: { tags: true } } },
      });
    },

    firstInquiries: async (orgId, opportunityIds) => {
      const { db } = await import("@/lib/db");
      return db.salesAction.findMany({
        where: calibrationInquiryWhere(orgId, opportunityIds),
        select: { opportunityId: true, inputContext: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        distinct: ["opportunityId"],
      });
    },

    quoteSentOpportunities: async (orgId, opportunityIds) => {
      const { db } = await import("@/lib/db");
      const rows = await db.businessOutcome.findMany({
        where: quoteSentOutcomeWhere(orgId, opportunityIds),
        select: { entityId: true },
        distinct: ["entityId"],
      });
      return rows.map((r) => r.entityId);
    },

    classifier: async () => {
      const sla = await import("./sla-metrics");
      return { isOnboardingTestInquiry: sla.isOnboardingTestInquiry, utmSourceOf: sla.utmSourceOf };
    },
  };
}
