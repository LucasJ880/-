/**
 * 组织驾驶舱 — 工作量读模型（A-4，openspec change org-cockpit-workload）
 *
 * 只读：按组织读六类来源（AI 运行、平台自动化日计数、待审批动作、FDE 询盘、跟进护栏审计、AI 用量记账），
 * 解析归属所需的查找表，交给纯函数 computeWorkload（workload.ts）判定与汇总。
 * 依赖可注入；生产查询条件全部由本文件导出的纯函数构造（AI 运行直接复用岗位总览的两个条件）。
 * 每类来源有行数上限，触顶即 truncated。响应只含计数、token、成本合计与固定文案。
 */

import { AUTOMATION_REGISTRY, resolveOrgTimezone, type AutomationKey } from "@/lib/automation/registry";
import { nextDay } from "@/lib/revenue-spine/business-days";
import { POST_REGISTRY, SHARED_PENDING_ACTION_TYPES } from "./posts";
import { agentRunTypeCountWhere, workforceDomainCountWhere, type CockpitViewer } from "./posts-read-model";
import { lookupIdsFor, type AttributionLookups, type PendingActionRow } from "./waiting";
import {
  WORKLOAD_SIGNAL_WINDOW_DAYS,
  computeWorkload,
  localDayKeys,
  localDayStart,
  workloadThresholdsFromOrgSettings,
  type InquiryFlags,
  type WorkloadAgentRunRow,
  type WorkloadAutomationCount,
  type WorkloadInquiryRow,
  type WorkloadPendingRow,
  type WorkloadResult,
  type WorkloadUsageRow,
} from "./workload";

const DAY_MS = 86_400_000;
const AUTOMATION_KEYS = AUTOMATION_REGISTRY.map((d) => d.key as AutomationKey);

/** 每类来源的读取上限；读满即视为触顶 */
export const WORKLOAD_ROW_LIMIT = 5000;

/** 与 src/lib/revenue-spine/fde/actions.ts FDE_EMPLOYEE_KEY 一致（测试对照源码） */
export const WORKLOAD_FDE_EMPLOYEE_KEY = "inbound_sales_fde";
/** 与 src/lib/revenue-spine/sla-metrics.ts INBOUND_INQUIRY_ACTION_TYPE 一致 */
export const WORKLOAD_INQUIRY_ACTION_TYPE = "inbound_inquiry";
/** 与 src/lib/revenue-spine/fde/inbound-sales.ts INQUIRY_REPLY_ACTION_TYPE 一致 */
export const WORKLOAD_INQUIRY_REPLY_TYPE = "sales.send_inquiry_reply";
/** 与 src/lib/revenue-spine/fde/no-reply-followup.ts FOLLOW_UP_GUARDRAIL_AUDIT_ACTION 一致 */
export const WORKLOAD_FOLLOW_UP_GUARDRAIL_ACTION = "revenue_spine.followup_draft.guardrail_blocked";

export interface WorkloadResponse extends WorkloadResult {
  orgId: string;
  generatedAt: string;
}

export interface WorkloadQueryResult<T> {
  rows: T[];
  truncated: boolean;
}

/** 待审批动作（不含载荷；载荷只为通用动作类型按需另取） */
export interface WorkloadPendingSource extends Omit<WorkloadPendingRow, "inquiry" | "payload"> {
  id: string;
}

/** FDE 询盘的原始字段（与 SLA 指标读取同一组列） */
export interface InquirySource {
  opportunityId: string | null;
  createdAt: Date;
  inputContext: unknown;
  opportunity: { source: string | null; lostReason: string | null; customer: { tags: string | null } | null } | null;
}

/** SLA 指标的测试询盘 / 展会判定（默认依赖从 sla-metrics.ts 取同一组函数） */
export interface InquiryClassifier {
  isOnboardingTestInquiry(m: { utmSource?: string | null; customerTags?: string | null; lostReason?: string | null }): boolean;
  utmSourceOf(inputContext: unknown): string | null;
  tradeShowSource: string;
}

export interface WorkloadDeps {
  now(): Date;
  orgSettings(orgId: string): Promise<unknown>;
  agentRuns(orgId: string, since: Date, runTypes: readonly string[], workDomains: readonly string[], limit: number): Promise<WorkloadQueryResult<WorkloadAgentRunRow>>;
  /** 平台级：[from, to) 内各自动化的运行数；to 为 null 表示不设上界 */
  automationCounts(keys: readonly AutomationKey[], from: Date, to: Date | null): Promise<WorkloadAutomationCount[]>;
  pendingActions(orgId: string, since: Date, limit: number): Promise<WorkloadQueryResult<WorkloadPendingSource>>;
  /** 通用动作类型且无 projectId 的动作，按 id 取载荷（只用于读目标类型 / 目标 id） */
  pendingPayloads(orgId: string, ids: readonly string[]): Promise<ReadonlyMap<string, unknown>>;
  projectWorkDomains(orgId: string, projectIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  agentRunTypes(orgId: string, runIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** 询盘回复动作 id → 关联的 FDE 询盘 */
  inquiryLinks(orgId: string, pendingActionIds: readonly string[]): Promise<ReadonlyMap<string, InquirySource>>;
  inquiries(orgId: string, since: Date, now: Date, limit: number): Promise<WorkloadQueryResult<InquirySource>>;
  followUpGuardrailBlocks(orgId: string, since: Date, limit: number): Promise<WorkloadQueryResult<Date>>;
  usage(orgId: string, since: Date, limit: number): Promise<WorkloadQueryResult<WorkloadUsageRow>>;
  usageRuns(orgId: string, runIds: readonly string[]): Promise<ReadonlyMap<string, { runType: string; workDomain: string | null }>>;
  inquiryClassifier(): Promise<InquiryClassifier>;
}

// ── 查询条件（纯函数，测试直接对其断言） ──────────────────────

export function automationRunRangeWhere(keys: readonly string[], from: Date, to: Date | null) {
  return { automationKey: { in: [...keys] }, startedAt: to ? { gte: from, lt: to } : { gte: from } };
}

/** 窗口内创建或决策过的动作，其 updatedAt 都不早于窗口起点 */
export function workloadPendingActionWhere(orgId: string, since: Date) {
  return { orgId, updatedAt: { gte: since } };
}

export function pendingPayloadWhere(orgId: string, ids: readonly string[]) {
  return { orgId, id: { in: [...ids] } };
}

/** 与 sla-metrics.ts loadSlaMetrics 的询盘条件相同（窗口不同） */
export function workloadInquiryWhere(orgId: string, since: Date, now: Date) {
  return {
    orgId,
    employeeKey: WORKLOAD_FDE_EMPLOYEE_KEY,
    actionType: WORKLOAD_INQUIRY_ACTION_TYPE,
    opportunityId: { not: null },
    createdAt: { gte: since, lte: now },
  };
}

export function inquiryLinkWhere(orgId: string, pendingActionIds: readonly string[]) {
  return {
    orgId,
    employeeKey: WORKLOAD_FDE_EMPLOYEE_KEY,
    actionType: WORKLOAD_INQUIRY_ACTION_TYPE,
    pendingActionId: { in: [...pendingActionIds] },
  };
}

export function followUpGuardrailWhere(orgId: string, since: Date) {
  return { orgId, action: WORKLOAD_FOLLOW_UP_GUARDRAIL_ACTION, createdAt: { gte: since } };
}

export function workloadUsageWhere(orgId: string, since: Date) {
  return { orgId, occurredAt: { gte: since } };
}

export function runLookupWhere(orgId: string, ids: readonly string[]) {
  return { orgId, id: { in: [...ids] } };
}

/** 询盘 select：与 sla-metrics.ts 一致的判定字段 */
export const INQUIRY_SELECT = {
  opportunityId: true,
  createdAt: true,
  inputContext: true,
  opportunity: { select: { source: true, lostReason: true, customer: { select: { tags: true } } } },
} as const;

// ── 询盘判定（复用 SLA 指标的函数） ──────────────────────────

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function inquiryFlagsOf(src: InquirySource, sla: InquiryClassifier): InquiryFlags {
  const ctx = record(src.inputContext);
  const source = src.opportunity?.source ?? (typeof ctx?.source === "string" ? ctx.source : null);
  return {
    testInquiry: sla.isOnboardingTestInquiry({
      utmSource: sla.utmSourceOf(src.inputContext),
      customerTags: src.opportunity?.customer?.tags ?? null,
      lostReason: src.opportunity?.lostReason ?? null,
    }),
    tradeShow: source === sla.tradeShowSource,
  };
}

export function toInquiryRow(src: InquirySource, sla: InquiryClassifier): WorkloadInquiryRow | null {
  if (!src.opportunityId) return null;
  return {
    opportunityId: src.opportunityId,
    createdAt: src.createdAt,
    guardrailBlocked: typeof record(src.inputContext)?.guardrailBlockedAt === "string",
    ...inquiryFlagsOf(src, sla),
  };
}

// ── 入口 ──────────────────────────────────────────────────────

/** 通用动作类型无 projectId 时要从载荷取目标类型 / 目标 id；其余类型的载荷（草稿正文等）不读 */
const SHARED_TYPES_NEEDING_PAYLOAD: ReadonlySet<string> = new Set(SHARED_PENDING_ACTION_TYPES);

export async function getOrgWorkload(
  viewer: CockpitViewer,
  days: number,
  deps: WorkloadDeps = defaultWorkloadDeps(),
): Promise<WorkloadResponse> {
  const orgId = viewer.orgId;
  const now = deps.now();
  const settings = await deps.orgSettings(orgId);
  const timeZone = resolveOrgTimezone(settings);
  const thresholds = workloadThresholdsFromOrgSettings(settings);
  const dayKeys = localDayKeys(now, timeZone, days);
  const since7 = new Date(now.getTime() - WORKLOAD_SIGNAL_WINDOW_DAYS * DAY_MS);
  const windowStart = new Date(Math.min(localDayStart(dayKeys[0], timeZone).getTime(), since7.getTime()));
  const runTypes = [...new Set(POST_REGISTRY.flatMap((p) => p.agentRunTypes as readonly string[]))];
  const workDomains = [...new Set(POST_REGISTRY.flatMap((p) => p.workDomains as readonly string[]))];

  const [agentRuns, automationDaily, automationLast7, pending, inquiries, followUps, usage, classifier] = await Promise.all([
    deps.agentRuns(orgId, windowStart, runTypes, workDomains, WORKLOAD_ROW_LIMIT),
    Promise.all(
      dayKeys.map(async (day) => [day, await deps.automationCounts(AUTOMATION_KEYS, localDayStart(day, timeZone), localDayStart(nextDay(day), timeZone))] as const),
    ),
    deps.automationCounts(AUTOMATION_KEYS, since7, null),
    deps.pendingActions(orgId, windowStart, WORKLOAD_ROW_LIMIT),
    deps.inquiries(orgId, windowStart, now, WORKLOAD_ROW_LIMIT),
    deps.followUpGuardrailBlocks(orgId, windowStart, WORKLOAD_ROW_LIMIT),
    deps.usage(orgId, windowStart, WORKLOAD_ROW_LIMIT),
    deps.inquiryClassifier(),
  ]);

  const needPayload = pending.rows.filter((r) => !r.projectId && SHARED_TYPES_NEEDING_PAYLOAD.has(r.type)).map((r) => r.id);
  const payloads = needPayload.length ? await deps.pendingPayloads(orgId, needPayload) : new Map<string, unknown>();
  const actionRows: Array<WorkloadPendingSource & PendingActionRow> = pending.rows.map((r) => ({ ...r, payload: payloads.get(r.id) ?? null }));

  const { projectIds, agentRunIds } = lookupIdsFor(actionRows);
  const replyIds = actionRows.filter((r) => r.type === WORKLOAD_INQUIRY_REPLY_TYPE).map((r) => r.id);
  const usageRunIds = [...new Set(usage.rows.map((u) => u.runId).filter((id): id is string => !!id))];
  const [projectWorkDomains, agentRunTypes, links, usageRuns] = await Promise.all([
    projectIds.length ? deps.projectWorkDomains(orgId, projectIds) : new Map<string, string>(),
    agentRunIds.length ? deps.agentRunTypes(orgId, agentRunIds) : new Map<string, string>(),
    replyIds.length ? deps.inquiryLinks(orgId, replyIds) : new Map<string, InquirySource>(),
    usageRunIds.length ? deps.usageRuns(orgId, usageRunIds) : new Map<string, { runType: string; workDomain: string | null }>(),
  ]);

  const attribution: AttributionLookups = { pendingActions: new Map(), projectWorkDomains, agentRunTypes };
  const pendingActions: WorkloadPendingRow[] = actionRows.map(({ id, ...row }) => {
    const link = links.get(id);
    return { ...row, inquiry: link ? inquiryFlagsOf(link, classifier) : null };
  });

  const result = computeWorkload({
    now,
    timeZone,
    days,
    thresholds,
    agentRuns: agentRuns.rows,
    automationDaily: new Map(automationDaily),
    automationLast7,
    pendingActions,
    attribution,
    inquiries: inquiries.rows
      .map((src) => toInquiryRow(src, classifier))
      .filter((r): r is WorkloadInquiryRow => r !== null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    followUpGuardrailBlocks: followUps.rows,
    usage: usage.rows,
    usageRuns,
    truncated: [agentRuns, pending, inquiries, followUps, usage].some((r) => r.truncated),
  });

  return { orgId, generatedAt: now.toISOString(), ...result };
}

// ── 默认依赖（Prisma，只读） ──────────────────────────────────

const capped = <T>(rows: T[], limit: number): WorkloadQueryResult<T> => ({ rows, truncated: rows.length >= limit });

export function defaultWorkloadDeps(): WorkloadDeps {
  return {
    now: () => new Date(),

    orgSettings: async (orgId) => {
      const { db } = await import("@/lib/db");
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
      return org?.settingsJson ?? null;
    },

    // 与岗位总览"7 天 AI 运行"同一组条件（agentRunTypeCountWhere / workforceDomainCountWhere），只是窗口更长
    agentRuns: async (orgId, since, runTypes, workDomains, limit) => {
      const { db } = await import("@/lib/db");
      const [typed, ...byDomain] = await Promise.all([
        runTypes.length
          ? db.agentRun.findMany({
              where: agentRunTypeCountWhere(orgId, since, runTypes),
              select: { createdAt: true, runType: true },
              orderBy: { createdAt: "desc" },
              take: limit,
            })
          : Promise.resolve([] as Array<{ createdAt: Date; runType: string }>),
        ...workDomains.map((domain) =>
          db.agentRun.findMany({
            where: workforceDomainCountWhere(orgId, since, domain),
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
            take: limit,
          }),
        ),
      ]);
      const rows: WorkloadAgentRunRow[] = [
        ...typed.map((r) => ({ at: r.createdAt, runType: r.runType, workDomain: null })),
        ...byDomain.flatMap((list, i) => list.map((r) => ({ at: r.createdAt, runType: "workforce_job", workDomain: workDomains[i] }))),
      ];
      return { rows, truncated: typed.length >= limit || byDomain.some((list) => list.length >= limit) };
    },

    // AutomationRun 是平台级运行流；按 (automationKey, startedAt) 索引分组计数
    automationCounts: async (keys, from, to) => {
      const { db } = await import("@/lib/db");
      const groups = await db.automationRun.groupBy({
        by: ["automationKey"],
        where: automationRunRangeWhere(keys, from, to),
        _count: { _all: true },
      });
      return groups.map((g) => ({ automationKey: g.automationKey, count: g._count._all }));
    },

    pendingActions: async (orgId, since, limit) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({
        where: workloadPendingActionWhere(orgId, since),
        select: {
          id: true,
          type: true,
          status: true,
          failureReason: true,
          decidedById: true,
          createdAt: true,
          decidedAt: true,
          executedAt: true,
          updatedAt: true,
          projectId: true,
          agentRunId: true,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return capped(rows, limit);
    },

    pendingPayloads: async (orgId, ids) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({ where: pendingPayloadWhere(orgId, ids), select: { id: true, payload: true } });
      return new Map(rows.map((r) => [r.id, r.payload]));
    },

    projectWorkDomains: async (orgId, projectIds) => {
      const { db } = await import("@/lib/db");
      const rows = await db.project.findMany({ where: runLookupWhere(orgId, projectIds), select: { id: true, workDomain: true } });
      return new Map(rows.map((p) => [p.id, p.workDomain]));
    },

    agentRunTypes: async (orgId, runIds) => {
      const { db } = await import("@/lib/db");
      const rows = await db.agentRun.findMany({ where: runLookupWhere(orgId, runIds), select: { id: true, runType: true } });
      return new Map(rows.map((r) => [r.id, r.runType]));
    },

    inquiryLinks: async (orgId, pendingActionIds) => {
      const { db } = await import("@/lib/db");
      const rows = await db.salesAction.findMany({
        where: inquiryLinkWhere(orgId, pendingActionIds),
        select: { pendingActionId: true, ...INQUIRY_SELECT },
      });
      const out = new Map<string, InquirySource>();
      for (const { pendingActionId, ...src } of rows) if (pendingActionId) out.set(pendingActionId, src);
      return out;
    },

    inquiries: async (orgId, since, now, limit) => {
      const { db } = await import("@/lib/db");
      const rows = await db.salesAction.findMany({
        where: workloadInquiryWhere(orgId, since, now),
        select: INQUIRY_SELECT,
        orderBy: { createdAt: "asc" },
        take: limit,
      });
      return capped(rows, limit);
    },

    followUpGuardrailBlocks: async (orgId, since, limit) => {
      const { db } = await import("@/lib/db");
      const rows = await db.auditLog.findMany({
        where: followUpGuardrailWhere(orgId, since),
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return capped(
        rows.map((r) => r.createdAt),
        limit,
      );
    },

    usage: async (orgId, since, limit) => {
      const { db } = await import("@/lib/db");
      const rows = await db.aiUsageLedger.findMany({
        where: workloadUsageWhere(orgId, since),
        select: { occurredAt: true, runId: true, sourceType: true, inputTokens: true, outputTokens: true, costAmount: true, currency: true },
        orderBy: { occurredAt: "desc" },
        take: limit,
      });
      return capped(
        rows.map((r) => ({
          at: r.occurredAt,
          runId: r.runId,
          sourceType: r.sourceType,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cost: Number(r.costAmount),
          currency: r.currency,
        })),
        limit,
      );
    },

    usageRuns: async (orgId, runIds) => {
      const { db } = await import("@/lib/db");
      const rows = await db.agentRun.findMany({ where: runLookupWhere(orgId, runIds), select: { id: true, runType: true, metadata: true } });
      return new Map(
        rows.map((r) => {
          const domain = record(r.metadata)?.workDomain;
          return [r.id, { runType: r.runType, workDomain: typeof domain === "string" ? domain : null }];
        }),
      );
    },

    inquiryClassifier: async () => {
      const sla = await import("@/lib/revenue-spine/sla-metrics");
      return { isOnboardingTestInquiry: sla.isOnboardingTestInquiry, utmSourceOf: sla.utmSourceOf, tradeShowSource: sla.TRADE_SHOW_SOURCE };
    },
  };
}
