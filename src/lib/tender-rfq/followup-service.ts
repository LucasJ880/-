/**
 * RFQ-AUTO-1 跟进授权（DB 侧）：停止一轮的自动跟进、读轮次页要显示的状态。
 *
 * 停止 = 一条审计记录（记录即状态，零 schema）；不可恢复——恢复等于重新授权，那应当由人重新逐张批。
 * 本文件不发信、不建审批卡。
 */
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { FOLLOWUP_AUDIT_TARGET, loadFollowUpRoundState } from "./chase-service";
import { FOLLOWUP_AUTO_SEND_AUDIT_ACTION, FOLLOWUP_STOP_AUDIT_ACTION, describeRoundFollowUp, parseFollowUpPolicy, type RoundFollowUpDisplay } from "./followup-coverage";
import { isRfqFollowUpPreapprovalEnabledForOrg } from "./followup-flags";
import { TENDER_SEND_RFQ_TYPE } from "./types";

export type StopFollowUpResult =
  | { ok: true; alreadyStopped: boolean }
  | { ok: false; errorCode: "DISABLED" | "ROUND_NOT_FOUND" | "NO_POLICY"; message: string };

/** 调用方负责项目写权限；这里只认「这一轮属于这个组织的这个项目，且批准时带了授权」。 */
export async function stopRoundFollowUp(input: { orgId: string; projectId: string; inquiryId: string; userId: string }): Promise<StopFollowUpResult> {
  if (!isRfqFollowUpPreapprovalEnabledForOrg(input.orgId)) return { ok: false, errorCode: "DISABLED", message: "自动跟进未开启。" };
  const inquiry = await db.projectInquiry.findFirst({
    where: { id: input.inquiryId, projectId: input.projectId, project: { orgId: input.orgId } },
    select: { id: true, roundNumber: true },
  });
  if (!inquiry) return { ok: false, errorCode: "ROUND_NOT_FOUND", message: "没找到这一轮询价。" };
  const card = await db.pendingAction.findFirst({
    where: { orgId: input.orgId, type: TENDER_SEND_RFQ_TYPE, payload: { path: ["inquiryId"], equals: inquiry.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true },
  });
  const policy = parseFollowUpPolicy((card?.payload as { followUpPolicy?: unknown } | null)?.followUpPolicy);
  if (!card || !policy) return { ok: false, errorCode: "NO_POLICY", message: "这一轮批准时没有带自动跟进，催单本来就是逐张批。" };

  const existing = await db.auditLog.findFirst({
    where: { orgId: input.orgId, action: FOLLOWUP_STOP_AUDIT_ACTION, targetType: FOLLOWUP_AUDIT_TARGET, targetId: inquiry.id },
    select: { id: true },
  });
  if (existing) return { ok: true, alreadyStopped: true };
  // 停止必须留痕：审计写不进去就算失败（不用吞错的 logAudit）
  await writeAuditLog(db, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: FOLLOWUP_STOP_AUDIT_ACTION,
    targetType: FOLLOWUP_AUDIT_TARGET,
    targetId: inquiry.id,
    afterData: { roundNumber: inquiry.roundNumber, roundActionId: card.id, policy },
  });
  return { ok: true, alreadyStopped: false };
}

export type RoundFollowUpStatus = RoundFollowUpDisplay & {
  /** 已自动执行并确实发出的封数 */
  autoSentCount: number;
};

/** 轮次页要显示的自动跟进状态。开关关闭 → 每一轮都是 none，且不查库。 */
export async function loadRoundFollowUpStatus(orgId: string, inquiryIds: readonly string[]): Promise<Map<string, RoundFollowUpStatus>> {
  const out = new Map<string, RoundFollowUpStatus>();
  if (!isRfqFollowUpPreapprovalEnabledForOrg(orgId)) {
    for (const id of inquiryIds) out.set(id, { state: "none", autoSentCount: 0 });
    return out;
  }
  for (const inquiryId of inquiryIds) {
    const st = await loadFollowUpRoundState(orgId, inquiryId);
    const display = describeRoundFollowUp({ flagEnabled: st.flagEnabled, roundCard: st.roundCard, approverActive: st.approver.active, inquiryStatus: st.inquiryStatus, stopped: st.stopped });
    let autoSentCount = 0;
    if (display.state !== "none") {
      const rows = await db.auditLog.findMany({
        where: { orgId, action: FOLLOWUP_AUTO_SEND_AUDIT_ACTION, targetType: FOLLOWUP_AUDIT_TARGET, targetId: inquiryId },
        select: { afterData: true },
      });
      // 按催单卡去重：并发的两次扫描可能各写一条审计，但同一张卡只会发出一封
      const sentCards = new Set<string>();
      for (const r of rows) {
        try {
          const d = JSON.parse(r.afterData ?? "{}") as { sent?: boolean; chaseActionId?: string };
          if (d.sent === true && d.chaseActionId) sentCards.add(d.chaseActionId);
        } catch {
          // 坏数据不计
        }
      }
      autoSentCount = sentCards.size;
    }
    out.set(inquiryId, { ...display, autoSentCount });
  }
  return out;
}
