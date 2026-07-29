/**
 * 运营矩阵管道服务（Phase C）
 *
 * 扇出 → resolveEffectiveAccountContext → 结构化差异化文案 →
 * evaluatePublishSafety → 状态机 →（可选）派发
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { fetchAivoraVideos, isAivoraConfigured } from "./aivora";
import { dispatchPublishJob } from "./publishers";
import {
  CAPTION_PROMPT_VERSION,
  generateStructuredCaptionVariants,
  structuredHashtags,
  structuredToCaptionText,
  type AccountCaptionBrief,
} from "./caption-variants";
import { reviewCaptionsAgainstBrand } from "./ai-review";
import { getBrandContext } from "./brand-context";
import { resolveEffectiveAccountContext } from "./playbook/resolve-context";
import { getPlaybookEnforcementMode } from "./playbook/enforcement";
import { evaluatePublishSafety, hasBlockIssues } from "./publish-safety";
import {
  assessCrossAccountSimilarity,
  DEFAULT_SIMILARITY_THRESHOLDS,
} from "./similarity";
import {
  buildIdempotencyKey,
  normalizePublishStatus,
} from "./publish-status";
import { transitionPublishJob } from "./publish-events";
import { isAdmin, isBoss } from "@/lib/rbac/roles";
import { logAudit } from "@/lib/audit/logger";

const SAMPLE_EVERY_N = 20;
/** 默认关闭矩阵号自动批准；仅当 org settings 显式开启 */
const AUTO_APPROVE_SETTING_KEY = "matrixAutoApproveEnabled";

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
  groupName?: string;
  accountIds?: string[];
  captionText: string;
  hashtags?: string;
  scheduledAt?: Date;
  actorUserId?: string;
}

export interface FanoutResult {
  createdJobs: number;
  queued: number;
  held: number;
  blocked: number;
  failed: number;
  variantFallback: boolean;
  aiFlagged: number;
  errors: string[];
}

async function isMatrixAutoApproveEnabled(orgId: string): Promise<boolean> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { settingsJson: true },
  });
  const s =
    org?.settingsJson && typeof org.settingsJson === "object"
      ? (org.settingsJson as Record<string, unknown>)
      : {};
  return s[AUTO_APPROVE_SETTING_KEY] === true;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 把一条视频扇出为多个发布任务（每账号一条）。
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

  const enforcementMode = await getPlaybookEnforcementMode(input.orgId);
  const autoApproveEnabled = await isMatrixAutoApproveEnabled(input.orgId);
  const brandContext = await getBrandContext(input.orgId);
  const brand = await db.brandProfile.findUnique({ where: { orgId: input.orgId } });

  // 批量解析上下文（避免业务层自行拼接 personaNotes）
  const contexts = new Map<
    string,
    Awaited<ReturnType<typeof resolveEffectiveAccountContext>>
  >();
  for (const account of accounts) {
    contexts.set(
      account.id,
      await resolveEffectiveAccountContext({
        orgId: input.orgId,
        accountId: account.id,
      }),
    );
  }

  const briefs: AccountCaptionBrief[] = accounts.map((a) => {
    const ctx = contexts.get(a.id)!;
    return {
      accountId: a.id,
      platform: a.platform,
      handle: a.handle,
      playbookSummary: {
        accountRole: ctx.accountRole,
        positioning: ctx.positioning,
        toneOfVoice: ctx.toneOfVoice,
        personaSummary: ctx.personaSummary,
        contentPillars: ctx.contentPillars,
        ctaStrategy: ctx.ctaStrategy,
        forbiddenTopics: ctx.forbiddenTopics,
        hasApprovedPlaybook: ctx.hasApprovedPlaybook,
      },
    };
  });

  const { variants, usedFallback, promptVersion } =
    await generateStructuredCaptionVariants(
      asset,
      input.captionText,
      input.hashtags,
      briefs,
    );

  const aiReview = await reviewCaptionsAgainstBrand(
    asset,
    accounts.map((a) => {
      const v = variants.get(a.id);
      const caption = v ? structuredToCaptionText(v) : input.captionText;
      const tags = v ? structuredHashtags(v, input.hashtags) : input.hashtags;
      return {
        accountId: a.id,
        caption: tags ? `${caption}\n${tags}` : caption,
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

  // 扇出批次内跨账号相似度
  const batchPeers: Array<{ publishJobId: string; text: string; accountId: string }> =
    [];

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

    const existing = await db.publishJob.findUnique({
      where: { assetId_accountId: { assetId: asset.id, accountId: account.id } },
      select: { id: true },
    });
    if (existing) continue;

    const ctx = contexts.get(account.id)!;
    const variant = variants.get(account.id);
    const captionText = variant
      ? structuredToCaptionText(variant)
      : input.captionText;
    const hashtags = variant
      ? structuredHashtags(variant, input.hashtags)
      : input.hashtags ?? null;

    const similarity = assessCrossAccountSimilarity({
      candidateText: captionText,
      peers: batchPeers.map((p) => ({
        publishJobId: p.publishJobId,
        text: p.text,
      })),
      thresholds: DEFAULT_SIMILARITY_THRESHOLDS,
    });

    const publishedToday = await db.publishJob.count({
      where: {
        orgId: input.orgId,
        accountId: account.id,
        status: "published",
        updatedAt: { gte: startOfToday() },
      },
    });

    const isPremium = account.tier === "premium";
    const sampled = isPremium || i % SAMPLE_EVERY_N === 0;
    const aiItem = aiReview.items.get(account.id);
    const aiHit = aiItem?.verdict === "flag";
    if (aiHit) aiFlagged += 1;

    // 自动发布条件：有批准 Playbook（账号或组继承）且非抽检/精品
    const canConsiderAuto =
      ctx.hasApprovedPlaybook &&
      !isPremium &&
      !sampled &&
      !aiHit &&
      autoApproveEnabled &&
      enforcementMode !== "off";

    const safety = evaluatePublishSafety({
      captionText,
      hashtags,
      ctaText: variant?.cta,
      hookText: variant?.hook,
      videoUrl: asset.videoUrl,
      platform: account.platform,
      accountStatus: account.status,
      dailyQuota: account.dailyQuota,
      publishedTodayCount: publishedToday,
      hasApprovedPlaybook: ctx.hasApprovedPlaybook,
      playbookCompletenessScore: null,
      enforcementMode,
      autoPublish: Boolean(canConsiderAuto),
      brandForbiddenClaims: brand?.forbiddenClaims,
      similarity,
    });

    let initialStatus: string;
    if (hasBlockIssues(safety)) {
      initialStatus = "blocked";
    } else if (isPremium || sampled || aiHit || !ctx.hasApprovedPlaybook) {
      initialStatus = "pending_human_approval";
    } else if (canConsiderAuto && safety.result === "pass") {
      initialStatus = "approved";
    } else {
      initialStatus = "pending_human_approval";
    }

    const warnings = [
      ...ctx.warnings,
      ...safety.issues.map((x) => `${x.code}: ${x.message}`),
      ...(isPremium ? ["精品号全审"] : []),
      ...(aiHit ? (aiItem?.reasons ?? []).map((r) => `AI预审：${r}`) : []),
    ];

    const contextSnapshot = {
      brandProfileUpdatedAt: brand?.updatedAt?.toISOString() ?? null,
      marketingBrand: Boolean(ctx.brandContext?.brandName),
      hasApprovedPlaybook: ctx.hasApprovedPlaybook,
      usingDraftPreview: ctx.usingDraftPreview,
      groupId: ctx.groupId,
      groupKey: ctx.groupKey,
      effectiveContext: ctx.effectiveContext,
      sourceTrace: ctx.sourceTrace,
      warnings: ctx.warnings,
    };

    const generationMetadata = {
      model: "ai-or-fallback",
      promptVersion,
      captionPromptVersion: CAPTION_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      baseCaption: input.captionText,
      baseHashtags: input.hashtags ?? null,
      usedFallback,
      variant,
      humanOverrides: null,
    };

    const riskAssessment = {
      ...safety,
      similarity,
      enforcementMode,
      autoPublishAttempted: Boolean(canConsiderAuto),
    };

    const job = await db.publishJob.create({
      data: {
        orgId: input.orgId,
        assetId: asset.id,
        accountId: account.id,
        captionText,
        hashtags,
        hookText: variant?.hook || null,
        titleText: variant?.title || null,
        ctaText: variant?.cta || null,
        firstCommentText: variant?.firstComment || null,
        platformFieldsJson: (variant?.platformFields ??
          undefined) as Prisma.InputJsonValue,
        channel,
        scheduledAt: input.scheduledAt,
        status: initialStatus,
        sampledForReview: sampled,
        errorMessage: warnings.length ? warnings.slice(0, 8).join("；") : null,
        contentVersion: 1,
        contextSnapshotJson: contextSnapshot as Prisma.InputJsonValue,
        generationMetadataJson: generationMetadata as Prisma.InputJsonValue,
        riskAssessmentJson: riskAssessment as Prisma.InputJsonValue,
        similarityScore: similarity.similarityScore,
        similarityJson: similarity as Prisma.InputJsonValue,
        playbookEnforcementMode: enforcementMode,
        createdById: input.actorUserId ?? null,
      },
    });
    createdJobs += 1;
    batchPeers.push({
      publishJobId: job.id,
      text: captionText,
      accountId: account.id,
    });

    await db.publishJobStatusEvent.create({
      data: {
        orgId: input.orgId,
        publishJobId: job.id,
        fromStatus: null,
        toStatus: initialStatus,
        actorType: "system",
        actorId: input.actorUserId ?? null,
        reasonCode: "FANOUT_CREATE",
        reason: "扇出创建发布任务",
        metadata: { safetyResult: safety.result } as Prisma.InputJsonValue,
      },
    });

    if (input.actorUserId) {
      await logAudit({
        userId: input.actorUserId,
        orgId: input.orgId,
        action: "publish_job.created",
        targetType: "PublishJob",
        targetId: job.id,
        afterData: { status: initialStatus, accountId: account.id },
      });
    }

    if (initialStatus === "blocked") {
      blocked += 1;
      errors.push(`${account.handle}: 安全检查阻断`);
      continue;
    }

    if (initialStatus === "pending_human_approval") {
      held += 1;
      continue;
    }

    // approved → 尝试入队
    if (initialStatus === "approved") {
      const idempotencyKey = buildIdempotencyKey(input.orgId, job.id, 1);
      await db.publishJob.update({
        where: { id: job.id },
        data: { idempotencyKey },
      });
      const result = await dispatchPublishJob(
        { ...job, idempotencyKey, status: "approved" },
        asset,
        account,
      );
      if (result.ok) {
        const toStatus =
          result.providerStatus === "published" ? "published" : "queued";
        await transitionPublishJob({
          orgId: input.orgId,
          jobId: job.id,
          toStatus,
          actorType: "system",
          actorId: input.actorUserId,
          reasonCode: "AUTO_DISPATCH",
          metadata: {
            externalJobId: result.externalJobId,
            providerStatus: result.providerStatus,
          },
          data: {
            externalJobId: result.externalJobId,
            providerStatus: result.providerStatus ?? null,
            providerResponseJson: (result.providerResponse ??
              undefined) as Prisma.InputJsonValue,
            externalPostUrl: result.externalPostUrl ?? null,
          },
        });
        if (toStatus === "queued" || toStatus === "published") queued += 1;
      } else {
        await transitionPublishJob({
          orgId: input.orgId,
          jobId: job.id,
          toStatus: "failed",
          actorType: "system",
          reasonCode: "DISPATCH_FAIL",
          reason: result.error,
          data: { errorMessage: result.error },
        });
        failed += 1;
        errors.push(`${account.handle}: ${result.error}`);
      }
    }
  }

  if (createdJobs > 0) {
    await db.videoAsset.update({
      where: { id: asset.id },
      data: { status: "scheduled" },
    });
  }

  return {
    createdJobs,
    queued,
    held,
    blocked,
    failed,
    variantFallback: usedFallback,
    aiFlagged,
    errors,
  };
}

export function canApprovePublishJob(role: string | null | undefined): boolean {
  return isAdmin(role ?? "") || isBoss(role);
}

/** 审核通过：可选改写文案后进入 approved → 派发 */
export async function approveAndDispatchJob(
  orgId: string,
  jobId: string,
  opts: {
    editedCaption?: string;
    actorUserId: string;
    actorRole: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canApprovePublishJob(opts.actorRole)) {
    return { ok: false, error: "仅 Boss/Admin 可批准发布任务" };
  }

  const job = await db.publishJob.findFirst({
    where: {
      id: jobId,
      orgId,
      status: {
        in: [
          "pending_human_approval",
          "review", // legacy
          "blocked",
          "ai_reviewed",
          "needs_revision",
        ],
      },
    },
    include: { asset: true, account: true },
  });
  if (!job) return { ok: false, error: "任务不存在或不在待审状态" };

  // 自批限制：创建人不得批准自己的内容（Boss 例外，报告说明）
  if (
    job.createdById &&
    job.createdById === opts.actorUserId &&
    !isBoss(opts.actorRole)
  ) {
    return { ok: false, error: "创建人不得批准自己的发布任务（Boss 除外）" };
  }

  const enforcementMode = await getPlaybookEnforcementMode(orgId);
  const ctx = await resolveEffectiveAccountContext({
    orgId,
    accountId: job.accountId,
  });

  let captionText = job.captionText;
  let contentVersion = job.contentVersion;
  if (opts.editedCaption?.trim()) {
    captionText = opts.editedCaption.trim();
    contentVersion = job.contentVersion + 1;
  } else if (normalizePublishStatus(job.status) === "blocked") {
    return { ok: false, error: "被拦截的任务须修改文案后才能通过" };
  }

  const brand = await db.brandProfile.findUnique({ where: { orgId } });
  const publishedToday = await db.publishJob.count({
    where: {
      orgId,
      accountId: job.accountId,
      status: "published",
      updatedAt: { gte: startOfToday() },
    },
  });

  const safety = evaluatePublishSafety({
    captionText,
    hashtags: job.hashtags,
    ctaText: job.ctaText,
    hookText: job.hookText,
    videoUrl: job.asset.videoUrl,
    platform: job.account.platform,
    accountStatus: job.account.status,
    dailyQuota: job.account.dailyQuota,
    publishedTodayCount: publishedToday,
    hasApprovedPlaybook: ctx.hasApprovedPlaybook,
    enforcementMode,
    autoPublish: false,
    brandForbiddenClaims: brand?.forbiddenClaims,
    similarity: (job.similarityJson as {
      similarityScore: number;
      comparedPublishJobIds: string[];
      duplicateRisk: "low" | "medium" | "high";
      explanation: string;
    } | null) ?? null,
  });

  if (hasBlockIssues(safety) && !ctx.hasApprovedPlaybook && enforcementMode === "enforce") {
    return { ok: false, error: "enforce 模式且无批准 Playbook，无法批准" };
  }
  if (safety.issues.some((i) => i.severity === "block" && i.code !== "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK")) {
    // 兼容 warn：允许 PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK 人工通过
    const hard = safety.issues.filter(
      (i) =>
        i.severity === "block" &&
        i.code !== "PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK",
    );
    if (hard.length) {
      return {
        ok: false,
        error: `仍有阻断项：${hard.map((h) => h.message).join("；")}`,
      };
    }
  }

  const approvalSnapshot = {
    approvedById: opts.actorUserId,
    approvedAt: new Date().toISOString(),
    captionText,
    hashtags: job.hashtags,
    riskAssessment: safety,
    note: ctx.hasApprovedPlaybook
      ? null
      : "兼容模式：仅允许人工审核发布（PLAYBOOK_NOT_APPROVED_LEGACY_FALLBACK）",
  };

  const idempotencyKey = buildIdempotencyKey(orgId, job.id, contentVersion);
  const current = normalizePublishStatus(job.status);

  // blocked / needs_revision → pending_human_approval（改文后），再批准
  if (current === "blocked" || current === "needs_revision" || current === "draft") {
    const mid =
      current === "draft" ? "pending_human_approval" : "pending_human_approval";
    const step = await transitionPublishJob({
      orgId,
      jobId: job.id,
      toStatus: mid,
      actorType: "user",
      actorId: opts.actorUserId,
      reasonCode: "PRE_APPROVE_RESUME",
      data: {
        captionText,
        contentVersion,
        riskAssessmentJson: safety as unknown as Prisma.InputJsonValue,
      },
    });
    if (!step.ok) return step;
  } else if (opts.editedCaption?.trim()) {
    await db.publishJob.update({
      where: { id: job.id },
      data: {
        captionText,
        contentVersion,
        riskAssessmentJson: safety as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const approved = await transitionPublishJob({
    orgId,
    jobId: job.id,
    toStatus: "approved",
    actorType: "user",
    actorId: opts.actorUserId,
    reasonCode: "HUMAN_APPROVE",
    data: {
      captionText,
      contentVersion,
      idempotencyKey,
      approvedById: opts.actorUserId,
      approvedAt: new Date(),
      approvalSnapshotJson: approvalSnapshot as Prisma.InputJsonValue,
      riskAssessmentJson: safety as unknown as Prisma.InputJsonValue,
      errorMessage: ctx.hasApprovedPlaybook
        ? null
        : "兼容模式：仅允许人工审核发布",
    },
  });
  if (!approved.ok) return approved;

  const updatedJob = await db.publishJob.findUniqueOrThrow({ where: { id: job.id } });
  const result = await dispatchPublishJob(updatedJob, job.asset, job.account);
  if (!result.ok) {
    await transitionPublishJob({
      orgId,
      jobId: job.id,
      toStatus: "failed",
      actorType: "system",
      actorId: opts.actorUserId,
      reasonCode: "DISPATCH_FAIL",
      reason: result.error,
      data: { errorMessage: result.error },
    });
    return { ok: false, error: result.error };
  }

  const toStatus =
    result.providerStatus === "published" ? "published" : "queued";
  await transitionPublishJob({
    orgId,
    jobId: job.id,
    toStatus,
    actorType: "system",
    actorId: opts.actorUserId,
    reasonCode: "DISPATCH_OK",
    metadata: {
      externalJobId: result.externalJobId,
      providerStatus: result.providerStatus,
    },
    data: {
      externalJobId: result.externalJobId,
      providerStatus: result.providerStatus ?? null,
      providerResponseJson: (result.providerResponse ??
        undefined) as Prisma.InputJsonValue,
      externalPostUrl: result.externalPostUrl ?? null,
    },
  });

  return { ok: true };
}
