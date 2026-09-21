/**
 * 主动开发短序列：Day 1 / 3 / 7。
 * cron 只起草，人审后才发；不群发、不自动发出。
 */

import { db } from "@/lib/db";
import { generateOutreachEmail, type OutreachDraft } from "@/lib/trade/agents";
import { getResearchReportForAgents } from "@/lib/trade/research-bundle";
import { sendEmail } from "@/lib/trade/email";
import { createMessage, updateProspect } from "@/lib/trade/service";
import { logActivity } from "@/lib/trade/activity-log";
import { stageAtLeastContacted } from "@/lib/trade/stage";
import {
  SEQUENCE_CATEGORY_BY_OFFSET,
  SEQUENCE_DAY_OFFSETS,
  SEQUENCE_LABEL_BY_OFFSET,
  addUtcDays,
  isSequenceDayOffset,
  nextFollowUpAfterSend,
  type SequenceDayOffset,
} from "@/lib/trade/outreach-sequence-constants";

export {
  SEQUENCE_CATEGORY_BY_OFFSET,
  SEQUENCE_DAY_OFFSETS,
  SEQUENCE_LABEL_BY_OFFSET,
  addUtcDays,
  isSequenceDayOffset,
  nextFollowUpAfterSend,
};
export type { SequenceCategory, SequenceDayOffset, SequenceStepStatus } from "@/lib/trade/outreach-sequence-constants";

export async function ensureOutreachSequence(input: {
  orgId: string;
  prospectId: string;
  anchorAt?: Date;
}) {
  const anchor = input.anchorAt ?? new Date();
  const existing = await db.tradeOutreachStep.findMany({
    where: { orgId: input.orgId, prospectId: input.prospectId },
    select: { dayOffset: true },
  });
  const have = new Set(existing.map((s) => s.dayOffset));
  const missing = SEQUENCE_DAY_OFFSETS.filter((d) => !have.has(d));
  if (missing.length === 0) {
    return listOutreachSequence(input.orgId, input.prospectId);
  }
  await db.tradeOutreachStep.createMany({
    data: missing.map((dayOffset) => ({
      orgId: input.orgId,
      prospectId: input.prospectId,
      dayOffset,
      status: "pending",
      sequenceCategory: SEQUENCE_CATEGORY_BY_OFFSET[dayOffset],
      scheduledAt: addUtcDays(anchor, dayOffset),
    })),
  });
  return listOutreachSequence(input.orgId, input.prospectId);
}

export async function listOutreachSequence(orgId: string, prospectId: string) {
  return db.tradeOutreachStep.findMany({
    where: { orgId, prospectId },
    orderBy: { dayOffset: "asc" },
  });
}

export async function syncFirstStepDraft(input: {
  orgId: string;
  prospectId: string;
  draft: OutreachDraft;
}) {
  await ensureOutreachSequence({ orgId: input.orgId, prospectId: input.prospectId });
  return db.tradeOutreachStep.update({
    where: { prospectId_dayOffset: { prospectId: input.prospectId, dayOffset: 0 } },
    data: {
      status: "drafted",
      draftedAt: new Date(),
      subject: input.draft.subject,
      body: input.draft.body,
      subjectZh: input.draft.subjectZh,
      bodyZh: input.draft.bodyZh,
      lastError: null,
    },
  });
}

export async function markSequenceStepSent(input: {
  orgId: string;
  prospectId: string;
  dayOffset: SequenceDayOffset;
  sentAt?: Date;
}) {
  const sentAt = input.sentAt ?? new Date();
  await ensureOutreachSequence({ orgId: input.orgId, prospectId: input.prospectId, anchorAt: sentAt });
  await db.tradeOutreachStep.update({
    where: { prospectId_dayOffset: { prospectId: input.prospectId, dayOffset: input.dayOffset } },
    data: { status: "sent", sentAt, lastError: null },
  });
  if (input.dayOffset === 0) {
    await db.tradeOutreachStep.updateMany({
      where: {
        orgId: input.orgId,
        prospectId: input.prospectId,
        dayOffset: { in: [3, 7] },
        status: { in: ["pending", "drafted"] },
      },
      data: { scheduledAt: addUtcDays(sentAt, 3) },
    });
    await db.tradeOutreachStep.updateMany({
      where: {
        orgId: input.orgId,
        prospectId: input.prospectId,
        dayOffset: 7,
        status: { in: ["pending", "drafted"] },
      },
      data: { scheduledAt: addUtcDays(sentAt, 7) },
    });
  }
}

function previousOffset(offset: SequenceDayOffset): SequenceDayOffset | null {
  if (offset === 3) return 0;
  if (offset === 7) return 3;
  return null;
}

export async function canDraftSequenceStep(input: {
  orgId: string;
  prospectId: string;
  dayOffset: SequenceDayOffset;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const step = await db.tradeOutreachStep.findFirst({
    where: { orgId: input.orgId, prospectId: input.prospectId, dayOffset: input.dayOffset },
  });
  if (!step) return { ok: false, error: "序列步骤不存在" };
  if (step.status === "sent") return { ok: false, error: "该步骤已发送" };
  if (step.status === "skipped") return { ok: false, error: "该步骤已跳过" };
  const prev = previousOffset(input.dayOffset);
  if (prev != null) {
    const prevStep = await db.tradeOutreachStep.findFirst({
      where: { orgId: input.orgId, prospectId: input.prospectId, dayOffset: prev },
    });
    if (!prevStep || prevStep.status !== "sent") {
      return { ok: false, error: "请先人工发出上一封，再起草跟进" };
    }
    if (step.scheduledAt > now) {
      return { ok: false, error: "尚未到跟进日，不自动起草" };
    }
  }
  return { ok: true };
}

export async function draftSequenceStep(input: {
  orgId: string;
  prospectId: string;
  dayOffset: SequenceDayOffset;
  senderName: string;
  senderCompany?: string;
  now?: Date;
}): Promise<{ ok: true; draft: OutreachDraft } | { ok: false; error: string; status?: number }> {
  const gate = await canDraftSequenceStep(input);
  if (!gate.ok) return { ok: false, error: gate.error, status: 400 };

  const prospect = await db.tradeProspect.findFirst({
    where: { id: input.prospectId, orgId: input.orgId },
    include: { campaign: true },
  });
  if (!prospect) return { ok: false, error: "线索不存在", status: 404 };

  const report = getResearchReportForAgents(prospect.researchReport);
  if (!report) return { ok: false, error: "请先完成客户研究再生成开发信", status: 400 };

  const category = SEQUENCE_CATEGORY_BY_OFFSET[input.dayOffset];
  const draft = await generateOutreachEmail(
    {
      companyName: prospect.companyName,
      contactName: prospect.contactName,
      contactTitle: prospect.contactTitle,
      country: prospect.country,
    },
    report,
    prospect.campaign.productDesc,
    {
      companyName: input.senderCompany ?? "Our Company",
      senderName: input.senderName,
    },
    { sequenceCategory: category, orgId: input.orgId },
  );

  await db.tradeOutreachStep.update({
    where: { prospectId_dayOffset: { prospectId: input.prospectId, dayOffset: input.dayOffset } },
    data: {
      status: "drafted",
      draftedAt: new Date(),
      subject: draft.subject,
      body: draft.body,
      subjectZh: draft.subjectZh,
      bodyZh: draft.bodyZh,
      lastError: null,
    },
  });

  if (input.dayOffset === 0) {
    await updateProspect(input.prospectId, {
      outreachSubject: draft.subject,
      outreachBody: draft.body,
      outreachLang: "en",
    });
  }

  await logActivity({
    orgId: input.orgId,
    campaignId: prospect.campaignId,
    prospectId: input.prospectId,
    action: "outreach_sequence_draft",
    detail: `起草 ${SEQUENCE_LABEL_BY_OFFSET[input.dayOffset]}`,
    meta: { dayOffset: input.dayOffset },
  });

  return { ok: true, draft };
}

export async function sendSequenceStep(input: {
  orgId: string;
  prospectId: string;
  dayOffset: SequenceDayOffset;
  mode: "send" | "mark_sent";
  replyTo?: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const prospect = await db.tradeProspect.findFirst({
    where: { id: input.prospectId, orgId: input.orgId },
  });
  if (!prospect) return { ok: false, error: "线索不存在", status: 404 };

  const step = await db.tradeOutreachStep.findFirst({
    where: { orgId: input.orgId, prospectId: input.prospectId, dayOffset: input.dayOffset },
  });
  if (!step) return { ok: false, error: "序列步骤不存在", status: 404 };
  if (step.status === "sent") return { ok: false, error: "该步骤已发送", status: 409 };
  if (step.status === "skipped") return { ok: false, error: "该步骤已跳过", status: 400 };
  if (!step.subject || !step.body) {
    return { ok: false, error: "请先起草该步骤", status: 400 };
  }

  const now = new Date();
  if (input.mode === "send") {
    if (!prospect.contactEmail) {
      return { ok: false, error: "无线索邮箱，只能标记为已发送", status: 400 };
    }
    const result = await sendEmail({
      to: prospect.contactEmail,
      subject: step.subject,
      body: step.body,
      replyTo: input.replyTo,
    });
    if (!result.success) {
      return { ok: false, error: `发送失败: ${result.error}`, status: 500 };
    }
  }

  await createMessage({
    prospectId: input.prospectId,
    direction: "outbound",
    channel: "email",
    subject: step.subject,
    content: step.body,
  });

  await markSequenceStepSent({
    orgId: input.orgId,
    prospectId: input.prospectId,
    dayOffset: input.dayOffset,
    sentAt: now,
  });

  const nextAt = nextFollowUpAfterSend(now, input.dayOffset);
  await updateProspect(input.prospectId, {
    stage: stageAtLeastContacted(prospect.stage),
    outreachSentAt: prospect.outreachSentAt ?? now,
    lastContactAt: now,
    nextFollowUpAt: nextAt,
    followUpCount: { increment: input.dayOffset === 0 ? 0 : 1 },
  });

  if (input.dayOffset === 0) {
    await updateProspect(input.prospectId, {
      outreachSubject: step.subject,
      outreachBody: step.body,
    });
  }

  await logActivity({
    orgId: input.orgId,
    campaignId: prospect.campaignId,
    prospectId: input.prospectId,
    action: "outreach_sequence_send",
    detail: `人工发出 ${SEQUENCE_LABEL_BY_OFFSET[input.dayOffset]}（${input.mode}）`,
    meta: { dayOffset: input.dayOffset, mode: input.mode },
  });

  return { ok: true };
}

export async function draftDueSequenceSteps(now = new Date()): Promise<number> {
  const due = await db.tradeOutreachStep.findMany({
    where: {
      status: "pending",
      scheduledAt: { lte: now },
      dayOffset: { in: [3, 7] },
    },
    take: 30,
    select: { id: true, orgId: true, prospectId: true, dayOffset: true },
  });

  let drafted = 0;
  for (const step of due) {
    if (!isSequenceDayOffset(step.dayOffset)) continue;
    const gate = await canDraftSequenceStep({
      orgId: step.orgId,
      prospectId: step.prospectId,
      dayOffset: step.dayOffset,
      now,
    });
    if (!gate.ok) continue;
    const result = await draftSequenceStep({
      orgId: step.orgId,
      prospectId: step.prospectId,
      dayOffset: step.dayOffset,
      senderName: "Sales Team",
    });
    if (result.ok) drafted += 1;
    else {
      await db.tradeOutreachStep.update({
        where: { id: step.id },
        data: { lastError: result.error.slice(0, 2000) },
      });
    }
  }
  return drafted;
}
