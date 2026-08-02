/**
 * 发布通道适配器（Phase C）
 *
 * Postiz：创建排期 ≠ 平台已发布
 * - schedule / 仅获 postId → queued + providerStatus=scheduled
 * - now 且有明确 published 证据 → published
 * - 否则保持 queued，由 webhook/轮询回写
 */

import type { MatrixAccount, PublishJob, VideoAsset } from "@prisma/client";
import {
  buildPostizPostPayload,
  createPostizPost,
  isPostizConfigured,
  uploadPostizMediaFromUrl,
} from "./postiz";

export type DispatchResult =
  | {
      ok: true;
      externalJobId: string | null;
      providerStatus?: "scheduled" | "processing" | "published" | "failed";
      providerResponse?: unknown;
      externalPostUrl?: string | null;
    }
  | { ok: false; error: string; httpStatus?: number; retryable?: boolean };

export { isPostizConfigured } from "./postiz";

async function dispatchToPostiz(
  job: PublishJob,
  asset: VideoAsset,
  account: MatrixAccount,
): Promise<DispatchResult> {
  // Wave1.5：出站 webhook 副作用默认关闭（不发 HTTP、不标 completed）
  const { assertSideEffectOrThrow, RuntimeIsolationError } = await import(
    "@/lib/env/runtime-isolation"
  );
  try {
    assertSideEffectOrThrow("webhook");
  } catch (e) {
    if (e instanceof RuntimeIsolationError) {
      return {
        ok: false,
        error: e.message,
        retryable: false,
      };
    }
    throw e;
  }

  if (!isPostizConfigured()) {
    return { ok: false, error: "Postiz 未配置（POSTIZ_API_URL / POSTIZ_API_KEY）" };
  }
  if (!account.externalChannelId) {
    return { ok: false, error: `账号 ${account.handle} 未绑定 Postiz integration id` };
  }
  if (job.status === "published") {
    return { ok: false, error: "任务已发布，禁止重复发送" };
  }
  if (job.status === "canceled") {
    return { ok: false, error: "任务已取消，禁止发送" };
  }
  // 幂等：已有 externalJobId 则不再创建
  if (job.externalJobId) {
    return {
      ok: true,
      externalJobId: job.externalJobId,
      providerStatus: (job.providerStatus as "scheduled") || "scheduled",
      providerResponse: { idempotentReuse: true },
      externalPostUrl: job.externalPostUrl,
    };
  }

  try {
    const media = await uploadPostizMediaFromUrl(asset.videoUrl);
    const isScheduled = Boolean(job.scheduledAt);
    const payload = buildPostizPostPayload({
      scheduledAt: job.scheduledAt,
      captionText: job.captionText,
      hashtags: job.hashtags,
      platform: account.platform,
      integrationId: account.externalChannelId,
      media,
      idempotencyKey: job.idempotencyKey,
    });
    if (!payload) {
      return { ok: false, error: `${account.platform} 暂未配置 Postiz 发布参数` };
    }
    const created = await createPostizPost(payload);
    const externalJobId = created.postId;
    const providerResponse = created.raw;

    // 仅当明确拿到平台 release 证据才标 published；API 成功 ≠ 平台发布成功
    const publishedEvidence = created.releaseId || created.publishedUrl;
    if (!isScheduled && publishedEvidence) {
      return {
        ok: true,
        externalJobId,
        providerStatus: "published",
        providerResponse,
        externalPostUrl: created.publishedUrl ?? null,
      };
    }

    return {
      ok: true,
      externalJobId,
      providerStatus: isScheduled ? "scheduled" : "processing",
      providerResponse,
      externalPostUrl: created.publishedUrl ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Postiz 请求失败";
    const httpStatus = /Postiz API (\d+)/.exec(msg);
    const status = httpStatus ? Number(httpStatus[1]) : undefined;
    const retryable =
      status === 429 || (typeof status === "number" && status >= 500);
    return { ok: false, error: msg, httpStatus: status, retryable };
  }
}

export async function dispatchPublishJob(
  job: PublishJob,
  asset: VideoAsset,
  account: MatrixAccount,
): Promise<DispatchResult> {
  switch (job.channel) {
    case "postiz":
      return dispatchToPostiz(job, asset, account);
    case "postflow":
      return { ok: true, externalJobId: null, providerStatus: "scheduled" };
    default:
      return { ok: false, error: `未知发布通道: ${job.channel}` };
  }
}
