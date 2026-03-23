export interface TenderProject {
  createdAt: string | null;
  tenderStatus: string | null;
  publicDate: string | null;
  questionCloseDate: string | null;
  closeDate: string | null;
  dueDate: string | null;
  distributedAt: string | null;
  dispatchedAt?: string | null;
  interpretedAt: string | null;
  supplierInquiredAt: string | null;
  supplierQuotedAt: string | null;
  submittedAt: string | null;
  awardDate: string | null;
  intakeStatus?: string | null;
  sourceMetadataJson?: string | null;
}

export type TenderStage =
  | "initiation"
  | "distribution"
  | "interpretation"
  | "supplier_inquiry"
  | "supplier_quote"
  | "submission";

export type StageStatus =
  | "completed"
  | "current"
  | "upcoming"
  | "overdue"
  | "pending";

export interface StageInfo {
  key: TenderStage;
  label: string;
  status: StageStatus;
  weight: number;
}

export type TimelineEventKind = "internal" | "external" | "today";

export interface TimelineEvent {
  key: string;
  label: string;
  date: Date;
  kind: TimelineEventKind;
  status: "completed" | "active" | "upcoming" | "overdue";
  position: number;
}
