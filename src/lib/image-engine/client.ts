import { randomUUID } from "crypto";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { runImageEdit } from "@/lib/visualizer/image-ai";
import {
  buildImagePrompt,
  defaultProtectionRules,
  pickImageProvider,
} from "@/lib/image-engine/types";
import type { ImageEditRequest } from "@/lib/product-content/types";
import type { ImageEditResult } from "@/lib/image-engine/types";

export interface ImageEditDeps {
  readBlob?: typeof readBlobBuffer;
  runEdit?: typeof runImageEdit;
}

function isDryRun(request: ImageEditRequest): boolean {
  if (request.dryRun) return true;
  if (process.env.PRODUCT_CONTENT_IMAGE_DRY_RUN === "1") return true;
  if (process.env.PRODUCT_CONTENT_IMAGE_GENERATE_ENABLED === "0") return true;
  return false;
}

export async function editProductImage(
  request: ImageEditRequest,
  deps: ImageEditDeps = {},
): Promise<ImageEditResult> {
  const readBlob = deps.readBlob ?? readBlobBuffer;
  const runEdit = deps.runEdit ?? runImageEdit;

  const provider = pickImageProvider({
    mode: request.mode,
    geometryClass: request.geometryClass,
  });

  const protection =
    request.protectionRules ?? defaultProtectionRules(request.mode);

  const prompt =
    request.prompt ||
    buildImagePrompt({
      mode: request.mode,
      sceneType: request.sceneType,
      protection,
    });

  const dryRun = isDryRun(request);
  const requestId = randomUUID();
  const startedAt = Date.now();

  if (!request.primaryImagePath) {
    throw new Error("缺少主图，无法进行 EXACT/STUDIO 图像编辑");
  }

  const primary = await readBlob(request.primaryImagePath);
  if (!primary?.buffer || primary.buffer.byteLength === 0) {
    throw new Error("无法读取主图或主图为空");
  }

  const references: Array<{ buffer: Buffer; mime: string; fileName?: string }> = [];
  let referenceBytes = 0;
  for (const refPath of request.referenceImagePaths ?? []) {
    const ref = await readBlob(refPath);
    if (ref?.buffer && ref.buffer.byteLength > 0) {
      referenceBytes += ref.buffer.byteLength;
      references.push({
        buffer: ref.buffer,
        mime: ref.contentType || "image/png",
        fileName: refPath.split("/").pop(),
      });
    }
  }

  const primaryBytes = primary.buffer.byteLength;
  const referenceCount = references.length;

  console.info(
    "[image-engine]",
    JSON.stringify({
      event: "image_edit_request",
      mode: request.mode,
      provider: provider.id,
      primaryBytes,
      referenceCount,
      referenceBytes,
      hasMask: false,
      dryRun,
      jobId: request.jobId,
    }),
  );

  if (dryRun) {
    const latencyMs = Date.now() - startedAt;
    return {
      dryRun: true,
      provider: provider.id,
      model: "dry-run",
      metadata: {
        sceneType: request.sceneType,
        mode: request.mode,
        prompt,
        placeholder: true,
        primaryBytes,
        referenceCount,
        referenceBytes,
        latencyMs,
        requestId,
        startedAt,
        endedAt: Date.now(),
      },
    };
  }

  const quality =
    request.mode === "EXACT" ? "high" : request.mode === "STUDIO" ? "medium" : "auto";

  const { ProviderRouter } = await import("@/lib/ai/model-registry");
  // 统一 OPENAI_IMAGE_MODEL → pinned（不再维护 PRODUCT_CONTENT_IMAGE_MODEL）
  const modelCandidates = [
    ProviderRouter.getImageModel(),
    ProviderRouter.getImagePinnedModel(),
  ].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

  let edited: Buffer | null = null;
  let usedModel = modelCandidates[0] || ProviderRouter.getImageModel();
  const modelErrors: string[] = [];

  for (const model of modelCandidates) {
    usedModel = model;
    edited = await runEdit({
      imageBuffer: primary.buffer,
      imageMime: primary.contentType || "image/jpeg",
      prompt,
      referenceImages: references,
      quality,
      model,
    });
    if (edited) break;
    modelErrors.push(model);
    console.warn(`[image-engine] model failed, trying next: ${model}`);
  }

  const latencyMs = Date.now() - startedAt;

  if (!edited) {
    throw new Error(
      `图像编辑 provider 返回空结果（已尝试: ${modelErrors.join(", ") || usedModel}）`,
    );
  }

  return {
    buffer: edited,
    dryRun: false,
    provider: provider.id,
    model: usedModel,
    metadata: {
      sceneType: request.sceneType,
      mode: request.mode,
      prompt,
      primaryBytes,
      referenceCount,
      referenceBytes,
      latencyMs,
      requestId,
      startedAt,
      endedAt: Date.now(),
      modelsTried: modelCandidates,
    },
  };
}
