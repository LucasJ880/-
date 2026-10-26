/**
 * 组织驾驶舱 — 工作量 / 无用功汇总（A-4，openspec change org-cockpit-workload）
 *
 * 纯函数：按岗位 × 组织本地日汇总 AI 运行、待审批的提出与结局、护栏拦截、AI 用量与成本，
 * 再用近 7 天数据按固定阈值判定"疑似无用功"。查询与装配在 workload-read-model.ts。
 * 本文件不 import 任何数据库代码；需要数据库模块常量的地方用本地常量，测试对照写入方源码核对。
 */

import { getLocalTimeParts } from "@/lib/automation/local-time";
import { zonedLocalToUtc } from "@/lib/revenue-spine/business-days";
import {
  POST_REGISTRY,
  postForAgentRunType,
  postForAutomation,
  postForPendingAction,
  postForWorkDomain,
  type PostKey,
} from "./posts";
import { projectIdOf, targetTypeOf, type AttributionLookups, type PendingActionRow } from "./waiting";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── 窗口与参数 ────────────────────────────────────────────────

export const WORKLOAD_DEFAULT_DAYS = 14;
export const WORKLOAD_MIN_DAYS = 7;
export const WORKLOAD_MAX_DAYS = 30;
/** 规则与"近 7 天"合计的窗口：当前时刻往前 7×24 小时（与岗位卡片的"7 天"同口径） */
export const WORKLOAD_SIGNAL_WINDOW_DAYS = 7;

export function parseWorkloadDays(raw: string | null): { ok: true; days: number } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, days: WORKLOAD_DEFAULT_DAYS };
  if (!/^\d+$/.test(raw)) return { ok: false, error: `days 必须是 ${WORKLOAD_MIN_DAYS}–${WORKLOAD_MAX_DAYS} 的整数` };
  const days = Number(raw);
  if (days < WORKLOAD_MIN_DAYS || days > WORKLOAD_MAX_DAYS) {
    return { ok: false, error: `days 必须是 ${WORKLOAD_MIN_DAYS}–${WORKLOAD_MAX_DAYS} 的整数` };
  }
  return { ok: true, days };
}

// ── 阈值 ──────────────────────────────────────────────────────

export interface WorkloadThresholds {
  /** 驳回 /（批准 + 驳回）超过此值命中 */
  rejectRate: number;
  /** 过期 /（批准 + 驳回 + 过期）超过此值命中 */
  expireRate: number;
  /** 驳回率 / 过期率的分母至少这么多才判定 */
  minDecisions: number;
  /** 提出为 0 时，本组织 AI 运行至少这么多次才算空转 */
  idleMinRuns: number;
  /** 每次批准成本超过中位数的倍数 */
  costMultiple: number;
  /** 有"每次批准成本"的行至少这么多才判定成本离群 */
  minCostPeers: number;
}

export const DEFAULT_WORKLOAD_THRESHOLDS: Readonly<WorkloadThresholds> = Object.freeze({
  rejectRate: 0.5,
  expireRate: 0.5,
  minDecisions: 4,
  idleMinRuns: 1,
  costMultiple: 3,
  minCostPeers: 3,
});

const isRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000;
const isMultiple = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 1 && v <= 100;

const THRESHOLD_VALIDATORS: { [K in keyof WorkloadThresholds]: (v: unknown) => v is number } = {
  rejectRate: isRate,
  expireRate: isRate,
  minDecisions: isCount,
  idleMinRuns: isCount,
  costMultiple: isMultiple,
  minCostPeers: isCount,
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Organization.settingsJson.cockpit.workloadThresholds：逐项校验，非法项回退默认，不影响其他项 */
export function workloadThresholdsFromOrgSettings(settingsJson: unknown): WorkloadThresholds {
  const raw = record(record(record(settingsJson)?.cockpit)?.workloadThresholds) ?? {};
  const out = { ...DEFAULT_WORKLOAD_THRESHOLDS };
  for (const key of Object.keys(THRESHOLD_VALIDATORS) as Array<keyof WorkloadThresholds>) {
    const value = raw[key];
    if (THRESHOLD_VALIDATORS[key](value)) out[key] = value;
  }
  return out;
}

// ── 组织本地日 ────────────────────────────────────────────────

export function localDayOf(at: Date, timeZone: string): string {
  return getLocalTimeParts(at, timeZone).date;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** 含今天在内、按时间升序的 count 个组织本地日 */
export function localDayKeys(now: Date, timeZone: string, count: number): string[] {
  const days = [localDayOf(now, timeZone)];
  while (days.length < count) days.unshift(previousDay(days[0]));
  return days;
}

/** 本地日的起点（UTC），夏令时切换日按当地 00:00 计 */
export function localDayStart(day: string, timeZone: string): Date {
  return zonedLocalToUtc(day, 0, timeZone);
}

// ── 待审批动作的结局 ──────────────────────────────────────────

/** 写入方：approval/port.ts expireOverdueApprovals、pending-actions/executor.ts 懒过期 */
export const PENDING_EXPIRED_REASON = "已过期";
/** 写入方：capabilities/approvals/decision.ts（人工取消，带决策人） */
export const PENDING_CANCELLED_REASON = "已取消";
/** 写入方：pending-actions/executor.ts、agent-runtime/pending-link.ts（关联 run 被取消） */
export const PENDING_RUN_CANCELLED_PREFIX = "关联任务已取消";
/** 与 pending-actions/supersede.ts SYSTEM_SUPERSESSION_REASON_CODES 一致（测试对照源码） */
export const PENDING_ONBOARDING_TEST_SUPERSEDED = "SUPERSEDED_BY_ONBOARDING_TEST";
export const PENDING_SYSTEM_SUPERSEDED_CODES = ["SUPERSEDED_BY_MANUAL_REPLY", "SUPERSEDED_BY_NEWER_INBOUND"] as const;

export type PendingOutcome =
  | "excluded"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "superseded"
  | "system_failed";

export interface PendingOutcomeInput {
  status: string;
  failureReason: string | null;
  decidedById: string | null;
}

/** 有序规则表，第一条命中即停（design D5） */
export function pendingActionOutcome(row: PendingOutcomeInput): { outcome: PendingOutcome; executionFailed: boolean } {
  const reason = row.failureReason?.trim() ?? "";
  if (reason.startsWith(PENDING_ONBOARDING_TEST_SUPERSEDED)) return { outcome: "excluded", executionFailed: false };
  switch (row.status) {
    case "pending":
      return { outcome: "pending", executionFailed: false };
    case "approved":
    case "executed":
      return { outcome: "approved", executionFailed: false };
    case "rejected":
      return { outcome: reason.startsWith(PENDING_RUN_CANCELLED_PREFIX) ? "cancelled" : "rejected", executionFailed: false };
    case "failed":
      if (reason === PENDING_EXPIRED_REASON) return { outcome: "expired", executionFailed: false };
      if (reason === PENDING_CANCELLED_REASON) return { outcome: "cancelled", executionFailed: false };
      if (PENDING_SYSTEM_SUPERSEDED_CODES.some((code) => reason.startsWith(code))) return { outcome: "superseded", executionFailed: false };
      if (row.decidedById) return { outcome: "approved", executionFailed: true };
      return { outcome: "system_failed", executionFailed: false };
    default:
      return { outcome: "system_failed", executionFailed: false };
  }
}

/** 结局日：决策时间 → 执行时间 → 最后更新时间 */
export function pendingOutcomeAt(row: { decidedAt: Date | null; executedAt: Date | null; updatedAt: Date }): Date {
  return row.decidedAt ?? row.executedAt ?? row.updatedAt;
}

// ── 行与归属 ──────────────────────────────────────────────────

export const TRADE_SHOW_ROW = "inbound_sales_trade_show";
export const UNATTRIBUTED_ROW = "unattributed";
export type WorkloadRowKey = PostKey | typeof TRADE_SHOW_ROW | typeof UNATTRIBUTED_ROW;

/** 询盘销售之后紧跟展会行，未归属在最后 */
export const WORKLOAD_ROW_ORDER: readonly WorkloadRowKey[] = POST_REGISTRY.flatMap((p): WorkloadRowKey[] =>
  p.key === "inbound_sales" ? [p.key, TRADE_SHOW_ROW] : [p.key],
).concat(UNATTRIBUTED_ROW);

export function workloadRowName(key: WorkloadRowKey): string {
  if (key === TRADE_SHOW_ROW) return "询盘销售 · 展会";
  if (key === UNATTRIBUTED_ROW) return "未归属";
  return POST_REGISTRY.find((p) => p.key === key)?.name ?? key;
}

export function workloadRowNav(key: WorkloadRowKey): string | null {
  if (key === TRADE_SHOW_ROW) return "/revenue";
  if (key === UNATTRIBUTED_ROW) return null;
  return POST_REGISTRY.find((p) => p.key === key)?.nav ?? null;
}

/** AI 运行的岗位：运行类型的固定归属，或 workforce 作业的工作域（与岗位卡片"7 天 AI x 次"同一规则） */
export function postForAgentRun(runType: string, workDomain: string | null): PostKey | null {
  const byType = postForAgentRunType(runType);
  if (byType) return byType;
  return runType === "workforce_job" && workDomain ? postForWorkDomain(workDomain) : null;
}

/** 用量记账来源：产品内容模块的记账归"内容"岗位 */
export const USAGE_PRODUCT_CONTENT_SOURCE = "PRODUCT_CONTENT";
export const USAGE_COST_CURRENCY = "USD";

// ── 输入 ──────────────────────────────────────────────────────

export interface WorkloadAgentRunRow {
  at: Date;
  runType: string;
  workDomain: string | null;
}

export interface WorkloadAutomationCount {
  automationKey: string;
  count: number;
}

/** 询盘回复动作关联的询盘（由读模型用 SLA 指标的同一套判定算好） */
export interface InquiryFlags {
  testInquiry: boolean;
  tradeShow: boolean;
}

export interface WorkloadPendingRow extends PendingActionRow {
  status: string;
  failureReason: string | null;
  decidedById: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
  updatedAt: Date;
  /** 只有询盘回复动作且关联到 FDE 询盘时才有 */
  inquiry: InquiryFlags | null;
}

export interface WorkloadInquiryRow extends InquiryFlags {
  opportunityId: string;
  createdAt: Date;
  guardrailBlocked: boolean;
}

export interface WorkloadUsageRow {
  at: Date;
  runId: string | null;
  sourceType: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number;
  currency: string;
}

export interface WorkloadInput {
  now: Date;
  timeZone: string;
  days: number;
  thresholds: WorkloadThresholds;
  agentRuns: readonly WorkloadAgentRunRow[];
  /** 平台级自动化：每个本地日的计数（日期 → 计数表）与近 7 天合计 */
  automationDaily: ReadonlyMap<string, readonly WorkloadAutomationCount[]>;
  automationLast7: readonly WorkloadAutomationCount[];
  pendingActions: readonly WorkloadPendingRow[];
  attribution: AttributionLookups;
  /** 窗口内的 FDE 询盘（按创建时间升序） */
  inquiries: readonly WorkloadInquiryRow[];
  followUpGuardrailBlocks: readonly Date[];
  usage: readonly WorkloadUsageRow[];
  /** 用量记账 runId → 运行类型 / 工作域 */
  usageRuns: ReadonlyMap<string, { runType: string; workDomain: string | null }>;
  truncated: boolean;
}

// ── 输出 ──────────────────────────────────────────────────────

export interface WorkloadCounts {
  agentRuns: number;
  /** 平台级，不参与规则 */
  automationRuns: number;
  proposed: number;
  approved: number;
  rejected: number;
  expired: number;
  cancelled: number;
  superseded: number;
  systemFailed: number;
  executionFailed: number;
  guardrailBlocked: number;
  inputTokens: number;
  outputTokens: number;
  /** USD */
  cost: number;
}

export type WorkloadSignalCode = "high_reject_rate" | "high_expire_rate" | "idle" | "cost_outlier";

export interface WorkloadSignal {
  code: WorkloadSignalCode;
  message: string;
}

export interface WorkloadRow {
  key: WorkloadRowKey;
  name: string;
  nav: string | null;
  /** 与 days 一一对齐 */
  daily: WorkloadCounts[];
  last7: WorkloadCounts;
  /** 窗口内有没有任何用量记账；没有时成本显示"未入账" */
  costRecorded: boolean;
  signals: WorkloadSignal[];
}

export const WORKLOAD_AVAILABILITY = {
  edited: { status: "unavailable", reason: "审批流程还没有记录改稿痕迹，B-1（fde-feedback-loop）接入后可用" },
  autoExecuted: { status: "not_applicable", reason: "所有执行都经人工批准，没有自动执行路径" },
  automationScope: "platform",
} as const;

export interface WorkloadResult {
  timezone: string;
  days: string[];
  signalWindowDays: typeof WORKLOAD_SIGNAL_WINDOW_DAYS;
  thresholds: WorkloadThresholds;
  availability: typeof WORKLOAD_AVAILABILITY;
  rows: WorkloadRow[];
  truncated: boolean;
}

export function emptyCounts(): WorkloadCounts {
  return {
    agentRuns: 0,
    automationRuns: 0,
    proposed: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    cancelled: 0,
    superseded: 0,
    systemFailed: 0,
    executionFailed: 0,
    guardrailBlocked: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
  };
}

// ── 汇总 ──────────────────────────────────────────────────────

type CountKey = keyof WorkloadCounts;

const OUTCOME_FIELD: Partial<Record<PendingOutcome, CountKey>> = {
  approved: "approved",
  rejected: "rejected",
  expired: "expired",
  cancelled: "cancelled",
  superseded: "superseded",
  system_failed: "systemFailed",
};

function pendingRowKey(row: WorkloadPendingRow, lookups: AttributionLookups): WorkloadRowKey {
  if (row.inquiry?.tradeShow) return TRADE_SHOW_ROW;
  const projectId = projectIdOf(row);
  const post = postForPendingAction({
    type: row.type,
    projectWorkDomain: projectId ? lookups.projectWorkDomains.get(projectId) ?? null : null,
    targetType: targetTypeOf(row.payload),
    agentRunType: row.agentRunId ? lookups.agentRunTypes.get(row.agentRunId) ?? null : null,
  });
  return post ?? UNATTRIBUTED_ROW;
}

function usageRowKey(row: WorkloadUsageRow, runs: WorkloadInput["usageRuns"]): WorkloadRowKey {
  const run = row.runId ? runs.get(row.runId) : undefined;
  const byRun = run ? postForAgentRun(run.runType, run.workDomain) : null;
  if (byRun) return byRun;
  if (row.sourceType === USAGE_PRODUCT_CONTENT_SOURCE) return "content";
  return UNATTRIBUTED_ROW;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeWorkload(input: WorkloadInput): WorkloadResult {
  const { now, timeZone, thresholds } = input;
  const days = localDayKeys(now, timeZone, input.days);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const since7 = now.getTime() - WORKLOAD_SIGNAL_WINDOW_DAYS * DAY_MS;

  const rows = new Map<WorkloadRowKey, { daily: WorkloadCounts[]; last7: WorkloadCounts; costRecorded: boolean }>(
    WORKLOAD_ROW_ORDER.map((key) => [key, { daily: days.map(emptyCounts), last7: emptyCounts(), costRecorded: false }]),
  );

  const add = (key: WorkloadRowKey, at: Date, field: CountKey, amount = 1) => {
    const row = rows.get(key)!;
    const i = dayIndex.get(localDayOf(at, timeZone));
    if (i !== undefined) row.daily[i][field] += amount;
    if (at.getTime() >= since7) row.last7[field] += amount;
  };

  // AI 运行（本组织）
  for (const run of input.agentRuns) add(postForAgentRun(run.runType, run.workDomain) ?? UNATTRIBUTED_ROW, run.at, "agentRuns");

  // 平台级自动化：读模型已按本地日 / 近 7 天计好数，这里只按注册表归岗位
  for (const [day, counts] of input.automationDaily) {
    const i = dayIndex.get(day);
    if (i === undefined) continue;
    for (const c of counts) rows.get(postForAutomation(c.automationKey) ?? UNATTRIBUTED_ROW)!.daily[i].automationRuns += c.count;
  }
  for (const c of input.automationLast7) rows.get(postForAutomation(c.automationKey) ?? UNATTRIBUTED_ROW)!.last7.automationRuns += c.count;

  // 待审批：提出按创建日，结局按结局日；入驻测试（作废码或关联测试询盘）整条不计
  for (const row of input.pendingActions) {
    const { outcome, executionFailed } = pendingActionOutcome(row);
    if (outcome === "excluded" || row.inquiry?.testInquiry) continue;
    const key = pendingRowKey(row, input.attribution);
    add(key, row.createdAt, "proposed");
    const field = OUTCOME_FIELD[outcome];
    if (!field) continue;
    const at = pendingOutcomeAt(row);
    add(key, at, field);
    if (executionFailed) add(key, at, "executionFailed");
  }

  // 首封护栏：与 SLA 指标同口径——按商机去重（取最早一条）、排除测试询盘、展会单列，按询盘创建日分桶
  const seenOpportunities = new Set<string>();
  for (const inquiry of input.inquiries) {
    if (seenOpportunities.has(inquiry.opportunityId)) continue;
    seenOpportunities.add(inquiry.opportunityId);
    if (inquiry.testInquiry || !inquiry.guardrailBlocked) continue;
    add(inquiry.tradeShow ? TRADE_SHOW_ROW : "inbound_sales", inquiry.createdAt, "guardrailBlocked");
  }
  // 跟进护栏审计：无法区分测试 / 展会，全计入询盘销售（与 SLA 指标 guardrail.followUp 同口径）
  for (const at of input.followUpGuardrailBlocks) add("inbound_sales", at, "guardrailBlocked");

  // 用量与成本
  for (const usage of input.usage) {
    const key = usageRowKey(usage, input.usageRuns);
    rows.get(key)!.costRecorded = true;
    add(key, usage.at, "inputTokens", usage.inputTokens ?? 0);
    add(key, usage.at, "outputTokens", usage.outputTokens ?? 0);
    if (usage.currency === USAGE_COST_CURRENCY && Number.isFinite(usage.cost)) add(key, usage.at, "cost", usage.cost);
  }

  const built: WorkloadRow[] = WORKLOAD_ROW_ORDER.map((key) => {
    const row = rows.get(key)!;
    const roundCost = (c: WorkloadCounts) => ({ ...c, cost: round(c.cost, 4) });
    return {
      key,
      name: workloadRowName(key),
      nav: workloadRowNav(key),
      daily: row.daily.map(roundCost),
      last7: roundCost(row.last7),
      costRecorded: row.costRecorded,
      signals: [],
    };
  });

  applySignals(built, thresholds);

  return {
    timezone: timeZone,
    days,
    signalWindowDays: WORKLOAD_SIGNAL_WINDOW_DAYS,
    thresholds,
    availability: WORKLOAD_AVAILABILITY,
    rows: built,
    truncated: input.truncated,
  };
}

// ── 疑似无用功规则 ────────────────────────────────────────────

/** 每次批准成本：批准 > 0 且有成本的行才有值 */
export function costPerApproved(row: Pick<WorkloadRow, "last7" | "costRecorded">): number | null {
  const { approved, cost } = row.last7;
  return row.costRecorded && approved > 0 && cost > 0 ? cost / approved : null;
}

export function applySignals(rows: WorkloadRow[], thresholds: WorkloadThresholds): void {
  const judged = rows.filter((r) => r.key !== UNATTRIBUTED_ROW);

  for (const row of judged) {
    const c = row.last7;
    const decided = c.approved + c.rejected;
    if (decided >= thresholds.minDecisions && c.rejected / decided > thresholds.rejectRate) {
      row.signals.push({
        code: "high_reject_rate",
        message: `近 7 天驳回 ${c.rejected}/${decided}（${percent(c.rejected / decided)}），超过 ${percent(thresholds.rejectRate)}`,
      });
    }
    const closed = c.approved + c.rejected + c.expired;
    if (closed >= thresholds.minDecisions && c.expired / closed > thresholds.expireRate) {
      row.signals.push({
        code: "high_expire_rate",
        message: `近 7 天过期 ${c.expired}/${closed}（${percent(c.expired / closed)}），审批没人及时处理`,
      });
    }
    if (c.proposed === 0 && c.agentRuns >= thresholds.idleMinRuns) {
      row.signals.push({ code: "idle", message: `近 7 天 AI 运行 ${c.agentRuns} 次，没有提出任何待审批` });
    }
  }

  const peers = judged.map((row) => ({ row, value: costPerApproved(row) })).filter((p): p is { row: WorkloadRow; value: number } => p.value !== null);
  if (peers.length < thresholds.minCostPeers) return;
  const mid = median(peers.map((p) => p.value));
  for (const { row, value } of peers) {
    if (mid > 0 && value > thresholds.costMultiple * mid) {
      row.signals.push({
        code: "cost_outlier",
        message: `近 7 天每次批准成本 ${usd(value)}，是各岗位中位数 ${usd(mid)} 的 ${round(value / mid, 1)} 倍`,
      });
    }
  }
}
