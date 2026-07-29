/**
 * MatrixGroupPlaybook 生命周期 — 账号组级策略（继承源）
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { PlaybookContentFields } from "./types";
import { canSubmitValidation, validatePlaybookContent } from "./validate";

function contentFields(content: PlaybookContentFields) {
  return {
    accountRole: content.accountRole ?? null,
    businessObjective: content.businessObjective ?? null,
    positioning: content.positioning ?? null,
    personaBackground: content.personaBackground ?? null,
    personality: content.personality ?? null,
    toneOfVoice: content.toneOfVoice ?? null,
    operatingLanguage: content.operatingLanguage ?? null,
    operatingRegion: content.operatingRegion ?? null,
    primaryProducts: content.primaryProducts ?? null,
    targetAudienceJson:
      (content.targetAudienceJson as Prisma.InputJsonValue) ?? undefined,
    contentPillarsJson:
      (content.contentPillarsJson as Prisma.InputJsonValue) ?? undefined,
    contentMixJson:
      (content.contentMixJson as Prisma.InputJsonValue) ?? undefined,
    visualStyleJson:
      (content.visualStyleJson as Prisma.InputJsonValue) ?? undefined,
    postingRulesJson:
      (content.postingRulesJson as Prisma.InputJsonValue) ?? undefined,
    ctaStrategyJson:
      (content.ctaStrategyJson as Prisma.InputJsonValue) ?? undefined,
    conversionPathJson:
      (content.conversionPathJson as Prisma.InputJsonValue) ?? undefined,
    kpiTargetsJson:
      (content.kpiTargetsJson as Prisma.InputJsonValue) ?? undefined,
    forbiddenTopicsJson:
      (content.forbiddenTopicsJson as Prisma.InputJsonValue) ?? undefined,
    exampleContentJson:
      (content.exampleContentJson as Prisma.InputJsonValue) ?? undefined,
    mergeRulesJson:
      (content.overridesJson as Prisma.InputJsonValue) ?? undefined,
  };
}

async function getGroupOrThrow(orgId: string, groupId: string) {
  const group = await db.matrixAccountGroup.findFirst({
    where: { id: groupId, orgId },
  });
  if (!group) throw new Error("账号组不存在或不属于当前组织");
  return group;
}

export async function listGroupPlaybooks(orgId: string, groupId: string) {
  await getGroupOrThrow(orgId, groupId);
  return db.matrixGroupPlaybook.findMany({
    where: { orgId, groupId },
    orderBy: { version: "desc" },
  });
}

export async function getGroupPlaybookById(orgId: string, playbookId: string) {
  const pb = await db.matrixGroupPlaybook.findFirst({
    where: { id: playbookId, orgId },
  });
  if (!pb) throw new Error("组 Playbook 不存在");
  return pb;
}

export async function createGroupPlaybookDraft(input: {
  orgId: string;
  groupId: string;
  userId: string;
  content?: PlaybookContentFields;
  basedOnPlaybookId?: string;
  changeSummary?: string;
}) {
  await getGroupOrThrow(input.orgId, input.groupId);

  const latest = await db.matrixGroupPlaybook.findFirst({
    where: { orgId: input.orgId, groupId: input.groupId },
    orderBy: { version: "desc" },
  });

  let basedOnVersion: number | null = null;
  let seed: PlaybookContentFields = input.content ?? {};
  if (input.basedOnPlaybookId) {
    const base = await getGroupPlaybookById(input.orgId, input.basedOnPlaybookId);
    if (base.groupId !== input.groupId) {
      throw new Error("来源版本不属于该账号组");
    }
    basedOnVersion = base.version;
    seed = {
      accountRole: base.accountRole,
      businessObjective: base.businessObjective,
      positioning: base.positioning,
      personaBackground: base.personaBackground,
      personality: base.personality,
      toneOfVoice: base.toneOfVoice,
      operatingLanguage: base.operatingLanguage,
      operatingRegion: base.operatingRegion,
      primaryProducts: base.primaryProducts,
      targetAudienceJson: base.targetAudienceJson,
      contentPillarsJson: base.contentPillarsJson,
      contentMixJson: base.contentMixJson,
      visualStyleJson: base.visualStyleJson,
      postingRulesJson: base.postingRulesJson,
      ctaStrategyJson: base.ctaStrategyJson,
      conversionPathJson: base.conversionPathJson,
      kpiTargetsJson: base.kpiTargetsJson,
      forbiddenTopicsJson: base.forbiddenTopicsJson,
      exampleContentJson: base.exampleContentJson,
      overridesJson: base.mergeRulesJson,
      ...input.content,
    };
  } else if (latest?.status === "approved") {
    return createGroupPlaybookDraft({
      ...input,
      basedOnPlaybookId: latest.id,
    });
  }

  const openDraft = await db.matrixGroupPlaybook.findFirst({
    where: {
      orgId: input.orgId,
      groupId: input.groupId,
      status: { in: ["draft", "rejected"] },
    },
    orderBy: { version: "desc" },
  });
  if (openDraft && !input.basedOnPlaybookId && !input.content) {
    return openDraft;
  }

  const validation = validatePlaybookContent(seed);
  const version = (latest?.version ?? 0) + 1;

  return db.matrixGroupPlaybook.create({
    data: {
      orgId: input.orgId,
      groupId: input.groupId,
      version,
      basedOnVersion,
      status: "draft",
      isEffective: false,
      completenessScore: validation.completenessScore,
      validationResult: validation.validationResult,
      validationIssues: validation.validationIssues as Prisma.InputJsonValue,
      changeSummary: input.changeSummary ?? null,
      createdById: input.userId,
      ...contentFields(seed),
    },
  });
}

export async function updateGroupPlaybookDraft(input: {
  orgId: string;
  playbookId: string;
  content: PlaybookContentFields;
  changeSummary?: string;
}) {
  const pb = await getGroupPlaybookById(input.orgId, input.playbookId);
  if (pb.status !== "draft" && pb.status !== "rejected") {
    throw new Error("仅 draft/rejected 可编辑；已批准版本请创建新版本");
  }
  const validation = validatePlaybookContent(input.content);
  return db.matrixGroupPlaybook.update({
    where: { id: pb.id },
    data: {
      status: "draft",
      rejectedReason: null,
      changeSummary: input.changeSummary ?? pb.changeSummary,
      completenessScore: validation.completenessScore,
      validationResult: validation.validationResult,
      validationIssues: validation.validationIssues as Prisma.InputJsonValue,
      ...contentFields(input.content),
    },
  });
}

export async function submitGroupPlaybook(input: {
  orgId: string;
  playbookId: string;
  userId: string;
}) {
  const pb = await getGroupPlaybookById(input.orgId, input.playbookId);
  if (pb.status !== "draft" && pb.status !== "rejected") {
    throw new Error("仅草稿或驳回稿可提交审批");
  }
  const validation = validatePlaybookContent(pb);
  if (!canSubmitValidation(validation.validationResult)) {
    throw new Error("完整度校验未通过，无法提交审批");
  }
  return db.matrixGroupPlaybook.update({
    where: { id: pb.id },
    data: {
      status: "submitted",
      submittedById: input.userId,
      submittedAt: new Date(),
      completenessScore: validation.completenessScore,
      validationResult: validation.validationResult,
      validationIssues: validation.validationIssues as Prisma.InputJsonValue,
    },
  });
}

export async function approveGroupPlaybook(input: {
  orgId: string;
  playbookId: string;
  userId: string;
}) {
  const pb = await getGroupPlaybookById(input.orgId, input.playbookId);
  if (pb.status !== "submitted") {
    throw new Error("仅已提交的组 Playbook 可批准");
  }
  const validation = validatePlaybookContent(pb);
  if (validation.validationResult === "fail") {
    throw new Error("存在必填缺失，无法批准");
  }

  return db.$transaction(async (tx) => {
    await tx.matrixGroupPlaybook.updateMany({
      where: {
        orgId: input.orgId,
        groupId: pb.groupId,
        isEffective: true,
      },
      data: { isEffective: false, status: "archived" },
    });
    return tx.matrixGroupPlaybook.update({
      where: { id: pb.id },
      data: {
        status: "approved",
        isEffective: true,
        approvedById: input.userId,
        approvedAt: new Date(),
        completenessScore: validation.completenessScore,
        validationResult: validation.validationResult,
        validationIssues: validation.validationIssues as Prisma.InputJsonValue,
      },
    });
  });
}

export async function rejectGroupPlaybook(input: {
  orgId: string;
  playbookId: string;
  userId: string;
  reason: string;
}) {
  const pb = await getGroupPlaybookById(input.orgId, input.playbookId);
  if (pb.status !== "submitted") {
    throw new Error("仅已提交的组 Playbook 可驳回");
  }
  if (!input.reason.trim()) throw new Error("驳回原因必填");
  return db.matrixGroupPlaybook.update({
    where: { id: pb.id },
    data: {
      status: "rejected",
      isEffective: false,
      rejectedReason: input.reason.trim(),
      approvedById: input.userId,
      approvedAt: new Date(),
    },
  });
}
