import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { onProjectCreated } from "@/lib/project-discussion/system-events";
import { PROJECT_WORK_DOMAIN } from "@/lib/projects/work-domain";
import { resolveHandoffContractAmount } from "./amount";
import { inspectBidDataGate } from "./bid-data";
import { evaluateHandoffEligibility } from "./eligibility";
import {
  buildHandoffIdempotencyKey,
  buildHandoffTaskBatchKey,
} from "./idempotency";
import {
  buildHandoffTaskPlan,
  inferConditionalFlagsFromProjectTypes,
  mergeConditionalFlags,
} from "./tasks";
import {
  HANDOFF_TASK_SOURCE_TYPE,
  HANDOFF_TYPE_AWARD_TO_DELIVERY,
  type HandoffExecuteInput,
  type HandoffExecuteResult,
  type HandoffFailureCode,
} from "./types";

class HandoffError extends Error {
  code: HandoffFailureCode;
  status: number;
  constructor(code: HandoffFailureCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function markHandoffFailed(input: {
  handoffId: string;
  actorUserId: string;
  orgId: string | null;
  sourceProjectId: string;
  code: string;
  message: string;
}) {
  try {
    await db.projectHandoff.update({
      where: { id: input.handoffId },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureCode: input.code,
        failureMessage: input.message.slice(0, 500),
      },
    });
    await writeAuditLog(db, {
      userId: input.actorUserId,
      orgId: input.orgId,
      projectId: input.sourceProjectId,
      action: "project_handoff.failed",
      targetType: "project_handoff",
      targetId: input.handoffId,
      afterData: { code: input.code, message: input.message.slice(0, 200) },
    }).catch(() => undefined);
  } catch {
    // 独立失败更新不可阻断
  }
}

export async function executeAwardHandoff(input: {
  sourceProjectId: string;
  orgId: string;
  actorUserId: string;
  actorName: string;
  canOverride: boolean;
  payload: HandoffExecuteInput;
}): Promise<HandoffExecuteResult> {
  const deliveryOwnerId = String(input.payload.deliveryOwnerId || "").trim();
  if (!deliveryOwnerId) {
    throw new HandoffError("OWNER_INVALID", "必须明确选择运营项目负责人", 400);
  }

  const ownerMember = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: input.orgId, userId: deliveryOwnerId },
    },
    select: { status: true, user: { select: { id: true, status: true } } },
  });
  if (
    !ownerMember ||
    ownerMember.status !== "active" ||
    ownerMember.user.status !== "active"
  ) {
    throw new HandoffError(
      "OWNER_INVALID",
      "运营负责人必须是当前组织的有效成员",
      400,
    );
  }

  const source = await db.project.findFirst({
    where: { id: input.sourceProjectId, orgId: input.orgId },
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
      projectTypes: true,
      workspaceId: true,
      documents: {
        select: { id: true, title: true, fileType: true, source: true },
        take: 40,
      },
    },
  });
  if (!source?.orgId) {
    throw new HandoffError("ORG_MISMATCH", "项目不存在或不属于当前企业", 404);
  }

  const idempotencyKey = buildHandoffIdempotencyKey({
    orgId: source.orgId,
    sourceTenderProjectId: source.id,
  });

  const existing = await db.projectHandoff.findUnique({
    where: {
      orgId_sourceTenderProjectId_handoffType: {
        orgId: source.orgId,
        sourceTenderProjectId: source.id,
        handoffType: HANDOFF_TYPE_AWARD_TO_DELIVERY,
      },
    },
  });

  if (existing?.status === "completed" && existing.targetDeliveryProjectId) {
    return {
      handoffId: existing.id,
      status: "completed",
      targetDeliveryProjectId: existing.targetDeliveryProjectId,
      created: false,
      message: "已完成交接，返回既有执行项目",
    };
  }
  if (existing?.status === "processing") {
    throw new HandoffError("IN_PROGRESS", "交接正在处理中，请勿重复提交", 409);
  }
  if (existing?.status === "cancelled" && !input.canOverride) {
    throw new HandoffError(
      "FORBIDDEN",
      "已取消的交接需管理权限重新发起",
      403,
    );
  }

  const bidData = await inspectBidDataGate(source.id);
  const eligibility = evaluateHandoffEligibility({
    workDomain: source.workDomain,
    tenderStatus: source.tenderStatus,
    orgId: source.orgId,
    expectedOrgId: input.orgId,
    bidData,
    existingHandoffStatus: null, // 重试路径由上方 status 分支处理
    useHistoricalOverride: Boolean(input.payload.overrideReason?.trim()),
    canOverride: input.canOverride,
    overrideReason: input.payload.overrideReason,
  });
  if (!eligibility.ok) {
    const first = eligibility.blockers[0]!;
    throw new HandoffError(first.code, first.message, 400);
  }

  let plannedCompletionDate: Date | null = null;
  if (input.payload.plannedCompletionDate) {
    const d = new Date(input.payload.plannedCompletionDate);
    if (Number.isNaN(d.getTime())) {
      throw new HandoffError("VALIDATION", "计划完成日期无效", 400);
    }
    plannedCompletionDate = d;
  }

  const amount = resolveHandoffContractAmount(source);
  const flags = mergeConditionalFlags(
    inferConditionalFlagsFromProjectTypes(source.projectTypes),
    input.payload.conditionalFlags,
  );
  const { baseTasks, conditionalTasks } = buildHandoffTaskPlan(flags, {
    amountUnconfirmed: !amount.confirmed,
    dateMissing: !plannedCompletionDate,
  });
  const allTasks = [...baseTasks, ...conditionalTasks];

  const deliveryName =
    (input.payload.deliveryName || "").trim() || `${source.name} · 执行`;
  const description =
    input.payload.description !== undefined
      ? input.payload.description
      : source.description;

  // upsert handoff → processing
  const handoff = existing
    ? await db.projectHandoff.update({
        where: { id: existing.id },
        data: {
          status: "processing",
          deliveryOwnerId,
          initiatedById: input.actorUserId,
          overrideReason: input.payload.overrideReason?.trim() || null,
          failedAt: null,
          failureCode: null,
          failureMessage: null,
          retryCount: { increment: 1 },
          previewSnapshot: {
            deliveryName,
            flags,
            amount,
            plannedCompletionDate: plannedCompletionDate?.toISOString() ?? null,
          } as Prisma.InputJsonValue,
        },
      })
    : await db.projectHandoff.create({
        data: {
          orgId: source.orgId,
          sourceTenderProjectId: source.id,
          handoffType: HANDOFF_TYPE_AWARD_TO_DELIVERY,
          status: "processing",
          idempotencyKey,
          initiatedById: input.actorUserId,
          deliveryOwnerId,
          overrideReason: input.payload.overrideReason?.trim() || null,
          previewSnapshot: {
            deliveryName,
            flags,
            amount,
            plannedCompletionDate: plannedCompletionDate?.toISOString() ?? null,
          },
        },
      });

  await writeAuditLog(db, {
    userId: input.actorUserId,
    orgId: source.orgId,
    projectId: source.id,
    action: "project_handoff.started",
    targetType: "project_handoff",
    targetId: handoff.id,
    afterData: {
      sourceTenderProjectId: source.id,
      deliveryOwnerId,
      override: Boolean(input.payload.overrideReason?.trim()),
    },
  });

  try {
    const result = await db.$transaction(async (tx) => {
      // 再次验证来源
      const locked = await tx.project.findFirst({
        where: {
          id: source.id,
          orgId: source.orgId,
          workDomain: PROJECT_WORK_DOMAIN.TENDER,
          tenderStatus: "won",
        },
        select: { id: true },
      });
      if (!locked) {
        throw new HandoffError(
          "VALIDATION",
          "来源项目状态已变化，无法交接",
          409,
        );
      }

      const completedAgain = await tx.projectHandoff.findFirst({
        where: {
          orgId: source.orgId!,
          sourceTenderProjectId: source.id,
          handoffType: HANDOFF_TYPE_AWARD_TO_DELIVERY,
          status: "completed",
        },
        select: { id: true, targetDeliveryProjectId: true },
      });
      if (completedAgain?.targetDeliveryProjectId) {
        return {
          targetId: completedAgain.targetDeliveryProjectId,
          taskCount: 0,
          created: false,
        };
      }

      const delivery = await tx.project.create({
        data: {
          name: deliveryName,
          description: description || null,
          clientOrganization: source.clientOrganization,
          location: source.location,
          orgId: source.orgId,
          workspaceId: source.workspaceId,
          ownerId: deliveryOwnerId,
          workDomain: PROJECT_WORK_DOMAIN.DELIVERY,
          deliveryStage: "handoff",
          plannedCompletionDate,
          sourceTenderProjectId: source.id,
          // 金额：仅可靠中标价带入 estimatedValue 作参考，不复制 tenderStatus
          estimatedValue: amount.confirmed ? amount.amount : null,
          currency: amount.currency,
          status: "active",
          color: "#0F766E",
          members: {
            create: {
              userId: deliveryOwnerId,
              role: "project_admin",
              status: "active",
            },
          },
          environments: {
            create: [
              { name: "测试环境", code: "test", status: "active" },
              { name: "正式环境", code: "prod", status: "active" },
            ],
          },
        },
        select: { id: true, name: true },
      });

      if (deliveryOwnerId !== input.actorUserId) {
        await tx.projectMember.upsert({
          where: {
            projectId_userId: {
              projectId: delivery.id,
              userId: input.actorUserId,
            },
          },
          create: {
            projectId: delivery.id,
            userId: input.actorUserId,
            role: "project_admin",
            status: "active",
          },
          update: { status: "active" },
        });
      }

      await onProjectCreated(
        delivery.id,
        delivery.name,
        input.actorUserId,
        input.actorName,
        tx,
      );

      const batchKey = buildHandoffTaskBatchKey(handoff.id);
      let createdTasks = 0;
      for (const t of allTasks) {
        const existingTask = await tx.task.findUnique({
          where: {
            sourceId_sourceTemplateKey: {
              sourceId: handoff.id,
              sourceTemplateKey: t.templateKey,
            },
          },
          select: { id: true },
        });
        if (existingTask) continue;

        await tx.task.create({
          data: {
            title: t.title,
            description: t.description,
            status: "todo",
            priority: "medium",
            projectId: delivery.id,
            assigneeId: deliveryOwnerId,
            creatorId: input.actorUserId,
            sourceType: HANDOFF_TASK_SOURCE_TYPE,
            sourceId: handoff.id,
            sourceBatchKey: batchKey,
            sourceTemplateKey: t.templateKey,
          },
        });
        createdTasks += 1;
      }

      const transferredSnapshot = {
        sourceTenderProjectId: source.id,
        targetDeliveryProjectId: delivery.id,
        amount,
        plannedCompletionDate: plannedCompletionDate?.toISOString() ?? null,
        conditionalFlags: flags,
        tasks: allTasks.map((t) => t.templateKey),
        documentRefs: source.documents.map((d) => d.id),
        notTransferred: [
          "tenderStatus",
          "closeDate",
          "solicitationNumber",
          "evidence",
          "requirements",
          "approvals",
          "submissionLock",
          "agentRuns",
        ],
        overrideReason: input.payload.overrideReason?.trim() || null,
      };

      await tx.projectHandoff.update({
        where: { id: handoff.id },
        data: {
          status: "completed",
          targetDeliveryProjectId: delivery.id,
          completedAt: new Date(),
          transferredSnapshot: transferredSnapshot as Prisma.InputJsonValue,
          failedAt: null,
          failureCode: null,
          failureMessage: null,
        },
      });

      await writeAuditLog(tx, {
        userId: input.actorUserId,
        orgId: source.orgId,
        projectId: delivery.id,
        action: "project_handoff.completed",
        targetType: "project_handoff",
        targetId: handoff.id,
        afterData: {
          sourceTenderProjectId: source.id,
          targetDeliveryProjectId: delivery.id,
          taskCount: createdTasks,
          deliveryOwnerId,
        },
      });

      return {
        targetId: delivery.id,
        taskCount: createdTasks,
        created: true,
      };
    });

    return {
      handoffId: handoff.id,
      status: "completed",
      targetDeliveryProjectId: result.targetId,
      created: result.created,
      taskCount: result.taskCount,
      message: result.created
        ? "执行项目已创建"
        : "已完成交接，返回既有执行项目",
    };
  } catch (err) {
    const code =
      err instanceof HandoffError ? err.code : ("INTERNAL" as HandoffFailureCode);
    const message =
      err instanceof Error ? err.message : "交接失败，请稍后重试";
    await markHandoffFailed({
      handoffId: handoff.id,
      actorUserId: input.actorUserId,
      orgId: source.orgId,
      sourceProjectId: source.id,
      code,
      message,
    });
    if (err instanceof HandoffError) throw err;
    throw new HandoffError("INTERNAL", "交接失败，请查看交接记录后重试", 500);
  }
}

export { HandoffError };
