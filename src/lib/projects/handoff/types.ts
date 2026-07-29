export const HANDOFF_TYPE_AWARD_TO_DELIVERY = "award_to_delivery" as const;
export type HandoffType = typeof HANDOFF_TYPE_AWARD_TO_DELIVERY;

export const HANDOFF_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const HANDOFF_TASK_SOURCE_TYPE = "project_handoff" as const;

export type HandoffFailureCode =
  | "NOT_TENDER"
  | "NOT_WON"
  | "ORG_MISMATCH"
  | "FORBIDDEN"
  | "OWNER_INVALID"
  | "ALREADY_COMPLETED"
  | "IN_PROGRESS"
  | "BID_DATA_INCOMPLETE"
  | "BID_DATA_UNAVAILABLE"
  | "OVERRIDE_REQUIRED"
  | "OVERRIDE_FORBIDDEN"
  | "VALIDATION"
  | "INTERNAL";

export type ConditionalTaskFlags = {
  insuranceOrBond: boolean;
  securityOrSiteAccess: boolean;
  siteMeasurement: boolean;
  shopDrawing: boolean;
  procurement: boolean;
  installation: boolean;
};

export type HandoffAmountInfo = {
  amount: number | null;
  currency: string | null;
  source:
    | "winning_bid_price"
    | "our_bid_price_confirmed"
    | "none";
  label: string;
  confirmed: boolean;
};

export type HandoffTaskPlanItem = {
  templateKey: string;
  title: string;
  description: string;
  conditional: boolean;
  reason: string;
};

export type HandoffDocumentRef = {
  id: string;
  title: string;
  fileType: string;
  source: string;
};

export type HandoffPreview = {
  sourceProjectId: string;
  sourceProjectName: string;
  tenderStatus: string | null;
  orgId: string;
  suggestedDeliveryName: string;
  clientOrganization: string | null;
  location: string | null;
  description: string | null;
  amount: HandoffAmountInfo;
  plannedCompletionDate: string | null;
  plannedCompletionSource: "user_required" | "none";
  suggestedOwnerId: string | null;
  suggestedOwnerName: string | null;
  documentRefs: HandoffDocumentRef[];
  baseTasks: HandoffTaskPlanItem[];
  conditionalTasks: HandoffTaskPlanItem[];
  conditionalFlags: ConditionalTaskFlags;
  missing: string[];
  warnings: string[];
  blockers: Array<{ code: HandoffFailureCode; message: string }>;
  requiresHistoricalOverride: boolean;
  bidDataSummary: {
    layerAvailable: boolean;
    hasRevisions: boolean;
    finalRevisionId: string | null;
    finalStatus: string | null;
    technicalApproved: boolean | null;
    financialApproved: boolean | null;
    locked: boolean | null;
    failureCode: "BID_DATA_UNAVAILABLE" | "BID_DATA_INCOMPLETE" | null;
  };
  existingHandoff: {
    id: string;
    status: HandoffStatus;
    targetDeliveryProjectId: string | null;
  } | null;
  canExecute: boolean;
  canOverride: boolean;
};

export type HandoffExecuteInput = {
  deliveryOwnerId: string;
  deliveryName?: string;
  description?: string | null;
  plannedCompletionDate?: string | null;
  conditionalFlags?: Partial<ConditionalTaskFlags>;
  overrideReason?: string | null;
  note?: string | null;
};

export type HandoffExecuteResult = {
  handoffId: string;
  status: HandoffStatus;
  targetDeliveryProjectId: string | null;
  created: boolean;
  message: string;
  taskCount?: number;
};
