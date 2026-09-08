/**
 * 网站询盘接入 — 独立站表单 → 外贸线索
 *
 * 链路：网站表单 POST /api/trade/webhook/website（带 org 的 website 通道密钥）
 *   → 归一化校验 → 归集到「网站询盘」活动 → 按邮箱去重建/复用线索
 *   → 写入 inbound 消息（含 UTM/来源页）→ 线索标为待立即跟进 → 通知销售
 *
 * 密钥放在公开网页里本质是防滥用令牌而非机密：配合蜜罐字段与通道可停用。
 */

import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { createProspect } from "@/lib/trade/service";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { intakeInquiry, type InquiryIntakeInput, type IntakeResult } from "@/lib/revenue-spine/inquiry-intake";
import type { InquiryLanguage } from "@/lib/revenue-spine/normalize";
import { runInboundSalesFde, type InboundFdeResult } from "@/lib/revenue-spine/fde/inbound-sales";

export const WEBSITE_INQUIRY_CAMPAIGN_NAME = "网站询盘";

const LIMITS = {
  name: 120,
  email: 200,
  phone: 60,
  company: 200,
  country: 80,
  message: 4000,
  product: 200,
  website: 300,
  page: 500,
  utm: 120,
  eventId: 120,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 可被推进为「已回复」的前置阶段；成交/流失/归档等终态不动 */
const BUMPABLE_STAGES = new Set([
  "new",
  "discovered",
  "researched",
  "qualified",
  "contacted",
  "outreach_sent",
  "follow_up",
  "no_response",
]);

export interface NormalizedInquiry {
  name: string;
  email: string;
  phone: string;
  company: string;
  country: string;
  message: string;
  product: string;
  website: string;
  page: string;
  utm: { source: string; medium: string; campaign: string; content: string; term: string };
  /** 站点侧原始询盘 id（重发时相同）；存入主干 sourceRef.externalId 并用于按 id 重放 */
  eventId: string;
  honeypotTripped: boolean;
}

export type NormalizeResult =
  | { ok: true; value: NormalizedInquiry }
  | { ok: false; error: string };

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** 纯函数：清洗+校验网站表单载荷（JSON 或 form 字段均为字符串） */
export function normalizeInquiry(raw: Record<string, unknown>): NormalizeResult {
  const honeypotTripped = Boolean(str(raw._hp, 50) || str(raw.website_url, 50));
  const email = str(raw.email, LIMITS.email).toLowerCase();
  const phone = str(raw.phone ?? raw.whatsapp, LIMITS.phone);
  const name = str(raw.name ?? raw.contact ?? raw.contactName, LIMITS.name);
  const company = str(raw.company ?? raw.companyName, LIMITS.company);
  const eventId = str(raw.eventId ?? raw.event_id, LIMITS.eventId);

  if (honeypotTripped) {
    return {
      ok: true,
      value: {
        name, email, phone, company,
        country: "", message: "", product: "", website: "", page: "",
        utm: { source: "", medium: "", campaign: "", content: "", term: "" },
        eventId,
        honeypotTripped: true,
      },
    };
  }

  if (!email && !phone) {
    return { ok: false, error: "需要邮箱或电话/WhatsApp 至少一项" };
  }
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "邮箱格式不正确" };
  }

  return {
    ok: true,
    value: {
      name,
      email,
      phone,
      company,
      country: str(raw.country, LIMITS.country),
      message: str(raw.message ?? raw.inquiry ?? raw.content, LIMITS.message),
      product: str(raw.product ?? raw.interest, LIMITS.product),
      website: str(raw.website ?? raw.buyerWebsite, LIMITS.website),
      page: str(raw.page ?? raw.landingPage, LIMITS.page),
      utm: {
        source: str(raw.utm_source, LIMITS.utm),
        medium: str(raw.utm_medium, LIMITS.utm),
        campaign: str(raw.utm_campaign, LIMITS.utm),
        content: str(raw.utm_content, LIMITS.utm),
        term: str(raw.utm_term, LIMITS.utm),
      },
      eventId,
      honeypotTripped: false,
    },
  };
}

/** 线索公司名兜底：公司 → 姓名 → 邮箱域名 → 固定占位 */
export function deriveCompanyName(v: NormalizedInquiry): string {
  if (v.company) return v.company;
  if (v.name) return v.name;
  const domain = v.email.split("@")[1];
  if (domain && !/^(gmail|yahoo|hotmail|outlook|icloud|qq|163|126)\./i.test(domain)) {
    return domain;
  }
  return v.email || v.phone || "网站询盘";
}

/** 写入线索时间线的结构化消息正文 */
export function buildInquiryMessage(v: NormalizedInquiry): string {
  const lines = ["【网站询盘】"];
  if (v.product) lines.push(`产品：${v.product}`);
  if (v.message) lines.push(`留言：${v.message}`);
  const who = [v.name, v.phone, v.email].filter(Boolean).join(" · ");
  if (who) lines.push(`联系人：${who}`);
  if (v.country) lines.push(`国家：${v.country}`);
  if (v.website) lines.push(`买家网站：${v.website}`);
  if (v.page) lines.push(`来源页：${v.page}`);
  const utm = [
    v.utm.source && `source=${v.utm.source}`,
    v.utm.medium && `medium=${v.utm.medium}`,
    v.utm.campaign && `campaign=${v.utm.campaign}`,
    v.utm.content && `content=${v.utm.content}`,
    v.utm.term && `term=${v.utm.term}`,
  ].filter(Boolean);
  if (utm.length) lines.push(`UTM：${utm.join(" ")}`);
  return lines.join("\n");
}

function secretMatches(expected: unknown, provided: string): boolean {
  if (typeof expected !== "string" || !expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 按密钥定位 website 通道（每 org 一条；行数极少，逐条恒时比较） */
export async function resolveWebsiteChannelBySecret(secret: string) {
  if (!secret) return null;
  const channels = await db.tradeChannel.findMany({
    where: { channel: "website", status: "active" },
    select: { id: true, orgId: true, config: true },
  });
  for (const ch of channels) {
    const cfg = (ch.config ?? {}) as Record<string, unknown>;
    if (secretMatches(cfg.secret, secret)) return ch;
  }
  return null;
}

export async function ensureInquiryCampaign(
  orgId: string,
  name: string = WEBSITE_INQUIRY_CAMPAIGN_NAME,
) {
  const existing = await db.tradeCampaign.findFirst({
    where: { orgId, name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { ownerId: true },
  });
  const created = await db.tradeCampaign.create({
    data: {
      orgId,
      name,
      productDesc: name === WEBSITE_INQUIRY_CAMPAIGN_NAME ? "独立站表单自动归集的询盘" : "消息通道陌生来信自动归集的询盘",
      targetMarket: "海外（按询盘国家）",
      searchKeywords: [],
      status: "active",
      createdById: org?.ownerId ?? "system",
    },
    select: { id: true },
  });
  return created.id;
}

export interface FdeState {
  /** queued | running | completed | failed | run_blocked | stale_running | not_run（SalesAction.inputContext.fdeStatus 真实记录，不由 HTTP 结果推断） */
  status: string;
  agentRunId: string | null;
  pendingActionId: string | null;
  salesActionId: string | null;
}

export interface IngestResult {
  prospectId: string;
  messageId: string;
  duplicate: boolean;
  notified: number;
  /** 同一原始询盘再次到达（同 eventId，或窗口内同正文）：不新建 Trade 消息，返回既有 message */
  replay: boolean;
  /** Revenue Spine 结果；失败时 ok=false 且 Trade 线索仍已落库。重放时为既有主干（replay=true）或本次补齐的主干（recovered=true） */
  spine: IntakeResult | { ok: false; code: "SPINE_FAILED" | "REPLAY"; error: string };
  /** 本次调用实际执行的 FDE（首次或恢复重跑）；未执行为 null */
  fde: InboundFdeResult | null;
  /** 重放时补齐了缺失的下游步骤（主干或 FDE） */
  recovered: boolean;
  /** 该消息的 FDE 状态快照（来自 SalesAction） */
  fdeState: FdeState | null;
}

/** 幂等窗口：同一渲染正文的网站询盘视为重放（浏览器重试 / 双击提交 / 站点重发） */
export const WEBSITE_INQUIRY_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** FDE 处于 running 超过此时长视为被中断（函数被硬杀等），重放时允许重跑 */
export const FDE_STALE_RUNNING_MS = 10 * 60 * 1000;
const FDE_RERUNNABLE = new Set(["queued", "failed", "run_blocked", "stale_running"]);

interface ProspectRef {
  id: string;
  stage: string;
  companyName: string;
  convertedToSalesOpportunityId: string | null;
}

const PROSPECT_REF_SELECT = { id: true, stage: true, companyName: true, convertedToSalesOpportunityId: true } as const;

function intakeInputFor(orgId: string, v: NormalizedInquiry, prospectId: string, messageId: string, now: Date): InquiryIntakeInput {
  return {
    orgId,
    source: "website_inquiry",
    contact: { name: v.name, email: v.email, phone: v.phone, company: v.company, country: v.country, website: v.website },
    message: v.message,
    product: v.product,
    meta: { page: v.page, utm: v.utm, channel: "website" },
    sourceRef: { tradeProspectId: prospectId, tradeMessageId: messageId, externalId: v.eventId || null },
    actorUserId: null,
    now,
  };
}

/** 主干互动 ↔ Trade 消息：intake 把 sourceRef 写入 CustomerInteraction.analysisResult */
async function findSpineInteractionByMessage(orgId: string, tradeMessageId: string) {
  return db.customerInteraction.findFirst({
    where: { orgId, direction: "inbound", analysisResult: { path: ["sourceRef", "tradeMessageId"], equals: tradeMessageId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, customerId: true, opportunityId: true, language: true },
  });
}

async function findSpineInteractionByEventId(orgId: string, eventId: string) {
  return db.customerInteraction.findFirst({
    where: { orgId, direction: "inbound", analysisResult: { path: ["sourceRef", "externalId"], equals: eventId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, analysisResult: true },
  });
}

function tradeMessageIdOf(analysisResult: unknown): string | null {
  const ref = (analysisResult as { sourceRef?: { tradeMessageId?: unknown } } | null)?.sourceRef?.tradeMessageId;
  return typeof ref === "string" && ref ? ref : null;
}

/** FDE 状态来自 SalesAction（signalKey=inbound:<interactionId>）；running 过久视为 stale_running */
export async function loadFdeState(orgId: string, interactionId: string, now: Date = new Date()): Promise<FdeState> {
  const action = await db.salesAction.findFirst({
    where: { orgId, signalKey: `inbound:${interactionId}` },
    orderBy: { createdAt: "desc" },
    select: { id: true, agentRunId: true, pendingActionId: true, inputContext: true, updatedAt: true },
  });
  if (!action) return { status: "not_run", agentRunId: null, pendingActionId: null, salesActionId: null };
  const ctx = (action.inputContext ?? {}) as Record<string, unknown>;
  let status = typeof ctx.fdeStatus === "string" && ctx.fdeStatus ? ctx.fdeStatus : "queued";
  if (status === "running" && now.getTime() - action.updatedAt.getTime() > FDE_STALE_RUNNING_MS) status = "stale_running";
  return { status, agentRunId: action.agentRunId, pendingActionId: action.pendingActionId, salesActionId: action.id };
}

async function linkProspectToSpine(prospectId: string, spine: Extract<IntakeResult, { ok: true }>, convertedAt: Date | null) {
  // 回填 Trade 线索 ↔ 商机链接（P1-2：TradeProspect 仅为展示视图，SalesOpportunity 为 canonical）
  await db.tradeProspect.update({
    where: { id: prospectId },
    data: {
      convertedToSalesCustomerId: spine.customerId,
      convertedToSalesOpportunityId: spine.opportunityId,
      ...(convertedAt ? { convertedAt } : {}),
    },
  });
}

/**
 * 重放：同一原始询盘再次到达（站点超时/失败后重发、浏览器重试）。不新建 Trade 消息；
 * 按真实记录返回下游状态，并补齐缺失步骤：主干未建 → 用同一原消息 intake；FDE 失败/中断 → 重跑。
 * 内容去重只是"不重复建对象"，这里才是失败恢复；恢复始终关联原始消息，不改正文。
 */
async function replayIngest(
  orgId: string,
  v: NormalizedInquiry,
  prospect: ProspectRef,
  messageId: string,
  opts: { runFde?: boolean } | undefined,
  now: Date,
): Promise<IngestResult> {
  let spine: IngestResult["spine"];
  let fde: InboundFdeResult | null = null;
  let recovered = false;
  const existing = await findSpineInteractionByMessage(orgId, messageId);
  if (existing?.opportunityId) {
    const opp = await db.salesOpportunity.findUnique({ where: { id: existing.opportunityId }, select: { assignedToId: true, createdById: true } });
    const state = await loadFdeState(orgId, existing.id, now);
    spine = {
      ok: true,
      customerId: existing.customerId,
      customerCreated: false,
      matchLevel: null,
      opportunityId: existing.opportunityId,
      opportunityCreated: false,
      attachedToExisting: true,
      interactionId: existing.id,
      salesActionId: state.salesActionId,
      ownerUserId: opp?.assignedToId ?? opp?.createdById ?? "",
      language: (existing.language as InquiryLanguage | null) ?? "en",
      customerReplied: false,
      replay: true,
    };
    if (opts?.runFde !== false && FDE_RERUNNABLE.has(state.status)) {
      fde = await runInboundSalesFde({ orgId, opportunityId: existing.opportunityId, salesActionId: state.salesActionId, trigger: "inquiry", now });
      recovered = true;
    }
  } else {
    try {
      spine = await intakeInquiry(intakeInputFor(orgId, v, prospect.id, messageId, now));
      if (spine.ok) {
        await linkProspectToSpine(prospect.id, spine, prospect.convertedToSalesOpportunityId ? null : now);
        recovered = true;
        if (opts?.runFde !== false && !spine.replay) {
          fde = await runInboundSalesFde({
            orgId,
            opportunityId: spine.opportunityId,
            salesActionId: spine.salesActionId,
            trigger: spine.attachedToExisting ? "customer_reply" : "inquiry",
          });
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("[website-inquiry] replay recovery: revenue spine intake failed:", reason);
      spine = { ok: false, code: "SPINE_FAILED", error: reason };
    }
  }
  const fdeState = spine.ok ? await loadFdeState(orgId, spine.interactionId, now) : null;
  return { prospectId: prospect.id, messageId, duplicate: true, notified: 0, replay: true, spine, fde, recovered, fdeState };
}

export async function ingestWebsiteInquiry(
  orgId: string,
  v: NormalizedInquiry,
  opts?: { runFde?: boolean; now?: Date },
): Promise<IngestResult> {
  const now = opts?.now ?? new Date();
  const content = buildInquiryMessage(v);

  // ── 重放 ①：同 eventId（站点按原始询盘 id 重发；主干已建立时不依赖正文匹配） ──
  if (v.eventId) {
    const byEvent = await findSpineInteractionByEventId(orgId, v.eventId);
    const refMessageId = byEvent ? tradeMessageIdOf(byEvent.analysisResult) : null;
    if (refMessageId) {
      const msg = await db.tradeMessage.findFirst({
        where: { id: refMessageId, prospect: { orgId } },
        select: { id: true, prospect: { select: PROSPECT_REF_SELECT } },
      });
      if (msg) return replayIngest(orgId, v, msg.prospect, msg.id, opts, now);
    }
  }
  // ── 重放 ②：窗口内同正文（org 内 website 进线；不依赖邮箱，电话-only 询盘同样覆盖） ──
  const replayed = await db.tradeMessage.findFirst({
    where: {
      direction: "inbound",
      channel: "website",
      content,
      createdAt: { gte: new Date(now.getTime() - WEBSITE_INQUIRY_REPLAY_WINDOW_MS) },
      prospect: { orgId },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, prospect: { select: PROSPECT_REF_SELECT } },
  });
  if (replayed) return replayIngest(orgId, v, replayed.prospect, replayed.id, opts, now);

  const campaignId = await ensureInquiryCampaign(orgId);

  let prospect: ProspectRef | null = v.email
    ? await db.tradeProspect.findFirst({
        where: { orgId, contactEmail: { equals: v.email, mode: "insensitive" } },
        select: PROSPECT_REF_SELECT,
        orderBy: { createdAt: "desc" },
      })
    : null;
  const duplicate = Boolean(prospect);

  if (!prospect) {
    const created = await createProspect({
      campaignId,
      orgId,
      companyName: deriveCompanyName(v),
      contactName: v.name || undefined,
      contactEmail: v.email || undefined,
      website: v.website || undefined,
      country: v.country || undefined,
      source: "website",
      stage: "new",
    });
    prospect = { id: created.id, stage: created.stage, companyName: created.companyName, convertedToSalesOpportunityId: null };
  }

  const message = await db.tradeMessage.create({
    data: {
      prospectId: prospect.id,
      direction: "inbound",
      channel: "website",
      subject: v.product ? `网站询盘：${v.product}` : "网站询盘",
      content,
    },
    select: { id: true },
  });

  await db.tradeProspect.update({
    where: { id: prospect.id },
    data: {
      lastContactAt: now,
      // 询盘=买家主动，立即进当日跟进队列
      nextFollowUpAt: now,
      ...(BUMPABLE_STAGES.has(prospect.stage) ? { stage: "replied" } : {}),
    },
  });

  // 第二刀：进线自动分析（响应后执行，失败不影响主链）
  const { scheduleInquiryAnalysis } = await import("@/lib/trade/inquiry-analysis");
  await scheduleInquiryAnalysis({
    orgId,
    prospectId: prospect.id,
    messageId: message.id,
    content: [v.product && `Product: ${v.product}`, v.message].filter(Boolean).join("\n") || v.email,
    channel: "website",
    meta: { email: v.email || null, companyName: prospect.companyName, phone: v.phone || null, country: v.country || null, website: v.website || null },
  });

  const summaryBits = [v.product, v.message].filter(Boolean).join(" — ");
  const notified = await notifyInquiryMembers(orgId, {
    title: `网站询盘：${prospect.companyName}`,
    summary: (summaryBits || v.email || v.phone).slice(0, 140),
    prospectId: prospect.id,
    source: "website",
    sourceKey: `website-inquiry:${message.id}`,
  });

  // ── Revenue Spine：canonical 商业主干（SalesCustomer → SalesOpportunity → CustomerInteraction → SalesAction → FDE） ──
  // Trade 线索 / 询盘收件箱 / 通知已在上方落库；主干失败不回滚 Trade 侧（响应 spine.code 供排障，站点重发即可补齐）。
  let spine: IngestResult["spine"];
  let fde: InboundFdeResult | null = null;
  try {
    spine = await intakeInquiry(intakeInputFor(orgId, v, prospect.id, message.id, now));
    if (spine.ok) {
      await linkProspectToSpine(prospect.id, spine, duplicate ? null : now);
      if (opts?.runFde !== false && !spine.replay) {
        fde = await runInboundSalesFde({
          orgId,
          opportunityId: spine.opportunityId,
          salesActionId: spine.salesActionId,
          trigger: spine.attachedToExisting ? "customer_reply" : "inquiry",
        });
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[website-inquiry] revenue spine intake failed:", reason);
    spine = { ok: false, code: "SPINE_FAILED", error: reason };
  }

  const fdeState = spine.ok ? await loadFdeState(orgId, spine.interactionId, now) : null;
  return { prospectId: prospect.id, messageId: message.id, duplicate, notified, replay: false, spine, fde, recovered: false, fdeState };
}

/** 通知 org 内外贸相关成员（幂等键防重复） */
export async function notifyInquiryMembers(
  orgId: string,
  input: { title: string; summary: string; prospectId: string; source: string; sourceKey: string },
): Promise<number> {
  const members = await db.organizationMember.findMany({
    where: {
      orgId,
      status: "active",
      user: { role: { in: ["trade", "boss", "manager", "admin", "super_admin"] } },
    },
    select: { userId: true },
  });
  if (members.length === 0) return 0;
  return createNotificationsForUsers(
    members.map((m) => m.userId),
    {
      type: "followup",
      title: input.title,
      summary: input.summary,
      orgId,
      entityType: "trade_prospect",
      entityId: input.prospectId,
      priority: "high",
      metadata: { prospectId: input.prospectId, source: input.source },
      sourceKeyPrefix: input.sourceKey,
    },
  );
}
