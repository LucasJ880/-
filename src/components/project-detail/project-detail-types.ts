/**
 * 项目详情页共享类型（T1A 5-tab 拆分后由 page 与各 tab 组件共用）。
 * 形状对应 GET /api/projects/[id] 的业务投影，不新增后端字段。
 */

import type { ProjectDuty } from "@/lib/projects/duty";
import type { TenderProject } from "@/lib/tender/types";
import { isTenderProject as isTenderWorkDomain } from "@/lib/projects/work-domain";

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  color: string;
  status: string;
  orgId: string | null;
  owner: { id: string; name: string; email: string };
  purchaserId?: string | null;
  purchaser?: { id: string; name: string; email: string } | null;
  org: {
    id: string;
    name: string;
    code: string;
    status: string;
  } | null;
  _count: { tasks: number; members: number };
  // BidToGo / tender fields
  category?: string | null;
  sourceSystem?: string | null;
  sourcePlatform?: string | null;
  clientOrganization?: string | null;
  location?: string | null;
  estimatedValue?: number | null;
  currency?: string | null;
  solicitationNumber?: string | null;
  tenderStatus?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  publicDate?: string | null;
  questionCloseDate?: string | null;
  closeDate?: string | null;
  openDate?: string | null;
  distributedAt?: string | null;
  dispatchedAt?: string | null;
  intakeStatus?: string | null;
  interpretedAt?: string | null;
  supplierInquiredAt?: string | null;
  supplierQuotedAt?: string | null;
  submittedAt?: string | null;
  awardDate?: string | null;
  abandonedAt?: string | null;
  abandonedStage?: string | null;
  abandonedReason?: string | null;
  sourceMetadataJson?: string | null;
  externalRef?: { system: string; externalId: string; url: string | null } | null;
  intelligence?: {
    recommendation: string;
    riskLevel: string;
    fitScore: number;
    summary: string | null;
    fullReportUrl: string | null;
    fullReportJson: string | null;
    reportMarkdown: string | null;
    reportStatus?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    reviewNotes?: string | null;
    reviewScore?: number | null;
  } | null;
  documents?: Array<{
    id: string;
    title: string;
    url: string;
    fileType: string;
    parseStatus?: string | null;
  }>;
  bidPhaseStatus?: string | null;
  /** AI 建议态（与人工 goDecision 分离，不作真相来源） */
  aiAdviceStatus?: string | null;
  /** false = 当前环境尚未 migrate / 投标智能不可用 */
  intelligenceAvailable?: boolean;
  intelligenceRoom?: {
    id: string;
    goDecision: string | null;
    summaryStatus: string | null;
    summaryText: string | null;
  } | null;
  workDomain?: string | null;
}

export interface MemberRow {
  id: string;
  userId: string;
  role: string;
  duty: ProjectDuty;
  status: string;
  orgRole: string | null;
  user: {
    id: string;
    email: string;
    name: string;
    avatar?: string | null;
    nickname?: string | null;
  };
}

export interface ProjectHandoffInfo {
  status: string;
  targetDeliveryProjectId: string | null;
}

export function buildTenderProps(project: ProjectDetail): TenderProject {
  return {
    createdAt: project.createdAt ?? null,
    tenderStatus: project.tenderStatus ?? null,
    publicDate: project.publicDate ?? null,
    questionCloseDate: project.questionCloseDate ?? null,
    closeDate: project.closeDate ?? null,
    openDate: project.openDate ?? null,
    dueDate: project.dueDate ?? null,
    distributedAt: project.distributedAt ?? null,
    dispatchedAt: project.dispatchedAt ?? null,
    interpretedAt: project.interpretedAt ?? null,
    supplierInquiredAt: project.supplierInquiredAt ?? null,
    supplierQuotedAt: project.supplierQuotedAt ?? null,
    submittedAt: project.submittedAt ?? null,
    awardDate: project.awardDate ?? null,
    intakeStatus: project.intakeStatus ?? null,
    sourceMetadataJson: project.sourceMetadataJson ?? null,
  };
}

/**
 * 招投标项目判定。
 *
 * Canonical source（与后端 Package Analysis gate 对齐）：
 *   Project.workDomain === "tender"
 *
 * 旧字段（sourceSystem/tenderStatus/category）仅作历史项目兼容 fallback，
 * 不得成为新项目的 Tender 身份来源。
 */
export function isTenderProject(project: ProjectDetail): boolean {
  if (isTenderWorkDomain(project.workDomain)) return true;
  // legacy compatibility only（历史 bidtogo / 旧 tender 项目）
  return (
    project.sourceSystem === "bidtogo" ||
    Boolean(project.tenderStatus) ||
    project.category === "tender_opportunity"
  );
}
