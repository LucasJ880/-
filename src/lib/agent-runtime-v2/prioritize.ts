/**
 * 销售跟进优先级：确定性可解释综合评分（必须消费 Grader 证据）
 */

export type PrioritizeOpportunity = {
  id: string;
  customerId: string;
  customerName: string;
  email?: string | null;
  stage?: string | null;
  estimatedValue?: number | null;
  nextFollowupAt?: string | Date | null;
  updatedAt?: string | Date | null;
  /** 代理 expectedCloseDate：installDate / measureDate */
  expectedCloseDate?: string | Date | null;
  lastInteractionAt?: string | Date | null;
  quoteSentAt?: string | Date | null;
  quoteUnansweredDays?: number | null;
};

export type PrioritizedCustomer = {
  opportunityId: string;
  customerId: string;
  customerName: string;
  email: string | null;
  stage?: string | null;
  score: number;
  reasons: string[];
  evidenceRefs: string[];
};

const STAGE_WEIGHT: Record<string, number> = {
  negotiation: 25,
  quoted: 22,
  measure_booked: 18,
  needs_confirmed: 14,
  new_lead: 10,
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

function asDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 从 Grader 结果中抽取与客户/商机相关的风险加分 */
export function extractGraderBoosts(
  followupAnalysis: unknown,
  quoteRiskAnalysis: unknown,
): {
  byCustomerId: Map<string, { boost: number; refs: string[]; reasons: string[] }>;
  byOpportunityId: Map<string, { boost: number; refs: string[]; reasons: string[] }>;
  followupPresent: boolean;
  quoteRiskPresent: boolean;
  followupPartial: boolean;
  quoteRiskPartial: boolean;
} {
  const byCustomerId = new Map<
    string,
    { boost: number; refs: string[]; reasons: string[] }
  >();
  const byOpportunityId = new Map<
    string,
    { boost: number; refs: string[]; reasons: string[] }
  >();

  const bump = (
    map: Map<string, { boost: number; refs: string[]; reasons: string[] }>,
    id: string,
    boost: number,
    ref: string,
    reason: string,
  ) => {
    const cur = map.get(id) ?? { boost: 0, refs: [], reasons: [] };
    cur.boost += boost;
    cur.refs.push(ref);
    cur.reasons.push(reason);
    map.set(id, cur);
  };

  const followup = followupAnalysis as {
    degraded?: boolean;
    evidenceQuality?: string;
    result?: {
      issues?: Array<{
        title?: string;
        description?: string;
        riskLevel?: string;
        evidence?: Array<{ sourceId?: string; sourceType?: string; text?: string }>;
      }>;
      score?: number;
    };
  } | null;

  const quoteRisk = quoteRiskAnalysis as {
    degraded?: boolean;
    evidenceQuality?: string;
    result?: {
      issues?: Array<{
        title?: string;
        riskLevel?: string;
        evidence?: Array<{ sourceId?: string; sourceType?: string; text?: string }>;
      }>;
      score?: number;
    };
  } | null;

  const followupPresent = !!followup?.result || !!followup;
  const quoteRiskPresent = !!quoteRisk?.result || !!quoteRisk;
  const followupPartial = followup?.evidenceQuality === "PARTIAL" || followup?.degraded === true;
  const quoteRiskPartial =
    quoteRisk?.evidenceQuality === "PARTIAL" || quoteRisk?.degraded === true;

  for (const issue of followup?.result?.issues ?? []) {
    const riskBoost =
      issue.riskLevel === "HIGH" || issue.riskLevel === "CRITICAL" ? 18 : 10;
    for (const ev of issue.evidence ?? []) {
      if (!ev.sourceId) continue;
      if (ev.sourceType === "CUSTOMER") {
        bump(
          byCustomerId,
          ev.sourceId,
          riskBoost,
          `s3:${ev.sourceId}`,
          `跟进分析：${issue.title ?? "需跟进"}`,
        );
      } else {
        bump(
          byOpportunityId,
          ev.sourceId,
          riskBoost,
          `s3:opp:${ev.sourceId}`,
          `跟进分析：${issue.title ?? "需跟进"}`,
        );
      }
    }
  }

  for (const issue of quoteRisk?.result?.issues ?? []) {
    const riskBoost =
      issue.riskLevel === "HIGH" || issue.riskLevel === "CRITICAL" ? 16 : 8;
    for (const ev of issue.evidence ?? []) {
      if (!ev.sourceId) continue;
      if (ev.sourceType === "CUSTOMER") {
        bump(
          byCustomerId,
          ev.sourceId,
          riskBoost,
          `s4:${ev.sourceId}`,
          `报价风险：${issue.title ?? "报价风险"}`,
        );
      } else {
        bump(
          byOpportunityId,
          ev.sourceId,
          riskBoost,
          `s4:src:${ev.sourceId}`,
          `报价风险：${issue.title ?? "报价风险"}`,
        );
      }
    }
  }

  return {
    byCustomerId,
    byOpportunityId,
    followupPresent,
    quoteRiskPresent,
    followupPartial,
    quoteRiskPartial,
  };
}

export function scoreFollowupCandidate(
  opp: PrioritizeOpportunity,
  now: Date,
  boosts: ReturnType<typeof extractGraderBoosts>,
): PrioritizedCustomer {
  let score = 0;
  const reasons: string[] = [];
  const evidenceRefs: string[] = [`s2:${opp.id}`];

  const followupAt = asDate(opp.nextFollowupAt);
  if (followupAt) {
    const overdue = daysBetween(now, followupAt);
    if (overdue >= 0) {
      const pts = Math.min(30, 12 + overdue * 2);
      score += pts;
      reasons.push(`跟进逾期 ${overdue} 天(+${pts})`);
    } else {
      reasons.push(`下次跟进还有 ${-overdue} 天`);
    }
  } else {
    score += 8;
    reasons.push("缺少下次跟进日期(+8)");
  }

  const lastIx = asDate(opp.lastInteractionAt) ?? asDate(opp.updatedAt);
  if (lastIx) {
    const idle = daysBetween(now, lastIx);
    const pts = Math.min(20, Math.max(0, idle));
    if (pts > 0) {
      score += pts;
      reasons.push(`距最后互动 ${idle} 天(+${pts})`);
    }
    evidenceRefs.push(`interaction_or_updated:${opp.id}`);
  }

  const stage = opp.stage ?? "";
  const stagePts = STAGE_WEIGHT[stage] ?? 6;
  score += stagePts;
  reasons.push(`阶段 ${stage || "未知"}(+${stagePts})`);

  const value = Number(opp.estimatedValue ?? 0);
  if (value > 0) {
    const pts = Math.min(15, Math.floor(Math.log10(value + 1) * 5));
    score += pts;
    reasons.push(`预估金额 ${value}(+${pts})`);
  }

  const closeAt = asDate(opp.expectedCloseDate);
  if (closeAt) {
    const daysToClose = daysBetween(closeAt, now);
    if (daysToClose >= 0 && daysToClose <= 14) {
      score += 10;
      reasons.push(`预计关单临近 ${daysToClose} 天内(+10)`);
    } else if (daysToClose < 0) {
      score += 6;
      reasons.push("预计关单日已过(+6)");
    }
    evidenceRefs.push(`close_proxy:${opp.id}`);
  } else {
    reasons.push("无 expectedCloseDate（使用 install/measure 代理亦缺失）");
  }

  const unanswered =
    opp.quoteUnansweredDays ??
    (asDate(opp.quoteSentAt)
      ? daysBetween(now, asDate(opp.quoteSentAt)!)
      : null);
  if (typeof unanswered === "number" && unanswered >= 3) {
    const pts = Math.min(18, unanswered);
    score += pts;
    reasons.push(`报价发送后未回复 ${unanswered} 天(+${pts})`);
    evidenceRefs.push(`quote_unanswered:${opp.id}`);
  }

  if (opp.email) {
    score += 5;
    reasons.push("有有效邮箱(+5)");
  } else {
    reasons.push("缺少有效联系方式");
  }

  const cBoost = boosts.byCustomerId.get(opp.customerId);
  const oBoost = boosts.byOpportunityId.get(opp.id);
  if (cBoost) {
    score += cBoost.boost;
    reasons.push(...cBoost.reasons);
    evidenceRefs.push(...cBoost.refs);
  }
  if (oBoost) {
    score += oBoost.boost;
    reasons.push(...oBoost.reasons);
    evidenceRefs.push(...oBoost.refs);
  }

  if (!boosts.followupPresent) {
    reasons.push("警告：未读取到 s3_followup_analysis");
  } else if (boosts.followupPartial) {
    reasons.push("跟进分析证据为 PARTIAL，降权");
    score = Math.floor(score * 0.85);
    evidenceRefs.push("s3:PARTIAL");
  } else {
    evidenceRefs.push("s3_followup_analysis");
  }

  if (!boosts.quoteRiskPresent) {
    reasons.push("警告：未读取到 s4_quote_risk");
  } else if (boosts.quoteRiskPartial) {
    reasons.push("报价风险证据为 PARTIAL，降权");
    score = Math.floor(score * 0.9);
    evidenceRefs.push("s4:PARTIAL");
  } else {
    evidenceRefs.push("s4_quote_risk");
  }

  return {
    opportunityId: opp.id,
    customerId: opp.customerId,
    customerName: opp.customerName,
    email: opp.email ?? null,
    stage: opp.stage,
    score,
    reasons,
    evidenceRefs,
  };
}

export function prioritizeFollowups(input: {
  opportunities: PrioritizeOpportunity[];
  followupAnalysis: unknown;
  quoteRiskAnalysis: unknown;
  now?: Date;
  limit?: number;
}): {
  prioritized: PrioritizedCustomer[];
  selectedCount: number;
  usedGraders: { followup: boolean; quoteRisk: boolean };
} {
  const now = input.now ?? new Date();
  const boosts = extractGraderBoosts(
    input.followupAnalysis,
    input.quoteRiskAnalysis,
  );
  const ranked = input.opportunities
    .filter((o) => o.customerId)
    .map((o) => scoreFollowupCandidate(o, now, boosts))
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 3);

  return {
    prioritized: ranked,
    selectedCount: ranked.length,
    usedGraders: {
      followup: boosts.followupPresent,
      quoteRisk: boosts.quoteRiskPresent,
    },
  };
}
