/**
 * 规则/统计驱动的个人偏好学习（不做 Fine-tuning）
 * 仅生成 suggested 候选，须员工确认后才写入 confirmed
 */

import { db } from "@/lib/db";
import { isLearnableForPersonal } from "./feedback-service";

export interface PreferenceSuggestion {
  preferenceKey: string;
  preference: string;
  confidence: number;
  evidenceCount: number;
  status: "suggested";
}

export function analyzeEmailShorteningSignals(
  events: Array<{
    humanDecision: string;
    feedbackScope: string;
    diffSummary: unknown;
    taskType: string;
  }>,
): PreferenceSuggestion | null {
  const relevant = events.filter(
    (e) =>
      isLearnableForPersonal(e.feedbackScope) &&
      e.humanDecision === "edited" &&
      /mail|email|跟进|draft/i.test(e.taskType),
  );
  if (relevant.length < 5) return null;

  let shortened = 0;
  for (const e of relevant.slice(0, 10)) {
    const diff = e.diffSummary as { shortenedPct?: number; notes?: string[] } | null;
    if ((diff?.shortenedPct ?? 0) >= 30 || diff?.notes?.some((n) => n.includes("缩短"))) {
      shortened++;
    }
  }
  const sample = Math.min(10, relevant.length);
  const confidence = shortened / sample;
  if (confidence < 0.7 || shortened < 5) return null;

  return {
    preferenceKey: "email_concise_default",
    preference: "邮件默认使用简洁格式，正文目标低于150词",
    confidence: Math.round(confidence * 100) / 100,
    evidenceCount: sample,
    status: "suggested",
  };
}

export function analyzeNoDiscountFirstTouch(
  events: Array<{
    humanDecision: string;
    feedbackScope: string;
    diffSummary: unknown;
    taskType: string;
  }>,
): PreferenceSuggestion | null {
  const relevant = events.filter(
    (e) =>
      isLearnableForPersonal(e.feedbackScope) &&
      e.humanDecision === "edited" &&
      /follow|跟进|mail|email/i.test(e.taskType),
  );
  if (relevant.length < 5) return null;
  let removed = 0;
  for (const e of relevant.slice(0, 10)) {
    const diff = e.diffSummary as { notes?: string[] } | null;
    if (diff?.notes?.some((n) => n.includes("折扣"))) removed++;
  }
  const sample = Math.min(10, relevant.length);
  const confidence = removed / sample;
  if (confidence < 0.7 || removed < 5) return null;
  return {
    preferenceKey: "no_discount_first_touch",
    preference: "首次跟进默认不主动提出折扣",
    confidence: Math.round(confidence * 100) / 100,
    evidenceCount: sample,
    status: "suggested",
  };
}

export async function suggestPersonalPreferences(input: {
  orgId: string;
  userId: string;
}): Promise<PreferenceSuggestion[]> {
  const events = await db.humanFeedbackEvent.findMany({
    where: { orgId: input.orgId, userId: input.userId },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      humanDecision: true,
      feedbackScope: true,
      diffSummary: true,
      taskType: true,
    },
  });

  const suggestions: PreferenceSuggestion[] = [];
  const a = analyzeEmailShorteningSignals(events);
  if (a) suggestions.push(a);
  const b = analyzeNoDiscountFirstTouch(events);
  if (b) suggestions.push(b);
  return suggestions;
}

/** 将 suggested 写入 profile.learnedPreferences.inferred（不自动 confirmed） */
export async function writeInferredPreferences(input: {
  orgId: string;
  userId: string;
  suggestions: PreferenceSuggestion[];
}) {
  const profile = await db.employeeAiProfile.findUnique({
    where: { orgId_userId: { orgId: input.orgId, userId: input.userId } },
  });
  if (!profile) return null;

  const learned = (profile.learnedPreferences as Record<string, unknown>) || {};
  const inferred = { ...((learned.inferred as Record<string, unknown>) || {}) };
  const rejected = new Set((learned.rejected as string[]) || []);
  const confirmedBag =
    (profile.manuallyConfirmedPreferences as Record<string, unknown>) || {};
  const confirmed = (confirmedBag.confirmed as Record<string, unknown>) || {};
  const confidence = { ...((learned.confidence as Record<string, unknown>) || {}) };

  for (const s of input.suggestions) {
    if (rejected.has(s.preferenceKey)) continue;
    if (confirmed[s.preferenceKey] != null) continue;
    inferred[s.preferenceKey] = {
      preference: s.preference,
      status: "suggested",
      evidenceCount: s.evidenceCount,
    };
    confidence[s.preferenceKey] = s.confidence;
  }

  return db.employeeAiProfile.update({
    where: { id: profile.id },
    data: {
      learnedPreferences: {
        ...learned,
        inferred,
        confidence,
        lastLearnedAt: new Date().toISOString(),
      } as object,
    },
  });
}
