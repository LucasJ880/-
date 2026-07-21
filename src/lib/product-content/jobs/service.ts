import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getOrgMembership } from "@/lib/auth";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit/logger";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { detectConflict, shouldOverwrite } from "@/lib/product-content/facts/conflict";
import { canAutoConfirm } from "@/lib/product-content/facts/priority";
import { resolveApprovalPolicy } from "@/lib/product-content/approval/policy";
import { getOrCreateApprovalSettings } from "@/lib/product-content/approval/settings";
import { summarizeJobCost } from "@/lib/product-content/cost/ledger";
import {
  getIndustryPack,
  listMissingFields,
} from "@/lib/product-content/industry-packs/home-textile";
import {
  assertTransition,
} from "@/lib/product-content/jobs/status";
import type { ProductContentJobStatus } from "@/lib/product-content/types";
import type {
  ApprovalActionKey,
  ApprovalPolicy,
  ExecutionMode,
  ExecutionPlan,
  ExtractedFact,
} from "@/lib/product-content/types";

const AUDIT_TARGET = "product_content_job";

async function assertOrgAccess(orgId: string, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user && isSuperAdmin(user.role)) return;

  const membership = await getOrgMembership(userId, orgId);
  if (!membership || membership.status !== "active") {
    throw new Error("无权访问该组织");
  }
}

async function loadJob(orgId: string, jobId: string) {
  const job = await db.productContentJob.findFirst({
    where: { id: jobId, orgId },
  });
  if (!job) throw new Error("产品内容任务不存在");
  return job;
}

export async function updateJobDocumentPurpose(input: {
  orgId: string;
  userId: string;
  jobId: string;
  documentPurpose: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  await loadJob(input.orgId, input.jobId);
  return db.productContentJob.update({
    where: { id: input.jobId },
    data: { documentPurpose: input.documentPurpose },
  });
}

export async function createProductContentJob(input: {
  orgId: string;
  userId: string;
  title: string;
  executionMode?: ExecutionMode;
  industryPack?: string;
  selectedSku?: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);

  const settings = await getOrCreateApprovalSettings(input.orgId);
  const executionMode =
    input.executionMode ??
    (settings.defaultExecutionMode as ExecutionMode) ??
    "AUTOPILOT";

  const job = await db.productContentJob.create({
    data: {
      orgId: input.orgId,
      title: input.title.trim(),
      executionMode,
      industryPack: input.industryPack ?? "home_textile",
      selectedSku: input.selectedSku,
      createdById: input.userId,
      status: "DRAFT",
    },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.CREATE,
    targetType: AUDIT_TARGET,
    targetId: job.id,
    afterData: { title: job.title, status: job.status },
  });

  return job;
}

export async function addJobInput(input: {
  orgId: string;
  userId: string;
  jobId: string;
  inputType: string;
  blobPathname?: string;
  mimeType?: string;
  fileName?: string;
  textContent?: string;
  url?: string;
  purpose?: string;
  transcriptText?: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  await loadJob(input.orgId, input.jobId);

  return db.productContentJobInput.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      inputType: input.inputType,
      blobPathname: input.blobPathname,
      mimeType: input.mimeType,
      fileName: input.fileName,
      textContent: input.textContent,
      url: input.url,
      purpose: input.purpose,
      transcriptText: input.transcriptText,
      createdById: input.userId,
    },
  });
}

export async function getProductContentJobStatus(orgId: string, jobId: string) {
  const job = await db.productContentJob.findFirst({
    where: { id: jobId, orgId },
    select: {
      id: true,
      status: true,
      executionMode: true,
      planJson: true,
      missingFieldsJson: true,
      errorMessage: true,
      updatedAt: true,
    },
  });
  if (!job) throw new Error("产品内容任务不存在");
  return job;
}

export async function listProductContentJobs(orgId: string, userId: string) {
  await assertOrgAccess(orgId, userId);
  return db.productContentJob.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      executionMode: true,
      industryPack: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getProductContentJobDetail(
  orgId: string,
  jobId: string,
  userId: string,
) {
  await assertOrgAccess(orgId, userId);
  const job = await db.productContentJob.findFirst({
    where: { id: jobId, orgId },
    include: {
      inputs: { orderBy: { createdAt: "asc" } },
      facts: { orderBy: [{ fieldKey: "asc" }, { updatedAt: "desc" }] },
      conflicts: { where: { status: "open" } },
      assets: { orderBy: { createdAt: "asc" } },
      visualJobs: {
        orderBy: { createdAt: "asc" },
        include: {
          outputs: {
            orderBy: { createdAt: "asc" },
            include: { qaResult: true },
          },
        },
      },
      copy: true,
      documents: { orderBy: { docType: "asc" } },
      approvals: { orderBy: { createdAt: "desc" } },
      steps: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!job) throw new Error("产品内容任务不存在");
  const costSummary = await summarizeJobCost(orgId, jobId);
  return { ...job, costSummary };
}

export async function updateProductFact(input: {
  orgId: string;
  userId: string;
  factId: string;
  action?: "confirm" | "reject" | "lock";
  value?: unknown;
}) {
  if (input.action === "confirm") {
    return confirmProductFact({
      orgId: input.orgId,
      userId: input.userId,
      factId: input.factId,
    });
  }
  if (input.action === "reject") {
    return rejectProductFact({
      orgId: input.orgId,
      userId: input.userId,
      factId: input.factId,
    });
  }
  if (input.action === "lock") {
    return lockProductFact({
      orgId: input.orgId,
      userId: input.userId,
      factId: input.factId,
    });
  }

  await assertOrgAccess(input.orgId, input.userId);
  const fact = await db.productFact.findFirst({
    where: { id: input.factId, orgId: input.orgId },
  });
  if (!fact) throw new Error("产品事实不存在");
  if (fact.locked) throw new Error("该事实已锁定，无法修改");

  return db.productFact.update({
    where: { id: fact.id },
    data: {
      value: input.value as object,
      normalizedValue: input.value as object,
      sourceType: "confirmed_human",
      status: "confirmed",
      confirmedById: input.userId,
      confirmedAt: new Date(),
    },
  });
}

export async function updateVisualOutput(input: {
  orgId: string;
  userId: string;
  outputId: string;
  action: "approve" | "reject" | "lock" | "unlock";
  /** 拒绝原因（写入 metadata + 审计） */
  reason?: string;
  /** reject 时是否将 Job 置为 REVISION_REQUESTED（默认 true） */
  requestRevision?: boolean;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const output = await db.visualOutput.findFirst({
    where: { id: input.outputId, orgId: input.orgId },
    include: { visualJob: true },
  });
  if (!output) throw new Error("视觉输出不存在");

  switch (input.action) {
    case "approve":
      return db.visualOutput.update({
        where: { id: output.id },
        data: { status: "approved", locked: false },
      });
    case "reject": {
      const prevMeta =
        output.metadata && typeof output.metadata === "object"
          ? (output.metadata as Record<string, unknown>)
          : {};
      const updated = await db.visualOutput.update({
        where: { id: output.id },
        data: {
          status: "rejected",
          locked: false,
          metadata: {
            ...prevMeta,
            rejectReason: input.reason ?? prevMeta.rejectReason ?? null,
            rejectedAt: new Date().toISOString(),
            rejectedById: input.userId,
          } as Prisma.InputJsonValue,
        },
      });

      await logAudit({
        userId: input.userId,
        orgId: input.orgId,
        action: AUDIT_ACTIONS.UPDATE,
        targetType: "visual_output",
        targetId: output.id,
        afterData: {
          status: "rejected",
          reason: input.reason ?? null,
          sceneType: output.visualJob.sceneType,
        },
      });

      if (input.requestRevision !== false) {
        const job = await db.productContentJob.findFirst({
          where: { id: output.visualJob.jobId, orgId: input.orgId },
        });
        if (job && (job.status === "READY_FOR_REVIEW" || job.status === "APPROVED")) {
          await setJobStatus({
            orgId: input.orgId,
            userId: input.userId,
            jobId: job.id,
            status: "REVISION_REQUESTED",
          });
        }
      }
      return updated;
    }
    case "lock":
      return db.visualOutput.update({
        where: { id: output.id },
        data: { status: "locked", locked: true },
      });
    case "unlock":
      return db.visualOutput.update({
        where: { id: output.id },
        data: { status: "generated", locked: false },
      });
  }
}

/**
 * 统计会阻断批准的 rejected：仅当某场景「最新输出」仍为 rejected，
 * 且该场景没有任何 approved/locked 时计入（旧版拒绝不阻断）。
 */
export async function countBlockingRejectedVisuals(
  orgId: string,
  jobId: string,
): Promise<number> {
  const outputs = await db.visualOutput.findMany({
    where: { orgId, visualJob: { jobId } },
    include: { visualJob: { select: { sceneType: true } } },
    orderBy: { createdAt: "desc" },
  });

  const byScene = new Map<string, typeof outputs>();
  for (const o of outputs) {
    const scene = o.visualJob.sceneType;
    const list = byScene.get(scene) ?? [];
    list.push(o);
    byScene.set(scene, list);
  }

  let blocking = 0;
  for (const [, list] of byScene) {
    const hasApproved = list.some(
      (o) => o.status === "approved" || o.status === "locked",
    );
    if (hasApproved) continue;
    const latest = list[0];
    if (latest?.status === "rejected") blocking += 1;
  }
  return blocking;
}

export async function updateProductCopyFields(input: {
  orgId: string;
  userId: string;
  jobId: string;
  patch?: Record<string, unknown>;
  action?: "lock" | "unlock" | "approve";
}) {
  await assertOrgAccess(input.orgId, input.userId);
  await loadJob(input.orgId, input.jobId);

  const existing = await db.productCopy.findUnique({ where: { jobId: input.jobId } });
  if (!existing) throw new Error("产品文案不存在，请先生成文案");

  if (input.action === "lock") {
    return db.productCopy.update({
      where: { jobId: input.jobId },
      data: { locked: true },
    });
  }
  if (input.action === "unlock") {
    return db.productCopy.update({
      where: { jobId: input.jobId },
      data: { locked: false },
    });
  }
  if (input.action === "approve") {
    return db.productCopy.update({
      where: { jobId: input.jobId },
      data: { status: "approved", locked: true },
    });
  }

  if (existing.locked) throw new Error("文案已锁定，无法修改");

  const patch = input.patch ?? {};
  const allowed = [
    "productNameEn",
    "titleEn",
    "shortDescriptionEn",
    "longDescriptionEn",
    "careInstructionsEn",
    "sellingPointsJson",
    "specificationsJson",
    "packagingJson",
    "useCasesJson",
    "missingInformationJson",
    "claimsToVerifyJson",
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) data[key] = patch[key];
  }
  if (Object.keys(data).length === 0) {
    throw new Error("未提供可更新的文案字段");
  }

  return db.productCopy.update({
    where: { jobId: input.jobId },
    data,
  });
}

export async function listJobVisuals(orgId: string, jobId: string, userId: string) {
  await assertOrgAccess(orgId, userId);
  await loadJob(orgId, jobId);
  return db.visualGenerationJob.findMany({
    where: { orgId, jobId },
    orderBy: { createdAt: "asc" },
    include: {
      outputs: {
        orderBy: { createdAt: "asc" },
        include: { qaResult: true },
      },
    },
  });
}

export async function setJobStatus(input: {
  orgId: string;
  userId: string;
  jobId: string;
  status: ProductContentJobStatus;
  errorMessage?: string | null;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const job = await loadJob(input.orgId, input.jobId);

  assertTransition(job.status as ProductContentJobStatus, input.status);

  const updated = await db.productContentJob.update({
    where: { id: job.id },
    data: {
      status: input.status,
      errorMessage: input.errorMessage ?? null,
    },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    targetType: AUDIT_TARGET,
    targetId: job.id,
    beforeData: { status: job.status },
    afterData: { status: updated.status, errorMessage: updated.errorMessage },
  });

  return updated;
}

async function upsertStep(
  orgId: string,
  jobId: string,
  stepKey: string,
  patch: {
    status?: string;
    inputJson?: unknown;
    outputJson?: unknown;
    errorMessage?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
  },
) {
  const existing = await db.productContentStep.findFirst({
    where: { orgId, jobId, stepKey },
  });
  if (existing) {
    return db.productContentStep.update({
      where: { id: existing.id },
      data: {
        status: patch.status,
        inputJson: patch.inputJson as Prisma.InputJsonValue | undefined,
        outputJson: patch.outputJson as Prisma.InputJsonValue | undefined,
        errorMessage: patch.errorMessage,
        startedAt: patch.startedAt,
        finishedAt: patch.finishedAt,
      },
    });
  }
  return db.productContentStep.create({
    data: {
      orgId,
      jobId,
      stepKey,
      status: patch.status ?? "pending",
      inputJson: patch.inputJson as Prisma.InputJsonValue | undefined,
      outputJson: patch.outputJson as Prisma.InputJsonValue | undefined,
      errorMessage: patch.errorMessage ?? undefined,
      startedAt: patch.startedAt,
      finishedAt: patch.finishedAt,
    },
  });
}

export { upsertStep as upsertProductContentStep };

function factValueToRecord(facts: Array<{ fieldKey: string; value: unknown }>) {
  const record: Record<string, unknown> = {};
  for (const f of facts) {
    record[f.fieldKey] = f.value;
  }
  return record;
}

export async function upsertProductFactsFromExtraction(input: {
  orgId: string;
  jobId: string;
  userId: string;
  facts: ExtractedFact[];
}) {
  await assertOrgAccess(input.orgId, input.userId);
  await loadJob(input.orgId, input.jobId);

  const results: Array<{ fieldKey: string; action: string; factId?: string }> = [];

  for (const incoming of input.facts) {
    const existing = await db.productFact.findFirst({
      where: {
        orgId: input.orgId,
        jobId: input.jobId,
        fieldKey: incoming.fieldKey,
        status: { not: "rejected" },
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!existing) {
      const status = canAutoConfirm(incoming.sourceType) ? "extracted" : "needs_review";
      const created = await db.productFact.create({
        data: {
          orgId: input.orgId,
          jobId: input.jobId,
          fieldKey: incoming.fieldKey,
          value: incoming.value as object,
          normalizedValue: incoming.value as object,
          sourceType: incoming.sourceType,
          sourceId: incoming.sourceId,
          sourceLocation: incoming.sourceLocation,
          confidence: incoming.confidence ?? 0.5,
          status,
        },
      });
      results.push({ fieldKey: incoming.fieldKey, action: "created", factId: created.id });
      continue;
    }

    if (detectConflict(existing.value, incoming.value)) {
      const incomingFact = await db.productFact.create({
        data: {
          orgId: input.orgId,
          jobId: input.jobId,
          fieldKey: incoming.fieldKey,
          value: incoming.value as object,
          normalizedValue: incoming.value as object,
          sourceType: incoming.sourceType,
          sourceId: incoming.sourceId,
          sourceLocation: incoming.sourceLocation,
          confidence: incoming.confidence ?? 0.5,
          status: "conflict",
        },
      });

      await db.productFactConflict.create({
        data: {
          orgId: input.orgId,
          jobId: input.jobId,
          fieldKey: incoming.fieldKey,
          currentFactId: existing.id,
          incomingFactId: incomingFact.id,
          currentValue: existing.value as object,
          incomingValue: incoming.value as object,
          status: "open",
        },
      });

      await db.productFact.update({
        where: { id: existing.id },
        data: { status: "conflict" },
      });

      results.push({ fieldKey: incoming.fieldKey, action: "conflict", factId: incomingFact.id });
      continue;
    }

    if (shouldOverwrite(existing.sourceType, incoming.sourceType, existing.locked)) {
      const updated = await db.productFact.update({
        where: { id: existing.id },
        data: {
          value: incoming.value as object,
          normalizedValue: incoming.value as object,
          sourceType: incoming.sourceType,
          sourceId: incoming.sourceId,
          sourceLocation: incoming.sourceLocation,
          confidence: incoming.confidence ?? existing.confidence,
          status: canAutoConfirm(incoming.sourceType) ? "extracted" : "needs_review",
        },
      });
      results.push({ fieldKey: incoming.fieldKey, action: "updated", factId: updated.id });
    } else {
      results.push({ fieldKey: incoming.fieldKey, action: "skipped", factId: existing.id });
    }
  }

  return results;
}

export async function confirmProductFact(input: {
  orgId: string;
  userId: string;
  factId: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const fact = await db.productFact.findFirst({
    where: { id: input.factId, orgId: input.orgId },
  });
  if (!fact) throw new Error("产品事实不存在");

  const updated = await db.productFact.update({
    where: { id: fact.id },
    data: {
      status: "confirmed",
      sourceType: "confirmed_human",
      confirmedById: input.userId,
      confirmedAt: new Date(),
    },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: "product_fact",
    targetId: fact.id,
    afterData: { status: "confirmed", fieldKey: fact.fieldKey },
  });

  return updated;
}

export async function rejectProductFact(input: {
  orgId: string;
  userId: string;
  factId: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const fact = await db.productFact.findFirst({
    where: { id: input.factId, orgId: input.orgId },
  });
  if (!fact) throw new Error("产品事实不存在");

  return db.productFact.update({
    where: { id: fact.id },
    data: { status: "rejected" },
  });
}

export async function lockProductFact(input: {
  orgId: string;
  userId: string;
  factId: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const fact = await db.productFact.findFirst({
    where: { id: input.factId, orgId: input.orgId },
  });
  if (!fact) throw new Error("产品事实不存在");

  const updated = await db.productFact.update({
    where: { id: fact.id },
    data: { locked: true, status: "confirmed" },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.UPDATE,
    targetType: "product_fact",
    targetId: fact.id,
    afterData: { locked: true, fieldKey: fact.fieldKey },
  });

  return updated;
}

export async function generateExecutionPlan(input: {
  orgId: string;
  jobId: string;
  userId: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const job = await loadJob(input.orgId, input.jobId);

  const facts = await db.productFact.findMany({
    where: {
      orgId: input.orgId,
      jobId: input.jobId,
      status: { in: ["extracted", "confirmed", "needs_review"] },
    },
    select: { fieldKey: true, value: true },
  });

  const factRecord = factValueToRecord(facts);
  const pack = getIndustryPack(job.industryPack);
  const missing = listMissingFields(factRecord);

  const plan: ExecutionPlan = {
    visuals: [
      { mode: "EXACT", sceneType: "white_bg", count: 1 },
      { mode: "STUDIO", sceneType: "bedroom", count: 1 },
      { mode: "STUDIO", sceneType: "hotel", count: 1 },
      { mode: "STUDIO", sceneType: "marketing_layout", count: 1 },
    ],
    missingFields: missing.map((f) => f.key),
    notes: missing.length
      ? [`仍有 ${missing.length} 个必填字段待补充`]
      : ["必填字段已满足，可进入视觉生成"],
  };

  const updated = await db.productContentJob.update({
    where: { id: job.id },
    data: {
      planJson: plan as object,
      missingFieldsJson: missing.map((f) => ({ key: f.key, label: f.label })),
      status: missing.length > 0 ? "NEEDS_INPUT" : "PLAN_READY",
    },
  });

  return { job: updated, plan, missingFields: missing };
}

export async function approveExecutionPlan(input: {
  orgId: string;
  jobId: string;
  userId: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const job = await loadJob(input.orgId, input.jobId);

  const plan = (job.planJson as ExecutionPlan | null) ?? null;
  if (!plan) throw new Error("执行计划不存在，请先生成计划");

  const approvedPlan: ExecutionPlan = {
    ...plan,
    approvedAt: new Date().toISOString(),
    approvedById: input.userId,
  };

  return db.productContentJob.update({
    where: { id: job.id },
    data: {
      planJson: approvedPlan as object,
      status: "PLAN_READY",
    },
  });
}

export async function requestApproval(input: {
  orgId: string;
  jobId: string;
  userId: string;
  actionKey: ApprovalActionKey;
  payload?: unknown;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const job = await loadJob(input.orgId, input.jobId);
  const settings = await getOrCreateApprovalSettings(input.orgId);
  const policy = resolveApprovalPolicy(
    settings,
    job.executionMode as ExecutionMode,
    input.actionKey,
  );

  if (policy === "AUTO_ALLOW") {
    return db.productContentApproval.create({
      data: {
        orgId: input.orgId,
        jobId: input.jobId,
        actionKey: input.actionKey,
        policy,
        status: "auto_allowed",
        requestedById: input.userId,
        decidedById: input.userId,
        decidedAt: new Date(),
        payloadJson: input.payload as object | undefined,
      },
    });
  }

  return db.productContentApproval.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      actionKey: input.actionKey,
      policy,
      status: "pending",
      requestedById: input.userId,
      payloadJson: input.payload as object | undefined,
    },
  });
}

export async function decideApproval(input: {
  orgId: string;
  jobId: string;
  userId: string;
  approvalId: string;
  decision: "approved" | "rejected";
  reason?: string;
}) {
  await assertOrgAccess(input.orgId, input.userId);
  const approval = await db.productContentApproval.findFirst({
    where: { id: input.approvalId, orgId: input.orgId, jobId: input.jobId },
  });
  if (!approval) throw new Error("审批记录不存在");
  if (approval.status !== "pending") {
    throw new Error("该审批已处理");
  }

  return db.productContentApproval.update({
    where: { id: approval.id },
    data: {
      status: input.decision,
      decidedById: input.userId,
      decidedAt: new Date(),
      reason: input.reason,
    },
  });
}

export async function getJobFactsMap(orgId: string, jobId: string) {
  const facts = await db.productFact.findMany({
    where: {
      orgId,
      jobId,
      status: { in: ["extracted", "confirmed", "needs_review"] },
    },
  });
  return factValueToRecord(facts.map((f) => ({ fieldKey: f.fieldKey, value: f.value })));
}
