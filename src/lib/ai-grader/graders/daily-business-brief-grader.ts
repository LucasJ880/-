/**
 * DailyBusinessBriefGrader —— 今日业务体检（微信 AI 分身优化阶段 · 第一阶段）
 *
 * 职责：基于当前 orgId / userId / role / dataScope，跑确定性规则生成「今日体检」，
 * 输出统一 GraderResult（最多 Top 5 issues + Top 3 suggestedActions）。
 *
 * 设计约束：
 * - 纯只读，无任何写副作用；suggestedActions 仅为建议，执行走 PendingAction 适配器。
 * - 复用现有只读 service `scanSalesDomain`（已内建 orgId + ownOnly 隔离），不重写大 SQL。
 * - 不直接调用会写数据的工具；不跨 orgId；销售只看自己可见数据，admin/super_admin 看全局。
 * - 第一版规则型为主，不依赖 LLM。
 */

import { scanSalesDomain } from "@/lib/secretary/domains/sales";
import { resolveSalesOwnOnly } from "./_scope";
import { computeScoreAndRisk } from "./_scoring";
import {
  orderAndCapActions,
  buildInternalNoteAction,
  extractNameFromTitle,
} from "./_actions";
import type { BriefingItem } from "@/lib/secretary/types";
import type {
  GraderResult,
  GraderIssue,
  GraderAction,
  GraderEvidence,
  RiskLevel,
} from "../types";

export type DailyBusinessBriefContext = {
  orgId: string;
  userId: string;
  role: string;
  now?: Date;
  maxIssues?: number;
  maxActions?: number;
};

const DEFAULT_MAX_ISSUES = 5;
const DEFAULT_MAX_ACTIONS = 3;

/** 可生成"销售跟进提醒"草稿的类别（→ SUGGEST_STATUS_UPDATE / sales.update_followup） */
const FOLLOWUP_CATEGORIES = new Set([
  "quote_pending",
  "followup_due",
  "viewed_not_signed",
  "stale_opportunity",
  "new_lead_stale",
]);

/** 可生成"日历提醒"草稿的类别（→ CREATE_CALENDAR_REMINDER / calendar.create_event） */
const CALENDAR_CATEGORIES = new Set([
  "upcoming_measure",
  "upcoming_install",
  "order_overdue",
  "appointment",
  "today_schedule",
]);

/**
 * 运行今日业务体检。
 */
export async function runDailyBusinessBriefGrader(
  ctx: DailyBusinessBriefContext,
): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  if (!ctx.orgId || !ctx.userId) {
    throw new Error("DailyBusinessBriefGrader 缺少 orgId / userId");
  }

  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);

  // 只读扫描（内建 orgId + ownOnly 隔离）
  const scan = await scanSalesDomain(ctx.userId, ctx.orgId, { ownOnly });

  // 只把 urgent / warning 当作风险项（info 仅作上下文，不计入 issues / 扣分）
  const riskItems = scan.items.filter(
    (i) => i.severity === "urgent" || i.severity === "warning",
  );

  // ── 计算评分（基于全部风险项，而非仅展示的 Top N，更真实）──
  const { score, riskLevel } = computeScoreAndRisk(
    riskItems.map((i) => scanSeverityToRisk(i.severity)),
  );

  // ── Top issues ──
  const topItems = riskItems.slice(0, maxIssues);
  const issues: GraderIssue[] = topItems.map((item) => ({
    severity: scanSeverityToRisk(item.severity),
    category: item.category,
    title: item.title,
    description: item.description ?? "",
    evidence: item.description || undefined,
  }));

  // ── Evidence（对应展示的 issues）──
  const evidence: GraderEvidence[] = topItems.map((item) => ({
    sourceType: sourceTypeFor(item),
    sourceId: item.entityId,
    text: item.title,
  }));

  // ── suggestedActions（来自风险项，确定性映射；统一排序 + 截断）──
  const candidates: GraderAction[] = [];
  for (const item of riskItems) {
    const action = actionForItem(item, now);
    if (action) candidates.push(action);
  }
  const noteAction = buildDailyInternalNote(riskItems);
  if (noteAction) candidates.push(noteAction);
  const suggestedActions = orderAndCapActions(candidates, maxActions);

  const summary = buildSummary(riskItems, score, riskLevel);

  return { score, riskLevel, summary, issues, suggestedActions, evidence };
}

// ── 内部辅助 ───────────────────────────────────────────────────

function scanSeverityToRisk(sev: BriefingItem["severity"]): RiskLevel {
  if (sev === "urgent") return "HIGH";
  if (sev === "warning") return "MEDIUM";
  return "LOW";
}

function sourceTypeFor(item: BriefingItem): GraderEvidence["sourceType"] {
  if (item.category === "quote_pending" || item.category === "viewed_not_signed") {
    return "QUOTE";
  }
  if (CALENDAR_CATEGORIES.has(item.category)) return "CALENDAR";
  return "CUSTOMER";
}

/** 次日 09:00（本地时区）ISO */
function nextMorningISO(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function actionForItem(item: BriefingItem, now: Date): GraderAction | null {
  const payload = item.action?.payload ?? {};
  const opportunityId =
    typeof payload.opportunityId === "string" ? payload.opportunityId : undefined;
  const customerId =
    typeof payload.customerId === "string" ? payload.customerId : undefined;
  const nextFollowupAt = nextMorningISO(now);

  // 销售跟进类 → SUGGEST_STATUS_UPDATE（适配器映射到 sales.update_followup，已可执行）
  if (opportunityId && FOLLOWUP_CATEGORIES.has(item.category)) {
    return {
      actionType: "SUGGEST_STATUS_UPDATE",
      label: `创建跟进提醒：${item.title}`,
      description: `为该机会创建下一次跟进提醒（${item.title}）`,
      requiresApproval: true,
      payload: {
        opportunityId,
        nextFollowupAt,
        reason: item.title,
      },
    };
  }

  // 日程类 → CREATE_CALENDAR_REMINDER（适配器映射到 calendar.create_event，已可执行）
  if (CALENDAR_CATEGORIES.has(item.category)) {
    return {
      actionType: "CREATE_CALENDAR_REMINDER",
      label: `创建提醒：${item.title}`,
      description: item.title,
      requiresApproval: true,
      payload: {
        title: `提醒：${item.title}`,
        startTime: nextFollowupAt,
        durationMinutes: 30,
        customerId,
      },
    };
  }

  return null;
}

/** 取首个 HIGH（urgent）且可定位（opportunityId/customerId）的风险项，生成 ≤1 个内部备注 */
function buildDailyInternalNote(riskItems: BriefingItem[]): GraderAction | null {
  for (const item of riskItems) {
    if (scanSeverityToRisk(item.severity) !== "HIGH") continue;
    const payload = item.action?.payload ?? {};
    const opportunityId =
      typeof payload.opportunityId === "string" ? payload.opportunityId : undefined;
    const customerId =
      typeof payload.customerId === "string"
        ? payload.customerId
        : item.entityType === "sales_customer"
          ? item.entityId
          : undefined;
    if (!opportunityId && !customerId) continue;

    const name = extractNameFromTitle(item.title);
    return buildInternalNoteAction({
      graderType: "DAILY_BRIEF",
      label: name ? `记录${name}风险备注` : "记录销售风险备注",
      noteText: `AI 今日体检发现：${item.title}。建议尽快跟进。`,
      reason: "DailyBusinessBriefGrader 检测到高风险销售跟进问题",
      issueCategory: item.category,
      issueSeverity: "HIGH",
      opportunityId,
      customerId,
    });
  }
  return null;
}

function buildSummary(
  riskItems: BriefingItem[],
  score: number,
  riskLevel: RiskLevel,
): string {
  if (riskItems.length === 0) {
    return "今天没有发现明显风险，保持节奏 👍";
  }
  const urgent = riskItems.filter((i) => i.severity === "urgent").length;
  return `今日体检完成：评分 ${score}/100（风险 ${riskLevel}），发现 ${riskItems.length} 项需关注，其中紧急 ${urgent} 项。`;
}
