/**
 * AI 秘书 — 主动跟进引擎
 *
 * 定时扫描客户时间线，智能决定谁需要跟进：
 * 1. 已设定跟进日期且到期的客户
 * 2. 开发信发出后 N 天未回复（阶梯式策略）
 * 3. 客户回复后超过 48 小时未处理
 * 4. 谈判阶段超过 7 天未推进
 *
 * 对需要跟进的客户，AI 自动生成跟进策略建议和邮件草稿，
 * 写入 Notification 推送给用户。
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import type { BriefingItem } from "./types";

const DAY_MS = 86_400_000;

export interface FollowupCandidate {
  prospectId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  stage: string;
  followUpCount: number;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  outreachSentAt: Date | null;
  /** 触发跟进的原因 */
  reason: FollowupReason;
  /** 距上次联系的天数 */
  daysSilent: number;
  /** 优先级分数（越高越需要关注） */
  priorityScore: number;
  /** 最近的入站消息（如果有） */
  lastInboundContent?: string;
}

export type FollowupReason =
  | "scheduled_due"
  | "no_response_first"
  | "no_response_second"
  | "no_response_final"
  | "reply_unhandled"
  | "negotiation_stalled";

export interface FollowupSuggestion {
  candidate: FollowupCandidate;
  strategy: string;
  draft: {
    subject: string;
    body: string;
    subjectZh: string;
    bodyZh: string;
  } | null;
}

export interface FollowupScanResult {
  scannedAt: string;
  orgId: string;
  candidates: FollowupCandidate[];
  suggestions: FollowupSuggestion[];
  notificationsCreated: number;
}

// ── 跟进触达阶梯策略 ────────────────────────────────────────────
// 首封无回复 5 天 → 第一次跟进
// 第一次跟进无回复 7 天 → 第二次跟进
// 第二次跟进无回复 10 天 → 最后一次跟进
const FOLLOWUP_LADDER = [
  { minDays: 5, maxDays: 12, followUpCount: 0, reason: "no_response_first" as const },
  { minDays: 7, maxDays: 14, followUpCount: 1, reason: "no_response_second" as const },
  { minDays: 10, maxDays: 21, followUpCount: 2, reason: "no_response_final" as const },
];

// ── 扫描入口 ─────────────────────────────────────────────────────

export async function scanFollowups(orgId: string): Promise<FollowupCandidate[]> {
  const now = new Date();
  const candidates: FollowupCandidate[] = [];
  const seenIds = new Set<string>();

  function addCandidate(c: FollowupCandidate) {
    if (seenIds.has(c.prospectId)) return;
    seenIds.add(c.prospectId);
    candidates.push(c);
  }

  // ── 1. 已设定跟进日期到期的 ──
  const scheduledDue = await db.tradeProspect.findMany({
    where: {
      orgId,
      nextFollowUpAt: { lte: now },
      stage: { notIn: ["won", "lost", "unqualified", "new", "no_response"] },
    },
    select: prospectSelect,
    take: 15,
    orderBy: { nextFollowUpAt: "asc" },
  });

  for (const p of scheduledDue) {
    const daysSilent = calcDaysSilent(p.lastContactAt, now);
    addCandidate({
      ...mapProspect(p),
      reason: "scheduled_due",
      daysSilent,
      priorityScore: 80 + Math.min(daysSilent * 2, 20),
    });
  }

  // ── 2. 阶梯式无回复跟进 ──
  for (const ladder of FOLLOWUP_LADDER) {
    const sinceDate = new Date(now.getTime() - ladder.maxDays * DAY_MS);
    const untilDate = new Date(now.getTime() - ladder.minDays * DAY_MS);

    const noReply = await db.tradeProspect.findMany({
      where: {
        orgId,
        stage: "outreach_sent",
        followUpCount: ladder.followUpCount,
        lastContactAt: { gt: sinceDate, lt: untilDate },
      },
      select: prospectSelect,
      take: 10,
    });

    for (const p of noReply) {
      const daysSilent = calcDaysSilent(p.lastContactAt, now);
      addCandidate({
        ...mapProspect(p),
        reason: ladder.reason,
        daysSilent,
        priorityScore: ladder.reason === "no_response_final" ? 90 : 70,
      });
    }
  }

  // ── 3. 客户回复后超 48 小时未处理 ──
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);
  const repliedUnhandled = await db.tradeProspect.findMany({
    where: {
      orgId,
      stage: { in: ["replied", "interested"] },
      messages: {
        some: {
          direction: "inbound",
          createdAt: { lt: twoDaysAgo },
        },
      },
    },
    select: {
      ...prospectSelect,
      messages: {
        where: { direction: "inbound" },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
    take: 10,
  });

  for (const p of repliedUnhandled) {
    const lastInbound = p.messages[0];
    if (!lastInbound) continue;
    const daysSince = calcDaysSilent(lastInbound.createdAt, now);
    if (daysSince < 2) continue;

    addCandidate({
      ...mapProspect(p),
      reason: "reply_unhandled",
      daysSilent: daysSince,
      priorityScore: 95,
      lastInboundContent: lastInbound.content.slice(0, 300),
    });
  }

  // ── 4. 谈判阶段停滞 ──
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const negotiationStalled = await db.tradeProspect.findMany({
    where: {
      orgId,
      stage: "negotiating",
      lastContactAt: { lt: sevenDaysAgo },
    },
    select: prospectSelect,
    take: 10,
  });

  for (const p of negotiationStalled) {
    const daysSilent = calcDaysSilent(p.lastContactAt, now);
    addCandidate({
      ...mapProspect(p),
      reason: "negotiation_stalled",
      daysSilent,
      priorityScore: 85,
    });
  }

  // 按优先级排序
  candidates.sort((a, b) => b.priorityScore - a.priorityScore);

  return candidates;
}

// ── AI 跟进策略生成 ──────────────────────────────────────────────

export async function generateFollowupSuggestions(
  candidates: FollowupCandidate[],
  options?: { maxDrafts?: number },
): Promise<FollowupSuggestion[]> {
  const maxDrafts = options?.maxDrafts ?? 5;
  const topCandidates = candidates.slice(0, maxDrafts);
  const suggestions: FollowupSuggestion[] = [];

  for (const candidate of topCandidates) {
    try {
      const suggestion = await generateSingleSuggestion(candidate);
      suggestions.push(suggestion);
    } catch (e) {
      console.error(`[followup-engine] Failed for ${candidate.companyName}:`, e);
      suggestions.push({
        candidate,
        strategy: getFallbackStrategy(candidate),
        draft: null,
      });
    }
  }

  return suggestions;
}

async function generateSingleSuggestion(
  candidate: FollowupCandidate,
): Promise<FollowupSuggestion> {
  const reasonLabel = REASON_LABELS[candidate.reason];
  const stageLabel = STAGE_LABELS[candidate.stage] ?? candidate.stage;

  const prompt = `客户: ${candidate.companyName}
联系人: ${candidate.contactName || "未知"}
国家: ${candidate.country || "未知"}
当前阶段: ${stageLabel}
触发原因: ${reasonLabel}
距上次联系: ${candidate.daysSilent} 天
已跟进次数: ${candidate.followUpCount}
${candidate.lastInboundContent ? `客户最近回复: ${candidate.lastInboundContent}` : ""}`;

  const raw = await createCompletion({
    systemPrompt: `你是「青砚」AI 外贸秘书。分析客户情况，给出跟进策略和邮件草稿。

要求：
1. strategy: 一句话说明跟进策略（中文，20字以内）
2. 邮件草稿用英文撰写，附中文翻译
3. 根据跟进次数调整策略：
   - 首次跟进: 温和提醒，提供新价值点
   - 二次跟进: 换角度切入，制造紧迫感
   - 最后跟进: 直接询问意向，留退路
   - 回复未处理: 针对客户回复内容回应
   - 谈判停滞: 主动让步或提新方案
4. 正文 80-150 词，简洁有力
5. 不要虚构事实

返回 JSON：
{"strategy":"中文策略","subject":"英文主题","body":"英文正文","subjectZh":"中文主题","bodyZh":"中文正文"}`,
    userPrompt: prompt,
    mode: "fast",
    temperature: 0.4,
  });

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    return {
      candidate,
      strategy: parsed.strategy || getFallbackStrategy(candidate),
      draft: {
        subject: parsed.subject || "",
        body: parsed.body || "",
        subjectZh: parsed.subjectZh || "",
        bodyZh: parsed.bodyZh || "",
      },
    };
  } catch {
    return {
      candidate,
      strategy: getFallbackStrategy(candidate),
      draft: null,
    };
  }
}

// ── 写入通知 ─────────────────────────────────────────────────────

export async function saveFollowupNotifications(
  userId: string,
  suggestions: FollowupSuggestion[],
): Promise<number> {
  let created = 0;

  for (const s of suggestions) {
    const sourceKey = `followup:${s.candidate.prospectId}:${new Date().toISOString().slice(0, 10)}`;

    const existing = await db.notification.findUnique({ where: { sourceKey } });
    if (existing) continue;

    const severity = s.candidate.priorityScore >= 90 ? "high"
      : s.candidate.priorityScore >= 70 ? "medium"
        : "low";

    await db.notification.create({
      data: {
        userId,
        type: "followup_reminder",
        category: "ai_secretary",
        title: `跟进提醒：${s.candidate.companyName}`,
        summary: s.strategy,
        priority: severity,
        entityType: "trade_prospect",
        entityId: s.candidate.prospectId,
        sourceKey,
        metadata: JSON.stringify({
          type: "followup_suggestion",
          reason: s.candidate.reason,
          daysSilent: s.candidate.daysSilent,
          followUpCount: s.candidate.followUpCount,
          stage: s.candidate.stage,
          draft: s.draft,
          priorityScore: s.candidate.priorityScore,
        }),
      },
    });
    created++;

    // 异步推送到微信
    pushFollowupToWeChat(userId, s).catch(() => {});
  }

  return created;
}

// ── 完整执行入口（Cron 调用） ────────────────────────────────────

export async function runFollowupEngine(
  orgId: string,
): Promise<FollowupScanResult> {
  const candidates = await scanFollowups(orgId);

  const suggestions = candidates.length > 0
    ? await generateFollowupSuggestions(candidates)
    : [];

  // 找组织内所有活跃用户推送通知
  const members = await db.organizationMember.findMany({
    where: { orgId, role: { not: "inactive" } },
    select: { userId: true },
  });

  let totalNotifications = 0;
  for (const m of members) {
    totalNotifications += await saveFollowupNotifications(m.userId, suggestions);
  }

  return {
    scannedAt: new Date().toISOString(),
    orgId,
    candidates,
    suggestions,
    notificationsCreated: totalNotifications,
  };
}

// ── 将跟进引擎结果转换为 BriefingItem（供简报使用） ──────────────

export function suggestionsToItems(suggestions: FollowupSuggestion[]): BriefingItem[] {
  return suggestions.map((s) => {
    const reasonLabel = REASON_LABELS[s.candidate.reason];
    const severity = s.candidate.priorityScore >= 90 ? "urgent" as const
      : s.candidate.priorityScore >= 70 ? "warning" as const
        : "info" as const;

    return {
      id: `followup_${s.candidate.prospectId}`,
      domain: "trade" as const,
      severity,
      category: `followup_${s.candidate.reason}`,
      title: `${s.candidate.companyName} — ${reasonLabel}`,
      description: `${s.strategy}（已 ${s.candidate.daysSilent} 天未联系）`,
      action: s.draft
        ? {
          type: "followup_draft",
          label: "查看 AI 跟进草稿",
          payload: {
            prospectId: s.candidate.prospectId,
            companyName: s.candidate.companyName,
            prefilled: s.draft,
          },
        }
        : {
          type: "followup_draft",
          label: "生成跟进草稿",
          payload: {
            prospectId: s.candidate.prospectId,
            companyName: s.candidate.companyName,
          },
        },
      entityType: "trade_prospect",
      entityId: s.candidate.prospectId,
      dedupeKey: `followup:${s.candidate.prospectId}`,
    };
  });
}

// ── 辅助 ─────────────────────────────────────────────────────────

const prospectSelect = {
  id: true,
  companyName: true,
  contactName: true,
  contactEmail: true,
  country: true,
  stage: true,
  followUpCount: true,
  lastContactAt: true,
  nextFollowUpAt: true,
  outreachSentAt: true,
} as const;

function mapProspect(p: {
  id: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  stage: string;
  followUpCount: number;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  outreachSentAt: Date | null;
}): Omit<FollowupCandidate, "reason" | "daysSilent" | "priorityScore"> {
  return {
    prospectId: p.id,
    companyName: p.companyName,
    contactName: p.contactName,
    contactEmail: p.contactEmail,
    country: p.country,
    stage: p.stage,
    followUpCount: p.followUpCount,
    lastContactAt: p.lastContactAt,
    nextFollowUpAt: p.nextFollowUpAt,
    outreachSentAt: p.outreachSentAt,
  };
}

function calcDaysSilent(lastContact: Date | null, now: Date): number {
  if (!lastContact) return 999;
  return Math.floor((now.getTime() - lastContact.getTime()) / DAY_MS);
}

function getFallbackStrategy(c: FollowupCandidate): string {
  switch (c.reason) {
    case "scheduled_due": return "按计划跟进";
    case "no_response_first": return "温和提醒，提供新价值";
    case "no_response_second": return "换角度切入，适度紧迫";
    case "no_response_final": return "最后跟进，询问意向";
    case "reply_unhandled": return "尽快回复客户";
    case "negotiation_stalled": return "推动谈判进展";
    default: return "建议跟进";
  }
}

const REASON_LABELS: Record<FollowupReason, string> = {
  scheduled_due: "跟进日期到期",
  no_response_first: "首封邮件未回复",
  no_response_second: "二次跟进未回复",
  no_response_final: "最后机会跟进",
  reply_unhandled: "客户回复未处理",
  negotiation_stalled: "谈判阶段停滞",
};

async function pushFollowupToWeChat(userId: string, s: FollowupSuggestion): Promise<void> {
  const { pushFollowupReminder } = await import("@/lib/messaging/push-service");
  await pushFollowupReminder(
    userId,
    s.candidate.companyName,
    s.strategy,
    s.candidate.reason,
    s.candidate.daysSilent,
  );
}

const STAGE_LABELS: Record<string, string> = {
  new: "新发现",
  researched: "已研究",
  qualified: "已评分",
  outreach_draft: "开发信草稿",
  outreach_sent: "已发开发信",
  replied: "已回复",
  interested: "有意向",
  negotiating: "谈判中",
  won: "成交",
  lost: "失败",
  unqualified: "不合格",
  no_response: "无回复",
};
