/**
 * 场景：Gmail 草稿 Prepare（确认前不调用 createGmailDraft）
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import { resolveCustomerForFollowup } from "@/lib/ai-grader/graders/customer-followup-grader";
import type { AssistantScenarioResult, ScenarioContext } from "./types";
import { friendlyScenarioError } from "./types";
import { extractCustomerNameHint, extractEmail } from "./entity-parse";

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

function clip(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max);
}

export function buildGmailDraftCopy(input: {
  to: string;
  subject: string;
  body: string;
  requestedDirectExecution?: boolean;
}): string {
  const lines = [
    input.requestedDirectExecution
      ? "你要求发送邮件。当前阶段为了安全，只会创建 Gmail 草稿，不会自动发送。"
      : "已准备 Gmail 邮件草稿预览（确认后才会创建草稿，不会自动发送）。",
    "",
    `收件人：${input.to}`,
    `主题：${input.subject}`,
    "",
    "正文预览：",
    input.body.slice(0, 500) + (input.body.length > 500 ? "…" : ""),
    "",
    "请确认下方卡片；取消则不会创建草稿。",
  ];
  return lines.join("\n");
}

export type GmailDraftPlan = {
  to: string;
  subject: string;
  body: string;
  customerId?: string;
  customerName?: string;
  assistantContent: string;
};

export type GmailAnalyzeResult =
  | {
      kind: "clarification_required";
      assistantContent: string;
      missingFields: string[];
    }
  | { kind: "ready"; plan: GmailDraftPlan };

async function resolveRecipient(
  ctx: Pick<
    ScenarioContext,
    "orgId" | "userId" | "role" | "message"
  >,
): Promise<
  | { ok: true; to: string; customerId?: string; customerName?: string }
  | { ok: false; result: Extract<GmailAnalyzeResult, { kind: "clarification_required" }> }
> {
  const email = extractEmail(ctx.message);
  if (email) {
    return { ok: true, to: email };
  }

  const name = extractCustomerNameHint(ctx.message);
  if (!name) {
    return {
      ok: false,
      result: {
        kind: "clarification_required",
        missingFields: ["recipient"],
        assistantContent: friendlyScenarioError("RECIPIENT_REQUIRED"),
      },
    };
  }

  const customer = await resolveCustomerForFollowup({
    orgId: ctx.orgId,
    userId: ctx.userId,
    role: ctx.role,
    customerName: name,
  });

  if (customer.status === "ambiguous") {
    return {
      ok: false,
      result: {
        kind: "clarification_required",
        missingFields: ["customerName"],
        assistantContent: `找到多个客户：${customer.candidates
          .map((c) => c.name)
          .join("、")}。请指定唯一客户或直接提供邮箱。`,
      },
    };
  }
  if (customer.status !== "ok") {
    return {
      ok: false,
      result: {
        kind: "clarification_required",
        missingFields: ["recipient"],
        assistantContent: friendlyScenarioError("RECIPIENT_REQUIRED"),
      },
    };
  }

  const full = await db.salesCustomer.findFirst({
    where: { id: customer.customerId, orgId: ctx.orgId },
    select: { id: true, name: true, email: true },
  });
  if (!full?.email) {
    return {
      ok: false,
      result: {
        kind: "clarification_required",
        missingFields: ["recipient"],
        assistantContent: `客户「${customer.customerName}」没有可用邮箱。请提供收件人邮箱。`,
      },
    };
  }

  return {
    ok: true,
    to: full.email,
    customerId: full.id,
    customerName: full.name,
  };
}

/** 分析阶段：澄清时不创建 Run / PA */
export async function analyzeGmailDraft(
  ctx: Pick<
    ScenarioContext,
    "orgId" | "userId" | "role" | "message" | "requestedDirectExecution"
  >,
): Promise<GmailAnalyzeResult> {
  const recipient = await resolveRecipient(ctx);
  if (!recipient.ok) return recipient.result;

  const subject = clip(
    recipient.customerName
      ? `关于 ${recipient.customerName} 的跟进`
      : "跟进邮件",
    SUBJECT_MAX,
  );
  const body = clip(
    [
      `您好${recipient.customerName ? ` ${recipient.customerName}` : ""}，`,
      "",
      "希望这封邮件找到你一切顺利。",
      "",
      "我想跟进一下我们之前沟通的事项，请问您方便的时间吗？",
      "",
      "此致",
      "敬礼",
      "",
      `（由青砚助手根据你的请求起草；原文：${ctx.message.slice(0, 120)}）`,
    ].join("\n"),
    BODY_MAX,
  );

  return {
    kind: "ready",
    plan: {
      to: recipient.to,
      subject,
      body,
      customerId: recipient.customerId,
      customerName: recipient.customerName,
      assistantContent: buildGmailDraftCopy({
        to: recipient.to,
        subject,
        body,
        requestedDirectExecution: ctx.requestedDirectExecution,
      }),
    },
  };
}

export async function commitGmailDraft(
  ctx: ScenarioContext,
  ready: Extract<GmailAnalyzeResult, { kind: "ready" }>,
): Promise<AssistantScenarioResult> {
  const { plan } = ready;
  const draft = await createDraft({
    type: "grader.email_draft",
    title: `邮件草稿：${plan.to}`,
    preview: buildGmailDraftCopy({
      to: plan.to,
      subject: plan.subject,
      body: plan.body.slice(0, 180),
      requestedDirectExecution: ctx.requestedDirectExecution,
    }).slice(0, 500),
    payload: {
      to: plan.to,
      subject: plan.subject,
      body: plan.body,
      targetType: plan.customerId ? "CUSTOMER" : undefined,
      targetId: plan.customerId,
      source: "GRADER",
      graderType: "CUSTOMER_FOLLOWUP",
      metadata: {
        orgId: ctx.orgId,
        customerId: plan.customerId,
      },
    },
    userId: ctx.userId,
    orgId: ctx.orgId,
    threadId: ctx.threadId,
    messageId: ctx.assistantMessageId,
    agentRunId: ctx.agentRunId,
  });

  if (
    !draft.success ||
    !draft.data ||
    typeof draft.data !== "object" ||
    typeof (draft.data as { actionId?: unknown }).actionId !== "string"
  ) {
    return {
      kind: "failed",
      assistantContent: friendlyScenarioError("DRAFT_CREATION_FAILED"),
      errorCode: "DRAFT_CREATION_FAILED",
    };
  }

  const data = draft.data as {
    actionId: string;
    type: string;
    title: string;
    preview: string;
  };

  return {
    kind: "approval_required",
    assistantContent: plan.assistantContent,
    pendingActions: [
      {
        id: data.actionId,
        type: data.type,
        title: data.title,
        preview: data.preview,
      },
    ],
    resultSummary: "gmail_draft_pending",
  };
}

export async function runGmailDraftScenario(
  ctx: ScenarioContext,
): Promise<AssistantScenarioResult> {
  const analyzed = await analyzeGmailDraft(ctx);
  if (analyzed.kind === "clarification_required") {
    return analyzed;
  }
  return commitGmailDraft(ctx, analyzed);
}
