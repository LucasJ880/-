import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { editProductImage } from "@/lib/image-engine/client";
import { analyzeJobInputs } from "@/lib/product-content/intake/analyze";
import { generateProductCopy } from "@/lib/product-content/copy/generate";
import { generateProductDocuments } from "@/lib/product-content/documents/generate";
import {
  FIDELITY_QA_THRESHOLDS,
  runProductFidelityQa,
} from "@/lib/product-content/qa/fidelity";
import {
  checkJobBudget,
  estimateImageEditCostCents,
  recordCostEntry,
} from "@/lib/product-content/cost/ledger";
import { resolveApprovalPolicy } from "@/lib/product-content/approval/policy";
import { getOrCreateApprovalSettings } from "@/lib/product-content/approval/settings";
import {
  generateExecutionPlan,
  requestApproval,
  setJobStatus,
  upsertProductContentStep,
} from "@/lib/product-content/jobs/service";
import type { ExecutionMode, ExecutionPlan, VisualGenerationMode } from "@/lib/product-content/types";

const REFERENCE_ROLES = new Set([
  "detail",
  "texture",
  "logo",
  "label",
  "primary",
  "primary_product",
]);

async function hasPendingApproval(orgId: string, jobId: string, actionKey: string) {
  const pending = await db.productContentApproval.findFirst({
    where: { orgId, jobId, actionKey, status: "pending" },
  });
  return Boolean(pending);
}

async function ensureApproval(
  orgId: string,
  jobId: string,
  userId: string,
  actionKey: Parameters<typeof resolveApprovalPolicy>[2],
  executionMode: ExecutionMode,
) {
  const settings = await getOrCreateApprovalSettings(orgId);
  const policy = resolveApprovalPolicy(settings, executionMode, actionKey);
  if (policy === "AUTO_ALLOW") return { allowed: true as const, policy };

  const approval = await requestApproval({ orgId, jobId, userId, actionKey });
  if (approval.status === "auto_allowed") return { allowed: true as const, policy };

  return { allowed: false as const, policy, approvalId: approval.id };
}

async function findPrimaryImage(orgId: string, jobId: string) {
  const asset = await db.productAsset.findFirst({
    where: {
      orgId,
      jobId,
      roleAuto: { in: ["primary", "primary_product", "unknown", "white_bg"] },
    },
    orderBy: { createdAt: "asc" },
  });
  return asset?.blobPathname ?? null;
}

async function collectReferenceImagePaths(orgId: string, jobId: string, primaryPath: string) {
  const assets = await db.productAsset.findMany({
    where: { orgId, jobId },
    orderBy: { createdAt: "asc" },
  });

  const paths: string[] = [];
  for (const asset of assets) {
    const role = asset.roleConfirmed ?? asset.roleAuto;
    if (!REFERENCE_ROLES.has(role)) continue;
    if (asset.blobPathname === primaryPath) continue;
    paths.push(asset.blobPathname);
  }
  return paths;
}

async function sceneTypeAlreadyDone(orgId: string, jobId: string, sceneType: string) {
  const existing = await db.visualGenerationJob.findFirst({
    where: { orgId, jobId, sceneType },
    include: {
      outputs: {
        where: { status: { in: ["approved", "locked"] } },
        take: 1,
      },
    },
  });
  return Boolean(existing?.outputs.length);
}

async function runSingleVisual(input: {
  orgId: string;
  jobId: string;
  userId: string;
  visual: ExecutionPlan["visuals"][number];
  primaryPath: string;
  referencePaths: string[];
  dryRunVisuals?: boolean;
}) {
  const visualJob = await db.visualGenerationJob.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      mode: input.visual.mode,
      sceneType: input.visual.sceneType,
      status: "running",
    },
  });

  let attempt = 0;
  let lastError: string | null = null;
  let outputId: string | null = null;

  while (attempt < 2) {
    attempt += 1;
    const retryCount = attempt - 1;
    const execStartedAt = Date.now();

    try {
      const budget = await checkJobBudget(input.orgId, input.jobId);
      if (!budget.allowed) {
        throw new Error(budget.reason ?? "超出任务成本预算");
      }

      const result = await editProductImage({
        orgId: input.orgId,
        jobId: input.jobId,
        mode: input.visual.mode as VisualGenerationMode,
        sceneType: input.visual.sceneType,
        primaryImagePath: input.primaryPath,
        referenceImagePaths: input.referencePaths,
        dryRun: input.dryRunVisuals,
        prompt: "",
      });

      const estimatedCostCents = estimateImageEditCostCents(input.visual.mode);
      await recordCostEntry({
        orgId: input.orgId,
        jobId: input.jobId,
        category: "image_edit",
        provider: result.provider,
        model: result.model,
        estimatedCents: estimatedCostCents,
        actualCents: result.dryRun ? 0 : estimatedCostCents,
        requestId: String(result.metadata.requestId ?? ""),
        latencyMs: Number(result.metadata.latencyMs ?? 0),
        meta: {
          sceneType: input.visual.sceneType,
          mode: input.visual.mode,
          dryRun: result.dryRun,
        },
      });

      let blobPath: string | null = null;
      if (result.buffer) {
        const put = await putPrivateBlob({
          pathname: `product-content/${input.orgId}/${input.jobId}/visuals/${visualJob.id}-${input.visual.sceneType}.png`,
          body: result.buffer,
          contentType: "image/png",
        });
        blobPath = put.pathname;
      } else if (result.dryRun) {
        blobPath = `product-content/${input.orgId}/${input.jobId}/visuals/${visualJob.id}-dry-run.json`;
        await putPrivateBlob({
          pathname: blobPath,
          body: JSON.stringify(result.metadata),
          contentType: "application/json",
        });
      }

      const execMetadata = {
        ...result.metadata,
        provider: result.provider,
        model: result.model,
        estimatedCostCents,
        retryCount,
        failureReason: null,
        startedAt: execStartedAt,
        endedAt: Date.now(),
      };

      const output = await db.visualOutput.create({
        data: {
          orgId: input.orgId,
          visualJobId: visualJob.id,
          blobPathname: blobPath,
          provider: result.provider,
          model: result.model,
          metadata: execMetadata as object,
          status: "generated",
        },
      });
      outputId = output.id;

      const qa = await runProductFidelityQa({
        orgId: input.orgId,
        jobId: input.jobId,
        visualOutputId: output.id,
        mode: input.visual.mode as VisualGenerationMode,
        metadata: execMetadata,
        dryRun: result.dryRun,
      });

      // dry-run 不因启发式低分重试，避免重复占位输出
      if (
        !result.dryRun &&
        qa.qa.recommendedStatus === "REJECT" &&
        qa.qa.overallScore < FIDELITY_QA_THRESHOLDS.review &&
        attempt < 2
      ) {
        continue;
      }

      await db.visualGenerationJob.update({
        where: { id: visualJob.id },
        data: {
          status: "done",
          provider: result.provider,
          model: result.model,
          costCents: estimatedCostCents,
        },
      });

      return { ok: true as const, outputId: output.id };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await db.visualGenerationJob.update({
        where: { id: visualJob.id },
        data: {
          status: attempt >= 2 ? "failed" : "running",
          errorMessage: lastError,
        },
      });
    }
  }

  return { ok: false as const, outputId, error: lastError };
}

export async function createVisualsForJob(input: {
  orgId: string;
  jobId: string;
  userId: string;
  plan: ExecutionPlan;
  dryRunVisuals?: boolean;
}) {
  const primaryPath = await findPrimaryImage(input.orgId, input.jobId);
  if (!primaryPath) {
    throw new Error("缺少产品主图，无法生成视觉内容");
  }

  const referencePaths = await collectReferenceImagePaths(
    input.orgId,
    input.jobId,
    primaryPath,
  );

  const outputs: string[] = [];
  let successCount = 0;

  for (const visual of input.plan.visuals) {
    if (await sceneTypeAlreadyDone(input.orgId, input.jobId, visual.sceneType)) {
      continue;
    }

    for (let i = 0; i < visual.count; i++) {
      const result = await runSingleVisual({
        orgId: input.orgId,
        jobId: input.jobId,
        userId: input.userId,
        visual,
        primaryPath,
        referencePaths,
        dryRunVisuals: input.dryRunVisuals,
      });

      if (result.ok && result.outputId) {
        successCount += 1;
        outputs.push(result.outputId);
      }
    }
  }

  if (successCount === 0 && input.plan.visuals.length > 0) {
    throw new Error("所有视觉场景生成均失败");
  }

  return outputs;
}

export async function regenerateVisualOutput(input: {
  orgId: string;
  jobId: string;
  userId: string;
  outputId: string;
  dryRunVisuals?: boolean;
}) {
  const output = await db.visualOutput.findFirst({
    where: { id: input.outputId, orgId: input.orgId },
    include: { visualJob: true },
  });
  if (!output) throw new Error("视觉输出不存在");
  if (output.locked || output.status === "locked") {
    throw new Error("该视觉输出已锁定，无法重新生成");
  }
  if (output.visualJob.jobId !== input.jobId) {
    throw new Error("视觉输出不属于该任务");
  }

  const primaryPath = await findPrimaryImage(input.orgId, input.jobId);
  if (!primaryPath) throw new Error("缺少产品主图");

  const referencePaths = await collectReferenceImagePaths(
    input.orgId,
    input.jobId,
    primaryPath,
  );

  const result = await runSingleVisual({
    orgId: input.orgId,
    jobId: input.jobId,
    userId: input.userId,
    visual: {
      mode: output.visualJob.mode as VisualGenerationMode,
      sceneType: output.visualJob.sceneType,
      count: 1,
    },
    primaryPath,
    referencePaths,
    dryRunVisuals: input.dryRunVisuals,
  });

  if (!result.ok || !result.outputId) {
    throw new Error(result.error ?? "重新生成失败");
  }

  if (output.status !== "locked") {
    await db.visualOutput.update({
      where: { id: output.id },
      data: { status: "rejected" },
    });
  }

  return { outputId: result.outputId };
}

export async function runProductContentPipeline(
  orgId: string,
  jobId: string,
  userId: string,
  opts?: {
    dryRunVisuals?: boolean;
    formalDocuments?: boolean;
    /** 缺字段时强制停在 NEEDS_INPUT（即使 INTERNAL_DRAFT） */
    stopOnMissing?: boolean;
    /** 显式允许缺字段继续内部草稿流水线 */
    allowDraftContinue?: boolean;
  },
) {
  const job = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw new Error("产品内容任务不存在");

  const executionMode = job.executionMode as ExecutionMode;

  try {
    await upsertProductContentStep(orgId, jobId, "pipeline", {
      status: "running",
      startedAt: new Date(),
    });

    const analyzeGate = await ensureApproval(
      orgId,
      jobId,
      userId,
      "analyze_files",
      executionMode,
    );
    if (!analyzeGate.allowed) {
      await setJobStatus({ orgId, userId, jobId, status: "AWAITING_APPROVAL" });
      return { status: "AWAITING_APPROVAL", step: "analyze_files" };
    }
    await analyzeJobInputs(orgId, jobId, userId);

    const { plan, missingFields } = await generateExecutionPlan({ orgId, jobId, userId });
    const purpose = (job.documentPurpose || "INTERNAL_DRAFT") as string;
    const stopOnMissing =
      opts?.stopOnMissing === true ||
      (missingFields.length > 0 &&
        purpose !== "INTERNAL_DRAFT" &&
        opts?.allowDraftContinue !== true);

    if (missingFields.length > 0) {
      await upsertProductContentStep(orgId, jobId, "pipeline", {
        status: stopOnMissing ? "waiting" : "running",
        outputJson: {
          missingFields: missingFields.map((f) => f.key),
          draftContinue: !stopOnMissing,
          documentPurpose: purpose,
        },
      });

      // 正式用途：缺字段必须停在 NEEDS_INPUT。内部草稿可继续生成，但不得伪装成已齐套。
      if (stopOnMissing) {
        return {
          status: "NEEDS_INPUT",
          missingFields: missingFields.map((f) => f.key),
        };
      }

      if (job.status === "NEEDS_INPUT") {
        await setJobStatus({
          orgId,
          userId,
          jobId,
          status: "PLAN_READY",
        });
      }
    }

    if (executionMode === "ALWAYS_ASK") {
      await requestApproval({
        orgId,
        jobId,
        userId,
        actionKey: "generate_low_cost_visuals",
        payload: plan,
      });
      await setJobStatus({ orgId, userId, jobId, status: "AWAITING_APPROVAL" });
      return { status: "AWAITING_APPROVAL", step: "execution_plan" };
    }

    const visualGate = await ensureApproval(
      orgId,
      jobId,
      userId,
      "generate_low_cost_visuals",
      executionMode,
    );
    if (!visualGate.allowed) {
      await setJobStatus({ orgId, userId, jobId, status: "AWAITING_APPROVAL" });
      return { status: "AWAITING_APPROVAL", step: "generate_low_cost_visuals" };
    }

    await setJobStatus({ orgId, userId, jobId, status: "GENERATING_VISUALS" });
    await createVisualsForJob({
      orgId,
      jobId,
      userId,
      plan,
      dryRunVisuals: opts?.dryRunVisuals,
    });

    await setJobStatus({ orgId, userId, jobId, status: "RUNNING_VISUAL_QA" });
    await setJobStatus({ orgId, userId, jobId, status: "GENERATING_CONTENT" });

    const copyGate = await ensureApproval(
      orgId,
      jobId,
      userId,
      "generate_copy_draft",
      executionMode,
    );
    if (!copyGate.allowed) {
      await setJobStatus({ orgId, userId, jobId, status: "AWAITING_APPROVAL" });
      return { status: "AWAITING_APPROVAL", step: "generate_copy_draft" };
    }
    await generateProductCopy(orgId, jobId, userId);

    const refreshed = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
    const docPurpose =
      (refreshed?.documentPurpose as string) || purpose || "INTERNAL_DRAFT";

    // 内部草稿：直接生成 DRAFT 文档，不走正式 PDF/ZIP 审批。
    // 正式用途：按审批策略询问后再生成。
    if (docPurpose === "INTERNAL_DRAFT" && !opts?.formalDocuments) {
      await setJobStatus({ orgId, userId, jobId, status: "GENERATING_DOCUMENTS" });
      await generateProductDocuments(orgId, jobId, userId, {
        purpose: "INTERNAL_DRAFT",
      });
    } else {
      const settings = await getOrCreateApprovalSettings(orgId);
      const zipPolicy = resolveApprovalPolicy(
        settings,
        executionMode,
        "generate_formal_zip",
      );
      const pdfPolicy = resolveApprovalPolicy(
        settings,
        executionMode,
        "generate_formal_pdf",
      );

      if (zipPolicy === "ASK_BEFORE" || pdfPolicy === "ASK_BEFORE") {
        const pendingZip = await hasPendingApproval(orgId, jobId, "generate_formal_zip");
        const pendingPdf = await hasPendingApproval(orgId, jobId, "generate_formal_pdf");
        if (!pendingZip && zipPolicy === "ASK_BEFORE") {
          await requestApproval({
            orgId,
            jobId,
            userId,
            actionKey: "generate_formal_zip",
          });
        }
        if (!pendingPdf && pdfPolicy === "ASK_BEFORE") {
          await requestApproval({
            orgId,
            jobId,
            userId,
            actionKey: "generate_formal_pdf",
          });
        }
        await setJobStatus({
          orgId,
          userId,
          jobId,
          status: "AWAITING_APPROVAL",
        });
        return {
          status: "AWAITING_APPROVAL",
          step: "generate_formal_documents",
          missingFields: missingFields.map((f) => f.key),
        };
      }

      await setJobStatus({ orgId, userId, jobId, status: "GENERATING_DOCUMENTS" });
      await generateProductDocuments(orgId, jobId, userId, {
        purpose: docPurpose as "INTERNAL_DRAFT" | "CUSTOMER_REVIEW" | "FORMAL_EXTERNAL",
        formalOnly: opts?.formalDocuments,
      });
    }

    await setJobStatus({ orgId, userId, jobId, status: "READY_FOR_REVIEW" });

    await upsertProductContentStep(orgId, jobId, "pipeline", {
      status: "done",
      finishedAt: new Date(),
      outputJson: {
        status: "READY_FOR_REVIEW",
        missingFields: missingFields.map((f) => f.key),
        documentPurpose: docPurpose,
      },
    });

    return {
      status: "READY_FOR_REVIEW",
      missingFields: missingFields.map((f) => f.key),
      documentPurpose: docPurpose,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setJobStatus({
      orgId,
      userId,
      jobId,
      status: "FAILED",
      errorMessage: message,
    }).catch(() => undefined);

    await upsertProductContentStep(orgId, jobId, "pipeline", {
      status: "failed",
      finishedAt: new Date(),
      errorMessage: message,
    });

    throw err;
  }
}
