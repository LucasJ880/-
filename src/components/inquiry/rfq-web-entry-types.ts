/**
 * W-1 询价 Web 入口 — 前端用的响应类型（只含类型，零运行时）
 */
import type { EntryPreview, EntrySupplier, RfqEntryState, UserMessage } from "@/lib/tender-rfq/web-entry-pure";
import type { RfqApprovalInfo, RfqEmailPreview } from "@/lib/tender-rfq/web-entry-approval";

export type { RfqApprovalInfo, RfqEmailPreview, UserMessage };

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
};

export type RfqRoundFailed = { ok: false; errorCode: string; userMessage: UserMessage };
