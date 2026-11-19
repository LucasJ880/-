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
import { isStageAutoAdvanceSwitchedOn } from "@/lib/tender/stage-auto-flags";
import { hasGmailComposeScope, sendGmail, type EmailAttachment } from "@/lib/google-email";
import { markItemSent } from "@/lib/inquiry/service";
import { INQUIRY_STATUS } from "@/lib/inquiry/types";
import { formatRfqContactNotes } from "./inbound-contract";
import { hashRfqPayloadItems, readTenderRfqSettings, resolveSender } from "./round-pure";
import { RFQ_IDENTITY_GUARD_VERSION, type TenderSendRfqPayload } from "./types";
import { loadProjectIdentity } from "@/lib/bid-workflow/project-identity-sources";
import { describeIdentityHits, scanOutboundRfqEmail } from "@/lib/bid-workflow/project-identity-deny";
import { logAudit } from "@/lib/audit/logger";
import { RFQ_ATTACHMENT_EXEC_FAILED_ZH, readPayloadAttachment, sha256Hex } from "./attachment";
import { rebuildFailureForExec, rebuildRfqAttachment, renderRfqAttachmentPdf } from "./attachment-service";

/** CHAIN-4a：带附件的卡发出至少一封后写的审计 */
export const RFQ_ATTACHMENT_SENT_AUDIT_ACTION = "tender.rfq_attachment_sent" as const;

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
  // CHAIN-4a：载荷里有附件字段但读不出来（形状不对）→ 不猜，整张卡拒发
  const attachment = readPayloadAttachment(payload);
  if (payload.attachment !== undefined && !attachment) {
    return { ok: false, error: "询价附件信息不完整，拒绝执行", errorCode: "RFQ_PAYLOAD_INVALID" };
  }
  if (hashRfqPayloadItems(payload.items, attachment) !== payload.rfqDocHash) {
    return { ok: false, error: "询价内容与审批时不一致，拒绝执行", errorCode: "RFQ_PAYLOAD_TAMPERED" };
  }

  const project = await db.project.findUnique({ where: { id: payload.projectId }, select: { orgId: true, name: true, org: { select: { settingsJson: true } } } });
  if (!project) return { ok: false, error: "项目不存在", errorCode: "PROJECT_NOT_FOUND" };
  if (ctx.orgId && project.orgId !== ctx.orgId) return { ok: false, error: "跨组织动作，拒绝执行", errorCode: "CROSS_ORG" };

  // CHAIN-4b：发第一封之前复核招标身份。防护上线前起草的卡（没有标记）一律拒发；
  // 有标记的按执行时的项目资料与当前分析重建禁出清单，逐家再查（标题全查、正文不查项目名称）。
  // 两种拒发都不发任何一封、不动询价项状态。催单 / 追问卡不走这里。
  if (payload.identityGuard !== RFQ_IDENTITY_GUARD_VERSION) {
    return {
      ok: false,
      error: "这张询价卡在询价身份防护上线前起草，可能带有项目名或招标编号，请驳回后重新起草",
      errorCode: "RFQ_IDENTITY_UNGUARDED",
    };
  }
  const identity = await loadProjectIdentity(payload.projectId);
  const identityHits = identity ? payload.items.flatMap((it, i) => scanOutboundRfqEmail(identity.denyList, it, `第 ${i + 1} 家`)) : [];
  if (identityHits.length) {
    return {
      ok: false,
      error: `询价内容含招标身份信息（命中：${describeIdentityHits(identityHits)}），整张卡拒发，请驳回后重新起草`,
      errorCode: "RFQ_IDENTITY_LEAK",
    };
  }

  // 发件账号：组织配置的授权邮箱（mailboxEmail，从 org settings 读，不信 payload）；From / Reply-To 仍是 payload.fromEmail
  const { mailboxEmail } = readTenderRfqSettings(project.org?.settingsJson);
  const providers = await db.emailProvider.findMany({
    where: { type: "gmail", accountEmail: { equals: mailboxEmail, mode: "insensitive" } },
    select: { userId: true, accountEmail: true, grantedScopes: true },
  });
  const sender = resolveSender(providers, mailboxEmail, hasGmailComposeScope);
  if (!sender.ok) return { ok: false, error: sender.message, errorCode: sender.errorCode };

  // CHAIN-4a：带附件的卡——按执行时的资料重排、比对内容指纹，一致才生成 PDF；任何一步不过都一封不发、不动询价项。
  // 放在发件账号检查之后（发不出去的卡不白生成一次 PDF）；询价项都已发过（重放）时不再生成。
  // 不带附件的卡不做这一步，发出的邮件也不带附件。
  let attachments: EmailAttachment[] | null = null;
  if (attachment) {
    const pendingCount = await db.inquiryItem.count({ where: { id: { in: payload.items.map((i) => i.inquiryItemId) }, status: "pending" } });
    if (pendingCount > 0) {
      const rebuilt = await rebuildRfqAttachment(payload, attachment);
      if (!rebuilt.ok) {
        const f = rebuildFailureForExec(rebuilt);
        return { ok: false, error: f.message, errorCode: f.errorCode };
      }
      const rendered = await renderRfqAttachmentPdf(rebuilt.html);
      if (!rendered.ok) return { ok: false, error: RFQ_ATTACHMENT_EXEC_FAILED_ZH, errorCode: "RFQ_ATTACHMENT_FAILED" };
      attachments = [{ filename: attachment.filename, mimeType: attachment.mimeType, data: rendered.pdf }];
    }
  }

  const send = deps.send ?? sendGmail;
  const from = `"${payload.fromName.replace(/"/g, "")}" <${payload.fromEmail}>`;
  const sent: string[] = [];
  let newlySent = 0; // 这一次真的发出的（不含「此前已发」）
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
    // CHAIN-4a：带附件的卡在附件没准备好时绝不发出（不降级为不带附件发）
    if (attachment && !attachments) {
      failed.push({ supplierName: item.supplierName, error: "询价附件没有生成" });
      continue;
    }
    try {
      const { messageId, threadId } = await send(sender.userId, {
        to: item.to,
        from,
        subject: item.subject,
        body: item.body,
        replyTo: payload.fromEmail,
        contentType: "text",
        // CHAIN-4a：不带附件时不写这个键，发信参数与本功能之前相同
        ...(attachments ? { attachments } : {}),
      });
      await markItemSent({ projectId: payload.projectId, inquiryId: payload.inquiryId, itemId: item.inquiryItemId }, { sentVia: "email" });
      // threadId 是 P1-4 回信入站的唯一匹配键（formatRfqContactNotes / parseRfqThreadId 成对）
      await db.inquiryItem.update({
        where: { id: item.inquiryItemId },
        data: { contactNotes: formatRfqContactNotes(messageId, threadId, new Date()) },
      });
      sent.push(item.supplierName);
      newlySent += 1;
    } catch (err) {
      failed.push({ supplierName: item.supplierName, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // CHAIN-4a：这一次真的发出了至少一封带附件的 → 记一条审计（PDF 字节的 SHA-256，不记内容）
  if (attachment && attachments && newlySent > 0) {
    await logAudit({
      userId: ctx.userId,
      orgId: project.orgId ?? undefined,
      projectId: payload.projectId,
      action: RFQ_ATTACHMENT_SENT_AUDIT_ACTION,
      targetType: "tender_rfq_round",
      targetId: payload.inquiryId,
      afterData: {
        roundNumber: payload.roundNumber,
        filename: attachment.filename,
        pages: attachment.pages,
        sizeBytes: attachments[0].data.length,
        pdfSha256: sha256Hex(attachments[0].data),
        contentHash: attachment.contentHash,
        sentCount: newlySent,
      },
    });
  }

  if (sent.length > 0) {
    await db.projectInquiry.update({ where: { id: payload.inquiryId }, data: { status: INQUIRY_STATUS.IN_PROGRESS } }).catch(() => undefined);
    // FLOW-H1c：这一次真的发出了至少一家 → 阶段记录到达「供应商询价」并收建阶段任务（开关关闭时不加载、不查库）；下面原有的写入照旧
    if (newlySent > 0 && isStageAutoAdvanceSwitchedOn()) {
      await import("@/lib/tender/stage-auto")
        .then((m) => m.recordStageReached({ projectId: payload.projectId, trigger: "rfq_sent", actorId: ctx.userId }))
        .catch((err) => console.error("[StageAuto] rfq_sent failed:", err));
    }
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
