/**
 * Tender RFQ（P1-3）— 批准后执行：Gmail 发送 → markItemSent → 轮次 in_progress
 *
 * 安全：
 *   - 只用组织配置的授权邮箱发出（settings.mailboxEmail 查 EmailProvider），与审批人无关；
 *     From / Reply-To 显示 payload.fromEmail（可以是该账号的 Gmail 别名，如 project@）；
 *   - payload 内容 hash 与执行时重算一致，否则拒绝（防止审批后被改）；
 *   - 逐封发送、逐封记录；某家失败不回滚已发出的（邮件发出即不可撤回），结果如实列出。
 *   - sendGmail 内部已有 assertSideEffectOrThrow("email")：非生产默认 SIDE_EFFECT_DISABLED。
 */

import { db } from "@/lib/db";
import { hasGmailComposeScope, sendGmail } from "@/lib/google-email";
import { markItemSent } from "@/lib/inquiry/service";
import { INQUIRY_STATUS } from "@/lib/inquiry/types";
import { formatRfqContactNotes } from "./inbound-contract";
import { hashRfqPayloadItems, readTenderRfqSettings, resolveSender } from "./round-pure";
import type { TenderSendRfqPayload } from "./types";

export type ExecTenderSendRfqContext = { userId: string; role: string | null | undefined; orgId?: string | null };
export type ExecTenderSendRfqResult = { ok: boolean; resultRef?: string; message?: string; error?: string; errorCode?: string };

export async function execTenderSendRfq(
  payload: TenderSendRfqPayload,
  ctx: ExecTenderSendRfqContext,
  deps: { send?: typeof sendGmail } = {},
): Promise<ExecTenderSendRfqResult> {
  if (!payload?.projectId || !payload.inquiryId || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, error: "询价 payload 不完整，拒绝执行", errorCode: "RFQ_PAYLOAD_INVALID" };
  }
  if (hashRfqPayloadItems(payload.items) !== payload.rfqDocHash) {
    return { ok: false, error: "询价内容与审批时不一致，拒绝执行", errorCode: "RFQ_PAYLOAD_TAMPERED" };
  }

  const project = await db.project.findUnique({ where: { id: payload.projectId }, select: { orgId: true, name: true, org: { select: { settingsJson: true } } } });
  if (!project) return { ok: false, error: "项目不存在", errorCode: "PROJECT_NOT_FOUND" };
  if (ctx.orgId && project.orgId !== ctx.orgId) return { ok: false, error: "跨组织动作，拒绝执行", errorCode: "CROSS_ORG" };

  // 发件账号：组织配置的授权邮箱（mailboxEmail，从 org settings 读，不信 payload）；From / Reply-To 仍是 payload.fromEmail
  const { mailboxEmail } = readTenderRfqSettings(project.org?.settingsJson);
  const providers = await db.emailProvider.findMany({
    where: { type: "gmail", accountEmail: { equals: mailboxEmail, mode: "insensitive" } },
    select: { userId: true, accountEmail: true, grantedScopes: true },
  });
  const sender = resolveSender(providers, mailboxEmail, hasGmailComposeScope);
  if (!sender.ok) return { ok: false, error: sender.message, errorCode: sender.errorCode };

  const send = deps.send ?? sendGmail;
  const from = `"${payload.fromName.replace(/"/g, "")}" <${payload.fromEmail}>`;
  const sent: string[] = [];
  const failed: Array<{ supplierName: string; error: string }> = [];

  for (const item of payload.items) {
    // 已发过的跳过（重放保护，与 markItemSent 的状态机一致）
    const current = await db.inquiryItem.findUnique({ where: { id: item.inquiryItemId }, select: { status: true } });
    if (!current) {
      failed.push({ supplierName: item.supplierName, error: "询价项已不存在" });
      continue;
    }
    if (current.status !== "pending") {
      sent.push(`${item.supplierName}（此前已发）`);
      continue;
    }
    try {
      const { messageId, threadId } = await send(sender.userId, { to: item.to, from, subject: item.subject, body: item.body, replyTo: payload.fromEmail, contentType: "text" });
      await markItemSent({ projectId: payload.projectId, inquiryId: payload.inquiryId, itemId: item.inquiryItemId }, { sentVia: "email" });
      // threadId 是 P1-4 回信入站的唯一匹配键（formatRfqContactNotes / parseRfqThreadId 成对）
      await db.inquiryItem.update({
        where: { id: item.inquiryItemId },
        data: { contactNotes: formatRfqContactNotes(messageId, threadId, new Date()) },
      });
      sent.push(item.supplierName);
    } catch (err) {
      failed.push({ supplierName: item.supplierName, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (sent.length > 0) {
    await db.projectInquiry.update({ where: { id: payload.inquiryId }, data: { status: INQUIRY_STATUS.IN_PROGRESS } }).catch(() => undefined);
    await db.project.update({ where: { id: payload.projectId }, data: { supplierInquiredAt: new Date() } }).catch(() => undefined);
    // P1-8：批准人（操作者）没有默认贸易条款时，记下这轮用的（best-effort，不影响发送结果）
    if (project.orgId && payload.incoterm) {
      const { learnIncotermPreference } = await import("@/lib/muse-bridge/prefs");
      await learnIncotermPreference({ orgId: project.orgId, userId: ctx.userId, incoterm: payload.incoterm });
    }
  }

  const summary = `已发出 ${sent.length}/${payload.items.length}：${sent.join("、") || "无"}` + (failed.length ? `；失败：${failed.map((f) => `${f.supplierName}（${f.error}）`).join("、")}` : "");
  if (sent.length === 0) return { ok: false, error: summary, errorCode: "RFQ_ALL_FAILED" };
  return { ok: true, resultRef: payload.inquiryId, message: summary };
}
