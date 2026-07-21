/**
 * product-visual-builder — dry-run service（Phase 1B-Service，轻量版）
 *
 * 只跑内部记录链路：AgentSkill → buildProductVisualPrompt → SkillExecution → AuditLog。
 * 本阶段不调用 Image Provider、不上传 Blob、不创建 API、不做前端。
 *
 * 安全边界：
 * - orgId / userId 必须由调用方（params）传入，不信任 input.orgId / input.userId。
 * - service 用 params.orgId / params.userId 覆盖 input 内的同名字段。
 * - 本阶段不深查 customerId / projectId 归属。
 *   注意：下一阶段的 API route 必须校验 OrganizationMember 以及
 *   customerId / projectId 是否属于当前 org，再调用本 service。
 *
 * 可测试性：依赖通过 deps 注入，默认绑定真实 db / logAudit；
 * 单测注入内存假实现，避免连接 / 写入生产数据库。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import type { AuditLogParams } from "@/lib/audit/logger";
import { buildProductVisualPrompt, FIXED_WARNINGS } from "./prompt";
import { generateProductVisualImage, type VisualImageSize } from "./image-client";
import {
  uploadVisualBuilderImage,
  VISUAL_BUILDER_PUBLIC_BLOB_NOTICE,
  type UploadImageParams,
  type UploadImageResult,
  type VisualAssetRole,
} from "./storage";
import type { VisualBuilderInput, VisualBuilderOutput, VisualStyle } from "./types";

export const PRODUCT_VISUAL_BUILDER_SLUG = "product-visual-builder";
const DRY_RUN_MODEL = "dry-run";

export const HUMAN_REVIEW_WARNING =
  "需人工确认：生成结果仅为建议，发布前请核对真实产品事实与认证。";

/** 真实生成各阶段的错误码（route 据此映射状态码，且不泄露底层细节）。 */
export const VPB_ERRORS = {
  SKILL_MISSING: "VPB_SKILL_MISSING",
  SOURCE_INVALID: "VPB_SOURCE_INVALID",
  IMAGE_FAILED: "VPB_IMAGE_FAILED",
  UPLOAD_FAILED: "VPB_UPLOAD_FAILED",
  EXEC_UPDATE_FAILED: "VPB_EXEC_UPDATE_FAILED",
} as const;

/** 运行选项；默认 dry-run（dryRun=true, generateEnabled=false）。 */
export interface VisualBuilderRunOptions {
  dryRun?: boolean;
  generateEnabled?: boolean;
  imageSize?: VisualImageSize;
}

/** 写入 SkillExecution 的记录契约（与现有 SkillExecution 字段对齐）。 */
export interface SkillExecutionRecord {
  skillId: string;
  userId: string;
  inputJson: string;
  outputJson: string;
  promptSnapshot: string;
  toolCalls: null;
  success: boolean;
  durationMs: number;
  tokenCount: null;
}

/** image-client 生成结果（service 视角，仅取必要字段）。 */
export interface ImageGenResult {
  model: string;
  images: Array<{ base64?: string; buffer?: Buffer }>;
  warnings: string[];
}

/** 可注入依赖；默认实现绑定真实 db / logAudit / 时钟。 */
export interface VisualBuilderDeps {
  findSkillId: (orgId: string, slug: string) => Promise<string | null>;
  createExecution: (record: SkillExecutionRecord) => Promise<{ id: string }>;
  logAudit: (params: AuditLogParams) => Promise<void>;
  now: () => number;
  // ── 以下仅真实生成路径需要（dry-run 不使用）──
  generateImage?: (args: {
    prompt: string;
    sourceImageUrls: string[];
    size: VisualImageSize;
  }) => Promise<ImageGenResult>;
  uploadImage?: (args: UploadImageParams) => Promise<UploadImageResult>;
  updateExecution?: (
    id: string,
    patch: { outputJson: string; success: boolean; durationMs: number },
  ) => Promise<void>;
}

export const defaultDeps: VisualBuilderDeps = {
  findSkillId: async (orgId, slug) => {
    const row = await db.agentSkill.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { id: true },
    });
    return row?.id ?? null;
  },
  // toolCalls / tokenCount 为 null：直接省略，让数据库默认值为 NULL，
  // 避免 Prisma 对 Json? 字段显式 null 的特殊处理。
  createExecution: async (record) =>
    db.skillExecution.create({
      data: {
        skillId: record.skillId,
        userId: record.userId,
        inputJson: record.inputJson,
        outputJson: record.outputJson,
        promptSnapshot: record.promptSnapshot,
        success: record.success,
        durationMs: record.durationMs,
      },
      select: { id: true },
    }),
  logAudit,
  now: () => Date.now(),
  generateImage: async ({ prompt, sourceImageUrls, size }) => {
    const res = await generateProductVisualImage({
      prompt,
      sourceImageUrls,
      size,
      dryRun: false,
      generateEnabled: true,
    });
    return { model: res.model, images: res.images, warnings: res.warnings };
  },
  uploadImage: async (args) => uploadVisualBuilderImage(args),
  updateExecution: async (id, patch) => {
    await db.skillExecution.update({
      where: { id },
      data: {
        outputJson: patch.outputJson,
        success: patch.success,
        durationMs: patch.durationMs,
      },
    });
  },
};

export async function runProductVisualBuilderDryRun(
  params: { orgId: string; userId: string; input: VisualBuilderInput },
  deps: VisualBuilderDeps = defaultDeps,
): Promise<VisualBuilderOutput> {
  const { orgId, userId } = params;
  const start = deps.now();

  // 用可信的 params 覆盖 input 内的 orgId / userId（不信任客户端）
  const input: VisualBuilderInput = { ...params.input, orgId, userId };

  // 1. 定位本 org 的 product-visual-builder 技能（不静默失败）
  const skillId = await deps.findSkillId(orgId, PRODUCT_VISUAL_BUILDER_SLUG);
  if (!skillId) {
    throw new Error(
      `未找到技能「${PRODUCT_VISUAL_BUILDER_SLUG}」（org=${orgId}）。请先对该组织执行 seedBuiltinSkills 初始化内置技能。`,
    );
  }

  // 审计：请求受理（不含 prompt / 图片 URL / 隐私）
  await deps.logAudit({
    userId,
    orgId,
    action: "visual_builder.generate.requested",
    targetType: "visual_builder",
    afterData: {
      orgId,
      userId,
      productType: input.productType,
      useCase: input.useCase,
      style: input.style,
      sourceCount: input.sourceImageUrls?.length ?? 0,
    },
  });

  // 2. 组装 prompt（纯函数，不调 AI / DB / Blob）
  const { finalPrompt, warnings, productFactsUsed } = buildProductVisualPrompt(input);

  // 3. 构造 dry-run 输出（不出图）
  const output: VisualBuilderOutput = {
    status: "completed",
    outputImageUrls: [],
    finalPrompt,
    model: DRY_RUN_MODEL,
    warnings: warnings.length > 0 ? warnings : [...FIXED_WARNINGS],
    productFactsUsed,
    websitePathSuggestions: [],
    assetNamingSuggestions: [],
    humanReviewRequired: true,
    createdAt: new Date(deps.now()).toISOString(),
  };

  const promptSnapshot = `[SYSTEM]\n(${DRY_RUN_MODEL})\n\n[USER]\n${finalPrompt}`;

  // 4. 写入 SkillExecution
  const execution = await deps.createExecution({
    skillId,
    userId,
    inputJson: JSON.stringify(input),
    outputJson: JSON.stringify(output),
    promptSnapshot,
    toolCalls: null,
    success: true,
    durationMs: deps.now() - start,
    tokenCount: null,
  });

  // 5. 回填 executionId
  output.executionId = execution.id;

  // 审计：生成完成（仅摘要，不含 prompt / 图片 URL / 隐私）
  await deps.logAudit({
    userId,
    orgId,
    action: "visual_builder.generate.completed",
    targetType: "visual_builder",
    targetId: execution.id,
    afterData: {
      executionId: execution.id,
      outputCount: output.outputImageUrls.length,
      humanReviewRequired: output.humanReviewRequired,
      model: output.model,
    },
  });

  return output;
}

// ── 真实生成路径（Phase 1G）──────────────────────────────────

/** style → generated 资产角色映射。 */
function assetRoleForStyle(style: VisualStyle): VisualAssetRole {
  switch (style) {
    case "spec_sheet":
      return "spec-sheet";
    case "white_background":
      return "white-bg";
    case "warm_home":
    case "hotel":
      return "lifestyle";
    case "ecommerce":
    default:
      return "generated";
  }
}

/** 校验 sourceImageUrls 必须是本 org 的 Blob 地址（路径级）。 */
function assertSourceImagesInOrg(orgId: string, urls: string[]): void {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error(`${VPB_ERRORS.SOURCE_INVALID}: 缺少 sourceImageUrls`);
  }
  const marker = `visual-builder/${orgId}/`;
  for (const u of urls) {
    if (typeof u !== "string" || !u.includes(marker)) {
      throw new Error(
        `${VPB_ERRORS.SOURCE_INVALID}: sourceImageUrls 必须来自本组织 upload API 返回的地址`,
      );
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 失败兜底：尽力把占位记录标记失败并写 failed 审计；内部错误不掩盖原始错误。 */
async function markFailed(
  deps: VisualBuilderDeps,
  ctx: { executionId: string | null; orgId: string; userId: string; start: number; reason: string },
): Promise<void> {
  if (ctx.executionId && deps.updateExecution) {
    try {
      await deps.updateExecution(ctx.executionId, {
        outputJson: JSON.stringify({ status: "failed", reason: ctx.reason }),
        success: false,
        durationMs: deps.now() - ctx.start,
      });
    } catch {
      /* 忽略：不掩盖原始失败 */
    }
  }
  try {
    await deps.logAudit({
      userId: ctx.userId,
      orgId: ctx.orgId,
      action: "visual_builder.generate.failed",
      targetType: "visual_builder",
      targetId: ctx.executionId ?? undefined,
      afterData: { executionId: ctx.executionId, reason: ctx.reason },
    });
  } catch {
    /* 忽略 */
  }
}

/**
 * 统一入口：默认 dry-run；仅当 generateEnabled=true 且 dryRun=false 时走真实生成。
 *
 * 默认行为完全等价于 runProductVisualBuilderDryRun（model="dry-run"、outputImageUrls=[]、
 * humanReviewRequired=true、不调用 OpenAI、不上传 generated 图片）。
 */
export async function runProductVisualBuilder(
  params: {
    orgId: string;
    userId: string;
    input: VisualBuilderInput;
    options?: VisualBuilderRunOptions;
  },
  deps: VisualBuilderDeps = defaultDeps,
): Promise<VisualBuilderOutput> {
  const dryRun = params.options?.dryRun ?? true;
  const generateEnabled = params.options?.generateEnabled ?? false;

  // 默认（及任何非"显式开启真实生成"的组合）继续走 dry-run，行为不变。
  if (!(generateEnabled === true && dryRun === false)) {
    return runProductVisualBuilderDryRun(
      { orgId: params.orgId, userId: params.userId, input: params.input },
      deps,
    );
  }

  const { orgId, userId } = params;
  const start = deps.now();
  const input: VisualBuilderInput = { ...params.input, orgId, userId };

  const skillId = await deps.findSkillId(orgId, PRODUCT_VISUAL_BUILDER_SLUG);
  if (!skillId) {
    throw new Error(
      `未找到技能「${PRODUCT_VISUAL_BUILDER_SLUG}」（org=${orgId}）。请先对该组织执行 seedBuiltinSkills 初始化内置技能。`,
    );
  }

  // 真实生成前先做 org 级 sourceImageUrls 校验（无副作用、不创建记录）。
  assertSourceImagesInOrg(orgId, input.sourceImageUrls);

  if (!deps.generateImage || !deps.uploadImage || !deps.updateExecution) {
    throw new Error("real generation deps not configured");
  }

  // 审计：请求受理（仅摘要）
  await deps.logAudit({
    userId,
    orgId,
    action: "visual_builder.generate.requested",
    targetType: "visual_builder",
    afterData: {
      orgId,
      userId,
      mode: "generate",
      productType: input.productType,
      useCase: input.useCase,
      style: input.style,
      sourceCount: input.sourceImageUrls?.length ?? 0,
    },
  });

  const { finalPrompt, warnings: promptWarnings, productFactsUsed } =
    buildProductVisualPrompt(input);
  const promptSnapshot = `[SYSTEM]\n(generate)\n\n[USER]\n${finalPrompt}`;

  // 方案 A：先创建占位 SkillExecution（success=false / status=pending），
  // 用其 id 作为 Blob executionId，便于后续追踪“执行 ↔ 资产”一一对应。
  const execution = await deps.createExecution({
    skillId,
    userId,
    inputJson: JSON.stringify(input),
    outputJson: JSON.stringify({
      status: "pending",
      outputImageUrls: [],
      humanReviewRequired: true,
    }),
    promptSnapshot,
    toolCalls: null,
    success: false,
    durationMs: deps.now() - start,
    tokenCount: null,
  });
  const executionId = execution.id;

  // 1. 调用图片模型
  let gen: ImageGenResult;
  try {
    gen = await deps.generateImage({
      prompt: finalPrompt,
      sourceImageUrls: input.sourceImageUrls,
      size: params.options?.imageSize ?? "1024x1024",
    });
  } catch (e) {
    await markFailed(deps, { executionId, orgId, userId, start, reason: "image_generation_failed" });
    throw new Error(`${VPB_ERRORS.IMAGE_FAILED}: ${errMsg(e)}`);
  }
  if (!gen.images || gen.images.length === 0) {
    await markFailed(deps, { executionId, orgId, userId, start, reason: "image_generation_failed" });
    throw new Error(`${VPB_ERRORS.IMAGE_FAILED}: empty result`);
  }

  // 2. 上传 generated 图片到 Blob
  const assetRole = assetRoleForStyle(input.style);
  const outputImageUrls: string[] = [];
  try {
    for (let i = 0; i < gen.images.length; i++) {
      const img = gen.images[i];
      const buffer =
        img.buffer ?? (img.base64 ? Buffer.from(img.base64, "base64") : undefined);
      if (!buffer) throw new Error("missing image buffer");
      const res = await deps.uploadImage({
        orgId,
        executionId,
        assetRole,
        index: i,
        ext: "png",
        mimeType: "image/png",
        buffer,
      });
      outputImageUrls.push(res.url);
    }
  } catch (e) {
    await markFailed(deps, { executionId, orgId, userId, start, reason: "blob_upload_failed" });
    throw new Error(`${VPB_ERRORS.UPLOAD_FAILED}: ${errMsg(e)}`);
  }

  // 3. 组装最终输出
  const output: VisualBuilderOutput = {
    executionId,
    status: "completed",
    outputImageUrls,
    finalPrompt,
    model: gen.model,
    warnings: [
      ...promptWarnings,
      ...gen.warnings,
      VISUAL_BUILDER_PUBLIC_BLOB_NOTICE,
      HUMAN_REVIEW_WARNING,
    ],
    productFactsUsed,
    websitePathSuggestions: [],
    assetNamingSuggestions: [],
    humanReviewRequired: true,
    createdAt: new Date(deps.now()).toISOString(),
  };

  // 4. 回填 SkillExecution（成功）
  try {
    await deps.updateExecution(executionId, {
      outputJson: JSON.stringify(output),
      success: true,
      durationMs: deps.now() - start,
    });
  } catch (e) {
    await markFailed(deps, { executionId, orgId, userId, start, reason: "skill_execution_update_failed" });
    throw new Error(`${VPB_ERRORS.EXEC_UPDATE_FAILED}: ${errMsg(e)}`);
  }

  // 审计：完成（仅摘要，不含 prompt / 图片 URL / 隐私）
  await deps.logAudit({
    userId,
    orgId,
    action: "visual_builder.generate.completed",
    targetType: "visual_builder",
    targetId: executionId,
    afterData: {
      executionId,
      outputCount: outputImageUrls.length,
      humanReviewRequired: output.humanReviewRequired,
      model: output.model,
    },
  });

  return output;
}
