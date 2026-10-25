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
import { isTerminalStage } from "@/lib/revenue-spine/opportunity-stage";
import { transitionOpportunity } from "@/lib/revenue-spine/transition";
import { ingestWebsiteInquiry, normalizeInquiry, type IngestResult } from "@/lib/trade/website-inquiry";
import { OnboardingError, activeWeChatBindings, loadActiveBusinessProfile, requireOrg, strArray } from "./onboarding";
import {
  ONBOARDING_TEST_BUYER_COMPANY,
  ONBOARDING_TEST_BUYER_EMAIL,
  ONBOARDING_TEST_CLOSE_REASON,
  ONBOARDING_TEST_PENDING_ACTION_REASON,
  buildOnboardingTestInquiryPayload,
  nextOnboardingTestCounter,
  onboardingTestEventPrefix,
  rec,
  withOnboardingTestTag,
} from "./onboarding-rules";

interface StageResult {
  ok: boolean;
  detail: string;
}

export interface OnboardingTestInquiryResult {
  ok: boolean;
  eventId: string;
  counter: number;
  stages: {
    receipt: StageResult & { receiptId: string | null; replay: boolean; busy: boolean };
    opportunity: StageResult & {
      opportunityId: string | null;
      customerId: string | null;
      prospectId: string | null;
      /** 入链前预建并打好测试标记的买家；customerId 与之相同 = 草稿生成时买家已带拒发标记 */
      preTaggedBuyerId: string;
    };
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
  const first = strArray(rec((await loadActiveBusinessProfile(orgId))?.configJson)?.productCategories)[0];
  if (!first) return null;
  const pack = resolveIndustryPack(industryPackId);
  return (pack.status === "ok" ? pack.pack.productCategoryCatalog?.find((c) => c.key === first)?.labelEn : null) ?? first.replace(/_/g, " ");
}

/**
 * 让测试单不可发送、不进队列：草稿系统终止、行动关闭、商机 disqualified、买家归档、线索归档。
 * 只处理传入的（同 org 内）测试对象；可重复调用。
 */
async function closeOnboardingTestInquiry(input: {
  orgId: string;
  actorUserId: string;
  opportunityId: string | null;
  customerId: string | null;
  prospectId: string | null;
  now: Date;
}): Promise<OnboardingTestInquiryResult["stages"]["closed"]> {
  const { orgId, opportunityId, now } = input;
  let pendingActionsCancelled = 0;
  let salesActionsDismissed = 0;
  let opportunityStage: string | null = null;
  let openLeft = 0;
  if (opportunityId) {
    const draftsOfOpp = { orgId, status: "pending", payload: { path: ["opportunityId"], equals: opportunityId } };
    // 1) 回复草稿：经系统作废原语 pending → failed（SUPERSEDED_BY_ONBOARDING_TEST；不写 decidedById，不冒充人工拒绝）
    const drafts = await db.pendingAction.findMany({
      where: { ...draftsOfOpp, type: INQUIRY_REPLY_ACTION_TYPE },
      select: { id: true, payload: true },
    });
    for (const d of drafts) {
      const p = rec(d.payload) ?? {};
      const agentRunId = rec(p.metadata)?.agentRunId;
      const sup = await supersedePendingAction({
        pendingActionId: d.id,
        orgId,
        expectedType: INQUIRY_REPLY_ACTION_TYPE,
        reasonCode: ONBOARDING_TEST_PENDING_ACTION_REASON,
        triggeredByUserId: input.actorUserId,
        auditActorUserId: input.actorUserId,
        evidence: {
          inboundInteractionId: typeof p.replyToInteractionId === "string" ? p.replyToInteractionId : null,
          agentRunId: typeof agentRunId === "string" ? agentRunId : null,
        },
      });
      if (sup.ok && !sup.duplicate) pendingActionsCancelled++;
    }

    // 2) FDE / SLA 行动：dismissed，标记 onboardingTest
    const actions = await db.salesAction.findMany({
      where: { orgId, opportunityId, status: { in: ["open", "in_progress"] } },
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

    // 3) 商机 → disqualified（终态不进 pipeline / 队列）；lostReason 统一为测试标记
    const opp = await db.salesOpportunity.findFirst({ where: { id: opportunityId, orgId }, select: { stage: true } });
    if (opp) {
      opportunityStage = opp.stage;
      if (!isTerminalStage(opp.stage)) {
        const r = await transitionOpportunity({
          orgId,
          opportunityId,
          to: "disqualified",
          actorUserId: input.actorUserId,
          source: "system",
          reason: ONBOARDING_TEST_CLOSE_REASON,
          now,
        });
        if (r.ok) opportunityStage = r.to;
      }
      await db.salesOpportunity.update({ where: { id: opportunityId }, data: { lostReason: ONBOARDING_TEST_CLOSE_REASON, nextFollowupAt: null } });
    }
    openLeft = await db.pendingAction.count({ where: draftsOfOpp });
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

  const closedOk = openLeft === 0 && (!opportunityId || (!!opportunityStage && isTerminalStage(opportunityStage)));
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
export async function runOnboardingTestInquiry(orgId: string, actorUserId: string): Promise<OnboardingTestInquiryResult> {
  const org = await requireOrg(orgId, "active");
  const now = new Date();

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
  const wechatRecipients = new Set((await activeWeChatBindings(orgId, recipients)).map((b) => b.userId)).size;

  const closed = await closeOnboardingTestInquiry({ orgId, actorUserId, opportunityId, customerId, prospectId, now });

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
      detail: opportunityId
        ? `已建线索、客户与商机${customerId === buyer.id ? "" : "（客户未匹配到预建的测试买家，已在关闭时补打测试标记）"}`
        : ingest && !ingest.spine.ok
          ? `商机未建出：${ingest.spine.error}`
          : "商机未建出",
      opportunityId,
      customerId,
      prospectId,
      preTaggedBuyerId: buyer.id,
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
