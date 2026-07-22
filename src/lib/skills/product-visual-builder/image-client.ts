/**
 * product-visual-builder — 图片模型客户端封装（Phase 1F-ImageClient）
 *
 * 职责：封装对 OpenAI Images API 的调用，支持 dryRun / disabled，便于测试与灰度时不真实扣费。
 * 本阶段只做封装与测试：
 * - 不接入 service.ts（不改 dry-run 默认行为）
 * - 不上传 Blob（生成结果交由后续阶段 service 负责存储）
 * - 不写数据库 / 不写 SkillExecution / 不写 AuditLog / 不做前端
 *
 * 复用现有 AI 基础设施：
 * - 模型名来自 getAIConfig().imageModel（ProviderRouter / ModelRegistry）
 * - 真实调用走项目统一的 getClient()（@/lib/ai/client，单例 OpenAI，apiKey/baseURL 来自 getAIConfig）
 *
 * source image 处理（Phase 1F 采用方案 B）：
 * - 本阶段仅用 prompt 生成，不把 sourceImageUrls 真正传入模型；
 * - 若传入 sourceImageUrls，会在 warnings 中明确说明 "provided but not used"，绝不静默忽略；
 * - 不从任意外链 fetch；后续阶段只允许使用 upload API 返回的 Blob URL 作为参考图。
 *
 * 安全：
 * - 不在返回值中暴露 apiKey；
 * - 默认不返回 raw response（仅 includeRaw 显式开启时返回，供非生产/测试排查）；
 * - 不把 apiKey / 完整 prompt 写入日志。
 */

import { getAIConfig } from "@/lib/ai/config";
import { getClient } from "@/lib/ai/client";

export type VisualImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export const SOURCE_IMAGES_NOT_USED_WARNING =
  "sourceImageUrls provided but not used in this phase (Plan B: prompt-only generation)";
export const DRY_RUN_WARNING = "dry-run: 未真实调用图片模型，未生成图片";
export const DISABLED_WARNING = "image generation disabled";

export interface GenerateProductVisualImageParams {
  prompt: string;
  sourceImageUrls?: string[];
  size?: VisualImageSize;
  style?: string;
  dryRun?: boolean;
  /** 默认 true；为 false 时不调用模型，返回 disabled。 */
  generateEnabled?: boolean;
  requestId?: string;
  /** Phase 3A-4：有可信 orgId 时做配额预留 */
  orgId?: string;
  userId?: string;
  workspaceId?: string;
}

export interface GeneratedImage {
  mimeType: "image/png";
  base64?: string;
  buffer?: Buffer;
}

export interface GenerateProductVisualImageResult {
  status: "completed" | "dry_run" | "disabled";
  model: string;
  images: GeneratedImage[];
  warnings: string[];
  /** 仅 includeRaw 开启时存在；默认 undefined，避免泄露。 */
  raw?: unknown;
}

/** 可注入依赖；默认绑定 getAIConfig().imageModel 与统一 OpenAI client。 */
export interface ImageClientDeps {
  getModel: () => string;
  /** 真实生成；返回 base64 PNG 列表。失败应抛错，不得吞错。 */
  generate: (args: {
    model: string;
    prompt: string;
    size: VisualImageSize;
  }) => Promise<{ base64: string }[]>;
  /** 是否在结果里附带 raw（默认 false；切勿在生产开启）。 */
  includeRaw: boolean;
}

export const defaultImageClientDeps: ImageClientDeps = {
  getModel: () => getAIConfig().imageModel,
  generate: async ({ model, prompt, size }) => {
    const client = getClient();
    const res = await client.images.generate({
      model,
      prompt,
      size,
      n: 1,
    });
    const data = res.data ?? [];
    return data
      .map((d) => ({ base64: d.b64_json ?? "" }))
      .filter((d) => d.base64.length > 0);
  },
  includeRaw: false,
};

/**
 * 生成产品视觉图片。
 * - dryRun=true：不调用模型，status="dry_run"，images=[]。
 * - generateEnabled=false：不调用模型，status="disabled"，images=[]。
 * - 否则真实调用；失败抛清晰错误，不返回假的 completed。
 */
export async function generateProductVisualImage(
  params: GenerateProductVisualImageParams,
  deps: ImageClientDeps = defaultImageClientDeps,
): Promise<GenerateProductVisualImageResult> {
  if (typeof params.prompt !== "string" || params.prompt.trim().length === 0) {
    throw new Error("prompt 不能为空");
  }

  const model = deps.getModel();
  if (!model) {
    throw new Error("未配置图片模型（getAIConfig().imageModel 为空）");
  }

  const warnings: string[] = [];
  if (params.sourceImageUrls && params.sourceImageUrls.length > 0) {
    warnings.push(SOURCE_IMAGES_NOT_USED_WARNING);
  }

  if (params.dryRun) {
    return {
      status: "dry_run",
      model,
      images: [],
      warnings: [...warnings, DRY_RUN_WARNING],
    };
  }

  if (params.generateEnabled === false) {
    return {
      status: "disabled",
      model,
      images: [],
      warnings: [...warnings, DISABLED_WARNING],
    };
  }

  const size: VisualImageSize = params.size ?? "1024x1024";

  let reservationId: string | null = null;
  if (params.orgId && params.userId) {
    const { reserveQuota, commitReservation, releaseReservation } = await import(
      "@/lib/capabilities/governance/reserve"
    );
    const reserved = await reserveQuota({
      orgId: params.orgId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      metric: "DAILY_IMAGE_GENERATIONS",
      amount: 1,
      idempotencyKey: `image_gen:${params.orgId}:${params.requestId ?? Date.now()}`,
    });
    if (!reserved.ok) {
      throw new Error(reserved.error ?? "图片生成配额已达 hard limit");
    }
    reservationId = reserved.reservationId;
    // 月费用保守估算预留（estimated）
    await reserveQuota({
      orgId: params.orgId,
      userId: params.userId,
      workspaceId: params.workspaceId,
      metric: "MONTHLY_AI_COST",
      amount: 0.12,
      idempotencyKey: `image_cost:${params.orgId}:${params.requestId ?? Date.now()}`,
    }).catch(() => null);
  }

  let results: { base64: string }[];
  try {
    results = await deps.generate({ model, prompt: params.prompt, size });
  } catch (err) {
    if (reservationId && params.orgId && params.userId) {
      const { releaseReservation } = await import(
        "@/lib/capabilities/governance/reserve"
      );
      await releaseReservation({
        reservationId,
        orgId: params.orgId,
        userId: params.userId,
      });
    }
    // 不泄露 prompt / apiKey：仅透出底层错误消息
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`图片生成失败（model=${model}）：${msg}`);
  }

  const images: GeneratedImage[] = (results ?? [])
    .filter((r) => typeof r.base64 === "string" && r.base64.length > 0)
    .map((r) => ({
      mimeType: "image/png" as const,
      base64: r.base64,
      buffer: Buffer.from(r.base64, "base64"),
    }));

  if (images.length === 0) {
    if (reservationId && params.orgId && params.userId) {
      const { releaseReservation } = await import(
        "@/lib/capabilities/governance/reserve"
      );
      await releaseReservation({
        reservationId,
        orgId: params.orgId,
        userId: params.userId,
      });
    }
    throw new Error(`图片生成返回空结果（model=${model}）`);
  }

  if (reservationId && params.orgId && params.userId) {
    const { commitReservation } = await import(
      "@/lib/capabilities/governance/reserve"
    );
    await commitReservation({
      reservationId,
      orgId: params.orgId,
      userId: params.userId,
    });
  }

  return {
    status: "completed",
    model,
    images,
    warnings,
    raw: deps.includeRaw ? results : undefined,
  };
}
