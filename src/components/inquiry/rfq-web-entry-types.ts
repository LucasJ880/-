/**
 * W-1 询价 Web 入口 — 前端用的响应类型（只含类型，零运行时）
 */
import type { EntryPreview, EntrySupplier, RfqEntryState, UserMessage } from "@/lib/tender-rfq/web-entry-pure";
import type { RfqApprovalInfo, RfqEmailPreview } from "@/lib/tender-rfq/web-entry-approval";
import type { FollowUpCardView } from "@/lib/tender-rfq/followup-coverage";
import type { RfqEntryFollowUp } from "@/lib/tender-rfq/web-entry";

export type { RfqApprovalInfo, RfqEmailPreview, UserMessage };

/** RFQ-AUTO-1：审批卡 / 建轮次表单上展示的跟进授权（范围 + 模板预览） */
export type RfqFollowUpCardView = FollowUpCardView;
/** RFQ-AUTO-1：一轮的自动跟进状态 */
export type RfqFollowUpRoundView = RfqEntryFollowUp["rounds"][string];

export type RfqIncoterm = "EXW" | "FOB" | "CIF" | "DDP" | "DAP";

export type RfqPendingChaseView = {
  actionId: string;
  inquiryId: string;
  itemId: string;
  supplierName: string;
  kind: "no_reply" | "missing_fields";
  chaseIndex: number;
  roundNumber: number | null;
  createdAt: string;
  approval: RfqApprovalInfo | null;
  emails: RfqEmailPreview[];
};

export type RfqPendingSendView = {
  actionId: string;
  inquiryId: string;
  roundNumber: number | null;
  createdAt: string;
  approval: RfqApprovalInfo | null;
  emails: RfqEmailPreview[];
};

export type RfqEntryView =
  | { available: false; reason: string }
  | {
      available: true;
      state: RfqEntryState;
      suppliers: EntrySupplier[];
      defaults: { incoterm: RfqIncoterm | null; incotermFromPrefs: boolean };
      preview: EntryPreview;
      pendingSends: RfqPendingSendView[];
      /** T-1：待批的催单 / 追问卡（每张一封） */
      pendingChases: RfqPendingChaseView[];
      engineRounds: Record<string, { elapsed: string | null }>;
      autoIngest: UserMessage;
      timeZone: string;
      /** RFQ-AUTO-1：开关关闭时为 null */
      followUp: RfqEntryFollowUp | null;
      /** RFQ-AUTO-2：由系统起草的轮次（inquiryId → 卡上的那句说明）；开关关闭时没有这个字段 */
      autoDraftedRounds?: Record<string, { noteZh: string }>;
      /** RFQ-AUTO-3：本人的开关「自动起草的轮次带跟进授权」；两个功能开关任一关闭时没有这个字段 */
      autoDraftFollowUp?: { enabled: boolean };
    };

export type RfqRoundCreated = {
  ok: true;
  actionId: string;
  inquiryId: string;
  roundNumber: number;
  fromEmail: string;
  replyBy: string | null;
  suppliers: Array<{ id: string; name: string; to: string }>;
  blockedSuppliers: Array<{ id: string; name: string; reason: "no_email" | "inactive" }>;
  excludedRequirements: number;
  incoterm: RfqIncoterm | null;
  approval: RfqApprovalInfo | null;
  emails: RfqEmailPreview[];
  /** RFQ-AUTO-1：这张卡带的跟进授权；没带 = null */
  followUp?: RfqFollowUpCardView | null;
};

export type RfqRoundFailed = { ok: false; errorCode: string; userMessage: UserMessage };
