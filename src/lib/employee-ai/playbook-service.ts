import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { EmployeeAiAccessError } from "./access";

export async function listPlaybooks(input: {
  orgId: string;
  status?: string;
  department?: string;
}) {
  return db.rolePlaybook.findMany({
    where: {
      orgId: input.orgId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.department ? { department: input.department } : {}),
    },
    orderBy: [{ name: "asc" }, { version: "desc" }],
  });
}

export async function listActivePlaybooks(input: {
  orgId: string;
  roleScope?: string;
  department?: string;
}) {
  const now = new Date();
  return db.rolePlaybook.findMany({
    where: {
      orgId: input.orgId,
      status: "active",
      ...(input.roleScope ? { roleScope: input.roleScope } : {}),
      ...(input.department ? { department: input.department } : {}),
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
      ],
    },
    orderBy: { version: "desc" },
  });
}

export async function createPlaybookDraft(input: {
  orgId: string;
  userId: string;
  department: string;
  roleScope: string;
  name: string;
  description: string;
  rules?: unknown;
  workflows?: unknown;
  templates?: unknown;
  exceptions?: unknown;
  sourceCandidatePracticeIds?: string[];
}) {
  const latest = await db.rolePlaybook.findFirst({
    where: { orgId: input.orgId, name: input.name },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  const row = await db.rolePlaybook.create({
    data: {
      orgId: input.orgId,
      department: input.department,
      roleScope: input.roleScope,
      name: input.name,
      description: input.description,
      version,
      status: "draft",
      rules: input.rules as object | undefined,
      workflows: input.workflows as object | undefined,
      templates: input.templates as object | undefined,
      exceptions: input.exceptions as object | undefined,
      sourceCandidatePracticeIds: input.sourceCandidatePracticeIds as
        | object
        | undefined,
    },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.playbook.create_draft",
    targetType: "RolePlaybook",
    targetId: row.id,
    afterData: { name: row.name, version: row.version },
  });

  return row;
}

export async function publishPlaybook(input: {
  orgId: string;
  userId: string;
  id: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}) {
  const pb = await db.rolePlaybook.findFirst({
    where: { id: input.id, orgId: input.orgId },
  });
  if (!pb) throw new EmployeeAiAccessError("Playbook 不存在", 404);
  if (pb.status === "active") {
    throw new EmployeeAiAccessError("已是生效版本", 400);
  }

  // 同名旧 active → retired（不覆盖历史行）
  await db.rolePlaybook.updateMany({
    where: {
      orgId: input.orgId,
      name: pb.name,
      status: "active",
      id: { not: pb.id },
    },
    data: { status: "retired", effectiveTo: new Date() },
  });

  const published = await db.rolePlaybook.update({
    where: { id: pb.id },
    data: {
      status: "active",
      approvedBy: input.userId,
      approvedAt: new Date(),
      effectiveFrom: input.effectiveFrom ?? new Date(),
      effectiveTo: input.effectiveTo ?? null,
    },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.playbook.publish",
    targetType: "RolePlaybook",
    targetId: published.id,
    afterData: { name: published.name, version: published.version },
  });

  return published;
}

/** 回滚：将目标历史版本重新发布为新版本（不覆盖旧行） */
export async function rollbackPlaybook(input: {
  orgId: string;
  userId: string;
  targetId: string;
}) {
  const target = await db.rolePlaybook.findFirst({
    where: { id: input.targetId, orgId: input.orgId },
  });
  if (!target) throw new EmployeeAiAccessError("目标版本不存在", 404);

  const draft = await createPlaybookDraft({
    orgId: input.orgId,
    userId: input.userId,
    department: target.department,
    roleScope: target.roleScope,
    name: target.name,
    description: `${target.description}\n\n（回滚自 v${target.version}）`,
    rules: target.rules ?? undefined,
    workflows: target.workflows ?? undefined,
    templates: target.templates ?? undefined,
    exceptions: target.exceptions ?? undefined,
    sourceCandidatePracticeIds: Array.isArray(target.sourceCandidatePracticeIds)
      ? (target.sourceCandidatePracticeIds as string[])
      : undefined,
  });

  const withSupersede = await db.rolePlaybook.update({
    where: { id: draft.id },
    data: { supersedesId: target.id },
  });

  return publishPlaybook({
    orgId: input.orgId,
    userId: input.userId,
    id: withSupersede.id,
  });
}

export async function retirePlaybook(input: {
  orgId: string;
  userId: string;
  id: string;
}) {
  const pb = await db.rolePlaybook.findFirst({
    where: { id: input.id, orgId: input.orgId },
  });
  if (!pb) throw new EmployeeAiAccessError("Playbook 不存在", 404);

  const retired = await db.rolePlaybook.update({
    where: { id: pb.id },
    data: { status: "retired", effectiveTo: new Date() },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.playbook.retire",
    targetType: "RolePlaybook",
    targetId: retired.id,
  });

  return retired;
}

export async function reviewCandidatePractice(input: {
  orgId: string;
  userId: string;
  id: string;
  decision: "approve" | "reject";
  rejectionReason?: string;
  department?: string;
  roleScope?: string;
  exceptions?: unknown;
  effectiveFrom?: Date | null;
}) {
  const c = await db.candidatePractice.findFirst({
    where: { id: input.id, orgId: input.orgId },
  });
  if (!c) throw new EmployeeAiAccessError("候选方法不存在", 404);
  if (c.status === "approved") {
    throw new EmployeeAiAccessError("候选已批准，不会自动改 Skill", 400);
  }

  if (input.decision === "reject") {
    const rejected = await db.candidatePractice.update({
      where: { id: c.id },
      data: {
        status: "rejected",
        reviewedBy: input.userId,
        reviewedAt: new Date(),
        rejectionReason: input.rejectionReason ?? "主管拒绝",
      },
    });
    await logAudit({
      userId: input.userId,
      orgId: input.orgId,
      action: "employee_ai.candidate.reject",
      targetType: "CandidatePractice",
      targetId: rejected.id,
    });
    return { candidate: rejected, playbook: null };
  }

  const approved = await db.candidatePractice.update({
    where: { id: c.id },
    data: {
      status: "approved",
      reviewedBy: input.userId,
      reviewedAt: new Date(),
      department: input.department ?? c.department,
      roleScope: input.roleScope ?? c.roleScope,
      exceptions: (input.exceptions as object) ?? c.exceptions ?? undefined,
    },
  });

  // 批准 → 创建并发布 Playbook 新版本（不改 Skill 代码）
  const draft = await createPlaybookDraft({
    orgId: input.orgId,
    userId: input.userId,
    department: approved.department,
    roleScope: approved.roleScope,
    name: approved.title,
    description: approved.description,
    rules: {
      title: approved.title,
      recommendedProcess: approved.recommendedProcess,
    },
    workflows: approved.recommendedProcess ?? undefined,
    exceptions: approved.exceptions ?? undefined,
    sourceCandidatePracticeIds: [approved.id],
  });

  const playbook = await publishPlaybook({
    orgId: input.orgId,
    userId: input.userId,
    id: draft.id,
    effectiveFrom: input.effectiveFrom ?? new Date(),
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "employee_ai.candidate.approve",
    targetType: "CandidatePractice",
    targetId: approved.id,
    afterData: { playbookId: playbook.id, playbookVersion: playbook.version },
  });

  return { candidate: approved, playbook };
}
