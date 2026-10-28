/**
 * Revenue Spine — 询盘统一入口（PART 2 / Principle 2）
 *
 * 任何来源（website_inquiry / email / trade_show / whatsapp / manual / …）最终都走这里：
 *   normalize → 四级去重（邮箱 → 电话 → 域名 → 公司名）→ SalesCustomer 建/联 → SalesOpportunity 建/附 → CustomerInteraction
 *   → SalesAction（FDE 队列）→ 返回给调用方触发 FDE
 *
 * 同一客户在报价前阶段再次来信 = 补充信息（附到既有商机，记 CUSTOMER_REPLIED），不新建平行商机。
 */

import { db } from "@/lib/db";
import { resolveDefaultInquiryOwner } from "@/lib/trade/recipients";
import { logAudit } from "@/lib/audit/logger";
import type { Prisma } from "@prisma/client";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { addBusinessHours } from "./business-days";
import { buildDedupeKeys, matchCustomer, type MatchLevel } from "./customer-match";
import { FDE_EMPLOYEE_KEY, createFdeAction } from "./fde/actions";
import { logRevenueInteraction } from "./interactions";
import { applyNextAction } from "./next-action";
import { clipText, detectLanguage, normalizeEmail, type InquiryLanguage } from "./normalize";
import { OPEN_STAGES, OpportunityStage, PRE_QUOTE_STAGES } from "./opportunity-stage";
import { loadRevenueSpinePolicy, type RevenueSpinePolicy } from "./policy";

export const OPPORTUNITY_SOURCES = [
  "website_inquiry",
  "trade_intelligence",
  "outbound",
  "referral",
  "existing_customer",
  "trade_show",
  "manual",
  "import",
  "email",
  "whatsapp",
  "wechat",
] as const;

export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export function isOpportunitySource(v: unknown): v is OpportunitySource {
  return typeof v === "string" && (OPPORTUNITY_SOURCES as readonly string[]).includes(v);
}

/** 来源 → 互动渠道（调用方未在 meta.channel 指定时）；未列出的来源记 other */
const SOURCE_INTERACTION_CHANNEL: Partial<Record<OpportunitySource, string>> = {
  website_inquiry: "website",
  email: "email",
  whatsapp: "whatsapp",
  wechat: "wechat",
};

/** 来源 → CustomerInteraction.type；未列出的来源记 note */
const SOURCE_INTERACTION_TYPE: Partial<Record<OpportunitySource, string>> = {
  website_inquiry: "web_form",
  email: "email",
  trade_show: "in_person",
  whatsapp: "whatsapp",
  wechat: "wechat",
};

export function inquiryInteractionChannel(source: OpportunitySource, metaChannel?: string | null): string {
  return metaChannel ?? SOURCE_INTERACTION_CHANNEL[source] ?? "other";
}

export function inquiryInteractionType(source: OpportunitySource): string {
  return SOURCE_INTERACTION_TYPE[source] ?? "note";
}

export interface InquiryIntakeInput {
  orgId: string;
  source: OpportunitySource;
  contact: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    country?: string | null;
    website?: string | null;
  };
  message: string;
  subject?: string | null;
  product?: string | null;
  meta?: {
    page?: string | null;
    referrer?: string | null;
    /** 首次访问落地页（嵌入表单等前端采集；归因字段） */
    landing?: string | null;
    utm?: Record<string, string> | null;
    channel?: string | null;
    /** 展会名称（可含展位）；trade_show 来源时写入互动，回复草稿开头引用 */
    event?: string | null;
    /** 展位上看过的参考款；trade_show 来源时写入互动，草稿逐一点名 */
    styles?: Array<{ code: string; name: string | null; specUrl?: string | null; imageUrl?: string | null }> | null;
    /** 业务员在卡上判的等级 A/B/C；trade_show 来源时写入互动，FDE 据此定优先级 */
    boothGrade?: string | null;
    /** 展位上接待的业务员；trade_show 来源时写入互动，草稿落款 */
    boothSales?: string | null;
  };
  sourceRef?: {
    tradeProspectId?: string | null;
    tradeMessageId?: string | null;
    externalId?: string | null;
  };
  /**
   * 重放判定（默认 content：同客户 + 同正文 + 窗口内）。external_id = 来源平台保证消息 id 唯一（WhatsApp wamid）：
   * 只有同一 sourceRef.externalId 才算重放，同一买家发两次相同内容（「ok」、不带说明的图）是两条消息。
   */
  replayKey?: "content" | "external_id";
  /** 人工录入时为操作者；网站询盘为 null（用商机负责人） */
  actorUserId?: string | null;
  /** AI 主动发现的商机（trade_intelligence / outbound by FDE） */
  fdeSourced?: boolean;
  now?: Date;
  policy?: RevenueSpinePolicy;
}

export type IntakeResult =
  | {
      ok: true;
      customerId: string;
      customerCreated: boolean;
      matchLevel: MatchLevel | null;
      opportunityId: string;
      opportunityCreated: boolean;
      /** true = 附到既有开放商机（补充信息/客户回复） */
      attachedToExisting: boolean;
      interactionId: string;
      /** replay 时可能为空（既有行动已执行并释放） */
      salesActionId: string | null;
      ownerUserId: string;
      language: InquiryLanguage;
      customerReplied: boolean;
      /** 同一客户在 INQUIRY_REPLAY_WINDOW_MS 内重复提交同一内容：不新建任何对象 */
      replay: boolean;
    }
  | { ok: false; code: "INVALID_CONTACT" | "INVALID_EMAIL" | "EMPTY_MESSAGE" | "NO_OWNER"; error: string };

/** 幂等窗口：同客户 + 同正文 = 重放（浏览器重试 / 站点重发 / 双击） */
export const INQUIRY_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

const LIMITS = { name: 120, email: 200, phone: 60, company: 200, country: 80, website: 300, message: 20_000, subject: 200, product: 200 };

/**
 * 负责人：既有客户商机负责人 → 组织内岗位派生平台角色为 trade / sales 的成员（最早加入）→ 组织 owner。
 * PERM-6c：按派生角色选人（旧模式即平台角色），定义见 trade/recipients。
 */
export async function resolveInquiryOwner(orgId: string, preferredUserId?: string | null): Promise<string | null> {
  if (preferredUserId) return preferredUserId;
  return resolveDefaultInquiryOwner(orgId);
}

export async function intakeInquiry(input: InquiryIntakeInput): Promise<IntakeResult> {
  const now = input.now ?? new Date();
  const name = clipText(input.contact.name, LIMITS.name);
  const rawEmail = clipText(input.contact.email, LIMITS.email);
  const email = normalizeEmail(rawEmail);
  const phone = clipText(input.contact.phone, LIMITS.phone);
  const company = clipText(input.contact.company, LIMITS.company);
  const country = clipText(input.contact.country, LIMITS.country);
  const website = clipText(input.contact.website, LIMITS.website);
  const message = (input.message ?? "").trim().slice(0, LIMITS.message);
  const subject = clipText(input.subject, LIMITS.subject) || null;
  const product = clipText(input.product, LIMITS.product) || null;

  if (rawEmail && !email) return { ok: false, code: "INVALID_EMAIL", error: "邮箱格式不正确" };
  if (!email && !phone) return { ok: false, code: "INVALID_CONTACT", error: "需要邮箱或电话至少一项" };
  if (!message && !product) return { ok: false, code: "EMPTY_MESSAGE", error: "询盘内容为空" };

  const policy = input.policy ?? (await loadRevenueSpinePolicy(input.orgId));
  const language = detectLanguage([subject, product, message].filter(Boolean).join("\n"));
  const keys = buildDedupeKeys({ email, company, phone, website, country });

  // ── 1-4. 去重（邮箱 → 电话 E.164 → 企业域名 → 公司名）──
  const match = await matchCustomer(input.orgId, { email, company, phone, website, country });
  let customerId: string;
  let customerCreated = false;
  let ownerUserId: string | null = null;

  if (match.customer) {
    customerId = match.customer.id;
    const existingOpp = await db.salesOpportunity.findFirst({
      where: { orgId: input.orgId, customerId, stage: { in: [...OPEN_STAGES] } },
      orderBy: { updatedAt: "desc" },
      select: { assignedToId: true },
    });
    ownerUserId = await resolveInquiryOwner(input.orgId, input.actorUserId ?? existingOpp?.assignedToId ?? match.customer.createdById);
    // 补齐去重键与联系人（不覆盖已有值）
    await db.salesCustomer.update({
      where: { id: customerId },
      data: {
        ...(match.customer.emailDomain ? {} : keys.domain ? { emailDomain: keys.domain } : {}),
        ...(match.customer.normalizedName ? {} : keys.normalizedName ? { normalizedName: keys.normalizedName } : {}),
        ...(match.customer.contactName || !name ? {} : { contactName: name }),
        ...(match.customer.email || !email ? {} : { email }),
        ...(match.customer.phone || !phone ? {} : { phone }),
      },
    });
  } else {
    ownerUserId = await resolveInquiryOwner(input.orgId, input.actorUserId);
    if (!ownerUserId) return { ok: false, code: "NO_OWNER", error: "组织没有可分配的负责人" };
    const displayName = company || name || (keys.domain ?? "") || email || phone;
    const created = await db.salesCustomer.create({
      data: {
        orgId: input.orgId,
        name: displayName.slice(0, 200),
        contactName: name || null,
        email,
        phone: phone || null,
        website: website || null,
        country: country || null,
        emailDomain: keys.domain,
        normalizedName: keys.normalizedName,
        source: input.source,
        status: "active",
        createdById: ownerUserId,
      },
      select: { id: true },
    });
    customerId = created.id;
    customerCreated = true;
  }
  if (!ownerUserId) return { ok: false, code: "NO_OWNER", error: "组织没有可分配的负责人" };

  // ── 幂等：同客户、同正文、窗口内 → 重放，返回既有对象（replayKey=external_id：同一平台消息 id 才算）──
  const renderedContent = [subject ? `Subject: ${subject}` : null, product ? `Product: ${product}` : null, message].filter(Boolean).join("\n");
  const externalId = input.replayKey === "external_id" ? input.sourceRef?.externalId || null : null;
  if (!customerCreated && (input.replayKey !== "external_id" || externalId)) {
    const replayed = await db.customerInteraction.findFirst({
      where: {
        orgId: input.orgId,
        customerId,
        direction: "inbound",
        ...(externalId
          ? { analysisResult: { path: ["sourceRef", "externalId"], equals: externalId } }
          : { content: renderedContent, createdAt: { gte: new Date(now.getTime() - INQUIRY_REPLAY_WINDOW_MS) } }),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, opportunityId: true },
    });
    if (replayed?.opportunityId) {
      const existingAction = await db.salesAction.findFirst({
        where: { orgId: input.orgId, opportunityId: replayed.opportunityId, signalKey: `inbound:${replayed.id}` },
        select: { id: true },
      });
      return {
        ok: true,
        customerId,
        customerCreated: false,
        matchLevel: match.level,
        opportunityId: replayed.opportunityId,
        opportunityCreated: false,
        attachedToExisting: true,
        interactionId: replayed.id,
        salesActionId: existingAction?.id ?? null,
        ownerUserId,
        language,
        customerReplied: false,
        replay: true,
      };
    }
  }

  // ── 5-6. 商机：报价前的开放商机 → 附加；否则新建 ──
  const openPreQuote = customerCreated
    ? null
    : await db.salesOpportunity.findFirst({
        where: { orgId: input.orgId, customerId, stage: { in: [...PRE_QUOTE_STAGES] } },
        orderBy: { updatedAt: "desc" },
        select: { id: true, assignedToId: true },
      });
  let opportunityId: string;
  let opportunityCreated = false;
  if (openPreQuote) {
    opportunityId = openPreQuote.id;
  } else {
    const title = `${product ? product + " — " : ""}${company || name || email || phone}`.slice(0, 200);
    const opp = await db.salesOpportunity.create({
      data: {
        orgId: input.orgId,
        customerId,
        title,
        stage: OpportunityStage.NEW_INQUIRY,
        stageChangedAt: now,
        source: input.source,
        priority: "warm",
        market: country || null,
        fdeSourced: input.fdeSourced === true,
        sourceTradeProspectId: input.sourceRef?.tradeProspectId ?? null,
        assignedToId: ownerUserId,
        createdById: ownerUserId,
      },
      select: { id: true },
    });
    opportunityId = opp.id;
    opportunityCreated = true;
  }

  // ── 7. 互动（含 UTM / 来源页 / 表单原文） ──
  const rawMessages = [
    {
      role: "customer",
      content: renderedContent,
      time: now.toISOString(),
      contact: { name: name || null, email, phone: phone || null, company: company || null, country: country || null, website: website || null },
      meta: input.meta ?? null,
    },
  ];
  const logged = await logRevenueInteraction({
    orgId: input.orgId,
    opportunityId,
    direction: "inbound",
    channel: inquiryInteractionChannel(input.source, input.meta?.channel),
    type: inquiryInteractionType(input.source),
    summary: [subject, product, message].filter(Boolean).join(" — "),
    content: rawMessages[0].content,
    actorUserId: ownerUserId,
    occurredAt: now,
    rawMessages,
    language,
    source: input.source,
    extra: {
      // 写这封来信的人：同公司第二位联系人复用商机时，FDE 据此提醒审核人（见 fde/inbound-sales.ts）
      contact: { name: name || null, email: email || null },
      page: input.meta?.page ?? null,
      referrer: input.meta?.referrer ?? null,
      ...(input.meta?.landing ? { landing: input.meta.landing } : {}),
      utm: input.meta?.utm ?? null,
      sourceRef: input.sourceRef ?? null,
      ...(input.meta?.event ? { event: input.meta.event } : {}),
      ...(input.meta?.styles?.length ? { styles: input.meta.styles } : {}),
      ...(input.meta?.boothGrade ? { boothGrade: input.meta.boothGrade } : {}),
      ...(input.meta?.boothSales ? { boothSales: input.meta.boothSales } : {}),
    },
    policy,
  });

  // ── 8. SalesAction：进入 FDE 工作流（SLA 到期时间来自 policy；设了工作时间则按组织当地工作时段计） ──
  const dueAt = addBusinessHours(now, policy.salesSla.newInquiryResponseHours, policy.salesSla.businessHours ?? null);
  const action = await createFdeAction({
    orgId: input.orgId,
    customerId,
    opportunityId,
    actionType: opportunityCreated ? "inbound_inquiry" : "inbound_followup_message",
    category: "contact",
    title: `${opportunityCreated ? "新询盘" : "客户来信"}：${(company || name || email || phone).slice(0, 80)}${product ? " — " + product.slice(0, 60) : ""}`,
    description: message.slice(0, 2000),
    priority: "high",
    dueAt,
    signalKey: `inbound:${logged.interactionId}`,
    assignedToId: ownerUserId,
    createdById: ownerUserId,
    inputContext: {
      source: input.source,
      interactionId: logged.interactionId,
      language,
      fdeStatus: "queued",
      meta: input.meta ?? null,
      sourceRef: input.sourceRef ?? null,
    },
  });

  await applyNextAction(input.orgId, opportunityId, { policy, now });

  await logAudit({
    userId: input.actorUserId ?? ownerUserId,
    orgId: input.orgId,
    action: "revenue_spine.inquiry.intake",
    targetType: "sales_opportunity",
    targetId: opportunityId,
    afterData: {
      source: input.source,
      customerId,
      customerCreated,
      matchLevel: match.level,
      opportunityCreated,
      interactionId: logged.interactionId,
      salesActionId: action.id,
    },
  });

  // 通知负责人（幂等 sourceKey）
  await createNotificationsForUsers([ownerUserId], {
    type: "followup",
    title: opportunityCreated ? `新询盘：${(company || name || email || phone).slice(0, 60)}` : `客户来信：${(company || name || email || phone).slice(0, 60)}`,
    summary: [product, message].filter(Boolean).join(" — ").slice(0, 140),
    orgId: input.orgId,
    entityType: "revenue_opportunity",
    entityId: opportunityId,
    priority: "high",
    metadata: { opportunityId, salesActionId: action.id, source: input.source, employeeKey: FDE_EMPLOYEE_KEY } as Prisma.InputJsonValue as unknown as Record<string, unknown>,
    sourceKeyPrefix: `revenue-inquiry:${logged.interactionId}`,
  }).catch((err) => console.warn("[revenue-spine] notify failed:", err instanceof Error ? err.message : err));

  return {
    ok: true,
    customerId,
    customerCreated,
    matchLevel: match.level,
    opportunityId,
    opportunityCreated,
    attachedToExisting: !opportunityCreated,
    interactionId: logged.interactionId,
    salesActionId: action.id,
    ownerUserId,
    language,
    customerReplied: logged.customerReplied,
    replay: false,
  };
}
