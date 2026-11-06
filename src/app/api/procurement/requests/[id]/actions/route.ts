/**
 * POST /api/procurement/requests/{id}/actions（org_member+）：{ action, ... }
 *   MARK_READY / START_HANDOFF（事务内加锁重算 READY 与重复检查）/ CANCEL_HANDOFF
 *   COPIED_BODY / OPENED_PORTAL / VIEWED_FIELD_GUIDE（只记事件，不改变为已提交）
 *   REPORT_SUBMISSION { submittedAt, channel, actualFeeCents, feeCurrency, submissionReference, text, receiptAttachmentId? }
 *   REPORT_UNKNOWN { knownFacts[], pendingChecks[]? }（不自动重试）
 *   VERIFY_RECEIPT { attachmentId, confirm, manualVisualCheck?, submissionReference?, submittedAt? }
 *   RESOLVE_NOT_SUBMITTED { basisZh } / ARCHIVE { reason } / PATH_CHECK { kind, summaryZh } / RUN_ANALYSIS
 * 系统不代交、不代付、不发邮件；不接收任何政府账号密码、验证码或付款信息。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireRequestAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import {
  archiveDraft,
  cancelHandoff,
  markReady,
  recordHandoffAction,
  recordPathCheck,
  reportSubmission,
  reportSubmissionUnknown,
  resolveUnknownNotSubmitted,
  startHandoff,
  verifyReceipt,
  type ReportSubmissionInput,
} from "@/lib/procurement-records/requests";
import { runAnalysis } from "@/lib/procurement-records/analysis";
import { getRequestDetail } from "@/lib/procurement-records/views";

/** 拒收看起来像凭证的字段：系统不保存政府密码 / 验证码 / 会话 / 银行卡 */
const FORBIDDEN_KEYS = /pass(word)?|otp|mfa|captcha|session|cookie|token|card(number)?|cvv|cvc|iban|account_?number/i;

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  if (Object.keys(b).some((k) => FORBIDDEN_KEYS.test(k))) {
    return NextResponse.json({ error: "青砚不保存政府账号密码、验证码、会话令牌或银行卡数据", code: "CREDENTIALS_NOT_ACCEPTED" }, { status: 400 });
  }
  const action = String(b.action ?? "");
  let r: { ok: true } | { ok: false; status: number; code: string; message: string; detail?: unknown };
  switch (action) {
    case "MARK_READY":
      r = await markReady({ requestId: id, userId: user.id });
      break;
    case "START_HANDOFF":
      r = await startHandoff({ requestId: id, userId: user.id });
      break;
    case "CANCEL_HANDOFF":
      r = await cancelHandoff({ requestId: id, userId: user.id, reason: typeof b.reason === "string" ? b.reason : null });
      break;
    case "COPIED_BODY":
    case "OPENED_PORTAL":
    case "VIEWED_FIELD_GUIDE":
      r = await recordHandoffAction({ requestId: id, userId: user.id, action });
      break;
    case "REPORT_SUBMISSION": {
      const t = (b.text ?? {}) as Record<string, unknown>;
      const text: ReportSubmissionInput["text"] =
        t.mode === "SAME_AS_VERSION" && typeof t.versionId === "string"
          ? { mode: "SAME_AS_VERSION", versionId: t.versionId }
          : t.mode === "ACTUAL_TEXT" && typeof t.bodyEn === "string"
            ? { mode: "ACTUAL_TEXT", bodyEn: t.bodyEn }
            : { mode: "UNVERIFIED" };
      r = await reportSubmission({
        requestId: id,
        userId: user.id,
        submittedAt: String(b.submittedAt ?? ""),
        channel: String(b.channel ?? ""),
        actualFeeCents: typeof b.actualFeeCents === "number" ? b.actualFeeCents : null,
        feeCurrency: typeof b.feeCurrency === "string" ? b.feeCurrency : null,
        submissionReference: typeof b.submissionReference === "string" ? b.submissionReference : null,
        text,
        receiptAttachmentId: typeof b.receiptAttachmentId === "string" ? b.receiptAttachmentId : null,
      });
      break;
    }
    case "REPORT_UNKNOWN":
      r = await reportSubmissionUnknown({ requestId: id, userId: user.id, knownFacts: Array.isArray(b.knownFacts) ? (b.knownFacts as unknown[]).map(String) : [], pendingChecks: Array.isArray(b.pendingChecks) ? (b.pendingChecks as unknown[]).map(String) : undefined });
      break;
    case "VERIFY_RECEIPT":
      r = await verifyReceipt({ requestId: id, userId: user.id, attachmentId: String(b.attachmentId ?? ""), confirm: b.confirm === true, manualVisualCheck: b.manualVisualCheck === true, submissionReference: typeof b.submissionReference === "string" ? b.submissionReference : null, submittedAt: typeof b.submittedAt === "string" ? b.submittedAt : null });
      break;
    case "RESOLVE_NOT_SUBMITTED":
      r = await resolveUnknownNotSubmitted({ requestId: id, userId: user.id, basisZh: String(b.basisZh ?? "") });
      break;
    case "ARCHIVE":
      r = await archiveDraft({ requestId: id, userId: user.id, reason: String(b.reason ?? "") });
      break;
    case "PATH_CHECK":
      if (b.kind !== "publicRecords" && b.kind !== "completedAti") return NextResponse.json({ error: "kind 无效", code: "INVALID_KIND" }, { status: 400 });
      r = await recordPathCheck({ requestId: id, userId: user.id, kind: b.kind, summaryZh: String(b.summaryZh ?? "") });
      break;
    case "RUN_ANALYSIS":
      r = await runAnalysis({ requestId: id, userId: user.id, trigger: "USER" });
      break;
    default:
      return NextResponse.json({ error: `未知操作：${action}`, code: "INVALID_ACTION" }, { status: 400 });
  }
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, result: r, request: await getRequestDetail(id) });
});
