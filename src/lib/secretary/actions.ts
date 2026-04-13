/**
 * AI 秘书 — 一键动作引擎
 *
 * 支持的动作类型：
 * 1. followup_draft  — AI 生成跟进邮件草稿（首次/二次触达）
 * 2. quote_extend    — 延期报价有效期
 * 3. prospect_approve — 批准高分客户进入开发信生成流程
 * 4. prospect_skip   — 跳过某客户（标记为 unqualified）
 * 5. send_draft      — 确认并发送 AI 草稿邮件
 */

import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getProspect, updateProspect, createMessage } from "@/lib/trade/service";
import { sendEmail } from "@/lib/trade/email";

export type ActionType =
  | "followup_draft"
  | "quote_extend"
  | "prospect_approve"
  | "prospect_skip"
  | "send_draft";

export interface ActionRequest {
  type: ActionType;
  /** 目标实体 ID（prospect / quote） */
  entityId: string;
  /** 附加参数 */
  params?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  type: ActionType;
  message: string;
  /** 生成的草稿内容（followup_draft 时） */
  draft?: EmailDraft;
  /** 更新后的实体 */
  updatedEntity?: Record<string, unknown>;
}

export interface EmailDraft {
  subject: string;
  body: string;
  subjectZh: string;
  bodyZh: string;
  to?: string;
  prospectId: string;
  companyName: string;
}

export async function executeAction(req: ActionRequest): Promise<ActionResult> {
  switch (req.type) {
    case "followup_draft":
      return handleFollowupDraft(req.entityId, req.params);
    case "quote_extend":
      return handleQuoteExtend(req.entityId, req.params);
    case "prospect_approve":
      return handleProspectApprove(req.entityId);
    case "prospect_skip":
      return handleProspectSkip(req.entityId);
    case "send_draft":
      return handleSendDraft(req.entityId, req.params);
    default:
      return { success: false, type: req.type, message: `未知动作类型: ${req.type}` };
  }
}

// ── 1. AI 跟进邮件草稿 ──────────────────────────────────────────

async function handleFollowupDraft(
  prospectId: string,
  params?: Record<string, unknown>,
): Promise<ActionResult> {
  const prospect = await getProspect(prospectId);
  if (!prospect) {
    return { success: false, type: "followup_draft", message: "未找到该客户" };
  }

  const isSecondTouch = params?.isSecondTouch === true;
  const lastOutbound = prospect.messages
    ?.filter((m) => m.direction === "outbound")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const lastInbound = prospect.messages
    ?.filter((m) => m.direction === "inbound")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const contextParts: string[] = [];
  if (prospect.outreachSubject) contextParts.push(`首封邮件主题: ${prospect.outreachSubject}`);
  if (lastOutbound?.content) contextParts.push(`上次发出的内容（摘要）: ${lastOutbound.content.slice(0, 300)}`);
  if (lastInbound?.content) contextParts.push(`客户最近的回复: ${lastInbound.content.slice(0, 300)}`);
  if (prospect.researchReport) {
    const report = typeof prospect.researchReport === "string"
      ? prospect.researchReport
      : JSON.stringify(prospect.researchReport);
    contextParts.push(`客户研究摘要: ${report.slice(0, 500)}`);
  }

  const followupType = isSecondTouch ? "二次触达" : "跟进";
  const daysSinceContact = prospect.lastContactAt
    ? Math.floor((Date.now() - prospect.lastContactAt.getTime()) / 86_400_000)
    : null;

  const raw = await createCompletion({
    systemPrompt: `你是专业外贸${followupType}邮件写手。根据上下文生成一封个性化的${followupType}邮件。

要求：
1. 正文用英文撰写${prospect.country ? `（客户位于${prospect.country}）` : ""}，同时附中文翻译
2. 主题行简洁，${isSecondTouch ? "不要重复首封邮件主题，换个角度切入" : "提及上次沟通"}
3. 正文 100-180 词，${isSecondTouch ? "从新的角度引起兴趣，不要让客户觉得被骚扰" : "简要回顾上次联系，提供新价值点，给出明确 CTA"}
4. 语气专业友好，不卑不亢
5. 不要虚构事实

返回 JSON：{"subject":"英文主题","body":"英文正文","subjectZh":"中文主题","bodyZh":"中文正文"}`,
    userPrompt: `客户: ${prospect.companyName}
联系人: ${prospect.contactName || "未知"}
国家: ${prospect.country || "未知"}
当前阶段: ${prospect.stage}
${daysSinceContact !== null ? `距上次联系: ${daysSinceContact} 天` : ""}
${contextParts.length > 0 ? `\n历史上下文:\n${contextParts.join("\n")}` : ""}`,
    mode: "normal",
    temperature: 0.5,
  });

  let draft: EmailDraft;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    draft = {
      ...parsed,
      to: prospect.contactEmail || undefined,
      prospectId: prospect.id,
      companyName: prospect.companyName,
    };
  } catch {
    draft = {
      subject: "",
      body: raw,
      subjectZh: "",
      bodyZh: "",
      to: prospect.contactEmail || undefined,
      prospectId: prospect.id,
      companyName: prospect.companyName,
    };
  }

  return {
    success: true,
    type: "followup_draft",
    message: `已为 ${prospect.companyName} 生成${followupType}邮件草稿`,
    draft,
  };
}

// ── 2. 报价延期 ─────────────────────────────────────────────────

async function handleQuoteExtend(
  quoteId: string,
  params?: Record<string, unknown>,
): Promise<ActionResult> {
  const quote = await db.tradeQuote.findUnique({ where: { id: quoteId } });
  if (!quote) {
    return { success: false, type: "quote_extend", message: "未找到该报价" };
  }

  const extendDays = typeof params?.days === "number" ? params.days : 15;
  const currentExpiry = quote.expiresAt ?? new Date();
  const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(baseDate.getTime() + extendDays * 86_400_000);

  await db.tradeQuote.update({
    where: { id: quoteId },
    data: {
      expiresAt: newExpiry,
      validDays: quote.validDays + extendDays,
      status: quote.status === "expired" ? "sent" : quote.status,
    },
  });

  return {
    success: true,
    type: "quote_extend",
    message: `报价 ${quote.quoteNumber} 已延期 ${extendDays} 天，新到期日 ${newExpiry.toISOString().slice(0, 10)}`,
    updatedEntity: {
      quoteId,
      quoteNumber: quote.quoteNumber,
      newExpiresAt: newExpiry.toISOString(),
      extendDays,
    },
  };
}

// ── 3. 批准客户 → 生成开发信 ────────────────────────────────────

async function handleProspectApprove(prospectId: string): Promise<ActionResult> {
  const prospect = await getProspect(prospectId);
  if (!prospect) {
    return { success: false, type: "prospect_approve", message: "未找到该客户" };
  }

  if (prospect.stage !== "qualified") {
    return {
      success: false,
      type: "prospect_approve",
      message: `客户 ${prospect.companyName} 当前阶段为 ${prospect.stage}，无法批准`,
    };
  }

  await updateProspect(prospectId, {
    stage: "outreach_draft",
    nextFollowUpAt: new Date(Date.now() + 3 * 86_400_000),
  });

  return {
    success: true,
    type: "prospect_approve",
    message: `已批准 ${prospect.companyName}，可前往外贸看板生成开发信`,
    updatedEntity: { prospectId, companyName: prospect.companyName, newStage: "outreach_draft" },
  };
}

// ── 4. 跳过客户 ─────────────────────────────────────────────────

async function handleProspectSkip(prospectId: string): Promise<ActionResult> {
  const prospect = await getProspect(prospectId);
  if (!prospect) {
    return { success: false, type: "prospect_skip", message: "未找到该客户" };
  }

  await updateProspect(prospectId, { stage: "unqualified" });

  return {
    success: true,
    type: "prospect_skip",
    message: `已跳过 ${prospect.companyName}`,
    updatedEntity: { prospectId, companyName: prospect.companyName, newStage: "unqualified" },
  };
}

// ── 5. 确认并发送草稿邮件 ───────────────────────────────────────

async function handleSendDraft(
  prospectId: string,
  params?: Record<string, unknown>,
): Promise<ActionResult> {
  const prospect = await getProspect(prospectId);
  if (!prospect) {
    return { success: false, type: "send_draft", message: "未找到该客户" };
  }

  const to = (params?.to as string) || prospect.contactEmail;
  const subject = params?.subject as string;
  const body = params?.body as string;

  if (!to || !subject || !body) {
    return { success: false, type: "send_draft", message: "缺少收件人、主题或正文" };
  }

  const emailResult = await sendEmail({ to, subject, body });
  const emailSent = emailResult.success;

  await createMessage({
    prospectId,
    direction: "outbound",
    channel: "email",
    subject,
    content: body,
  });

  const now = new Date();
  await updateProspect(prospectId, {
    lastContactAt: now,
    outreachSentAt: prospect.outreachSentAt ?? now,
    stage: prospect.stage === "no_response" || prospect.stage === "outreach_sent"
      ? "outreach_sent"
      : prospect.stage,
    nextFollowUpAt: new Date(now.getTime() + 5 * 86_400_000),
    followUpCount: (prospect.followUpCount ?? 0) + 1,
  });

  return {
    success: true,
    type: "send_draft",
    message: emailSent
      ? `邮件已发送至 ${to}`
      : `邮件发送失败但已记录，请手动确认发送至 ${to}`,
    updatedEntity: { prospectId, emailSent, to },
  };
}
