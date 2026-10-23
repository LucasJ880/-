/**
 * Tender RFQ（P1-7）— 催单 / 追问批准后执行：作为原询价 Gmail 线程的回复发出 → contactNotes 追加 chase#N
 *
 * 安全（同 P1-3 execute.ts）：
 *   - 只用组织配置的授权邮箱发出（org settings 的 mailboxEmail 查 EmailProvider，不信 payload），与审批人无关；
 *     From / Reply-To 显示 payload.fromEmail（如 project@，可以是授权账号的 Gmail 别名）；
 *   - bodyHash 与执行时重算一致，否则拒绝（防止审批后被改）；
 *   - 没有 threadId 不发（P1-3 之前发的询价不自动催）；
 *   - 批准时对方已回复 / 已追问过 → 不发（状态是执行时重读的）；
 *   - sendGmail 内部已有 assertSideEffectOrThrow("email")：非生产默认 SIDE_EFFECT_DISABLED。
 *
 * 线程回复是硬要求：threadId 进 messages.send；In-Reply-To / References 取原询价邮件的 Message-ID 头
 * （P1-3 没存，执行时 messages.get(format=metadata) 取一次）；取不到只带 threadId 发，并在 notes 注明。
 */

import type { sendGmail } from "@/lib/google-email";
import { appendContactNote, formatChaseNote, hashChaseBody, parseChaseNotes, parseRfqMessageId } from "./chase-pure";
import { parseRfqThreadId } from "./inbound-contract";
import { readTenderRfqSettings, resolveSender, type SenderProvider } from "./round-pure";
import type { TenderSendChasePayload } from "./types";

export type ExecTenderSendChaseContext = { userId: string; role: string | null | undefined; orgId?: string | null };
export type ExecTenderSendChaseResult = { ok: boolean; resultRef?: string; message?: string; error?: string; errorCode?: string };

export type ChaseExecuteIo = {
  now: () => Date;
  loadProject: (projectId: string) => Promise<{ orgId: string | null; settingsJson: unknown } | null>;
  loadItem: (itemId: string) => Promise<{ status: string; contactNotes: string | null; inquiryId: string } | null>;
  findProviders: (mailboxEmail: string) => Promise<SenderProvider[]>;
  hasComposeScope: (scopes: string | null) => boolean;
  /** 原询价邮件的 RFC 822 Message-ID；取不到 / 没有读权限 → null */
  getMessageIdHeader: (userId: string, gmailMessageId: string) => Promise<string | null>;
  send: typeof sendGmail;
  saveContactNotes: (itemId: string, contactNotes: string) => Promise<void>;
};

export async function execTenderSendChase(
  payload: TenderSendChasePayload,
  ctx: ExecTenderSendChaseContext,
  io?: Partial<ChaseExecuteIo>,
): Promise<ExecTenderSendChaseResult> {
  const d: ChaseExecuteIo = { ...(await defaultChaseExecuteIo()), ...io };

  if (!payload?.projectId || !payload.inquiryItemId || !payload.to || !payload.subject || !payload.body) {
    return { ok: false, error: "催单 payload 不完整，拒绝执行", errorCode: "CHASE_PAYLOAD_INVALID" };
  }
  if (hashChaseBody(payload) !== payload.bodyHash) {
    return { ok: false, error: "催单内容与审批时不一致，拒绝执行", errorCode: "CHASE_PAYLOAD_TAMPERED" };
  }
  if (!payload.threadId) {
    return { ok: false, error: "这家的询价没有邮件线程，不能自动催，请手工联系", errorCode: "CHASE_NO_THREAD" };
  }

  const project = await d.loadProject(payload.projectId);
  if (!project) return { ok: false, error: "项目不存在", errorCode: "PROJECT_NOT_FOUND" };
  if (ctx.orgId && project.orgId !== ctx.orgId) return { ok: false, error: "跨组织动作，拒绝执行", errorCode: "CROSS_ORG" };

  const item = await d.loadItem(payload.inquiryItemId);
  if (!item || item.inquiryId !== payload.inquiryId) return { ok: false, error: "询价项已不存在", errorCode: "ITEM_NOT_FOUND" };
  if (parseRfqThreadId(item.contactNotes) !== payload.threadId) {
    return { ok: false, error: "询价线程与审批时不一致，拒绝执行", errorCode: "CHASE_THREAD_MISMATCH" };
  }
  // 重放 / 过时保护：执行时重读状态
  const done = parseChaseNotes(item.contactNotes);
  if (payload.kind === "no_reply") {
    if (item.status !== "sent") return { ok: true, resultRef: payload.inquiryItemId, message: `${payload.supplierName} 已回复（${item.status}），这封催单没有发出` };
    if (done.some((c) => c.kind === "no_reply" && c.index >= payload.chaseIndex)) {
      return { ok: true, resultRef: payload.inquiryItemId, message: `第 ${payload.chaseIndex} 次催单此前已发出，未重复发送` };
    }
  } else {
    if (item.status !== "replied" && item.status !== "quoted") {
      return { ok: false, error: `当前状态「${item.status}」不需要追问`, errorCode: "CHASE_NOT_APPLICABLE" };
    }
    if (done.some((c) => c.kind === "missing_fields")) {
      return { ok: true, resultRef: payload.inquiryItemId, message: "这家已追问过缺字段，未重复发送" };
    }
  }

  const { mailboxEmail } = readTenderRfqSettings(project.settingsJson);
  const sender = resolveSender(await d.findProviders(mailboxEmail), mailboxEmail, d.hasComposeScope);
  if (!sender.ok) return { ok: false, error: sender.message, errorCode: sender.errorCode };

  const rfqMessageId = parseRfqMessageId(item.contactNotes);
  let messageIdHeader: string | null = null;
  if (rfqMessageId) {
    try {
      messageIdHeader = await d.getMessageIdHeader(sender.userId, rfqMessageId);
    } catch (err) {
      console.warn("[tender-rfq-chase] Message-ID lookup failed, sending with threadId only:", err);
    }
  }

  let sent: { messageId: string; threadId: string };
  try {
    sent = await d.send(sender.userId, {
      to: payload.to,
      from: `"${payload.fromName.replace(/"/g, "")}" <${payload.fromEmail}>`,
      subject: payload.subject,
      body: payload.body,
      replyTo: payload.fromEmail,
      threadId: payload.threadId,
      ...(messageIdHeader ? { inReplyTo: messageIdHeader, references: messageIdHeader } : {}),
    });
  } catch (err) {
    return { ok: false, error: `发送失败：${err instanceof Error ? err.message : String(err)}`, errorCode: "CHASE_SEND_FAILED" };
  }

  const note = formatChaseNote({ index: payload.chaseIndex, kind: payload.kind, messageId: sent.messageId, at: d.now(), noMessageIdHeader: !messageIdHeader });
  await d.saveContactNotes(payload.inquiryItemId, appendContactNote(item.contactNotes, note));

  const what = payload.kind === "no_reply" ? `第 ${payload.chaseIndex} 次催单` : "缺字段追问";
  return {
    ok: true,
    resultRef: payload.inquiryItemId,
    message: `已给 ${payload.supplierName} 发出${what}（回复在原询价线程${messageIdHeader ? "" : "；未取到原 Message-ID，仅按 threadId 归线程"}）`,
  };
}

async function defaultChaseExecuteIo(): Promise<ChaseExecuteIo> {
  const { db } = await import("@/lib/db");
  const google = await import("@/lib/google-email");
  return {
    now: () => new Date(),
    loadProject: async (projectId) => {
      const p = await db.project.findUnique({ where: { id: projectId }, select: { orgId: true, org: { select: { settingsJson: true } } } });
      return p ? { orgId: p.orgId, settingsJson: p.org?.settingsJson ?? null } : null;
    },
    loadItem: (itemId) => db.inquiryItem.findUnique({ where: { id: itemId }, select: { status: true, contactNotes: true, inquiryId: true } }),
    findProviders: (mailboxEmail) =>
      db.emailProvider.findMany({
        where: { type: "gmail", accountEmail: { equals: mailboxEmail, mode: "insensitive" } },
        select: { userId: true, accountEmail: true, grantedScopes: true },
      }),
    hasComposeScope: google.hasGmailComposeScope,
    getMessageIdHeader: (userId, gmailMessageId) => google.getMessageIdHeader(userId, gmailMessageId),
    send: google.sendGmail,
    saveContactNotes: async (itemId, contactNotes) => {
      await db.inquiryItem.update({ where: { id: itemId }, data: { contactNotes } });
    },
  };
}
