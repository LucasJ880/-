import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

export interface DispatchInput {
  orgId: string;
  ownerUserId?: string;
  memberUserIds?: string[];
  note?: string;
}

export async function dispatchProject(
  projectId: string,
  input: DispatchInput,
  dispatchedById: string,
  request?: import("next/server").NextRequest
) {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("项目不存在");
  if (project.intakeStatus !== "pending_dispatch") {
    throw new Error("该项目不在待分发状态");
  }

  const org = await db.organization.findUnique({ where: { id: input.orgId } });
  if (!org) throw new Error("目标组织不存在");

  if (input.ownerUserId) {
    const user = await db.user.findUnique({ where: { id: input.ownerUserId } });
    if (!user) throw new Error("指定的负责人不存在");
  }

  const now = new Date();

  const updated = await db.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {
      intakeStatus: "dispatched",
      orgId: input.orgId,
      dispatchedAt: now,
      dispatchedById,
    };

    if (input.ownerUserId) {
      updateData.ownerId = input.ownerUserId;
    }

    const result = await tx.project.update({
      where: { id: projectId },
      data: updateData,
    });

    if (input.ownerUserId && input.ownerUserId !== project.ownerId) {
      await tx.projectMember.upsert({
        where: {
          projectId_userId: { projectId, userId: input.ownerUserId },
        },
        create: {
          projectId,
          userId: input.ownerUserId,
          role: "project_admin",
          status: "active",
        },
        update: { role: "project_admin", status: "active" },
      });
    }

    if (input.memberUserIds?.length) {
      for (const uid of input.memberUserIds) {
        if (uid === input.ownerUserId) continue;
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: uid } },
          create: { projectId, userId: uid, role: "operator", status: "active" },
          update: { status: "active" },
        });
      }
    }

    return result;
  });

  logAudit({
    userId: dispatchedById,
    action: AUDIT_ACTIONS.DISPATCH_PROJECT,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: projectId,
    projectId,
    orgId: input.orgId,
    afterData: {
      intakeStatus: "dispatched",
      orgId: input.orgId,
      ownerUserId: input.ownerUserId ?? project.ownerId,
      memberUserIds: input.memberUserIds ?? [],
      note: input.note,
    },
    request,
  }).catch(() => {});

  return updated;
}
