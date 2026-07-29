/**
 * Postiz 状态回写：轮询 externalJobId，仅在有可靠证据时标 published
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  classifyPostizProviderState,
  getPostizPost,
  isPostizConfigured,
} from "./postiz";
import { transitionPublishJob } from "./publish-events";
import { normalizePublishStatus } from "./publish-status";

export async function syncPostizPublishJobs(limit = 30): Promise<{
  checked: number;
  updated: number;
  published: number;
  failed: number;
  errors: string[];
}> {
  if (!isPostizConfigured()) {
    return { checked: 0, updated: 0, published: 0, failed: 0, errors: ["Postiz 未配置"] };
  }

  const jobs = await db.publishJob.findMany({
    where: {
      channel: "postiz",
      status: { in: ["queued", "processing"] },
      externalJobId: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  let updated = 0;
  let published = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const job of jobs) {
    if (!job.externalJobId) continue;
    if (normalizePublishStatus(job.status) === "canceled") continue;

    try {
      const remote = await getPostizPost(job.externalJobId);
      const classified = classifyPostizProviderState(remote.state);
      const evidencePublished =
        classified.providerStatus === "published" ||
        Boolean(remote.publishedUrl) ||
        Boolean(remote.releaseId);

      let toStatus = classified.publishJobStatus ?? "queued";
      // 无最终证据不得标 published
      if (toStatus === "published" && !evidencePublished) {
        toStatus = "processing";
      }

      const current = normalizePublishStatus(job.status);
      if (current === toStatus && job.providerStatus === classified.providerStatus) {
        await db.publishJob.update({
          where: { id: job.id },
          data: {
            providerResponseJson: remote.raw as Prisma.InputJsonValue,
          },
        });
        continue;
      }

      if (toStatus === "queued" && current === "queued") {
        await db.publishJob.update({
          where: { id: job.id },
          data: {
            providerStatus: classified.providerStatus,
            providerResponseJson: remote.raw as Prisma.InputJsonValue,
            externalPostUrl: remote.publishedUrl ?? job.externalPostUrl,
          },
        });
        updated += 1;
        continue;
      }

      const tr = await transitionPublishJob({
        orgId: job.orgId,
        jobId: job.id,
        toStatus,
        actorType: "system",
        reasonCode: "POSTIZ_POLL",
        metadata: { state: remote.state, postId: remote.postId },
        data: {
          providerStatus: classified.providerStatus,
          providerResponseJson: remote.raw as Prisma.InputJsonValue,
          externalPostUrl: remote.publishedUrl ?? job.externalPostUrl,
          errorMessage:
            toStatus === "failed"
              ? `Postiz 状态失败：${remote.state ?? "unknown"}`
              : job.errorMessage,
        },
      });
      if (!tr.ok) {
        errors.push(`${job.id}: ${tr.error}`);
        continue;
      }
      updated += 1;
      if (toStatus === "published") published += 1;
      if (toStatus === "failed") failed += 1;
    } catch (e) {
      errors.push(
        `${job.id}: ${e instanceof Error ? e.message : "sync failed"}`,
      );
    }
  }

  return {
    checked: jobs.length,
    updated,
    published,
    failed,
    errors,
  };
}
