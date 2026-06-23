/**
 * QuoteRiskGrader —— 报价风险体检（微信 AI 分身优化阶段 · 第三阶段）
 *
 * 第一版聚焦：报价跟进风险 + 报价状态风险 + 窗帘业务基础安全项（轻量文本检查）。
 * 不做利润审核 / 不做完整报价内容审查。
 *
 * 两种模式：
 * - GLOBAL：返回最有风险的 Top 报价（状态/跟进类规则）
 * - QUOTE：检查指定报价 / 指定客户最近报价（状态规则 + 窗帘安全项文本检查）
 *
 * 设计约束：
 * - 纯只读，无写副作用；suggestedActions 仅建议，执行走 PendingAction 适配器。
 * - 严格 orgId + RBAC + data scope；销售只看自己可见，admin/org_admin/super_admin 看全局。
 * - 字段不存在则跳过对应规则，不阻塞。第一版规则型，不依赖 LLM。
 */

import { db } from "@/lib/db";
import { resolveSalesOwnOnly } from "./_scope";
import { computeScoreAndRisk } from "./_scoring";
import {
  resolveCustomerForFollowup,
  type CustomerResolution,
} from "./customer-followup-grader";
import type {
  GraderResult,
  GraderIssue,
  GraderAction,
  GraderEvidence,
  RiskLevel,
} from "../types";

export type QuoteRiskGraderContext = {
  orgId: string;
  userId: string;
  role: string;
  now?: Date;
  mode?: "GLOBAL" | "QUOTE";
  quoteId?: string;
  customerId?: string;
  customerName?: string;
  opportunityId?: string;
  maxIssues?: number;
  maxActions?: number;
};

const DEFAULT_MAX_ISSUES = 5;
const DEFAULT_MAX_ACTIONS = 3;
const DAY_MS = 86_400_000;
/** 高金额报价阈值（无 nextFollowupAt 时升级为 HIGH） */
const HIGH_AMOUNT = 5000;
/** GLOBAL 模式只看未成交报价 */
const OPEN_QUOTE_STATUS = ["draft", "sent", "viewed"];

type QuoteFinding = {
  level: RiskLevel;
  title: string;
  quoteId: string;
  opportunityId: string | null;
  customerId: string;
  customerName: string;
  actionKind: "followup" | "send_reminder" | "note" | null;
  reason?: string;
};

type QuoteStatusRow = {
  id: string;
  status: string;
  grandTotal: number;
  sentAt: Date | null;
  viewedAt: Date | null;
  signedAt: Date | null;
  createdAt: Date;
  opportunityId: string | null;
  customer: { id: string; name: string };
  opportunity: { id: string; stage: string; nextFollowupAt: Date | null } | null;
};

// ── 报价解析（QUOTE 模式） ─────────────────────────────────────

export type QuoteResolution =
  | { status: "ok"; quoteId: string; customerName: string }
  | { status: "not_found" }
  | { status: "ambiguous"; candidates: Array<{ name: string }> }
  | { status: "need_target" };

/**
 * 解析 QUOTE 模式要检查的报价（按 orgId + ownOnly 限定，越权/不可见一律视为找不到）。
 */
export async function resolveQuoteForRisk(
  ctx: QuoteRiskGraderContext,
): Promise<QuoteResolution> {
  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);
  const ownerWhere = ownOnly ? { createdById: ctx.userId } : {};

  // 1) 指定 quoteId
  if (ctx.quoteId) {
    const q = await db.salesQuote.findFirst({
      where: { id: ctx.quoteId, orgId: ctx.orgId, ...ownerWhere },
      select: { id: true, customer: { select: { name: true } } },
    });
    return q
      ? { status: "ok", quoteId: q.id, customerName: q.customer.name }
      : { status: "not_found" };
  }

  // 2) 指定 opportunityId → 最近一份报价
  if (ctx.opportunityId) {
    const q = await db.salesQuote.findFirst({
      where: { opportunityId: ctx.opportunityId, orgId: ctx.orgId, ...ownerWhere },
      orderBy: { createdAt: "desc" },
      select: { id: true, customer: { select: { name: true } } },
    });
    return q
      ? { status: "ok", quoteId: q.id, customerName: q.customer.name }
      : { status: "not_found" };
  }

  // 3) 指定 customerId → 最近一份报价
  if (ctx.customerId) {
    return latestQuoteForCustomer(ctx.customerId, ctx.orgId, ownerWhere);
  }

  // 4) 按客户名 → 复用客户解析（含重名澄清），再取最近报价
  const name = (ctx.customerName ?? "").trim();
  if (!name) return { status: "need_target" };

  const cr: CustomerResolution = await resolveCustomerForFollowup({
    orgId: ctx.orgId,
    userId: ctx.userId,
    role: ctx.role,
    mode: "CUSTOMER",
    customerName: name,
  });
  if (cr.status === "ambiguous") return { status: "ambiguous", candidates: cr.candidates };
  if (cr.status === "not_found" || cr.status === "need_name") return { status: "not_found" };
  return latestQuoteForCustomer(cr.customerId, ctx.orgId, ownerWhere);
}

async function latestQuoteForCustomer(
  customerId: string,
  orgId: string,
  ownerWhere: Record<string, unknown>,
): Promise<QuoteResolution> {
  const q = await db.salesQuote.findFirst({
    where: { customerId, orgId, ...ownerWhere },
    orderBy: { createdAt: "desc" },
    select: { id: true, customer: { select: { name: true } } },
  });
  return q
    ? { status: "ok", quoteId: q.id, customerName: q.customer.name }
    : { status: "not_found" };
}

// ── 主入口 ─────────────────────────────────────────────────────

export async function runQuoteRiskGrader(
  ctx: QuoteRiskGraderContext,
): Promise<GraderResult> {
  if (!ctx.orgId || !ctx.userId) {
    throw new Error("QuoteRiskGrader 缺少 orgId / userId");
  }
  const mode = ctx.mode ?? "GLOBAL";
  return mode === "QUOTE" ? runQuoteMode(ctx) : runGlobalMode(ctx);
}

// ── GLOBAL 模式 ────────────────────────────────────────────────

async function runGlobalMode(ctx: QuoteRiskGraderContext): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);

  const quotes = (await db.salesQuote.findMany({
    where: {
      orgId: ctx.orgId,
      ...(ownOnly ? { createdById: ctx.userId } : {}),
      status: { in: OPEN_QUOTE_STATUS },
    },
    select: {
      id: true,
      status: true,
      grandTotal: true,
      sentAt: true,
      viewedAt: true,
      signedAt: true,
      createdAt: true,
      opportunityId: true,
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, stage: true, nextFollowupAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })) as QuoteStatusRow[];

  const findings: QuoteFinding[] = [];
  for (const q of quotes) {
    findings.push(...evaluateQuoteStatus(q, now, true));
  }
  sortBySeverity(findings);

  return buildResult(findings, maxIssues, maxActions, now, {
    emptySummary: "暂时没有需要处理的高风险报价，保持节奏 👍",
    summaryFn: (s, r, n) => `报价风险体检：评分 ${s}/100（风险 ${r}），有 ${n} 项报价需要处理。`,
  });
}

// ── QUOTE 模式 ─────────────────────────────────────────────────

async function runQuoteMode(ctx: QuoteRiskGraderContext): Promise<GraderResult> {
  const now = ctx.now ?? new Date();
  const maxIssues = ctx.maxIssues ?? DEFAULT_MAX_ISSUES;
  const maxActions = ctx.maxActions ?? DEFAULT_MAX_ACTIONS;

  if (!ctx.quoteId) throw new Error("QUOTE 模式需要已解析的 quoteId");
  const ownOnly = await resolveSalesOwnOnly(ctx.userId, ctx.orgId, ctx.role);

  const quote = await db.salesQuote.findFirst({
    where: {
      id: ctx.quoteId,
      orgId: ctx.orgId,
      ...(ownOnly ? { createdById: ctx.userId } : {}),
    },
    select: {
      id: true,
      status: true,
      grandTotal: true,
      sentAt: true,
      viewedAt: true,
      signedAt: true,
      createdAt: true,
      opportunityId: true,
      installMode: true,
      installSubtotal: true,
      installApplied: true,
      notes: true,
      formDataJson: true,
      customer: { select: { id: true, name: true } },
      opportunity: { select: { id: true, stage: true, nextFollowupAt: true } },
      items: { select: { product: true, fabric: true, cordless: true } },
      addons: { select: { addonKey: true } },
    },
  });

  if (!quote) {
    return {
      score: 100,
      riskLevel: "LOW",
      summary: "没有找到该报价或无权访问。",
      issues: [],
      suggestedActions: [],
      evidence: [],
    };
  }

  const statusRow: QuoteStatusRow = {
    id: quote.id,
    status: quote.status,
    grandTotal: quote.grandTotal,
    sentAt: quote.sentAt,
    viewedAt: quote.viewedAt,
    signedAt: quote.signedAt,
    createdAt: quote.createdAt,
    opportunityId: quote.opportunityId,
    customer: quote.customer,
    opportunity: quote.opportunity,
  };

  const findings: QuoteFinding[] = evaluateQuoteStatus(statusRow, now, false);
  findings.push(...evaluateCurtainSafety(quote));
  sortBySeverity(findings);

  return buildResult(findings, maxIssues, maxActions, now, {
    subjectName: quote.customer.name,
    emptySummary: `${quote.customer.name} 的报价暂无明显风险 👍`,
    summaryFn: (s, r, n) =>
      `${quote.customer.name} 报价健康分 ${s}/100（风险 ${r}），发现 ${n} 项需关注。`,
  });
}

// ── 规则：报价状态 / 跟进 ──────────────────────────────────────

function evaluateQuoteStatus(
  q: QuoteStatusRow,
  now: Date,
  withPrefix: boolean,
): QuoteFinding[] {
  const out: QuoteFinding[] = [];
  const prefix = withPrefix ? `${q.customer.name}：` : "";
  const base = {
    quoteId: q.id,
    opportunityId: q.opportunityId,
    customerId: q.customer.id,
    customerName: q.customer.name,
  };
  const daysSince = (d: Date) => Math.floor((now.getTime() - new Date(d).getTime()) / DAY_MS);

  // 金额为 0 / 空
  if (!q.grandTotal || q.grandTotal <= 0) {
    out.push({ ...base, level: "HIGH", title: `${prefix}报价金额为 0 或缺失`, actionKind: null });
  }

  // 缺商机关联
  if (!q.opportunityId) {
    out.push({ ...base, level: "HIGH", title: `${prefix}报价未关联商机`, actionKind: null });
  }

  // 草稿超 3 天未发送
  if (q.status === "draft") {
    const d = daysSince(q.createdAt);
    if (d >= 3) {
      out.push({
        ...base,
        level: "MEDIUM",
        title: `${prefix}报价草稿 ${d} 天未发送`,
        actionKind: "send_reminder",
        reason: "报价草稿超过 3 天未发送",
      });
    }
  }

  // 已发送未回复
  if (q.status === "sent") {
    const d = daysSince(q.sentAt ?? q.createdAt);
    if (d >= 7) {
      out.push({
        ...base,
        level: "HIGH",
        title: `${prefix}报价已发送 ${d} 天未回复`,
        actionKind: "followup",
        reason: "报价超过 7 天未回复",
      });
    } else if (d >= 3) {
      out.push({
        ...base,
        level: "MEDIUM",
        title: `${prefix}报价已发送 ${d} 天未回复`,
        actionKind: "followup",
        reason: "报价 3–6 天未回复",
      });
    }
  }

  // 已查看未签
  if (q.viewedAt && !q.signedAt) {
    const d = daysSince(q.viewedAt);
    if (d >= 5) {
      out.push({
        ...base,
        level: "HIGH",
        title: `${prefix}报价已查看 ${d} 天未签`,
        actionKind: "followup",
        reason: "客户已查看报价但未签署",
      });
    } else if (d >= 2) {
      out.push({
        ...base,
        level: "MEDIUM",
        title: `${prefix}报价已查看 ${d} 天未签`,
        actionKind: "followup",
        reason: "客户已查看报价但未签署",
      });
    }
  }

  // 高金额无下一步跟进 / quoted 阶段无下一步
  const noFollowup = !q.opportunity?.nextFollowupAt;
  if (noFollowup && q.opportunityId) {
    if (q.grandTotal >= HIGH_AMOUNT) {
      out.push({
        ...base,
        level: "HIGH",
        title: `${prefix}高金额报价无下一步跟进`,
        actionKind: "followup",
        reason: "高金额报价缺少跟进安排",
      });
    } else if (q.opportunity?.stage === "quoted") {
      out.push({
        ...base,
        level: "MEDIUM",
        title: `${prefix}报价阶段无下一步跟进`,
        actionKind: "followup",
        reason: "报价阶段缺少跟进安排",
      });
    }
  }

  return out;
}

// ── 规则：窗帘业务基础安全项（QUOTE 模式，轻量文本检查） ───────

type QuoteFullRow = {
  id: string;
  installMode: string;
  installSubtotal: number;
  installApplied: number;
  notes: string | null;
  formDataJson: string | null;
  customer: { id: string; name: string };
  opportunityId: string | null;
  items: Array<{ product: string; fabric: string; cordless: boolean }>;
  addons: Array<{ addonKey: string }>;
};

function evaluateCurtainSafety(q: QuoteFullRow): QuoteFinding[] {
  const out: QuoteFinding[] = [];
  const base = {
    quoteId: q.id,
    opportunityId: q.opportunityId,
    customerId: q.customer.id,
    customerName: q.customer.name,
  };

  const textParts = [
    q.notes ?? "",
    q.formDataJson ?? "",
    ...q.items.map((i) => `${i.product} ${i.fabric}`),
    ...q.addons.map((a) => a.addonKey),
  ];
  const text = textParts.join(" ").toLowerCase();
  const hasProducts = q.items.length > 0;

  const motorized =
    q.addons.some((a) => /motor|hub|remote|track/i.test(a.addonKey)) ||
    /motor|somfy|电动|马达|motorized/i.test(text);

  // 电动产品缺电源 / 电工责任
  if (motorized) {
    const powerOk = /electrician|power by others|电工|电源/i.test(text);
    if (!powerOk) {
      out.push({
        ...base,
        level: "HIGH",
        title: "电动产品报价中未明确电源/电工责任",
        actionKind: "note",
        reason: "电动产品报价缺少电源/电工责任说明",
      });
    }
  }

  // 质保说明缺失
  if (!/warranty|质保|保修/i.test(text)) {
    out.push({
      ...base,
      level: "MEDIUM",
      title: "报价未检测到质保说明",
      actionKind: "note",
      reason: "报价缺少质保说明",
    });
  }

  // 安装范围说明缺失（pickup 自提模式跳过）
  if (q.installMode !== "pickup" && hasProducts) {
    const installMentioned =
      /install|安装/i.test(text) || q.installSubtotal > 0 || q.installApplied > 0;
    if (!installMentioned) {
      out.push({
        ...base,
        level: "MEDIUM",
        title: "报价未检测到安装范围说明",
        actionKind: "note",
        reason: "报价缺少安装范围说明",
      });
    }
  }

  // 商业项目缺额外会议 / pre-installation 说明
  const commercial = /commercial|项目|工程/i.test(text);
  if (commercial && !/pre-?installation|site meeting|额外会议|现场会议/i.test(text)) {
    out.push({
      ...base,
      level: "LOW",
      title: "未检测到额外会议或 pre-installation 说明",
      actionKind: null,
    });
  }

  return out;
}

// ── 结果组装 ───────────────────────────────────────────────────

function buildResult(
  findings: QuoteFinding[],
  maxIssues: number,
  maxActions: number,
  now: Date,
  opts: {
    subjectName?: string;
    emptySummary: string;
    summaryFn: (score: number, risk: RiskLevel, n: number) => string;
  },
): GraderResult {
  // LOW 不计入扣分（与其它 grader 一致：仅 MEDIUM/HIGH/CRITICAL 扣分）
  const scored = findings.filter((f) => f.level !== "LOW");
  const { score, riskLevel } = computeScoreAndRisk(scored.map((f) => f.level));

  const topFindings = findings.slice(0, maxIssues);
  const issues: GraderIssue[] = topFindings.map((f) => ({
    severity: f.level,
    category: "quote_risk",
    title: f.title,
    description: "",
  }));
  const evidence: GraderEvidence[] = topFindings.map((f) => ({
    sourceType: "QUOTE",
    sourceId: f.quoteId,
    text: f.title,
  }));

  const suggestedActions = buildActions(findings, maxActions, now);

  const summary =
    scored.length === 0
      ? opts.emptySummary
      : opts.summaryFn(score, riskLevel, findings.length);

  return { score, riskLevel, summary, issues, suggestedActions, evidence };
}

function buildActions(
  findings: QuoteFinding[],
  maxActions: number,
  now: Date,
): GraderAction[] {
  const actions: GraderAction[] = [];
  const seen = new Set<string>();
  const nextFollowupAt = nextMorningISO(now);

  // 优先级：可执行的 followup / send_reminder 在前，note（占位降级）在后
  const ordered = [
    ...findings.filter((f) => f.actionKind === "followup" || f.actionKind === "send_reminder"),
    ...findings.filter((f) => f.actionKind === "note"),
  ];

  for (const f of ordered) {
    if (actions.length >= maxActions) break;
    if (!f.actionKind) continue;
    const key = `${f.actionKind}:${f.quoteId}`;
    if (seen.has(key)) continue;

    if (f.actionKind === "followup") {
      if (!f.opportunityId) continue; // sales.update_followup 需要 opportunityId
      seen.add(key);
      actions.push({
        actionType: "SUGGEST_STATUS_UPDATE",
        label: `创建 ${f.customerName} 报价跟进`,
        description: "为该报价关联客户设置下一次跟进",
        requiresApproval: true,
        payload: {
          opportunityId: f.opportunityId,
          nextFollowupAt,
          customerName: f.customerName,
          reason: f.reason ?? f.title,
        },
      });
    } else if (f.actionKind === "send_reminder") {
      seen.add(key);
      actions.push({
        actionType: "CREATE_CALENDAR_REMINDER",
        label: `创建 ${f.customerName} 报价发送提醒`,
        description: "提醒销售检查并发送报价",
        requiresApproval: true,
        payload: {
          title: `检查并发送报价 - ${f.customerName}`,
          startTime: nextFollowupAt,
          durationMinutes: 30,
          customerId: f.customerId,
          opportunityId: f.opportunityId,
          quoteId: f.quoteId,
        },
      });
    } else if (f.actionKind === "note") {
      seen.add(key);
      const noteText = `报价风险：${f.title}。${f.reason ? `（${f.reason}）` : ""}`;
      actions.push({
        actionType: "ADD_INTERNAL_NOTE",
        label: "记录报价风险备注",
        description: noteText,
        requiresApproval: true,
        payload: {
          targetType: "QUOTE",
          targetId: f.quoteId,
          note: noteText,
          reason: f.reason ?? f.title,
          source: "GRADER",
          graderType: "QUOTE_RISK",
          issueCategory: "quote_risk",
          issueSeverity: f.level,
          quoteId: f.quoteId,
          opportunityId: f.opportunityId,
          customerId: f.customerId,
        },
      });
    }
  }

  return actions;
}

// ── 工具 ───────────────────────────────────────────────────────

function sortBySeverity(findings: QuoteFinding[]): void {
  const rank: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  findings.sort((a, b) => rank[a.level] - rank[b.level]);
}

function nextMorningISO(now: Date): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
