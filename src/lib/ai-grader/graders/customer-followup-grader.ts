/**
 * CustomerFollowupGrader —— 客户跟进体检（微信 AI 分身优化阶段 · 第二阶段）
 *
 * 两种模式：
 * - GLOBAL：返回最该跟进的 Top 客户/商机（复用 scanSalesDomain 销售域只读扫描）
 * - CUSTOMER：针对单个客户/商机做跟进健康诊断（按 orgId + ownOnly 只读查询）
 *
 * 设计约束：
 * - 纯只读，无任何写副作用；suggestedActions 仅为建议，执行走 PendingAction 适配器。
 * - 复用现有只读能力（scanSalesDomain / data-scope）；不重写大 SQL；不调用会写数据的工具。
 * - 严格 orgId + RBAC + data scope；销售只看自己可见数据，admin/org_admin/super_admin 看全局。
 * - 第一版规则型，不依赖 LLM。
 */

import { db } from "@/lib/db";
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

export type CustomerFollowupGraderContext = {
  orgId: string;
  userId: string;
  role: string;
  now?: Date;
  mode?: "GLOBAL" | "CUSTOMER";
  customerId?: string;
  customerName?: string;
  opportunityId?: string;
  maxIssues?: number;
  maxActions?: number;
};

const DEFAULT_MAX_ISSUES = 5;
const DEFAULT_MAX_ACTIONS = 3;
const DAY_MS = 86_400_000;

const ACTIVE_STAGES = [
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "新线索",
  needs_confirmed: "需求确认",
  measure_booked: "预约量房",
  quoted: "已报价",
  negotiation: "洽谈中",
};

const STALE_DAYS: Record<string, number> = {
  new_lead: 3,
  needs_confirmed: 5,
  measure_booked: 5,
  quoted: 3,
  negotiation: 7,
};

/** GLOBAL 模式只关注的"跟进类"风险类别 */
const FOLLOWUP_GLOBAL_CATEGORIES = new Set([
  "followup_due",
  "stale_opportunity",
  "new_lead_stale",
  "quote_pending",
  "viewed_not_signed",
]);

// ── 客户解析（CUSTOMER 模式） ──────────────────────────────────

export type CustomerResolution =
  | { status: "ok"; customerId: string; customerName: string }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Array<{ name: string }> }
  | { status: "need_name" };

/**
 * 解析 CUSTOMER 模式要诊断的客户（按 orgId + ownOnly 限定，越权/不可见一律视为找不到）。
 */
export async function resolveCustomerForFollowup(
  ctx: CustomerFollowupGraderContext,
): Promise<CustomerResolution> {
  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);
  const ownerWhere = ownOnly ? { createdById: ctx.userId } : {};

  // 1) 指定 customerId
  if (ctx.customerId) {
    const c = await db.salesCustomer.findFirst({
      where: { id: ctx.customerId, orgId: ctx.orgId, ...ownerWhere },
      select: { id: true, name: true },
    });
    return c ? { status: "ok", customerId: c.id, customerName: c.name } : { status: "not_found" };
  }

  // 2) 指定 opportunityId → 取其客户（机会按 own：创建或被分配）
  if (ctx.opportunityId) {
    const opp = await db.salesOpportunity.findFirst({
      where: {
        id: ctx.opportunityId,
        orgId: ctx.orgId,
        ...(ownOnly
          ? { OR: [{ createdById: ctx.userId }, { assignedToId: ctx.userId }] }
          : {}),
      },
      select: { customer: { select: { id: true, name: true } } },
    });
    return opp?.customer
      ? { status: "ok", customerId: opp.customer.id, customerName: opp.customer.name }
      : { status: "not_found" };
  }

  // 3) 按客户名模糊匹配
  const name = (ctx.customerName ?? "").trim();
  if (!name) return { status: "need_name" };

  const matches = await db.salesCustomer.findMany({
    where: {
      orgId: ctx.orgId,
      archivedAt: null,
      name: { contains: name, mode: "insensitive" },
      ...ownerWhere,
    },
    select: { id: true, name: true },
    take: 6,
  });

  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) {
    return { status: "ambiguous", candidates: matches.map((m) => ({ name: m.name })) };
  }
  return { status: "ok", customerId: matches[0].id, customerName: matches[0].name };
}

// ── 主入口 ─────────────────────────────────────────────────────

export async function runCustomerFollowupGrader(
  ctx: CustomerFollowupGraderContext,
): Promise<GraderResult> {
  if (!ctx.orgId || !ctx.userId) {
    throw new Error("CustomerFollowupGrader 缺少 orgId / userId");
  }
  const mode = ctx.mode ?? "GLOBAL";
  return mode === "CUSTOMER" ? runCustomerMode(ctx) : runGlobalMode(ctx);
}

// ── GLOBAL 模式 ────────────────────────────────────────────────

async function runGlobalMode(
  ctx: CustomerFollowupGraderContext,
): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);
  const scan = await scanSalesDomain(ctx.userId, ctx.orgId, { ownOnly });

  // 只取跟进类风险（urgent/warning）
  const riskItems = scan.items.filter(
    (i) =>
      (i.severity === "urgent" || i.severity === "warning") &&
      FOLLOWUP_GLOBAL_CATEGORIES.has(i.category),
  );

  const { score, riskLevel } = computeScoreAndRisk(
    riskItems.map((i) => scanSeverityToRisk(i.severity)),
  );

  const topItems = riskItems.slice(0, maxIssues);
  const issues: GraderIssue[] = topItems.map((item) => ({
    severity: scanSeverityToRisk(item.severity),
    category: item.category,
    title: item.title,
    description: item.description ?? "",
    evidence: item.description || undefined,
  }));
  const evidence: GraderEvidence[] = topItems.map((item) => ({
    sourceType:
      item.category === "quote_pending" || item.category === "viewed_not_signed"
        ? "QUOTE"
        : "CUSTOMER",
    sourceId: item.entityId,
    text: item.title,
  }));

  const candidates: GraderAction[] = [];
  for (const item of riskItems) {
    const a = globalActionFor(item, now);
    if (a) candidates.push(a);
  }
  const noteAction = buildGlobalInternalNote(riskItems);
  if (noteAction) candidates.push(noteAction);
  const suggestedActions = orderAndCapActions(candidates, maxActions);

  const summary =
    riskItems.length === 0
      ? "暂时没有需要紧急跟进的客户，保持节奏 👍"
      : `客户跟进体检：评分 ${score}/100（风险 ${riskLevel}），有 ${riskItems.length} 个客户需要跟进。`;

  return { score, riskLevel, summary, issues, suggestedActions, evidence };
}

function globalActionFor(item: BriefingItem, now: Date): GraderAction | null {
  const payload = item.action?.payload ?? {};
  const opportunityId =
    typeof payload.opportunityId === "string" ? payload.opportunityId : undefined;
  if (!opportunityId) return null;
  return {
    actionType: "SUGGEST_STATUS_UPDATE",
    label: `创建跟进提醒：${item.title}`,
    description: `为该客户创建下一次跟进提醒（${item.title}）`,
    requiresApproval: true,
    payload: {
      opportunityId,
      nextFollowupAt: nextMorningISO(now),
      reason: item.title,
    },
  };
}

/** GLOBAL：取首个 HIGH 且可定位的风险项，生成 ≤1 个内部备注 */
function buildGlobalInternalNote(riskItems: BriefingItem[]): GraderAction | null {
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
      graderType: "CUSTOMER_FOLLOWUP",
      label: name ? `记录${name}跟进风险` : "记录客户跟进风险",
      noteText: `AI 客户体检发现：${item.title}。建议尽快跟进。`,
      reason: "CustomerFollowupGrader 检测到客户跟进风险",
      issueCategory: item.category,
      issueSeverity: "HIGH",
      opportunityId,
      customerId,
    });
  }
  return null;
}

// ── CUSTOMER 模式 ──────────────────────────────────────────────

async function runCustomerMode(
  ctx: CustomerFollowupGraderContext,
): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  if (!ctx.customerId) {
    throw new Error("CUSTOMER 模式需要已解析的 customerId");
  }
  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);

  const customer = await db.salesCustomer.findFirst({
    where: {
      id: ctx.customerId,
      orgId: ctx.orgId,
      ...(ownOnly ? { createdById: ctx.userId } : {}),
    },
    select: {
      id: true,
      name: true,
      opportunities: {
        where: { stage: { in: ACTIVE_STAGES } },
        select: {
          id: true,
          title: true,
          stage: true,
          nextFollowupAt: true,
          measureDate: true,
          createdAt: true,
          interactions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
          quotes: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true, status: true, viewedAt: true, signedAt: true },
          },
        },
        take: 20,
      },
    },
  });

  if (!customer) {
    // 解析层应已拦截；这里兜底为"无风险"空结果
    return {
      score: 100,
      riskLevel: "LOW",
      summary: "没有找到该客户或无权访问。",
      issues: [],
      suggestedActions: [],
      evidence: [],
    };
  }

  type Finding = {
    level: RiskLevel;
    title: string;
    opportunityId: string;
    /** followup=建跟进提醒 / quote=建报价提醒 */
    actionKind: "followup" | "quote" | null;
  };
  const findings: Finding[] = [];

  for (const opp of customer.opportunities) {
    const stageLabel = STAGE_LABELS[opp.stage] ?? opp.stage;
    const lastQuote = opp.quotes[0];
    const lastInteraction = opp.interactions[0];

    // 1) 跟进逾期 / 今日到期
    if (opp.nextFollowupAt) {
      const ms = opp.nextFollowupAt.getTime() - now.getTime();
      if (ms < 0) {
        findings.push({
          level: "HIGH",
          title: `跟进逾期 ${Math.floor(-ms / DAY_MS)} 天（${stageLabel}）`,
          opportunityId: opp.id,
          actionKind: "followup",
        });
      } else if (ms <= DAY_MS) {
        findings.push({
          level: "MEDIUM",
          title: `今日需跟进（${stageLabel}）`,
          opportunityId: opp.id,
          actionKind: "followup",
        });
      }
    } else {
      // 2) 没有下一步提醒
      findings.push({
        level: "MEDIUM",
        title: `没有下一步跟进安排（${stageLabel}）`,
        opportunityId: opp.id,
        actionKind: "followup",
      });
    }

    // 3) 报价已发送未回复
    if (lastQuote && opp.stage === "quoted" && lastQuote.status === "sent") {
      const days = Math.floor((now.getTime() - new Date(lastQuote.createdAt).getTime()) / DAY_MS);
      if (days >= 7) {
        findings.push({
          level: "HIGH",
          title: `报价已发送 ${days} 天未回复`,
          opportunityId: opp.id,
          actionKind: "followup",
        });
      } else if (days >= 3) {
        findings.push({
          level: "MEDIUM",
          title: `报价已发送 ${days} 天未回复`,
          opportunityId: opp.id,
          actionKind: "followup",
        });
      }
    }

    // 4) 已查看报价但未签约
    if (lastQuote?.viewedAt && !lastQuote.signedAt) {
      const days = Math.floor((now.getTime() - new Date(lastQuote.viewedAt).getTime()) / DAY_MS);
      if (days >= 2) {
        findings.push({
          level: days >= 5 ? "HIGH" : "MEDIUM",
          title: `客户已看报价 ${days} 天仍未签约`,
          opportunityId: opp.id,
          actionKind: "followup",
        });
      }
    }

    // 5) 测量完成但未报价
    if (
      opp.stage === "measure_booked" &&
      opp.measureDate &&
      opp.measureDate.getTime() < now.getTime() &&
      !lastQuote
    ) {
      findings.push({
        level: "HIGH",
        title: "已测量但还未报价",
        opportunityId: opp.id,
        actionKind: "quote",
      });
    }

    // 6) 长时间无新沟通
    const lastActivity = lastInteraction
      ? new Date(lastInteraction.createdAt)
      : new Date(opp.createdAt);
    const daysSilent = Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS);
    const staleDays = STALE_DAYS[opp.stage] ?? 7;
    if (daysSilent >= staleDays) {
      findings.push({
        level: daysSilent >= staleDays * 2 ? "HIGH" : "MEDIUM",
        title: `最近 ${daysSilent} 天无新沟通（${stageLabel}）`,
        opportunityId: opp.id,
        actionKind: "followup",
      });
    }
  }

  // 排序：HIGH 优先
  const rank: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => rank[a.level] - rank[b.level]);

  const { score, riskLevel } = computeScoreAndRisk(findings.map((f) => f.level));

  const topFindings = findings.slice(0, maxIssues);
  const issues: GraderIssue[] = topFindings.map((f) => ({
    severity: f.level,
    category: "customer_followup",
    title: f.title,
    description: "",
  }));
  const evidence: GraderEvidence[] = topFindings.map((f) => ({
    sourceType: "CUSTOMER",
    sourceId: f.opportunityId,
    text: f.title,
  }));

  // 生成动作（按机会 + 动作类型去重；统一排序 + 截断，最多 1 个内部备注）
  const candidates: GraderAction[] = [];
  const seen = new Set<string>();
  for (const f of findings) {
    if (!f.actionKind) continue;
    const key = `${f.actionKind}:${f.opportunityId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (f.actionKind === "followup") {
      candidates.push({
        actionType: "SUGGEST_STATUS_UPDATE",
        label: `创建 ${customer.name} 跟进提醒`,
        description: `为 ${customer.name} 设置下一次跟进时间`,
        requiresApproval: true,
        payload: {
          opportunityId: f.opportunityId,
          nextFollowupAt: nextMorningISO(now),
          customerName: customer.name,
          reason: f.title,
        },
      });
    } else if (f.actionKind === "quote") {
      candidates.push({
        actionType: "CREATE_CALENDAR_REMINDER",
        label: `创建 ${customer.name} 报价准备提醒`,
        description: `提醒为 ${customer.name} 准备报价`,
        requiresApproval: true,
        payload: {
          title: `准备报价 - ${customer.name}`,
          startTime: nextMorningISO(now),
          durationMinutes: 30,
          customerId: customer.id,
          opportunityId: f.opportunityId,
        },
      });
    }
  }

  // ≤1 个内部备注：取首个 HIGH finding（优先 OPPORTUNITY，否则 CUSTOMER）
  const noteFinding = findings.find((f) => f.level === "HIGH") ?? findings[0];
  if (noteFinding) {
    const note = buildInternalNoteAction({
      graderType: "CUSTOMER_FOLLOWUP",
      label: `记录 ${customer.name} 跟进风险`,
      noteText: `AI 客户体检发现：${customer.name} ${noteFinding.title}。建议销售尽快跟进。`,
      reason: "CustomerFollowupGrader 检测到客户跟进风险",
      issueCategory: "customer_followup",
      issueSeverity: noteFinding.level,
      opportunityId: noteFinding.opportunityId,
      customerId: customer.id,
    });
    if (note) candidates.push(note);
  }

  const suggestedActions = orderAndCapActions(candidates, maxActions);

  const summary =
    findings.length === 0
      ? `${customer.name} 跟进状态良好，暂无明显风险 👍`
      : `${customer.name} 跟进健康分 ${score}/100（风险 ${riskLevel}），发现 ${findings.length} 项需关注。`;

  return { score, riskLevel, summary, issues, suggestedActions, evidence };
}

// ── 工具 ───────────────────────────────────────────────────────

function scanSeverityToRisk(sev: BriefingItem["severity"]): RiskLevel {
  if (sev === "urgent") return "HIGH";
  if (sev === "warning") return "MEDIUM";
  return "LOW";
}

/** 次日 09:00 ISO */
function nextMorningISO(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
