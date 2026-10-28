/**
 * Muse Bridge — 跨助理询问与回复（TASKFLOW S2）：纯函数，零 DB / 零 LLM
 *
 * 询问 = Task（sourceType=muse_inquiry, sourceId=商机, sourceTemplateKey=inq:<requestId>）
 * 回复 = TaskComment（人读文本）+ TaskActivity（结构化答案 + 渠道）
 * 员工确认与 CRM 事实分开呈现；默认问题查表生成，不让模型决定问什么。
 */

import type { MuseInquiryNeed } from "./contract";
import { clip, eventSummary, oneLine, type Advisory } from "./advisory";
import type { EmitMuseEventInput } from "./events-pure";
import type { SalesSignals } from "./sales-pure";

export const INQUIRY_SOURCE_TYPE = "muse_inquiry" as const;
export const INQUIRY_CREATED_ACTION = "muse_inquiry.created" as const;
export const INQUIRY_REPLIED_ACTION = "muse_inquiry.replied" as const;
export const DEFAULT_REPLY_HOURS = 24;
export const CLOSED_TASK_STATUSES = ["done", "cancelled"] as const;

export const inquirySourceTemplateKey = (requestId: string) => `inq:${requestId}`;
export const workflowIdFor = (requestId: string) => `wf_${requestId}`;

export const NEED_LABELS: Record<MuseInquiryNeed, string> = {
  material: "资料",
  meeting: "会议",
  sample: "样板",
  quote_revision: "报价修订",
  other: "其他",
};

export const INQUIRY_PERMISSION_MESSAGE = "只有管理角色可以通过 Muse 发起商机询问。";
export const INQUIRY_UNASSIGNED_MESSAGE = "这个商机没有可询问的负责人（未分配、已离开组织或就是你本人）。";
export const INQUIRY_NOT_FOUND_MESSAGE = "没找到这条询问，或你不是它的收件人。";
export const INQUIRY_CLOSED_MESSAGE = "这条询问已经回复或已取消，不能再次回复。";
export const INQUIRY_REPLY_BY_MESSAGE = "期望回复时间必须晚于现在。";

/** 去空、去重，保留原顺序 */
export function normalizeQuestions(questions: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of questions) {
    const t = oneLine(q);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** 管理者"问负责人"时的默认问题：按已知信号查表，最多 3 条 */
export function defaultInquiryQuestions(signals: SalesSignals | null): string[] {
  const out: string[] = [];
  if (signals?.customerWaiting) out.push("客户最近来信说了什么？你准备怎么回、什么时候回？");
  if (signals?.stale) out.push("最近一次和客户联系是什么时候？客户态度如何？");
  if (signals?.followupOverdue || signals?.actionsOverdue) out.push("约定的跟进做了吗？没做的话卡在哪里？");
  out.push("下一步是什么、计划什么时候做？需要什么支持？");
  return out.slice(0, 3);
}

export type InquiryOpportunity = { id: string; title: string; customerName: string; stageLabel: string; updatedAt: Date };

export function inquiryTaskTitle(opportunityTitle: string): string {
  return `询问：${clip(oneLine(opportunityTitle), 60)}`;
}

export function inquiryTaskDescription(input: {
  askerName: string;
  opportunity: InquiryOpportunity;
  questions: string[];
  note?: string;
}): string {
  const lines = [
    `${input.askerName} 想了解商机「${oneLine(input.opportunity.title)}」（${oneLine(input.opportunity.customerName)}，${input.opportunity.stageLabel}）的最新进展：`,
    ...input.questions.map((q, i) => `${i + 1}. ${q}`),
  ];
  if (input.note) lines.push(`备注：${oneLine(input.note)}`);
  lines.push("请在青砚「商机询问」页或你的助理里回复。");
  return lines.join("\n");
}

export type InquiryCreatedDetail = {
  kind: typeof INQUIRY_CREATED_ACTION;
  workflowId: string;
  requestId: string;
  opportunityId: string;
  /** 发起时商机的 updatedAt：引用的 CRM 记录版本 */
  recordVersion: string;
  questions: string[];
  note: string | null;
};

export type InquiryReply = {
  nextStep: string;
  customerFeedback: string | null;
  lastContactAt: string | null;
  nextStepDueAt: string | null;
  needs: MuseInquiryNeed[];
  note: string | null;
};

export type InquiryReplyDetail = InquiryReply & { kind: typeof INQUIRY_REPLIED_ACTION; channel: "muse" | "web" };

export function normalizeReply(input: {
  nextStep: string;
  customerFeedback?: string;
  lastContactAt?: string;
  nextStepDueAt?: string;
  needs?: readonly MuseInquiryNeed[];
  note?: string;
}): InquiryReply {
  const text = (v?: string) => (v && oneLine(v) ? oneLine(v) : null);
  return {
    nextStep: oneLine(input.nextStep),
    customerFeedback: text(input.customerFeedback),
    lastContactAt: input.lastContactAt ?? null,
    nextStepDueAt: input.nextStepDueAt ?? null,
    needs: [...new Set(input.needs ?? [])],
    note: text(input.note),
  };
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** 写进 TaskComment 的人读文本 */
export function replyCommentText(reply: InquiryReply): string {
  const lines = [`下一步：${reply.nextStep}${reply.nextStepDueAt ? `（${day(reply.nextStepDueAt)} 前）` : ""}`];
  if (reply.customerFeedback) lines.push(`客户反馈：${reply.customerFeedback}`);
  if (reply.lastContactAt) lines.push(`最近联系：${day(reply.lastContactAt)}`);
  if (reply.needs.length > 0) lines.push(`需要支持：${reply.needs.map((n) => NEED_LABELS[n]).join("、")}`);
  if (reply.note) lines.push(`备注：${reply.note}`);
  return lines.join("\n");
}

/** TaskActivity.detail 是字符串；坏数据一律当作没有 */
export function parseDetail<T extends { kind: string }>(detail: string | null | undefined, kind: T["kind"]): T | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail) as T;
    return parsed && parsed.kind === kind ? parsed : null;
  } catch {
    return null;
  }
}

const statusStep = (opportunityId: string) => ({
  label: "看商机详情",
  command: { intent: "opportunity_status" as const, opportunityId },
});

export function inquiryReceivedEventInput(input: {
  orgId: string;
  assigneeUserId: string;
  inquiryId: string;
  opportunityId: string;
  opportunityTitle: string;
  askerName: string;
  questionCount: number;
  dueAt: Date;
}): EmitMuseEventInput {
  return {
    eventId: `inquiry.received:${input.inquiryId}`,
    type: "inquiry.received",
    orgId: input.orgId,
    userId: input.assigneeUserId,
    opportunityId: input.opportunityId,
    inquiryId: input.inquiryId,
    summary: eventSummary(
      `${clip(oneLine(input.askerName), 12)} 问你「${clip(oneLine(input.opportunityTitle), 20)}」的进展`,
      `${input.questionCount} 个问题，请在 ${input.dueAt.toISOString().slice(0, 16).replace("T", " ")}（UTC）前回复`,
    ),
    action: statusStep(input.opportunityId),
  };
}

export function inquiryRepliedEventInput(input: {
  orgId: string;
  askerUserId: string;
  inquiryId: string;
  opportunityId: string;
  opportunityTitle: string;
  replierName: string;
  nextStep: string;
}): EmitMuseEventInput {
  return {
    eventId: `inquiry.replied:${input.inquiryId}`,
    type: "inquiry.replied",
    orgId: input.orgId,
    userId: input.askerUserId,
    opportunityId: input.opportunityId,
    inquiryId: input.inquiryId,
    summary: eventSummary(
      `${clip(oneLine(input.replierName), 12)} 回复了「${clip(oneLine(input.opportunityTitle), 20)}」`,
      `下一步：${oneLine(input.nextStep)}`,
    ),
    action: statusStep(input.opportunityId),
  };
}

export function askColleagueAdvisory(input: {
  opportunityTitle: string;
  assigneeName: string;
  dueAt: Date;
  questionCount: number;
  opportunityId: string;
}): Advisory {
  return {
    conclusion: `已问 ${clip(oneLine(input.assigneeName), 10)}「${clip(oneLine(input.opportunityTitle), 16)}」的进展`,
    reasons: [
      `${input.questionCount} 个问题，期望 ${input.dueAt.toISOString().slice(0, 16).replace("T", " ")}（UTC）前回复`,
      "对方回复后你会收到通知；回复会作为员工确认，与 CRM 记录分开显示",
    ],
    nextStep: statusStep(input.opportunityId),
  };
}

export function replyInquiryAdvisory(input: { opportunityTitle: string; askerName: string; opportunityId: string }): Advisory {
  return {
    conclusion: `已回复「${clip(oneLine(input.opportunityTitle), 20)}」的询问`,
    reasons: [`${clip(oneLine(input.askerName), 12)} 会收到你的回复`],
    nextStep: statusStep(input.opportunityId),
  };
}

// ── 商机状态里的询问视图 ────────────────────────────────────────

export type InquiryRecord = {
  id: string;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
  creator: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  createdDetail: InquiryCreatedDetail | null;
  reply: { at: Date; by: { id: string; name: string }; detail: InquiryReplyDetail } | null;
};

export function employeeConfirmationsView(records: InquiryRecord[]) {
  return records
    .filter((r) => r.reply)
    .sort((a, b) => (b.reply as NonNullable<InquiryRecord["reply"]>).at.getTime() - (a.reply as NonNullable<InquiryRecord["reply"]>).at.getTime())
    .map((r) => {
      const reply = r.reply as NonNullable<InquiryRecord["reply"]>;
      const d = reply.detail;
      const answers = {
        channel: d.channel,
        nextStep: d.nextStep,
        customerFeedback: d.customerFeedback,
        lastContactAt: d.lastContactAt,
        nextStepDueAt: d.nextStepDueAt,
        needs: d.needs,
        note: d.note,
      };
      return {
        inquiryId: r.id,
        askedBy: r.creator,
        askedAt: r.createdAt.toISOString(),
        questions: r.createdDetail?.questions ?? [],
        repliedBy: reply.by,
        repliedAt: reply.at.toISOString(),
        ...answers,
      };
    });
}

export function openInquiriesView(records: InquiryRecord[], now: Date) {
  return records
    .filter((r) => !r.reply && !(CLOSED_TASK_STATUSES as readonly string[]).includes(r.status))
    .map((r) => ({
      inquiryId: r.id,
      askedBy: r.creator,
      assignee: r.assignee,
      askedAt: r.createdAt.toISOString(),
      dueAt: r.dueDate ? r.dueDate.toISOString() : null,
      overdue: !!r.dueDate && r.dueDate.getTime() < now.getTime(),
      questions: r.createdDetail?.questions ?? [],
    }));
}
