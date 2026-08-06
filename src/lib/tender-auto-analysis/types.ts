/**
 * Phase 1.1 Tender Auto Analysis — 共享 TypeScript 类型
 */

import type {
  ChangeCandidateStatus,
  ChangeType,
  ClarificationPriority,
  ClarificationStatus,
  ConfidenceLevel,
  DeliverableKey,
  DeliverableStatus,
  DocumentRole,
  ProjectionStatus,
  RequirementComplianceStatus,
  RequirementReviewStatus,
  SectionKey,
  SectionReviewStatus,
  StatementKind,
  TenderAnalysisRunKind,
  TenderAnalysisStatus,
  WorkerStep,
} from "./constants";

export type CanAutoEnqueueInput = {
  workDomain: string | null | undefined;
  hasIntelligenceRoom: boolean;
};

export type CanAutoEnqueueResult = {
  ok: boolean;
  reason: "tender_domain" | "intelligence_room" | "gate_closed";
};

export type BuildIdempotencyKeyInput = {
  projectId: string;
  fingerprint: string;
  promptVersion: string;
  analysisVersion: string;
};

export type SourceHashInput = {
  /** 有序 contentHash 列表（调用方保证排序） */
  orderedHashes: readonly string[];
};

export type TenderAnalysisRunSnapshot = {
  id: string;
  orgId: string;
  projectId: string;
  roomId: string | null;
  status: TenderAnalysisStatus;
  runKind: TenderAnalysisRunKind;
  analysisVersion: string;
  promptVersion: string;
  model: string | null;
  idempotencyKey: string;
  sourceHashFingerprint: string;
  workerStep: WorkerStep | string | null;
  workerCursor: unknown;
  summaryJson: unknown;
  summaryText: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorCode: string | null;
  errorMessageSanitized: string | null;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  parentRunId: string | null;
  supersedesRunId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  nextAttemptAt: Date | null;
  attemptCount: number;
  tokenUsageJson: unknown;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenderAnalysisSectionInput = {
  sectionKey: SectionKey;
  contentZh: string;
  structuredJson?: unknown;
  confidence?: ConfidenceLevel;
  reviewStatus?: SectionReviewStatus;
};

export type TenderAnalysisFactInput = {
  statementKind: StatementKind;
  contentZh: string;
  contentOriginal?: string | null;
  confidence?: ConfidenceLevel;
  sectionId?: string | null;
};

export type TenderSourceRefInput = {
  documentId: string;
  pageNumber?: number | null;
  sectionLabel?: string | null;
  originalTextSnippet: string;
  extractionMethod: string;
  confidence?: ConfidenceLevel;
  factId?: string | null;
  sectionId?: string | null;
  requirementId?: string | null;
  clarificationQuestionId?: string | null;
  deliverableId?: string | null;
};

export type TenderRequirementInput = {
  requirementCode: string;
  category: string;
  originalRequirement: string;
  chineseTranslation: string;
  mandatory?: boolean;
  evidenceRequired?: boolean;
  complianceStatus?: RequirementComplianceStatus;
  reviewStatus?: RequirementReviewStatus;
  ownerId?: string | null;
  sourcePage?: number | null;
  projectionStatus?: ProjectionStatus;
};

export type TenderDeliverableInput = {
  deliverableKey: DeliverableKey | string;
  title: string;
  mandatory?: boolean;
  sourcePage?: number | null;
  ownerId?: string | null;
  dueAt?: Date | null;
  status?: DeliverableStatus;
  relatedDocumentId?: string | null;
};

export type TenderClarificationInput = {
  question: string;
  reason: string;
  priority?: ClarificationPriority;
  enquiryDeadline?: Date | null;
  status?: ClarificationStatus;
};

export type TenderChangeCandidateInput = {
  changeType: ChangeType;
  entityType: string;
  entityKey?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  summaryZh: string;
  parentRunId?: string | null;
  status?: ChangeCandidateStatus;
};

export type RunDocumentLink = {
  documentId: string;
  contentHash: string;
  role: DocumentRole;
};
