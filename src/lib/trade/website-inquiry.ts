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
import { INQUIRY_REPLY_ACTION_TYPE, runInboundSalesFde, type InboundFdeResult } from "@/lib/revenue-spine/fde/inbound-sales";
import { addBusinessHours } from "@/lib/revenue-spine/business-days";
import { createFdeAction } from "@/lib/revenue-spine/fde/actions";
import { loadRevenueSpinePolicy } from "@/lib/revenue-spine/policy";
import { claimInquiryReceipt, fromReceiptPayload, linkReceipt, releaseReceipt } from "./website-inquiry-receipts";

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
  /** not_run | queued | running | stale_running | completed | failed | run_blocked | cancelled | already_sent | human_rejected | superseded */
  status: string;
  /** true = 接收端不会再自行推进（全链已完成或已被人工/系统终结）；false = 仍需恢复 */
  terminal: boolean;
  /** 判定依据（供站点与排障读取，不由 HTTP 状态推断） */
  reason: string;
  agentRunId: string | null;
  pendingActionId: string | null;
  salesActionId: string | null;
}

/** 链路逐项核对结果：每一项都由真实记录判定，不由上一项存在推断 */
export interface ChainState {
  prospectId: string | null;
  tradeMessageId: string | null;
  customerId: string | null;
  opportunityId: string | null;
  interactionId: string | null;
  salesActionId: string | null;
  /** TradeProspect → Sales 关联已回填 */
  prospectLinked: boolean;
  fde: FdeState;
}

export interface IngestResult {
  prospectId: string;
  messageId: string;
  duplicate: boolean;
  notified: number;
  /** 同一原始事件再次到达（同 eventId / 派生身份），不新建 Trade 消息 */
  replay: boolean;
  /** Revenue Spine 结果；失败时 ok=false 且 Trade 线索仍已落库 */
  spine: IntakeResult | { ok: false; code: "SPINE_FAILED" | "REPLAY" | "INCOMPLETE"; error: string };
  /** 本次调用实际执行的 FDE（首次或恢复重跑）；未执行为 null */
  fde: InboundFdeResult | null;
  /** 本次补齐了此前缺失的步骤 */
  recovered: boolean;
  /** 本次补齐的步骤名（trade_message / spine / sales_action / prospect_link / fde） */
  recoveredSteps: string[];
  /** FDE 真实状态快照（来自 SalesAction / AgentRun / PendingAction） */
  fdeState: FdeState | null;
  /** 事件身份 */
  eventId: string;
  receiptId: string;
  /** 同一事件正在被另一执行者处理：本次未执行任何步骤 */
  busy: boolean;
  /** 同 eventId 携带了不同业务内容：原始事实未被覆盖 */
  conflict: boolean;
  /** 内容与既有事件相同（不同 eventId）：已记录，复用原事件对象 */
  contentDuplicateOf: string | null;
  /** 全链终态（业务对象齐全 + FDE 终态） */
  complete: boolean;
}

/** 幂等窗口：同一渲染正文的网站询盘视为重放（浏览器重试 / 双击提交 / 站点重发） */
export const WEBSITE_INQUIRY_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** FDE 处于 running 超过此时长视为被中断（函数被硬杀等），重放时允许重跑 */
export const FDE_STALE_RUNNING_MS = 10 * 60 * 1000;
/** 可重跑的 FDE 状态（其余状态要么已完成，要么已被人工/系统终结） */
const FDE_RERUNNABLE = new Set(["not_run", "queued", "failed", "run_blocked", "stale_running"]);

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

/**
 * FDE 真实状态：SalesAction.inputContext.fdeStatus 为主，再用 AgentRun / PendingAction 的
 * 真实终态覆盖。恢复不得复活已取消、已人工拒绝、已发送或已被系统作废的动作。
 */
export async function loadFdeState(orgId: string, interactionId: string, now: Date = new Date()): Promise<FdeState> {
  const action = await db.salesAction.findFirst({
    where: { orgId, signalKey: `inbound:${interactionId}` },
    orderBy: { createdAt: "desc" },
    select: { id: true, agentRunId: true, pendingActionId: true, inputContext: true, updatedAt: true },
  });
  if (!action) {
    return { status: "not_run", terminal: false, reason: "no SalesAction for this inbound", agentRunId: null, pendingActionId: null, salesActionId: null };
  }
  const ctx = (action.inputContext ?? {}) as Record<string, unknown>;
  let status = typeof ctx.fdeStatus === "string" && ctx.fdeStatus ? ctx.fdeStatus : "queued";
  if (status === "running" && now.getTime() - action.updatedAt.getTime() > FDE_STALE_RUNNING_MS) status = "stale_running";
  const base = { agentRunId: action.agentRunId, pendingActionId: action.pendingActionId, salesActionId: action.id };

  // 1) 该来信的审批草稿真实状态优先（人工决策与系统作废都是终态，不得靠恢复复活）
  const drafts = await db.pendingAction.findMany({
    where: { orgId, type: INQUIRY_REPLY_ACTION_TYPE, payload: { path: ["replyToInteractionId"], equals: interactionId } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, decidedById: true, failureReason: true, expiresAt: true },
  });
  const executed = drafts.find((d) => d.status === "executed");
  if (executed) return { ...base, status: "already_sent", terminal: true, reason: "reply already sent (PendingAction executed)", pendingActionId: executed.id };
  const pending = drafts.find((d) => d.status === "pending" && d.expiresAt > now);
  if (pending) return { ...base, status: "completed", terminal: true, reason: "draft awaiting human approval", pendingActionId: pending.id };
  const rejected = drafts.find((d) => d.status === "rejected" && d.decidedById);
  if (rejected) return { ...base, status: "human_rejected", terminal: true, reason: "draft rejected by a human", pendingActionId: rejected.id };
  const superseded = drafts.find((d) => d.status === "failed" && (d.failureReason ?? "").startsWith("SUPERSEDED_"));
  if (superseded) return { ...base, status: "superseded", terminal: true, reason: "draft superseded by a newer event", pendingActionId: superseded.id };

  // 2) run 被 supervisor 取消 → 终态，恢复不得重跑
  if (action.agentRunId) {
    const run = await db.agentRun.findUnique({ where: { id: action.agentRunId }, select: { status: true } });
    if (run?.status === "cancelled") return { ...base, status: "cancelled", terminal: true, reason: "AgentRun cancelled by supervisor" };
  }

  if (status === "completed") return { ...base, status, terminal: true, reason: "FDE completed" };
  if (status === "running") return { ...base, status, terminal: false, reason: "FDE currently running" };
  return { ...base, status, terminal: false, reason: `FDE not finished (${status})` };
}

/** 逐项核对七个对象；每一项都用真实记录判定，不由上一项存在推断 */
export async function inspectChain(orgId: string, receipt: { tradeMessageId: string | null; interactionId: string | null }, v: NormalizedInquiry, now: Date): Promise<ChainState> {
  const empty: ChainState = {
    prospectId: null, tradeMessageId: null, customerId: null, opportunityId: null, interactionId: null,
    salesActionId: null, prospectLinked: false,
    fde: { status: "not_run", terminal: false, reason: "chain not established", agentRunId: null, pendingActionId: null, salesActionId: null },
  };

  // Trade 消息：先按收据登记的 id；否则按 org 内窗口内同正文认领（无收据的历史数据兼容）
  let message = receipt.tradeMessageId
    ? await db.tradeMessage.findFirst({ where: { id: receipt.tradeMessageId, prospect: { orgId } }, select: { id: true, prospect: { select: PROSPECT_REF_SELECT } } })
    : null;
  if (!message) {
    message = await db.tradeMessage.findFirst({
      where: {
        direction: "inbound",
        channel: "website",
        content: buildInquiryMessage(v),
        createdAt: { gte: new Date(now.getTime() - WEBSITE_INQUIRY_REPLAY_WINDOW_MS) },
        prospect: { orgId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, prospect: { select: PROSPECT_REF_SELECT } },
    });
  }
  if (!message) return empty;

  const state: ChainState = { ...empty, prospectId: message.prospect.id, tradeMessageId: message.id };

  // 主干互动：先按收据登记的 id；否则按 sourceRef.tradeMessageId 反查
  const interaction = receipt.interactionId
    ? await db.customerInteraction.findFirst({ where: { id: receipt.interactionId, orgId }, select: { id: true, customerId: true, opportunityId: true } })
    : await findSpineInteractionByMessage(orgId, message.id);
  if (!interaction?.opportunityId) return state;

  state.interactionId = interaction.id;
  state.customerId = interaction.customerId;
  state.opportunityId = interaction.opportunityId;
  state.prospectLinked = message.prospect.convertedToSalesOpportunityId === interaction.opportunityId;

  state.fde = await loadFdeState(orgId, interaction.id, now);
  state.salesActionId = state.fde.salesActionId;
  return state;
}

async function linkProspectToSpine(prospectId: string, customerId: string, opportunityId: string, convertedAt: Date | null) {
  // 回填 Trade 线索 ↔ 商机链接（P1-2：TradeProspect 仅为展示视图，SalesOpportunity 为 canonical）
  await db.tradeProspect.update({
    where: { id: prospectId },
    data: {
      convertedToSalesCustomerId: customerId,
      convertedToSalesOpportunityId: opportunityId,
      ...(convertedAt ? { convertedAt } : {}),
    },
  });
}

/** 缺失的 FDE 行动（互动已建但 SalesAction 未建）：用 canonical helper 补，不新建平行体系 */
async function recreateFdeAction(orgId: string, v: NormalizedInquiry, interactionId: string, customerId: string, opportunityId: string, now: Date) {
  const opp = await db.salesOpportunity.findFirst({ where: { id: opportunityId, orgId }, select: { assignedToId: true, createdById: true } });
  const ownerUserId = opp?.assignedToId ?? opp?.createdById;
  if (!ownerUserId) return null;
  const policy = await loadRevenueSpinePolicy(orgId);
  const who = (v.company || v.name || v.email || v.phone).slice(0, 80);
  return createFdeAction({
    orgId,
    customerId,
    opportunityId,
    actionType: "inbound_inquiry",
    category: "contact",
    title: `新询盘：${who}${v.product ? " — " + v.product.slice(0, 60) : ""}`,
    description: v.message.slice(0, 2000),
    priority: "high",
    dueAt: addBusinessHours(now, policy.salesSla.newInquiryResponseHours),
    signalKey: `inbound:${interactionId}`,
    assignedToId: ownerUserId,
    createdById: ownerUserId,
    inputContext: { source: "website_inquiry", interactionId, fdeStatus: "queued", recovered: true, meta: { page: v.page, utm: v.utm, channel: "website" } },
  });
}

/**
 * 网站询盘接收：先认领事件身份（收据），再逐项核对并补齐链路。
 *
 * 首次事件 → 建链；重发 → 只补缺失的步骤，绝不重复创建客户 / 商机 / 互动 / 消息。
 * 同一事件同时到达两次 → 后到者 busy 返回，不并行执行。
 */
export async function ingestWebsiteInquiry(
  orgId: string,
  incoming: NormalizedInquiry,
  opts?: { runFde?: boolean; now?: Date },
): Promise<IngestResult> {
  const now = opts?.now ?? new Date();
  const claim = await claimInquiryReceipt(orgId, incoming, now);
  const receipt = claim.receipt;
  // 恢复一律按**首次**收到的业务事实重放；本次请求的冲突内容只记录，不覆盖
  const v = fromReceiptPayload(receipt.payload);
  const recoveredSteps: string[] = [];
  // duplicate 保持原义：该联系人此前已有 Trade 线索（不是"事件重发"，后者是 replay）
  let prospectExisted = !claim.created;

  const snapshot = async (state: ChainState, spine: IngestResult["spine"], fde: InboundFdeResult | null, extra: Partial<IngestResult>): Promise<IngestResult> => ({
    prospectId: state.prospectId ?? "",
    messageId: state.tradeMessageId ?? "",
    duplicate: prospectExisted,
    notified: 0,
    replay: !claim.created,
    spine,
    fde,
    recovered: recoveredSteps.length > 0,
    recoveredSteps: [...recoveredSteps],
    fdeState: state.opportunityId ? state.fde : null,
    eventId: receipt.eventId,
    receiptId: receipt.id,
    busy: false,
    conflict: claim.conflict,
    contentDuplicateOf: claim.duplicateOfReceiptId,
    complete: Boolean(state.opportunityId && state.salesActionId && state.prospectLinked && state.fde.terminal),
    ...extra,
  });

  /** 重放时的主干快照：字段全部取自真实记录，不臆造负责人/语言 */
  const spineOf = async (state: ChainState, replay: boolean): Promise<IngestResult["spine"]> => {
    if (!state.opportunityId || !state.customerId || !state.interactionId) {
      return { ok: false, code: "INCOMPLETE", error: "revenue spine not established for this event" };
    }
    const opp = await db.salesOpportunity.findFirst({
      where: { id: state.opportunityId, orgId },
      select: { assignedToId: true, createdById: true },
    });
    const interaction = await db.customerInteraction.findUnique({ where: { id: state.interactionId }, select: { language: true } });
    return {
      ok: true,
      customerId: state.customerId,
      customerCreated: false,
      matchLevel: null,
      opportunityId: state.opportunityId,
      opportunityCreated: false,
      attachedToExisting: true,
      interactionId: state.interactionId,
      salesActionId: state.salesActionId,
      ownerUserId: opp?.assignedToId ?? opp?.createdById ?? "",
      language: (interaction?.language as InquiryLanguage | null) ?? "en",
      customerReplied: false,
      replay,
    };
  };

  // 单执行者控制：同一事件正在被处理（首发仍在跑 / 另一次重发在跑）→ 返回当前状态，不并行
  if (claim.busy) {
    const state = await inspectChain(orgId, receipt, v, now);
    return snapshot(state, await spineOf(state, true), null, { busy: true });
  }

  try {
    const state = await inspectChain(orgId, receipt, v, now);

    // ── 步骤 1：Trade 线索 + 消息 ──
    let notified = 0;
    if (!state.tradeMessageId) {
      const campaignId = await ensureInquiryCampaign(orgId);
      let prospect: ProspectRef | null = v.email
        ? await db.tradeProspect.findFirst({
            where: { orgId, contactEmail: { equals: v.email, mode: "insensitive" } },
            select: PROSPECT_REF_SELECT,
            orderBy: { createdAt: "desc" },
          })
        : null;
      const existingProspect = Boolean(prospect);
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
          content: buildInquiryMessage(v),
        },
        select: { id: true },
      });
      await linkReceipt(receipt.id, { prospectId: prospect.id, tradeMessageId: message.id });
      state.prospectId = prospect.id;
      state.tradeMessageId = message.id;
      if (!claim.created) recoveredSteps.push("trade_message");

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
      notified = await notifyInquiryMembers(orgId, {
        title: `网站询盘：${prospect.companyName}`,
        summary: (summaryBits || v.email || v.phone).slice(0, 140),
        prospectId: prospect.id,
        source: "website",
        sourceKey: `website-inquiry:${message.id}`,
      });
      prospectExisted = existingProspect;
    }

    // ── 步骤 2：Revenue Spine（客户 / 商机 / 互动 / FDE 行动） ──
    let intake: IntakeResult | null = null;
    if (!state.interactionId) {
      try {
        intake = await intakeInquiry(intakeInputFor(orgId, v, state.prospectId!, state.tradeMessageId!, now));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("[website-inquiry] revenue spine intake failed:", reason);
        await releaseReceipt(receipt.id, "linked", now);
        return snapshot(state, { ok: false, code: "SPINE_FAILED", error: reason }, null, { notified });
      }
      if (!intake.ok) {
        await releaseReceipt(receipt.id, "linked", now);
        return snapshot(state, { ok: false, code: "SPINE_FAILED", error: intake.error }, null, { notified });
      }
      state.customerId = intake.customerId;
      state.opportunityId = intake.opportunityId;
      state.interactionId = intake.interactionId;
      state.salesActionId = intake.salesActionId;
      await linkReceipt(receipt.id, {
        customerId: intake.customerId,
        opportunityId: intake.opportunityId,
        interactionId: intake.interactionId,
        salesActionId: intake.salesActionId,
      });
      if (!claim.created) recoveredSteps.push("spine");
    }

    // ── 步骤 3：FDE 行动缺失（互动已建、SalesAction 未建）──
    if (state.interactionId && !state.salesActionId) {
      const action = await recreateFdeAction(orgId, v, state.interactionId, state.customerId!, state.opportunityId!, now);
      if (action) {
        state.salesActionId = action.id;
        await linkReceipt(receipt.id, { salesActionId: action.id });
        recoveredSteps.push("sales_action");
      }
    }

    // ── 步骤 4：Trade 线索 ↔ 商机关联回填 ──
    if (state.prospectId && state.opportunityId && state.customerId && !state.prospectLinked) {
      await linkProspectToSpine(state.prospectId, state.customerId, state.opportunityId, claim.created ? now : null);
      state.prospectLinked = true;
      if (!claim.created) recoveredSteps.push("prospect_link");
    }

    // ── 步骤 5：FDE（真实状态判定；不复活已取消 / 已人工终结的动作）──
    let fde: InboundFdeResult | null = null;
    state.fde = await loadFdeState(orgId, state.interactionId!, now);
    state.salesActionId = state.fde.salesActionId ?? state.salesActionId;
    const shouldRun = opts?.runFde !== false && !state.fde.terminal && FDE_RERUNNABLE.has(state.fde.status);
    if (shouldRun) {
      fde = await runInboundSalesFde({
        orgId,
        opportunityId: state.opportunityId!,
        salesActionId: state.salesActionId,
        trigger: intake && intake.ok && intake.attachedToExisting ? "customer_reply" : "inquiry",
        now,
      });
      if (!claim.created) recoveredSteps.push("fde");
      state.fde = await loadFdeState(orgId, state.interactionId!, now);
      await linkReceipt(receipt.id, { agentRunId: state.fde.agentRunId, pendingActionId: state.fde.pendingActionId });
    }

    const complete = Boolean(state.opportunityId && state.salesActionId && state.prospectLinked && state.fde.terminal);
    await releaseReceipt(receipt.id, complete ? "complete" : "linked", now);

    const spine: IngestResult["spine"] = intake ?? (await spineOf(state, true));
    return snapshot(state, spine, fde, { notified, complete });
  } catch (err) {
    await releaseReceipt(receipt.id, "linked", now).catch(() => undefined);
    throw err;
  }
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
