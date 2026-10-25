/**
 * 厂家入驻向导（PRD F6）— 端到端测试询盘
 *
 * 用一条合成询盘走真实链路：ingestWebsiteInquiry（收据 → Trade 线索 → Revenue Spine 商机 → FDE 草稿 → 通知），
 * 跑完立即让它不可发送、不进指标：
 *   - 测试买家（example.com 保留域名）在入链前预建并打 tags 标记 → 发送执行器见标记一律拒发（即使草稿迟到）
 *   - 生成的回复草稿经系统作废原语终止（status=failed，failureReason=SUPERSEDED_BY_ONBOARDING_TEST…，不写 decidedById）
 *   - FDE 行动 dismissed；商机 → disqualified（lostReason = "onboarding test"）
 *   - 测试买家归档（archivedAt，列表与客户去重默认排除）；Trade 线索 → archived，序列步骤 skipped（不触发 SLA 提醒）
 * 事件身份：eventId = onboarding-test-<orgId>-<序号>，utm_source = qingyan_onboarding_test。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { supersedePendingAction } from "@/lib/pending-actions/supersede";
import { resolveIndustryPack } from "@/lib/industry-packs/registry";
import { buildDedupeKeys } from "@/lib/revenue-spine/customer-match";
import { updateFdeAction } from "@/lib/revenue-spine/fde/actions";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";
import { resolveInquiryOwner } from "@/lib/revenue-spine/inquiry-intake";
import { TERMINAL_STAGES, isOpportunityStage } from "@/lib/revenue-spine/opportunity-stage";
import { RULE_KEY_BUSINESS_PROFILE } from "@/lib/revenue-spine/policy";
import { transitionOpportunity } from "@/lib/revenue-spine/transition";
import { ingestWebsiteInquiry, normalizeInquiry, type IngestResult } from "@/lib/trade/website-inquiry";
import { OnboardingError } from "./onboarding";
import {
  ONBOARDING_TEST_BUYER_COMPANY,
  ONBOARDING_TEST_BUYER_EMAIL,
  ONBOARDING_TEST_CLOSE_REASON,
  ONBOARDING_TEST_PENDING_ACTION_REASON,
  buildOnboardingTestInquiryPayload,
  nextOnboardingTestCounter,
  onboardingTestEventPrefix,
  withOnboardingTestTag,
} from "./onboarding-rules";

export interface StageResult {
  ok: boolean;
  detail: string;
}

export interface OnboardingTestInquiryResult {
  ok: boolean;
  eventId: string;
  counter: number;
  stages: {
    receipt: StageResult & { receiptId: string | null; replay: boolean; busy: boolean };
    opportunity: StageResult & { opportunityId: string | null; customerId: string | null; prospectId: string | null };
    draft: StageResult & { pendingActionId: string | null; fdeStatus: string | null; score: number | null; grade: string | null };
    notification: StageResult & { notifications: number; recipients: number; wechatRecipients: number };
    closed: StageResult & {
      pendingActionsCancelled: number;
      salesActionsDismissed: number;
      opportunityStage: string | null;
      customerArchived: boolean;
      prospectArchived: boolean;
    };
  };
  error: string | null;
}

/** 测试买家：同 org 未归档的复用（补标记），否则新建并打标记；负责人与真实询盘同规则 */
async function ensureTestBuyer(orgId: string): Promise<{ id: string; ownerUserId: string }> {
  const existing = await db.salesCustomer.findFirst({
    where: { orgId, archivedAt: null, email: { equals: ONBOARDING_TEST_BUYER_EMAIL, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, tags: true, createdById: true },
  });
  if (existing) {
    const tags = withOnboardingTestTag(existing.tags);
    if (tags !== existing.tags) await db.salesCustomer.update({ where: { id: existing.id }, data: { tags } });
    return { id: existing.id, ownerUserId: existing.createdById };
  }
  const ownerUserId = await resolveInquiryOwner(orgId);
  if (!ownerUserId) throw new OnboardingError("CONFLICT", "企业没有可分配的负责人", 409);
  const keys = buildDedupeKeys({ email: ONBOARDING_TEST_BUYER_EMAIL, company: ONBOARDING_TEST_BUYER_COMPANY });
  const created = await db.salesCustomer.create({
    data: {
      orgId,
      name: ONBOARDING_TEST_BUYER_COMPANY,
      contactName: "Test Buyer",
      email: ONBOARDING_TEST_BUYER_EMAIL,
      country: "Canada",
      emailDomain: keys.domain,
      normalizedName: keys.normalizedName,
      source: "website_inquiry",
      status: "active",
      tags: withOnboardingTestTag(null),
      notes: "青砚入驻测试买家（系统生成，测试结束自动归档；不会给该买家发送任何邮件）",
      createdById: ownerUserId,
    },
    select: { id: true },
  });
  return { id: created.id, ownerUserId };
}

async function firstMakeCategoryLabel(orgId: string, industryPackId: string | null): Promise<string | null> {
  const pack = resolveIndustryPack(industryPackId);
  const catalog = pack.status === "ok" ? pack.pack.productCategoryCatalog ?? [] : [];
  const profile = await db.orgBusinessRule.findFirst({
    where: { orgId, ruleKey: RULE_KEY_BUSINESS_PROFILE, status: "active" },
    orderBy: { version: "desc" },
    select: { configJson: true },
  });
  const cats = (profile?.configJson as { productCategories?: unknown } | null)?.productCategories;
  const first = Array.isArray(cats) ? cats.find((c): c is string => typeof c === "string") : undefined;
  if (!first) return null;
  return catalog.find((c) => c.key === first)?.labelEn ?? first.replace(/_/g, " ");
}

/**
 * 让测试单不可发送、不进队列：草稿系统终止、行动关闭、商机 disqualified、买家归档、线索归档。
 * 只处理传入的（同 org 内）测试对象；可重复调用。
 */
export async function closeOnboardingTestInquiry(input: {
  orgId: string;
  actorUserId: string;
  opportunityIds: string[];
  customerId: string | null;
  prospectId: string | null;
  now?: Date;
}): Promise<OnboardingTestInquiryResult["stages"]["closed"]> {
  const now = input.now ?? new Date();
  const { orgId } = input;
  const oppIds = [...new Set(input.opportunityIds.filter(Boolean))];

  // 1) 回复草稿：经系统作废原语 pending → failed（SUPERSEDED_BY_ONBOARDING_TEST；不写 decidedById，不冒充人工拒绝）
  let pendingActionsCancelled = 0;
  if (oppIds.length) {
    const drafts = await db.pendingAction.findMany({
      where: {
        orgId,
        type: INQUIRY_REPLY_ACTION_TYPE,
        status: "pending",
        OR: oppIds.map((id) => ({ payload: { path: ["opportunityId"], equals: id } })),
      },
      select: { id: true, payload: true },
    });
    for (const d of drafts) {
      const p = (d.payload ?? {}) as { replyToInteractionId?: unknown; metadata?: { agentRunId?: unknown } };
      const sup = await supersedePendingAction({
        pendingActionId: d.id,
        orgId,
        expectedType: INQUIRY_REPLY_ACTION_TYPE,
        reasonCode: ONBOARDING_TEST_PENDING_ACTION_REASON,
        triggeredByUserId: input.actorUserId,
        auditActorUserId: input.actorUserId,
        evidence: {
          inboundInteractionId: typeof p.replyToInteractionId === "string" ? p.replyToInteractionId : null,
          agentRunId: typeof p.metadata?.agentRunId === "string" ? p.metadata.agentRunId : null,
        },
      });
      if (sup.ok && !sup.duplicate) pendingActionsCancelled++;
    }
  }

  // 2) FDE / SLA 行动：dismissed，标记 onboardingTest
  let salesActionsDismissed = 0;
  if (oppIds.length) {
    const actions = await db.salesAction.findMany({
      where: { orgId, opportunityId: { in: oppIds }, status: { in: ["open", "in_progress"] } },
      select: { id: true },
    });
    for (const a of actions) {
      await updateFdeAction({
        orgId,
        actionId: a.id,
        inputContextPatch: { onboardingTest: true },
        close: { status: "dismissed", reason: "入驻测试询盘：系统自动关闭，无需跟进" },
      });
      salesActionsDismissed++;
    }
  }

  // 3) 商机 → disqualified（终态不进 pipeline / 队列）；lostReason 统一为测试标记
  let opportunityStage: string | null = null;
  for (const id of oppIds) {
    const opp = await db.salesOpportunity.findFirst({ where: { id, orgId }, select: { id: true, stage: true } });
    if (!opp) continue;
    let stage = opp.stage;
    if (!(TERMINAL_STAGES as readonly string[]).includes(stage)) {
      const r = await transitionOpportunity({
        orgId,
        opportunityId: id,
        to: "disqualified",
        actorUserId: input.actorUserId,
        source: "system",
        reason: ONBOARDING_TEST_CLOSE_REASON,
        now,
      });
      if (r.ok) stage = r.to;
      else if (isOpportunityStage(stage)) {
        // 报价后阶段不能直接判不合格：退到 lost（测试单不会走到这里，兜底）
        const lost = await transitionOpportunity({
          orgId,
          opportunityId: id,
          to: "lost",
          actorUserId: input.actorUserId,
          source: "system",
          reason: ONBOARDING_TEST_CLOSE_REASON,
          now,
        });
        if (lost.ok) stage = lost.to;
      }
    }
    await db.salesOpportunity.update({ where: { id }, data: { lostReason: ONBOARDING_TEST_CLOSE_REASON, nextFollowupAt: null } });
    opportunityStage = stage;
  }

  // 4) 测试买家：标记 + 归档（客户列表与去重默认排除）
  let customerArchived = false;
  if (input.customerId) {
    const c = await db.salesCustomer.findFirst({ where: { id: input.customerId, orgId }, select: { id: true, tags: true, archivedAt: true } });
    if (c) {
      await db.salesCustomer.update({
        where: { id: c.id },
        data: { tags: withOnboardingTestTag(c.tags), archivedAt: c.archivedAt ?? now, status: "dormant" },
      });
      customerArchived = true;
    }
  }

  // 5) Trade 线索：archived（收件箱视为已处理、不触发 SLA 提醒），序列步骤 skipped
  let prospectArchived = false;
  if (input.prospectId) {
    const p = await db.tradeProspect.findFirst({ where: { id: input.prospectId, orgId }, select: { id: true } });
    if (p) {
      await db.tradeProspect.update({ where: { id: p.id }, data: { stage: "archived", nextFollowUpAt: null } });
      await db.tradeOutreachStep.updateMany({
        where: { orgId, prospectId: p.id, status: { in: ["pending", "drafted"] } },
        data: { status: "skipped", lastError: "onboarding test" },
      });
      prospectArchived = true;
    }
  }

  const openLeft = oppIds.length
    ? await db.pendingAction.count({
        where: { orgId, status: "pending", OR: oppIds.map((id) => ({ payload: { path: ["opportunityId"], equals: id } })) },
      })
    : 0;
  const closedOk = openLeft === 0 && (oppIds.length === 0 || (!!opportunityStage && (TERMINAL_STAGES as readonly string[]).includes(opportunityStage)));
  return {
    ok: closedOk,
    detail: closedOk
      ? `已关闭：取消草稿 ${pendingActionsCancelled} 份，关闭行动 ${salesActionsDismissed} 个，商机 → ${opportunityStage ?? "无"}`
      : `仍有 ${openLeft} 份草稿未关闭或商机未终结，请重试`,
    pendingActionsCancelled,
    salesActionsDismissed,
    opportunityStage,
    customerArchived,
    prospectArchived,
  };
}

/** 发送一条测试询盘并返回逐段结果（收据 → 商机 → 草稿 → 通知 → 关闭） */
export async function runOnboardingTestInquiry(
  orgId: string,
  actorUserId: string,
  opts?: { now?: Date },
): Promise<OnboardingTestInquiryResult> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true, status: true, industryPackId: true } });
  if (!org) throw new OnboardingError("NOT_FOUND", "企业不存在", 404);
  if (org.status !== "active") throw new OnboardingError("CONFLICT", "企业未启用", 409);
  const now = opts?.now ?? new Date();

  const prior = await db.websiteInquiryReceipt.findMany({
    where: { orgId, eventId: { startsWith: onboardingTestEventPrefix(orgId) } },
    select: { eventId: true },
  });
  const counter = nextOnboardingTestCounter(orgId, prior.map((p) => p.eventId));
  const payload = buildOnboardingTestInquiryPayload({ orgId, counter, productLabelEn: await firstMakeCategoryLabel(orgId, org.industryPackId) });
  const normalized = normalizeInquiry(payload);
  if (!normalized.ok) throw new Error(`测试询盘载荷无效：${normalized.error}`);

  const buyer = await ensureTestBuyer(orgId);
  let ingest: IngestResult | null = null;
  let error: string | null = null;
  try {
    ingest = await ingestWebsiteInquiry(orgId, normalized.value, { now });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // 入链失败也要把已建出的对象关掉：按收据回查
  const receipt = await db.websiteInquiryReceipt.findUnique({
    where: { orgId_source_eventId: { orgId, source: "website", eventId: payload.eventId } },
    select: { id: true, prospectId: true, opportunityId: true, customerId: true, pendingActionId: true },
  });
  const opportunityId = (ingest?.spine.ok ? ingest.spine.opportunityId : null) ?? receipt?.opportunityId ?? null;
  const customerId = (ingest?.spine.ok ? ingest.spine.customerId : null) ?? receipt?.customerId ?? buyer.id;
  const prospectId = ingest?.prospectId || receipt?.prospectId || null;

  // 草稿阶段：收据 / FDE 状态里登记的审批草稿
  const pendingActionId = ingest?.fdeState?.pendingActionId ?? ingest?.fde?.pendingActionId ?? receipt?.pendingActionId ?? null;
  const draftRow = pendingActionId
    ? await db.pendingAction.findFirst({ where: { id: pendingActionId, orgId }, select: { id: true, status: true } })
    : null;

  // 通知阶段：本次为该线索 / 商机写入的站内通知，及其中已绑定微信的接收人
  const notifRows = prospectId || opportunityId
    ? await db.notification.findMany({
        where: {
          orgId,
          createdAt: { gte: now },
          OR: [
            ...(prospectId ? [{ entityType: "trade_prospect", entityId: prospectId }] : []),
            ...(opportunityId ? [{ entityType: "revenue_opportunity", entityId: opportunityId }] : []),
          ],
        },
        select: { userId: true },
      })
    : [];
  const recipients = [...new Set(notifRows.map((n) => n.userId))];
  const wechatRecipients = recipients.length
    ? (
        await db.weChatBinding.findMany({
          where: { userId: { in: recipients }, status: "active", OR: [{ orgId: null }, { orgId }] },
          select: { userId: true },
          distinct: ["userId"],
        })
      ).length
    : 0;

  const closed = await closeOnboardingTestInquiry({
    orgId,
    actorUserId,
    opportunityIds: opportunityId ? [opportunityId] : [],
    customerId,
    prospectId,
    now,
  });

  const stages: OnboardingTestInquiryResult["stages"] = {
    receipt: {
      ok: !!receipt && !ingest?.busy,
      detail: !receipt ? "未写入收据" : ingest?.busy ? "同一测试事件正在处理中" : `收据已写入（${payload.eventId}）`,
      receiptId: receipt?.id ?? null,
      replay: ingest?.replay ?? false,
      busy: ingest?.busy ?? false,
    },
    opportunity: {
      ok: !!opportunityId,
      detail: opportunityId ? "已建线索、客户与商机" : ingest && !ingest.spine.ok ? `商机未建出：${ingest.spine.error}` : "商机未建出",
      opportunityId,
      customerId,
      prospectId,
    },
    draft: {
      ok: !!draftRow,
      detail: draftRow
        ? "回复草稿已生成并进入审批（测试结束已系统取消，不会发送）"
        : `未生成审批草稿（FDE 状态：${ingest?.fdeState?.status ?? "未知"}${ingest?.fde?.error ? `，${ingest.fde.error}` : ""}）`,
      pendingActionId: draftRow?.id ?? null,
      fdeStatus: ingest?.fdeState?.status ?? null,
      score: ingest?.fde?.score ?? null,
      grade: ingest?.fde?.grade ?? null,
    },
    notification: {
      ok: notifRows.length > 0,
      detail: notifRows.length
        ? `已通知 ${recipients.length} 人${wechatRecipients ? `，其中 ${wechatRecipients} 人已绑定微信（由微信推送任务转发）` : "，均未绑定微信"}`
        : "没有写入任何通知（企业可能没有外贸 / 老板角色成员）",
      notifications: notifRows.length,
      recipients: recipients.length,
      wechatRecipients,
    },
    closed,
  };
  const ok = !error && stages.receipt.ok && stages.opportunity.ok && stages.draft.ok && stages.notification.ok && stages.closed.ok;

  await logAudit({
    userId: actorUserId,
    orgId,
    action: "onboarding.test_inquiry.run",
    targetType: "website_inquiry_receipt",
    targetId: receipt?.id ?? null,
    afterData: {
      eventId: payload.eventId,
      ok,
      error,
      opportunityId,
      pendingActionId: draftRow?.id ?? null,
      notifications: notifRows.length,
      closed: { pendingActionsCancelled: closed.pendingActionsCancelled, opportunityStage: closed.opportunityStage },
    },
  });

  return { ok, eventId: payload.eventId, counter, stages, error };
}
