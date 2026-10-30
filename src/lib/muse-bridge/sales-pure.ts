/**
 * Muse Bridge — 销售意图（TASKFLOW S1）：读范围、可解释优先级、回复构造（纯函数，零 DB / 零 LLM）
 *
 *   resolveSalesScope()      服务端角色 → 读范围（全组织 / 仅本人 / 拒绝）；请求字段不参与
 *   rankOpportunities()      只排开放态；每条规则既加分也产出一句理由（规则即理由）
 *   buildSalesOverview()     sales_overview 的 Advisory + data
 *   buildOpportunityStatus() opportunity_status 的 Advisory + data（CRM 事实 / 员工确认 / 建议 / 未核实分开）
 *
 * 决定 B（2026-10-27）：金额只对全组织读范围（管理角色）输出；销售角色的 data 不带 amount、理由不出金额。
 * "CRM 没记录"不等于"没跟进"：停滞理由一律写"未核实是否有线下跟进"。
 */

import { containsOutboundSensitive } from "./contract";
import { OUTBOUND_REDACTED, clip, oneLine, type Advisory, type AdvisoryNextStep } from "./advisory";
import { money } from "./router-pure";
import type { MuseIdentity } from "./binding-pure";
import {
  defaultInquiryQuestions,
  employeeConfirmationsView,
  openInquiriesView,
  type InquiryRecord,
} from "./inquiry-pure";
import { followupsView, type FollowupRecord } from "./followup-pure";
import { stripAmountKeys } from "@/lib/sales/period/summary-pure";
import type { PeriodInfo, PeriodTotals } from "@/lib/sales/period/types";
import {
  LEGACY_STAGE_MAP,
  OPEN_STAGES,
  getOpportunityStageLabel,
  isOpenStage,
  toCanonicalStage,
  type OpportunityStage,
} from "@/lib/revenue-spine/opportunity-stage";

// ── 读范围 ──────────────────────────────────────────────────────

/** PERM-7b：平台 admin 不再算销售管理层（等同 user） */
export const SALES_MANAGER_PLATFORM_ROLES = ["super_admin", "boss", "manager"] as const;
export const SALES_MANAGER_ORG_ROLES = ["org_owner", "org_admin"] as const;
export const SALES_REP_PLATFORM_ROLES = ["sales", "trade"] as const;

export type SalesScope = { kind: "org"; orgId: string } | { kind: "own"; orgId: string; userId: string };

const has = (list: readonly string[], v: string | null | undefined) => !!v && list.includes(v);

/**
 * 管理角色（平台或组织任一侧）→ 全组织；销售角色 → 仅本人；其余 → null（拒绝）。
 * PERM-4c4：岗位模式企业只看岗位派生平台角色（管理层 = 老板岗位），企业成员角色 org_owner / org_admin 本身不带来全组织。
 */
export function resolveSalesScope(
  identity: Pick<MuseIdentity, "userId" | "orgId" | "role" | "orgRole" | "positionMode">,
): SalesScope | null {
  const orgManager = !identity.positionMode && has(SALES_MANAGER_ORG_ROLES, identity.orgRole);
  if (has(SALES_MANAGER_PLATFORM_ROLES, identity.role) || orgManager) {
    return { kind: "org", orgId: identity.orgId };
  }
  if (has(SALES_REP_PLATFORM_ROLES, identity.role)) {
    return { kind: "own", orgId: identity.orgId, userId: identity.userId };
  }
  return null;
}

/** 决定 B：金额只给全组织读范围 */
export function amountsVisible(scope: SalesScope): boolean {
  return scope.kind === "org";
}

/** 读范围 + 请求里的负责人过滤 → 最终的负责人条件；销售指定别人 → 越权 */
export function resolveAssigneeFilter(
  scope: SalesScope,
  requested: string | undefined,
): { ok: true; assigneeId: string | null } | { ok: false } {
  if (scope.kind === "own") {
    return requested && requested !== scope.userId ? { ok: false } : { ok: true, assigneeId: scope.userId };
  }
  return { ok: true, assigneeId: requested ?? null };
}

export const SALES_PERMISSION_DENIED_MESSAGE = "你的角色不能通过 Muse 查看销售数据；如需开通请联系组织管理员。";
export const SALES_ASSIGNEE_DENIED_MESSAGE = "你只能查看分配给自己的商机。";
export const OPPORTUNITY_NOT_FOUND_MESSAGE = "没找到这个商机，或它不在你的查看范围内。";

// ── 开放态 ──────────────────────────────────────────────────────

/** 数据库过滤用：开放态 canonical 值 + 投影到开放态的 Sunny 历史值 */
export const OPEN_STAGE_RAW_VALUES: readonly string[] = [
  ...new Set([
    ...OPEN_STAGES,
    ...Object.entries(LEGACY_STAGE_MAP)
      .filter(([, canonical]) => isOpenStage(canonical))
      .map(([raw]) => raw),
  ]),
];

export function isOpenOpportunityStage(stage: string): boolean {
  const canonical = toCanonicalStage(stage);
  return !!canonical && isOpenStage(canonical);
}

// ── 优先级 ──────────────────────────────────────────────────────

export type SalesPerson = { id: string; name: string };

export type SalesOppRow = {
  id: string;
  title: string;
  stage: string;
  priority: string | null;
  estimatedValue: number | null;
  createdAt: Date;
  updatedAt: Date;
  stageChangedAt: Date | null;
  lastInteractionAt: Date | null;
  lastCustomerReplyAt: Date | null;
  lastOutboundAt: Date | null;
  nextFollowupAt: Date | null;
  nextActionType: string | null;
  nextActionReason: string | null;
  customer: SalesPerson;
  assignee: SalesPerson | null;
  /** 未结束（open / in_progress）的跟进行动数 */
  openActionCount: number;
  /** 其中 dueAt 已过的 */
  overdueActionCount: number;
};

export type SalesSignals = { customerWaiting: boolean; followupOverdue: boolean; actionsOverdue: boolean; stale: boolean };

export type RankedOpp = { row: SalesOppRow; score: number; reasons: string[]; unverified: string[]; signals: SalesSignals };

export type RankOptions = { now: Date; staleAfterDays: number; showAmounts: boolean };

const DAY_MS = 86_400_000;
const wholeDays = (later: Date, earlier: Date) => Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY_MS));

export const SALES_SCORE = {
  customerWaiting: 40,
  followupOverdueBase: 20,
  followupOverdueMaxExtra: 10,
  actionsOverdue: 10,
  stale: 15,
  valueMax: 10,
} as const;

const STAGE_WEIGHT: Partial<Record<OpportunityStage, number>> = {
  negotiation: 20,
  sample: 16,
  quoted: 14,
  follow_up: 14,
  quoting: 10,
  rfq_ready: 10,
  qualified: 6,
  needs_info: 6,
  new_inquiry: 4,
  enriching: 4,
};
/** 阶段权重达到这个值才写进理由（后期阶段才值得单独说） */
const STAGE_REASON_MIN = 14;
const PRIORITY_WEIGHT: Record<string, number> = { hot: 10, warm: 4 };
/** 金额分位加分达到这个值才写进理由 */
const VALUE_REASON_MIN = 7;

/** 金额在候选集里的位置 → 0–10（严格小于它的已知金额个数 / (n-1)）；未知金额不加分 */
function valueBoosts(rows: SalesOppRow[]): Map<string, number> {
  const known = rows.filter((r) => typeof r.estimatedValue === "number" && r.estimatedValue > 0);
  const values = known.map((r) => r.estimatedValue as number);
  const out = new Map<string, number>();
  for (const r of known) {
    const v = r.estimatedValue as number;
    const less = values.filter((x) => x < v).length;
    out.set(r.id, values.length === 1 ? SALES_SCORE.valueMax : Math.round((SALES_SCORE.valueMax * less) / (values.length - 1)));
  }
  return out;
}

function unverifiedOf(row: SalesOppRow, showAmounts: boolean): string[] {
  const out: string[] = [];
  if (!row.assignee) out.push("负责人");
  if (!row.nextFollowupAt) out.push("下次跟进日");
  if (!row.lastInteractionAt) out.push("最近互动");
  if (showAmounts && row.estimatedValue == null) out.push("金额");
  return out;
}

function scoreRow(row: SalesOppRow, boost: number, opts: RankOptions): RankedOpp {
  const { now } = opts;
  const reasons: string[] = [];
  let score = 0;

  const customerWaiting =
    !!row.lastCustomerReplyAt && (!row.lastOutboundAt || row.lastCustomerReplyAt.getTime() > row.lastOutboundAt.getTime());
  if (customerWaiting && row.lastCustomerReplyAt) {
    const d = wholeDays(now, row.lastCustomerReplyAt);
    score += SALES_SCORE.customerWaiting;
    reasons.push(`客户${d === 0 ? "今天" : ` ${d} 天前`}来信，之后没有我方外发记录`);
  }

  const followupOverdue = !!row.nextFollowupAt && row.nextFollowupAt.getTime() < now.getTime();
  if (followupOverdue && row.nextFollowupAt) {
    const d = wholeDays(now, row.nextFollowupAt);
    score += SALES_SCORE.followupOverdueBase + Math.min(d, SALES_SCORE.followupOverdueMaxExtra);
    reasons.push(d === 0 ? "约定跟进日今天已过" : `约定跟进日已过 ${d} 天`);
  }

  const actionsOverdue = row.overdueActionCount > 0;
  if (actionsOverdue) {
    score += SALES_SCORE.actionsOverdue;
    reasons.push(`${row.overdueActionCount} 条跟进行动已逾期`);
  }

  const quietDays = wholeDays(now, row.lastInteractionAt ?? row.createdAt);
  const stale = quietDays > opts.staleAfterDays;
  if (stale) {
    score += SALES_SCORE.stale;
    reasons.push(`CRM 中 ${quietDays} 天无互动记录（未核实是否有线下跟进）`);
  }

  const canonical = toCanonicalStage(row.stage);
  const stageWeight = canonical ? (STAGE_WEIGHT[canonical] ?? 0) : 0;
  score += stageWeight;
  if (stageWeight >= STAGE_REASON_MIN) reasons.push(`处于「${getOpportunityStageLabel(row.stage)}」阶段`);

  const priorityWeight = PRIORITY_WEIGHT[(row.priority ?? "").toLowerCase()] ?? 0;
  score += priorityWeight;
  if ((row.priority ?? "").toLowerCase() === "hot") reasons.push("标记为高热度");

  score += boost;
  if (opts.showAmounts && boost >= VALUE_REASON_MIN && row.estimatedValue != null) {
    reasons.push(`金额 ${money(row.estimatedValue)} 在本次列表中靠前`);
  }

  return { row, score, reasons, unverified: unverifiedOf(row, opts.showAmounts), signals: { customerWaiting, followupOverdue, actionsOverdue, stale } };
}

const timeOr = (d: Date | null, fallback: number) => (d ? d.getTime() : fallback);

/** 只排开放态；总分降序，平分按跟进日早、更新早、ID 字典序（同输入同输出） */
export function rankOpportunities(rows: SalesOppRow[], opts: RankOptions): RankedOpp[] {
  const open = rows.filter((r) => isOpenOpportunityStage(r.stage));
  const boosts = valueBoosts(open);
  return open
    .map((r) => scoreRow(r, boosts.get(r.id) ?? 0, opts))
    .sort(
      (a, b) =>
        b.score - a.score ||
        timeOr(a.row.nextFollowupAt, Number.MAX_SAFE_INTEGER) - timeOr(b.row.nextFollowupAt, Number.MAX_SAFE_INTEGER) ||
        a.row.updatedAt.getTime() - b.row.updatedAt.getTime() ||
        (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
    );
}

// ── 视图（data 一律是 JSON 原生类型，重放与首发逐字相同） ──────────────

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const shortName = (s: string, n: number) => clip(oneLine(s), n);

/** 出 Muse 的自由文本片段：命中敏感模式整段替换，否则单行截断 */
export function safeSnippet(text: string | null | undefined, max: number): string {
  const t = oneLine(text ?? "");
  return containsOutboundSensitive(t) ? OUTBOUND_REDACTED : clip(t, max);
}

export function opportunityFacts(row: SalesOppRow, showAmounts: boolean) {
  return {
    id: row.id,
    title: safeSnippet(row.title, 120),
    customer: { id: row.customer.id, name: safeSnippet(row.customer.name, 80) },
    stage: row.stage,
    stageLabel: getOpportunityStageLabel(row.stage),
    assignee: row.assignee,
    priority: row.priority,
    ...(showAmounts ? { amount: row.estimatedValue } : {}),
    createdAt: iso(row.createdAt),
    /** 记录版本：引用这条商机时以它为准 */
    updatedAt: iso(row.updatedAt),
    stageChangedAt: iso(row.stageChangedAt),
    lastInteractionAt: iso(row.lastInteractionAt),
    lastCustomerReplyAt: iso(row.lastCustomerReplyAt),
    lastOutboundAt: iso(row.lastOutboundAt),
    nextFollowupAt: iso(row.nextFollowupAt),
  };
}

const statusStep = (row: SalesOppRow): AdvisoryNextStep => ({
  label: `看「${shortName(row.title, 14)}」详情`,
  command: { intent: "opportunity_status", opportunityId: row.id },
});

export type OverviewCounts = { newInWindow: number; wonInWindow: number; lostInWindow: number };

export type SalesOverviewInput = {
  scope: SalesScope;
  /** 管理角色按负责人过滤时为 true（结论里说"该负责人"） */
  filteredByAssignee: boolean;
  rows: SalesOppRow[];
  counts: OverviewCounts;
  days: number;
  limit: number;
  staleAfterDays: number;
  truncated: boolean;
  now: Date;
  /** KPI-1：带 period 时的期间汇总（与 GET /api/sales/period-summary 同一口径）；不带为 undefined */
  period?: { info: PeriodInfo; totals: PeriodTotals };
};

/** KPI-1：期间汇总句；决定 B——销售范围只有计数 */
export function periodReason(period: { info: PeriodInfo; totals: PeriodTotals }, showAmounts: boolean): string {
  const { info: p, totals: t } = period;
  return showAmounts
    ? `期间 ${p.from} 至 ${p.to}：成单 ${t.wonCount} 单 ${money(t.wonAmount)}，报出 ${t.quotedCount} 份 ${money(t.quotedAmount)}`
    : `期间 ${p.from} 至 ${p.to}：成单 ${t.wonCount} 单，报出 ${t.quotedCount} 份`;
}

export function buildSalesOverview(input: SalesOverviewInput): { advisory: Advisory; data: unknown } {
  const showAmounts = amountsVisible(input.scope);
  const ranked = rankOpportunities(input.rows, { now: input.now, staleAfterDays: input.staleAfterDays, showAmounts });
  const shown = ranked.slice(0, input.limit);
  const count = (k: keyof SalesSignals) => ranked.filter((r) => r.signals[k]).length;
  const summary = {
    open: ranked.length,
    customerWaiting: count("customerWaiting"),
    followupOverdue: count("followupOverdue"),
    actionsOverdue: count("actionsOverdue"),
    stale: count("stale"),
    ...input.counts,
  };
  const who = input.scope.kind === "own" ? "你负责的" : input.filteredByAssignee ? "该负责人" : "全组织";

  const advisory: Advisory =
    shown.length === 0
      ? {
          conclusion: `${who}目前没有进行中的商机`,
          reasons: [`近 ${input.days} 天新建 ${summary.newInWindow} 个、成交 ${summary.wonInWindow} 个、丢单 ${summary.lostInWindow} 个`],
          nextStep: null,
        }
      : {
          conclusion:
            summary.customerWaiting > 0
              ? `${who}进行中 ${summary.open} 个商机，${summary.customerWaiting} 个客户在等回复`
              : `${who}进行中 ${summary.open} 个商机，建议先看这 ${shown.length} 个`,
          reasons: shown
            .slice(0, 3)
            .map((r, i) => `${i + 1}. ${shortName(r.row.title, 12)}（${shortName(r.row.customer.name, 8)}）：${r.reasons[0] ?? "暂无突出信号"}`),
          nextStep: statusStep(shown[0].row),
          alternatives: shown.slice(1, 3).map((r) => statusStep(r.row)),
        };

  const data = {
    observedAt: input.now.toISOString(),
    windowDays: input.days,
    scope: input.scope.kind,
    amountsVisible: showAmounts,
    truncated: input.truncated,
    summary,
    opportunities: shown.map((r, i) => ({
      rank: i + 1,
      score: r.score,
      reasons: r.reasons,
      unverified: r.unverified,
      crm: opportunityFacts(r.row, showAmounts),
    })),
  };
  if (!input.period) return { advisory, data };

  // KPI-1：带 period——期间汇总句放第一条理由（建议式回复理由 ≤ 3 条，末尾追加会被截掉），商机理由保留前两条
  const periodData = {
    ...input.period.info,
    totals: showAmounts ? input.period.totals : stripAmountKeys(input.period.totals),
  };
  return {
    advisory: { ...advisory, reasons: [periodReason(input.period, showAmounts), ...advisory.reasons.slice(0, 2)] },
    data: { ...data, period: periodData },
  };
}

export type InteractionRow = {
  id: string;
  type: string;
  direction: string | null;
  channel: string | null;
  summary: string;
  createdAt: Date;
  /** null = 记在客户上、没挂商机 */
  opportunityId: string | null;
};
export type ActionRow = { id: string; title: string; status: string; priority: string; dueAt: Date | null; source: string; assignee: SalesPerson | null };

export type OpportunityStatusInput = {
  scope: SalesScope;
  row: SalesOppRow;
  interactions: InteractionRow[];
  actions: ActionRow[];
  /** 系统建议下一步的中文名（由取数层按 nextActionType 查表；未知类型为 null） */
  nextActionLabel: string | null;
  /** S2：该商机上的询问（已回复的进 employeeConfirmations，未结束的进 openInquiries） */
  inquiries: InquiryRecord[];
  /** S3：该商机上的 Muse 跟进 */
  followups: FollowupRecord[];
  staleAfterDays: number;
  now: Date;
};

export function buildOpportunityStatus(input: OpportunityStatusInput): { advisory: Advisory; data: unknown } {
  const { row, now } = input;
  const showAmounts = amountsVisible(input.scope);
  const open = isOpenOpportunityStage(row.stage);
  const ranked = open ? rankOpportunities([row], { now, staleAfterDays: input.staleAfterDays, showAmounts })[0] : null;
  const stageLabel = getOpportunityStageLabel(row.stage);

  const reasons = ranked
    ? ranked.reasons.length > 0
      ? ranked.reasons
      : ["CRM 中暂无需要优先处理的信号"]
    : [`商机已处于「${stageLabel}」，不再进入推进排序`];

  const advisory: Advisory = {
    conclusion: `「${shortName(row.title, 16)}」${stageLabel}，负责人${row.assignee ? shortName(row.assignee.name, 8) : "未分配"}`,
    reasons,
    nextStep: null,
  };
  const openInquiries = openInquiriesView(input.inquiries, now);
  // S2：管理角色、开放商机、有负责人且没有未结束的询问 → 下一步是带默认问题的"问负责人"
  if (input.scope.kind === "org" && ranked && row.assignee && openInquiries.length === 0) {
    advisory.nextStep = {
      label: `问${shortName(row.assignee.name, 8)}最新进展`,
      command: {
        intent: "ask_colleague",
        opportunityId: row.id,
        questions: defaultInquiryQuestions(ranked.signals),
      },
    };
  }

  const data = {
    observedAt: now.toISOString(),
    amountsVisible: showAmounts,
    opportunity: opportunityFacts(row, showAmounts),
    priority: ranked ? { score: ranked.score, reasons: ranked.reasons } : null,
    unverified: unverifiedOf(row, showAmounts),
    interactions: input.interactions.map((i) => ({
      id: i.id,
      type: i.type,
      direction: i.direction,
      channel: i.channel,
      level: i.opportunityId ? "opportunity" : "customer",
      at: i.createdAt.toISOString(),
      summary: safeSnippet(i.summary, 200),
    })),
    /** 未结束行动总数；openActions 最多列 10 条 */
    openActionsTotal: row.openActionCount,
    openActions: input.actions.map((a) => ({
      id: a.id,
      title: safeSnippet(a.title, 120),
      status: a.status,
      priority: a.priority,
      dueAt: iso(a.dueAt),
      overdue: !!a.dueAt && a.dueAt.getTime() < now.getTime(),
      source: a.source,
      assignee: a.assignee,
    })),
    suggestions: row.nextActionType
      ? [
          {
            source: "revenue_spine",
            type: row.nextActionType,
            label: input.nextActionLabel,
            reason: row.nextActionReason ? safeSnippet(row.nextActionReason, 200) : null,
            dueAt: iso(row.nextFollowupAt),
          },
        ]
      : [],
    /** 员工确认：负责人对询问的回复，与 CRM 事实分开 */
    employeeConfirmations: employeeConfirmationsView(input.inquiries),
    openInquiries,
    /** S3：跟进（未结束在前）；标题、证据、原因与行动标题同样脱敏 */
    followups: followupsView(input.followups, now).map((f) => ({
      ...f,
      title: safeSnippet(f.title, 120),
      evidence: f.evidence ? safeSnippet(f.evidence, 300) : null,
      reason: f.reason ? safeSnippet(f.reason, 300) : null,
    })),
  };
  return { advisory, data };
}
