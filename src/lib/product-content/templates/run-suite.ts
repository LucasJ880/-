/**
 * 按模版套图生成视觉输出（不重跑 analyze/copy/document 流水线）
 */

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { putPrivateBlob, readBlobBuffer } from "@/lib/files/blob-access";
import { runImageEditDetailed } from "@/lib/visualizer/image-ai";
import { ProviderRouter } from "@/lib/ai/model-registry";
import {
  classifyImageProviderError,
  shouldRetryWithPinnedModel,
} from "@/lib/image-engine/errors";
import { estimateImageEditCostCents, recordCostEntry } from "@/lib/product-content/cost/ledger";
import { getVisualTemplateSuite } from "./registry";
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_RESOLUTION,
  framingPromptSuffix,
  mapAspectRatioToImageSize,
} from "./options";
import type {
  AspectRatio,
  ProductUploadSlotId,
  Resolution,
  StyleRefKind,
} from "./types";
import { PRODUCT_SLOT_PURPOSES } from "./types";

async function assertOrgAccess(orgId: string, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user && isSuperAdmin(user.role)) return;
  const m = await getOrgMembership(userId, orgId);
  if (!m || m.status !== "active") throw new Error("无权访问该组织");
}

function publicAssetAbs(publicPath: string): string {
  const rel = publicPath.replace(/^\//, "");
  return path.join(process.cwd(), "public", rel);
}

async function loadStyleBuffer(
  publicPath: string | undefined,
): Promise<{ buffer: Buffer; mime: string; fileName: string } | null> {
  if (!publicPath) return null;
  const abs = publicAssetAbs(publicPath);
  if (!fs.existsSync(abs)) return null;
  const buffer = fs.readFileSync(abs);
  const lower = abs.toLowerCase();
  const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
  return {
    buffer,
    mime,
    fileName: path.basename(abs),
  };
}

export type SuiteSlotPaths = Partial<Record<ProductUploadSlotId, string>>;

export async function resolveSuiteSlotPaths(
  orgId: string,
  jobId: string,
): Promise<SuiteSlotPaths> {
  const inputs = await db.productContentJobInput.findMany({
    where: {
      orgId,
      jobId,
      purpose: { in: [...PRODUCT_SLOT_PURPOSES] },
      blobPathname: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  const slots: SuiteSlotPaths = {};
  for (const input of inputs) {
    const purpose = input.purpose as ProductUploadSlotId;
    if (!PRODUCT_SLOT_PURPOSES.includes(purpose)) continue;
    if (slots[purpose]) continue; // 最新优先
    if (input.blobPathname) slots[purpose] = input.blobPathname;
  }

  // 兼容：若无 product_front，回退主图 asset / 任意 image input
  if (!slots.product_front) {
    const primaryAsset = await db.productAsset.findFirst({
      where: {
        orgId,
        jobId,
        OR: [
          { roleConfirmed: "primary" },
          { roleAuto: { in: ["primary", "primary_product"] } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (primaryAsset?.blobPathname) {
      slots.product_front = primaryAsset.blobPathname;
    } else {
      const anyImage = await db.productContentJobInput.findFirst({
        where: {
          orgId,
          jobId,
          inputType: "image",
          blobPathname: { not: null },
        },
        orderBy: { createdAt: "asc" },
      });
      if (anyImage?.blobPathname) slots.product_front = anyImage.blobPathname;
    }
  }

  return slots;
}

async function editWithFallback(args: {
  imageBuffer: Buffer;
  imageMime: string;
  prompt: string;
  size: string;
  quality: "low" | "medium" | "high" | "auto";
  referenceImages: Array<{ buffer: Buffer; mime: string; fileName?: string }>;
}) {
  const primary = ProviderRouter.getProductContentImageModel();
  const pinned = ProviderRouter.getImagePinnedModel();
  const candidates = [primary, pinned].filter(
    (m, i, arr) => Boolean(m) && arr.indexOf(m) === i,
  );

  let lastErr = "";
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const detailed = await runImageEditDetailed({
      imageBuffer: args.imageBuffer,
      imageMime: args.imageMime,
      prompt: args.prompt,
      referenceImages: args.referenceImages,
      quality: args.quality,
      size: args.size,
      model,
      attemptNumber: i + 1,
    });
    if (detailed.buffer) {
      return {
        buffer: detailed.buffer,
        model,
        execution: detailed.execution,
        fellBack: i > 0,
        providerErrorCode: detailed.providerErrorCode,
      };
    }
    const code =
      detailed.providerErrorCode ||
      classifyImageProviderError({
        httpStatus: detailed.httpStatus,
        body: detailed.errorBody,
      });
    lastErr = `${model}:${code}:${detailed.httpStatus}`;
    if (!shouldRetryWithPinnedModel(code)) break;
  }
  throw new Error(`套图出图失败（${lastErr}）`);
}

function collectStyleRefs(
  kind: StyleRefKind,
  modelBuf: { buffer: Buffer; mime: string; fileName: string } | null,
  displayBuf: { buffer: Buffer; mime: string; fileName: string } | null,
) {
  const out: Array<{ buffer: Buffer; mime: string; fileName?: string }> = [];
  if ((kind === "model" || kind === "both") && modelBuf) out.push(modelBuf);
  if ((kind === "display" || kind === "both") && displayBuf) out.push(displayBuf);
  return out;
}

export async function runVisualTemplateSuite(input: {
  orgId: string;
  jobId: string;
  userId: string;
  suiteId: string;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  dryRun?: boolean;
}) {
  await assertOrgAccess(input.orgId, input.userId);

  const suite = getVisualTemplateSuite(input.suiteId);
  if (!suite) throw new Error(`套图模板不存在: ${input.suiteId}`);

  const aspectRatio = input.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const resolution = input.resolution ?? DEFAULT_RESOLUTION;

  if (!suite.supportedAspectRatios.includes(aspectRatio)) {
    throw new Error(`该模板不支持比例 ${aspectRatio}`);
  }
  if (!suite.supportedResolutions.includes(resolution)) {
    throw new Error(`该模板不支持分辨率 ${resolution}`);
  }

  const job = await db.productContentJob.findFirst({
    where: { id: input.jobId, orgId: input.orgId },
  });
  if (!job) throw new Error("产品内容任务不存在");

  const slots = await resolveSuiteSlotPaths(input.orgId, input.jobId);
  if (!slots.product_front) {
    throw new Error("请先上传正面产品图（product_front）");
  }

  const dryRun =
    input.dryRun === true ||
    process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN === "1" ||
    process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED === "0";

  const primaryBlob = await readBlobBuffer(slots.product_front);
  if (!primaryBlob?.buffer?.byteLength) {
    throw new Error("无法读取正面产品图");
  }

  const refBuffers: Array<{ buffer: Buffer; mime: string; fileName?: string }> =
    [];
  for (const slotId of [
    "product_side",
    "product_detail",
    "product_texture",
  ] as const) {
    const p = slots[slotId];
    if (!p) continue;
    const blob = await readBlobBuffer(p);
    if (blob?.buffer?.byteLength) {
      refBuffers.push({
        buffer: blob.buffer,
        mime: blob.contentType || "image/jpeg",
        fileName: `${slotId}.jpg`,
      });
    }
  }

  const modelStyle = await loadStyleBuffer(suite.styleAssetPaths?.model);
  const displayStyle = await loadStyleBuffer(suite.styleAssetPaths?.display);

  const size = mapAspectRatioToImageSize(aspectRatio, resolution);
  const framing = framingPromptSuffix(aspectRatio, resolution);
  const outputs: Array<{
    shotKey: string;
    outputId: string;
    blobPathname: string | null;
    model?: string;
    dryRun: boolean;
  }> = [];

  for (const shot of suite.shots) {
    const visualJob = await db.visualGenerationJob.create({
      data: {
        orgId: input.orgId,
        jobId: input.jobId,
        mode: shot.mode,
        sceneType: shot.key,
        status: "running",
        prompt: shot.promptBody.slice(0, 2000),
      },
    });

    const prompt = `${shot.promptBody} ${framing}`;
    const styleRefs = collectStyleRefs(shot.styleRefs, modelStyle, displayStyle);
    // 再附一份正面作细节参考，强化真实感
    const referenceImages = [
      {
        buffer: primaryBlob.buffer,
        mime: primaryBlob.contentType || "image/jpeg",
        fileName: "product-front-detail.jpg",
      },
      ...refBuffers,
      ...styleRefs,
    ].slice(0, 8);

    const estimatedCostCents = estimateImageEditCostCents(shot.mode);
    const startedAt = Date.now();

    try {
      if (dryRun) {
        const placeholderPath = `product-content/${input.orgId}/${input.jobId}/visuals/${visualJob.id}-${shot.key}-dry-run.json`;
        await putPrivateBlob({
          pathname: placeholderPath,
          body: JSON.stringify({
            dryRun: true,
            suiteId: suite.id,
            shotKey: shot.key,
            aspectRatio,
            resolution,
          }),
          contentType: "application/json",
        });
        const output = await db.visualOutput.create({
          data: {
            orgId: input.orgId,
            visualJobId: visualJob.id,
            blobPathname: placeholderPath,
            provider: "openai_image_edit",
            model: "dry-run",
            status: "generated",
            metadata: {
              templateSuiteId: suite.id,
              shotKey: shot.key,
              aspectRatio,
              resolution,
              dryRun: true,
              placeholder: true,
            },
          },
        });
        await db.visualGenerationJob.update({
          where: { id: visualJob.id },
          data: { status: "done", model: "dry-run", costCents: 0 },
        });
        outputs.push({
          shotKey: shot.key,
          outputId: output.id,
          blobPathname: placeholderPath,
          model: "dry-run",
          dryRun: true,
        });
        continue;
      }

      const edited = await editWithFallback({
        imageBuffer: primaryBlob.buffer,
        imageMime: primaryBlob.contentType || "image/jpeg",
        prompt,
        size,
        quality: suite.quality,
        referenceImages,
      });

      const blobPut = await putPrivateBlob({
        pathname: `product-content/${input.orgId}/${input.jobId}/visuals/${visualJob.id}-${shot.key}.png`,
        body: edited.buffer,
        contentType: "image/png",
      });

      await recordCostEntry({
        orgId: input.orgId,
        jobId: input.jobId,
        category: "image_edit",
        provider: "openai_image_edit",
        model: edited.model,
        estimatedCents: estimatedCostCents,
        actualCents: estimatedCostCents,
        latencyMs: Date.now() - startedAt,
        meta: {
          templateSuiteId: suite.id,
          shotKey: shot.key,
          aspectRatio,
          resolution,
        },
      }).catch(() => undefined);

      const output = await db.visualOutput.create({
        data: {
          orgId: input.orgId,
          visualJobId: visualJob.id,
          blobPathname: blobPut.pathname,
          provider: "openai_image_edit",
          model: edited.model,
          status: "generated",
          metadata: {
            templateSuiteId: suite.id,
            shotKey: shot.key,
            shotLabel: shot.label,
            aspectRatio,
            resolution,
            size,
            quality: suite.quality,
            fellBack: edited.fellBack,
            providerErrorCode: edited.providerErrorCode,
            requestedModel: ProviderRouter.getProductContentImageModel(),
            resolvedModel: edited.model,
            latencyMs: Date.now() - startedAt,
            primaryBytes: primaryBlob.buffer.byteLength,
            referenceCount: referenceImages.length,
          },
        },
      });

      await db.visualGenerationJob.update({
        where: { id: visualJob.id },
        data: {
          status: "done",
          provider: "openai_image_edit",
          model: edited.model,
          costCents: estimatedCostCents,
        },
      });

      outputs.push({
        shotKey: shot.key,
        outputId: output.id,
        blobPathname: blobPut.pathname,
        model: edited.model,
        dryRun: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.visualGenerationJob.update({
        where: { id: visualJob.id },
        data: { status: "failed", errorMessage: msg },
      });
      throw new Error(`套图镜头 ${shot.key} 失败：${msg}`);
    }
  }

  return {
    suiteId: suite.id,
    suiteName: suite.name,
    aspectRatio,
    resolution,
    shotCount: outputs.length,
    outputs,
    slotsUsed: slots,
  };
}
