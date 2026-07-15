/**
 * 发布通道适配器
 *
 * - postiz：英文社媒（IG/FB/TikTok），走自托管 Postiz 的官方 API 排期
 * - postflow：小红书浏览器自动化。青砚不直接执行，只把 PublishJob 置为
 *   queued，由自建服务器上的 PostFlow worker 轮询 DB 队列消费并回写状态
 *
 * 环境变量（postiz）：
 * - POSTIZ_API_URL：自托管 Postiz 地址（如 https://postiz.example.com）
 * - POSTIZ_API_KEY：Postiz 设置页生成的 API Key
 */

import type { MatrixAccount, PublishJob, VideoAsset } from "@prisma/client";
import {
  buildPostizPostPayload,
  createPostizPost,
  isPostizConfigured,
  uploadPostizMediaFromUrl,
} from "./postiz";

export type DispatchResult =
  | { ok: true; externalJobId: string | null }
  | { ok: false; error: string };

export { isPostizConfigured } from "./postiz";

/** 派发到 Postiz：创建定时帖（视频由 Postiz 从外部 URL 拉取，不经青砚） */
async function dispatchToPostiz(
  job: PublishJob,
  asset: VideoAsset,
  account: MatrixAccount,
): Promise<DispatchResult> {
  if (!isPostizConfigured()) {
    return { ok: false, error: "Postiz 未配置（POSTIZ_API_URL / POSTIZ_API_KEY）" };
  }
  if (!account.externalChannelId) {
    return { ok: false, error: `账号 ${account.handle} 未绑定 Postiz integration id` };
  }

  try {
    const media = await uploadPostizMediaFromUrl(asset.videoUrl);
    const payload = buildPostizPostPayload({
      scheduledAt: job.scheduledAt,
      captionText: job.captionText,
      hashtags: job.hashtags,
      platform: account.platform,
      integrationId: account.externalChannelId,
      media,
    });
    if (!payload) {
      return { ok: false, error: `${account.platform} 暂未配置 Postiz 发布参数` };
    }
    return { ok: true, externalJobId: await createPostizPost(payload) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Postiz 请求失败" };
  }
}

/**
 * 派发发布任务到对应通道。
 * postflow 通道仅返回成功——job 状态改为 queued 后即视为进入 DB 队列，
 * 真正执行由服务器端 PostFlow worker 完成（拉取 queued 任务 → CLI 发布 → 回写）。
 */
export async function dispatchPublishJob(
  job: PublishJob,
  asset: VideoAsset,
  account: MatrixAccount,
): Promise<DispatchResult> {
  switch (job.channel) {
    case "postiz":
      return dispatchToPostiz(job, asset, account);
    case "postflow":
      return { ok: true, externalJobId: null };
    default:
      return { ok: false, error: `未知发布通道: ${job.channel}` };
  }
}
