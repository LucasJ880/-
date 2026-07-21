import { randomUUID } from "crypto";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { runImageEditDetailed } from "@/lib/visualizer/image-ai";
import {
  buildImagePrompt,
  defaultProtectionRules,
  pickImageProvider,
} from "@/lib/image-engine/types";
import {
  shouldRetryWithPinnedModel,
  type ProviderExecution,
} from "@/lib/image-engine/errors";
import type { ImageEditRequest } from "@/lib/product-content/types";
import type { ImageEditResult } from "@/lib/image-engine/types";

export interface ImageEditDeps {
  readBlob?: typeof readBlobBuffer;
  runEditDetailed?: typeof runImageEditDetailed;
  /** 测试兼容：仅返回 Buffer 时包装为 Detailed */
  runEdit?: (args: {
    imageBuffer: Buffer;
    imageMime: string;
    prompt: string;
    referenceImages?: Array<{ buffer: Buffer; mime: string; fileName?: string }>;
    quality?: "low" | "medium" | "high" | "auto";
    model?: string;
  }) => Promise<Buffer | null>;
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
  const runEditDetailed =
    deps.runEditDetailed ??
    (deps.runEdit
      ? async (args) => {
          const buffer = await deps.runEdit!(args);
          const providerErrorCode = buffer
            ? undefined
            : ("UNKNOWN_PROVIDER_ERROR" as const);
          const httpStatus = buffer ? 200 : 500;
          return {
            buffer,
            execution: {
              requestedModel: args.model || "test",
              resolvedModel: buffer ? args.model || "test" : undefined,
              attemptNumber: args.attemptNumber ?? 1,
              httpStatus,
              providerErrorCode,
            },
            providerErrorCode,
            httpStatus,
            errorBody: undefined as string | undefined,
          };
        }
      : runImageEditDetailed);

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
  // 默认 OPENAI_IMAGE_MODEL；可选 PRODUCT_CONTENT_IMAGE_MODEL 覆盖；失败可回退 pinned
  const primaryModel = ProviderRouter.getProductContentImageModel();
  const pinnedModel = ProviderRouter.getImagePinnedModel();
  const modelCandidates = [primaryModel, pinnedModel].filter(
    (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i,
  );

  let edited: Buffer | null = null;
  let usedModel = modelCandidates[0] || primaryModel;
  const executions: ProviderExecution[] = [];
  const modelErrors: string[] = [];

  for (let i = 0; i < modelCandidates.length; i++) {
    const model = modelCandidates[i];
    usedModel = model;
    const detailed = await runEditDetailed({
      imageBuffer: primary.buffer,
      imageMime: primary.contentType || "image/jpeg",
      prompt,
      referenceImages: references,
      quality,
      model,
      attemptNumber: i + 1,
    });

    const execution: ProviderExecution = {
      ...detailed.execution,
      requestedModel: modelCandidates[0],
      resolvedModel: detailed.buffer ? model : undefined,
      attemptNumber: i + 1,
    };

    if (!detailed.buffer && i > 0) {
      execution.fallbackReason = executions[0]?.providerErrorCode
        ? `primary_failed:${executions[0].providerErrorCode}`
        : "primary_failed";
    }
    if (!detailed.buffer && detailed.providerErrorCode) {
      execution.providerErrorCode = detailed.providerErrorCode;
      execution.httpStatus = detailed.httpStatus;
      execution.bodySnippet = detailed.errorBody?.slice(0, 400);
    }
    executions.push(execution);

    if (detailed.buffer) {
      edited = detailed.buffer;
      usedModel = model;
      break;
    }

    modelErrors.push(`${model}:${detailed.providerErrorCode || "empty"}`);
    console.warn(
      `[image-engine] model failed`,
      JSON.stringify({
        model,
        httpStatus: detailed.httpStatus,
        providerErrorCode: detailed.providerErrorCode,
        willRetryPinned:
          i === 0 &&
          modelCandidates.length > 1 &&
          shouldRetryWithPinnedModel(
            detailed.providerErrorCode || "UNKNOWN_PROVIDER_ERROR",
          ),
      }),
    );

    // 仅在可重试错误码时继续 pinned；参数非法等直接停
    if (
      detailed.providerErrorCode &&
      !shouldRetryWithPinnedModel(detailed.providerErrorCode)
    ) {
      break;
    }
  }

  const latencyMs = Date.now() - startedAt;
  const firstFail = executions.find((e) => e.providerErrorCode);
  const successExec = executions.find((e) => e.resolvedModel);

  if (!edited) {
    throw new Error(
      `图像编辑 provider 返回空结果（已尝试: ${modelErrors.join(", ") || usedModel}）` +
        (firstFail?.providerErrorCode
          ? ` [${firstFail.providerErrorCode}/${firstFail.httpStatus}]`
          : ""),
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
      requestedModel: modelCandidates[0],
      resolvedModel: usedModel,
      fallbackReason:
        successExec && usedModel !== modelCandidates[0]
          ? firstFail?.providerErrorCode
            ? `alias_or_primary_failed:${firstFail.providerErrorCode}`
            : "primary_failed_retry_pinned"
          : undefined,
      httpStatus: successExec?.httpStatus ?? 200,
      providerErrorCode: firstFail?.providerErrorCode,
      attemptNumber: successExec?.attemptNumber ?? 1,
      providerExecutions: executions,
    },
  };
}
