/**
 * 运营矩阵管道服务
 *
 * 链路：Aivora 成片入库 → 创建发布任务（按账号组扇出）→ 派发到通道
 * 文案变体引擎（AI 差异化）后续接入；当前扇出使用同一文案骨架。
 */

import { db } from "@/lib/db";
import { fetchAivoraVideos, isAivoraConfigured } from "./aivora";
import { dispatchPublishJob } from "./publishers";
import { generateCaptionVariants } from "./caption-variants";
import { checkContentRules } from "./content-rules";
import { getBrandContext } from "./brand-context";
import { reviewCaptionsAgainstBrand } from "./ai-review";

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

export interface FanoutResult {
  createdJobs: number;
  queued: number;
  /** 滞留审核队列（抽检 / 高敏内容 / AI 预审标记） */
  held: number;
  /** 规则拦截（禁忌表述，需改文案后重派） */
  blocked: number;
  failed: number;
  /** 文案变体是否有回退母版（AI 未配置或调用失败） */
  variantFallback: boolean;
  /** AI 预审标记为需人工复核的任务数 */
  aiFlagged: number;
  errors: string[];
}

/**
 * 把一条视频扇出为多个发布任务（每账号一条）。
 *
 * 流程：AI 生成每账号差异化文案 → 规则检查 + AI 品牌预审 →
 * - block（规则命中红线）：滞留 status=blocked，不派发
 * - review（规则高敏 / 抽检 / AI 预审标记 / 精品号全审）：滞留 status=review，人工通过后派发
 * - pass：立即派发（postflow 入 DB 队列等 worker；postiz 实时 API）
 * 账号分层：premium 精品号 100% 进人工审核；matrix 矩阵号按 1/N 抽检。
 * 单账号失败不影响其他账号；AI 预审失败保守放行（规则层已兜底红线）。
 */
export async function fanoutAndDispatch(input: FanoutInput): Promise<FanoutResult> {
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

  // 品牌语料按 orgId 严格隔离读取；未配置时为 null，变体引擎按无语料降级
  const brandContext = await getBrandContext(input.orgId);

  const { captions, usedFallback } = await generateCaptionVariants(
    asset,
    input.captionText,
    accounts,
    brandContext,
  );

  // AI 品牌预审：按品牌档案批量标注（语气/卖点/禁忌），只标 review 不 block
  const aiReview = await reviewCaptionsAgainstBrand(
    asset,
    accounts.map((a) => {
      const caption = captions.get(a.id) ?? input.captionText;
      return {
        accountId: a.id,
        caption: input.hashtags ? `${caption}\n${input.hashtags}` : caption,
      };
    }),
    brandContext,
  );

  let queued = 0;
  let held = 0;
  let blocked = 0;
  let failed = 0;
  let createdJobs = 0;
  let aiFlagged = 0;
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

    const captionText = captions.get(account.id) ?? input.captionText;
    const fullText = input.hashtags ? `${captionText}\n${input.hashtags}` : captionText;
    const rule = checkContentRules(fullText);
    const isPremium = account.tier === "premium";
    const sampled = isPremium || i % SAMPLE_EVERY_N === 0;
    const aiItem = aiReview.items.get(account.id);
    const aiHit = aiItem?.verdict === "flag";
    if (aiHit) aiFlagged += 1;

    const initialStatus =
      rule.verdict === "block"
        ? "blocked"
        : rule.verdict === "review" || sampled || aiHit
          ? "review"
          : "draft";

    const reasons = [
      ...(isPremium ? ["精品号全审"] : []),
      ...rule.reasons,
      ...(aiHit ? aiItem.reasons.map((r) => `AI预审：${r}`) : []),
    ];

    const job = await db.publishJob.create({
      data: {
        orgId: input.orgId,
        assetId: asset.id,
        accountId: account.id,
        captionText,
        hashtags: input.hashtags,
        channel,
        scheduledAt: input.scheduledAt,
        status: initialStatus,
        sampledForReview: sampled,
        errorMessage: reasons.length ? reasons.join("；") : null,
      },
    });
    createdJobs += 1;

    if (initialStatus === "blocked") {
      blocked += 1;
      errors.push(`${account.handle}: 规则拦截 — ${rule.reasons.join("；")}`);
      continue;
    }
    if (initialStatus === "review") {
      held += 1;
      continue;
    }

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

  return { createdJobs, queued, held, blocked, failed, variantFallback: usedFallback, aiFlagged, errors };
}

/** 审核通过：可选改写文案后派发 */
export async function approveAndDispatchJob(
  orgId: string,
  jobId: string,
  editedCaption?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await db.publishJob.findFirst({
    where: { id: jobId, orgId, status: { in: ["review", "blocked"] } },
    include: { asset: true, account: true },
  });
  if (!job) return { ok: false, error: "任务不存在或不在待审状态" };

  let captionText = job.captionText;
  if (editedCaption?.trim()) {
    captionText = editedCaption.trim();
    // 改写后的文案仍须过规则；block 级不放行（review 级此处即人工确认）
    const rule = checkContentRules(
      job.hashtags ? `${captionText}\n${job.hashtags}` : captionText,
    );
    if (rule.verdict === "block") {
      return { ok: false, error: `文案仍触发拦截规则：${rule.reasons.join("；")}` };
    }
  } else if (job.status === "blocked") {
    return { ok: false, error: "被拦截的任务须修改文案后才能通过" };
  }

  const updatedJob = await db.publishJob.update({
    where: { id: job.id },
    data: { captionText, errorMessage: null },
  });

  const result = await dispatchPublishJob(updatedJob, job.asset, job.account);
  if (!result.ok) {
    await db.publishJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: result.error },
    });
    return { ok: false, error: result.error };
  }
  await db.publishJob.update({
    where: { id: job.id },
    data: { status: "queued", externalJobId: result.externalJobId },
  });
  return { ok: true };
}
