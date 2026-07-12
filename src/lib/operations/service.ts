/**
 * 运营矩阵管道服务
 *
 * 链路：Aivora 成片入库 → 创建发布任务（按账号组扇出）→ 派发到通道
 * 文案变体引擎（AI 差异化）后续接入；当前扇出使用同一文案骨架。
 */

import { db } from "@/lib/db";
import { fetchAivoraVideos, isAivoraConfigured } from "./aivora";
import { dispatchPublishJob } from "./publishers";

/** 每 N 条发布任务抽 1 条进人工抽检队列 */
const SAMPLE_EVERY_N = 20;

export async function syncAivoraVideosForOrg(orgId: string): Promise<{
  configured: boolean;
  fetched: number;
  created: number;
  skipped: number;
}> {
  if (!isAivoraConfigured()) {
    return { configured: false, fetched: 0, created: 0, skipped: 0 };
  }

  const videos = await fetchAivoraVideos();
  let created = 0;
  for (const v of videos) {
    const existing = await db.videoAsset.findUnique({
      where: { source_externalId: { source: "aivora", externalId: v.externalId } },
      select: { id: true },
    });
    if (existing) continue;
    await db.videoAsset.create({
      data: {
        orgId,
        source: "aivora",
        externalId: v.externalId,
        title: v.title,
        topic: v.topic,
        language: v.language ?? "en",
        videoUrl: v.videoUrl,
        coverUrl: v.coverUrl,
        durationSec: v.durationSec,
      },
    });
    created += 1;
  }
  return {
    configured: true,
    fetched: videos.length,
    created,
    skipped: videos.length - created,
  };
}

export interface FanoutInput {
  orgId: string;
  assetId: string;
  /** 目标账号组；与 accountIds 二选一 */
  groupName?: string;
  accountIds?: string[];
  captionText: string;
  hashtags?: string;
  scheduledAt?: Date;
}

/**
 * 把一条视频扇出为多个发布任务（每账号一条），并立即派发。
 * postflow 任务派发后为 queued（等服务器 worker 消费）；
 * postiz 任务实时调用 API，失败则单条标记 failed 不影响其他账号。
 */
export async function fanoutAndDispatch(input: FanoutInput): Promise<{
  createdJobs: number;
  queued: number;
  failed: number;
  errors: string[];
}> {
  const asset = await db.videoAsset.findFirst({
    where: { id: input.assetId, orgId: input.orgId },
  });
  if (!asset) throw new Error("视频资产不存在");

  const accounts = await db.matrixAccount.findMany({
    where: {
      orgId: input.orgId,
      status: "active",
      ...(input.accountIds?.length
        ? { id: { in: input.accountIds } }
        : { groupName: input.groupName ?? "" }),
    },
  });
  if (accounts.length === 0) throw new Error("目标账号组内没有可用账号");

  let queued = 0;
  let failed = 0;
  let createdJobs = 0;
  const errors: string[] = [];

  for (const [i, account] of accounts.entries()) {
    const channel =
      account.publishChannel === "postiz" || account.publishChannel === "postflow"
        ? account.publishChannel
        : null;
    if (!channel) {
      failed += 1;
      errors.push(`${account.handle}: 发布通道为 manual，跳过自动派发`);
      continue;
    }

    // 幂等：同资产同账号只建一条
    const existing = await db.publishJob.findUnique({
      where: { assetId_accountId: { assetId: asset.id, accountId: account.id } },
      select: { id: true },
    });
    if (existing) continue;

    const job = await db.publishJob.create({
      data: {
        orgId: input.orgId,
        assetId: asset.id,
        accountId: account.id,
        captionText: input.captionText,
        hashtags: input.hashtags,
        channel,
        scheduledAt: input.scheduledAt,
        sampledForReview: i % SAMPLE_EVERY_N === 0,
      },
    });
    createdJobs += 1;

    const result = await dispatchPublishJob(job, asset, account);
    if (result.ok) {
      await db.publishJob.update({
        where: { id: job.id },
        data: { status: "queued", externalJobId: result.externalJobId },
      });
      queued += 1;
    } else {
      await db.publishJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: result.error },
      });
      failed += 1;
      errors.push(`${account.handle}: ${result.error}`);
    }
  }

  if (createdJobs > 0) {
    await db.videoAsset.update({
      where: { id: asset.id },
      data: { status: "scheduled" },
    });
  }

  return { createdJobs, queued, failed, errors };
}
