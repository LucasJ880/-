import { db } from "@/lib/db";
import { PROJECT_WORK_DOMAIN } from "@/lib/projects/work-domain";
import { resolveHandoffContractAmount } from "./amount";
import { inspectBidDataGate } from "./bid-data";
import { evaluateHandoffEligibility } from "./eligibility";
import {
  buildHandoffTaskPlan,
  inferConditionalFlagsFromProjectTypes,
  mergeConditionalFlags,
} from "./tasks";
import type {
  ConditionalTaskFlags,
  HandoffPreview,
  HandoffStatus,
} from "./types";
import { HANDOFF_TYPE_AWARD_TO_DELIVERY } from "./types";

export async function buildHandoffPreview(input: {
  sourceProjectId: string;
  orgId: string;
  canOverride: boolean;
  useHistoricalOverride?: boolean;
  overrideReason?: string | null;
  conditionalFlags?: Partial<ConditionalTaskFlags> | null;
}): Promise<HandoffPreview | { error: string; status: number }> {
  const project = await db.project.findFirst({
    where: {
      id: input.sourceProjectId,
      orgId: input.orgId,
    },
    select: {
      id: true,
      name: true,
      orgId: true,
      workDomain: true,
      tenderStatus: true,
      clientOrganization: true,
      location: true,
      description: true,
      winningBidPrice: true,
      ourBidPrice: true,
      currency: true,
      awardDate: true,
      closeDate: true,
      dueDate: true,
      projectTypes: true,
      ownerId: true,
      owner: { select: { id: true, name: true } },
      documents: {
        select: {
          id: true,
          title: true,
          fileType: true,
          source: true,
        },
        orderBy: { sortOrder: "asc" },
        take: 40,
      },
    },
  });

  if (!project || !project.orgId) {
    return { error: "项目不存在或不属于当前企业", status: 404 };
  }

  const existing = await db.projectHandoff.findUnique({
    where: {
      orgId_sourceTenderProjectId_handoffType: {
        orgId: project.orgId,
        sourceTenderProjectId: project.id,
        handoffType: HANDOFF_TYPE_AWARD_TO_DELIVERY,
      },
    },
    select: {
      id: true,
      status: true,
      targetDeliveryProjectId: true,
    },
  });

  const bidData = await inspectBidDataGate(project.id);
  const eligibility = evaluateHandoffEligibility({
    workDomain: project.workDomain,
    tenderStatus: project.tenderStatus,
    orgId: project.orgId,
    expectedOrgId: input.orgId,
    bidData,
    existingHandoffStatus: (existing?.status as HandoffStatus) ?? null,
    useHistoricalOverride: Boolean(input.useHistoricalOverride),
    canOverride: input.canOverride,
    overrideReason: input.overrideReason,
  });

  const inferred = inferConditionalFlagsFromProjectTypes(project.projectTypes);
  const flags = mergeConditionalFlags(inferred, input.conditionalFlags);
  const amount = resolveHandoffContractAmount(project);

  // 禁止复用 closeDate / awardDate 作为计划完成
  const plannedCompletionDate: string | null = null;

  const { baseTasks, conditionalTasks } = buildHandoffTaskPlan(flags, {
    amountUnconfirmed: !amount.confirmed,
    dateMissing: true,
  });

  const missing: string[] = [];
  if (!amount.confirmed) missing.push("合同金额尚未确认");
  missing.push("计划完成日期需用户确认（不会使用截标/中标日）");
  if (!project.clientOrganization) missing.push("客户名称缺失");
  if (!project.location) missing.push("项目地址缺失");

  const warnings = [...eligibility.warnings];
  if (project.workDomain !== PROJECT_WORK_DOMAIN.TENDER) {
    // already in blockers
  }
  warnings.push("将新建独立执行项目，原投标项目保留不变");
  warnings.push("文件以引用清单记录，不复制二进制，不扩大访问权限");

  const canExecute =
    eligibility.ok &&
    existing?.status !== "completed" &&
    existing?.status !== "processing";

  return {
    sourceProjectId: project.id,
    sourceProjectName: project.name,
    tenderStatus: project.tenderStatus,
    orgId: project.orgId,
    suggestedDeliveryName: `${project.name} · 执行`,
    clientOrganization: project.clientOrganization,
    location: project.location,
    description: project.description,
    amount,
    plannedCompletionDate,
    plannedCompletionSource: "user_required",
    suggestedOwnerId: null,
    suggestedOwnerName: null,
    documentRefs: project.documents.map((d) => ({
      id: d.id,
      title: d.title,
      fileType: d.fileType,
      source: d.source,
    })),
    baseTasks,
    conditionalTasks,
    conditionalFlags: flags,
    missing,
    warnings,
    blockers: eligibility.blockers,
    requiresHistoricalOverride: eligibility.requiresHistoricalOverride,
    bidDataSummary: {
      hasRevisions: bidData.hasRevisions,
      finalRevisionId: bidData.finalRevisionId,
      finalStatus: bidData.finalStatus,
      technicalApproved: bidData.technicalApproved,
      financialApproved: bidData.financialApproved,
      locked: bidData.locked,
    },
    existingHandoff: existing
      ? {
          id: existing.id,
          status: existing.status as HandoffStatus,
          targetDeliveryProjectId: existing.targetDeliveryProjectId,
        }
      : null,
    canExecute,
    canOverride: input.canOverride,
  };
}
