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
import { after } from "next/server";
import type { WebsiteInquiryReceipt } from "@prisma/client";
import { db } from "@/lib/db";
import { createProspect } from "@/lib/trade/service";
import { createNotificationsForUsers } from "@/lib/notifications/create";
import { intakeInquiry, type InquiryIntakeInput, type IntakeResult } from "@/lib/revenue-spine/inquiry-intake";
import type { InquiryLanguage } from "@/lib/revenue-spine/normalize";
import { runInboundSalesFde, type FdeTrigger, type InboundFdeResult } from "@/lib/revenue-spine/fde/inbound-sales";
import {
  FDE_RERUNNABLE,
  loadFdeState,
  runQueuedInboundFde,
  type FdeClaimant,
  type FdeState,
  type QueuedFdeRun,
  type RunQueuedFdeOptions,
} from "@/lib/revenue-spine/fde/inbound-queue";
import { addBusinessHours } from "@/lib/revenue-spine/business-days";
import { createFdeAction } from "@/lib/revenue-spine/fde/actions";
import { loadRevenueSpinePolicy } from "@/lib/revenue-spine/policy";
import {
  BOOTH_CARD_SOURCE,
  RECEIPT_PROCESSING_STALE_MS,
  WEBSITE_INQUIRY_SOURCE,
  claimInquiryReceipt,
  findReceiptByEventId,
  fromReceiptPayload,
  linkReceipt,
  releaseReceipt,
} from "./website-inquiry-receipts";
import { ensureOutreachSequence } from "./outreach-sequence";

// FDE 真实状态读取与认领在 Revenue Spine 层（inbound-queue.ts）；这里保留原导出名，调用方不变
export { FDE_STALE_RUNNING_MS, loadFdeState } from "@/lib/revenue-spine/fde/inbound-queue";
export type { FdeState } from "@/lib/revenue-spine/fde/inbound-queue";

export const WEBSITE_INQUIRY_CAMPAIGN_NAME = "网站询盘";
export const BOOTH_CARD_CAMPAIGN_NAME = "展会速记卡";

/**
 * 线索从哪来：网站表单（默认），或展会速记卡（夜间批量录入）。两者走同一条链路，
 * 只在活动、标签、Revenue Spine 来源与事件身份空间上区分。
 */
export interface IngestOrigin {
  kind: "website" | "trade_show";
  /** 展会名称（可含展位），写入互动 meta.event，回复草稿开头引用；仅 trade_show */
  event?: string | null;
  /** 买家在展位看过的参考款（款号 + 参考表里的品类名），草稿逐一点名；仅 trade_show */
  styles?: Array<{ code: string; name: string | null }>;
  /** 业务员在卡上判的等级 A/B/C：决定商机优先级与审批标题；仅 trade_show */
  grade?: string | null;
  /** 展位上接待的业务员（卡上署名），跟进邮件落款；仅 trade_show */
  sales?: string | null;
}

const ORIGINS = {
  website: {
    campaign: WEBSITE_INQUIRY_CAMPAIGN_NAME,
    campaignDesc: "独立站表单自动归集的询盘",
    receiptSource: WEBSITE_INQUIRY_SOURCE,
    prospectSource: "website",
    messageChannel: "website",
    label: "网站询盘",
    pageLabel: "来源页",
    intakeSource: "website_inquiry",
    interactionChannel: "website",
    // 买家主动来询：通知外贸成员
    notify: true,
  },
  trade_show: {
    campaign: BOOTH_CARD_CAMPAIGN_NAME,
    campaignDesc: "展位速记卡（名片 + 勾选项）夜间录入的线索",
    receiptSource: BOOTH_CARD_SOURCE,
    prospectSource: "exhibition",
    messageChannel: "exhibition",
    label: "展会速记卡",
    pageLabel: "展会",
    intakeSource: "trade_show",
    interactionChannel: "trade_show",
    // 录入人就是操作者，一晚几十张不逐条通知
    notify: false,
  },
} as const;

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
export function buildInquiryMessage(
  v: NormalizedInquiry,
  label: string = ORIGINS.website.label,
  pageLabel: string = ORIGINS.website.pageLabel,
): string {
  const lines = [`【${label}】`];
  if (v.product) lines.push(`产品：${v.product}`);
  if (v.message) lines.push(`留言：${v.message}`);
  const who = [v.name, v.phone, v.email].filter(Boolean).join(" · ");
  if (who) lines.push(`联系人：${who}`);
  if (v.country) lines.push(`国家：${v.country}`);
  if (v.website) lines.push(`买家网站：${v.website}`);
  if (v.page) lines.push(`${pageLabel}：${v.page}`);
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
  productDesc?: string,
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
      productDesc: productDesc ?? (name === WEBSITE_INQUIRY_CAMPAIGN_NAME ? ORIGINS.website.campaignDesc : "消息通道陌生来信自动归集的询盘"),
      targetMarket: "海外（按询盘国家）",
      searchKeywords: [],
      status: "active",
      createdById: org?.ownerId ?? "system",
    },
    select: { id: true },
  });
  return created.id;
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
  /** 本次调用在请求内实际执行的 FDE（inline 模式的首次或恢复重跑）；未执行为 null */
  fde: InboundFdeResult | null;
  /** deferred 模式：本次调用把 FDE 交给了调度器（after()），请求内未执行 */
  fdeScheduled: boolean;
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

/**
 * FDE 在哪里执行：
 * - inline（默认）：请求内认领并执行（展会速记卡逐张录入、脚本与既有库调用方；页面需要逐张结果）；
 * - deferred：请求只做到 Revenue Spine intake 就返回，FDE 交给调度器（webhook 用 after()），
 *   请求路径里没有 LLM。重发同样只安排、不在请求内执行。
 */
export type FdeMode = "inline" | "deferred";

/** 调度器：接收一个异步任务，在响应之后执行（默认 next/server after()）。必须同步返回；抛错 = 无法安排。 */
export type FdeScheduler = (task: () => Promise<void>) => void;

/** 默认调度器：next/server after()——响应发出后在同一函数实例内执行，计入路由 maxDuration（300 s）。 */
export const scheduleAfterResponse: FdeScheduler = (task) => {
  after(task);
};

let schedulerOverrideForTest: FdeScheduler | null = null;
/** 仅测试：替换 deferred 模式的默认调度器（路由文件只能导出 HTTP 方法与段配置，钩子放在这里） */
export function __setDefaultFdeSchedulerForTest(fn: FdeScheduler | null): void {
  schedulerOverrideForTest = fn;
}

/** 全链终态：业务对象齐全 + 关联已回填 + FDE 终态 */
function chainComplete(state: ChainState): boolean {
  return Boolean(state.opportunityId && state.salesActionId && state.prospectLinked && state.fde.terminal);
}

function originOfReceipt(receipt: Pick<WebsiteInquiryReceipt, "source">): IngestOrigin {
  return receipt.source === BOOTH_CARD_SOURCE ? { kind: "trade_show" } : { kind: "website" };
}

/** 重放 / 状态查询时的主干快照：字段全部取自真实记录，不臆造负责人/语言 */
async function spineSnapshot(orgId: string, state: ChainState, replay: boolean): Promise<IngestResult["spine"]> {
  if (!state.opportunityId || !state.customerId || !state.interactionId) {
    return { ok: false, code: "INCOMPLETE", error: "revenue spine not established for this event" };
  }
  const opp = await db.salesOpportunity.findFirst({
    where: { id: state.opportunityId, orgId },
    select: { assignedToId: true, createdById: true },
  });
  const interaction = await db.customerInteraction.findFirst({ where: { id: state.interactionId, orgId }, select: { language: true } });
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
}

interface ProspectRef {
  id: string;
  stage: string;
  companyName: string;
  convertedToSalesOpportunityId: string | null;
}

const PROSPECT_REF_SELECT = { id: true, stage: true, companyName: true, convertedToSalesOpportunityId: true } as const;

function intakeInputFor(orgId: string, v: NormalizedInquiry, prospectId: string, messageId: string, now: Date, origin: IngestOrigin): InquiryIntakeInput {
  const o = ORIGINS[origin.kind];
  return {
    orgId,
    source: o.intakeSource,
    contact: { name: v.name, email: v.email, phone: v.phone, company: v.company, country: v.country, website: v.website },
    message: v.message,
    product: v.product,
    meta: {
      page: v.page,
      utm: v.utm,
      channel: o.interactionChannel,
      ...(origin.kind === "trade_show"
        ? {
            ...(origin.event ? { event: origin.event } : {}),
            ...(origin.styles?.length ? { styles: origin.styles } : {}),
            ...(origin.grade ? { boothGrade: origin.grade } : {}),
            ...(origin.sales ? { boothSales: origin.sales } : {}),
          }
        : {}),
    },
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

/** 逐项核对七个对象；每一项都用真实记录判定，不由上一项存在推断 */
export async function inspectChain(orgId: string, receipt: { tradeMessageId: string | null; interactionId: string | null }, v: NormalizedInquiry, now: Date, origin: IngestOrigin = { kind: "website" }): Promise<ChainState> {
  const o = ORIGINS[origin.kind];
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
        channel: o.messageChannel,
        content: buildInquiryMessage(v, o.label, o.pageLabel),
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
async function recreateFdeAction(orgId: string, v: NormalizedInquiry, interactionId: string, customerId: string, opportunityId: string, now: Date, origin: IngestOrigin) {
  const o = ORIGINS[origin.kind];
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
    dueAt: addBusinessHours(now, policy.salesSla.newInquiryResponseHours, policy.salesSla.businessHours ?? null),
    signalKey: `inbound:${interactionId}`,
    assignedToId: ownerUserId,
    createdById: ownerUserId,
    inputContext: { source: o.intakeSource, interactionId, fdeStatus: "queued", recovered: true, meta: { page: v.page, utm: v.utm, channel: o.interactionChannel } },
  });
}

export interface IngestOptions {
  /** false = 本次既不执行也不安排 FDE（只建链） */
  runFde?: boolean;
  now?: Date;
  origin?: IngestOrigin;
  /** 默认 inline（见 FdeMode）；网站 webhook 传 deferred */
  fdeMode?: FdeMode;
  /** deferred 模式的调度器，默认 next/server after()（测试可注入以确定性地执行回调） */
  scheduleFde?: FdeScheduler;
}

/**
 * 网站询盘接收：先认领事件身份（收据），再逐项核对并补齐链路。
 *
 * 首次事件 → 建链；重发 → 只补缺失的步骤，绝不重复创建客户 / 商机 / 互动 / 消息。
 * 同一事件同时到达两次 → 后到者 busy 返回，不并行执行。
 * FDE：inline 模式在请求内认领并执行；deferred 模式只安排（after()），收据在返回前释放。
 * 两种模式下 FDE 都经 runQueuedInboundFde 原子认领，与 cron / 其它回调互斥。
 */
export async function ingestWebsiteInquiry(
  orgId: string,
  incoming: NormalizedInquiry,
  opts?: IngestOptions,
): Promise<IngestResult> {
  const now = opts?.now ?? new Date();
  const origin: IngestOrigin = opts?.origin ?? { kind: "website" };
  const fdeMode: FdeMode = opts?.fdeMode ?? "inline";
  const o = ORIGINS[origin.kind];
  const claim = await claimInquiryReceipt(orgId, incoming, now, o.receiptSource);
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
    fdeScheduled: false,
    recovered: recoveredSteps.length > 0,
    recoveredSteps: [...recoveredSteps],
    fdeState: state.opportunityId ? state.fde : null,
    eventId: receipt.eventId,
    receiptId: receipt.id,
    busy: false,
    conflict: claim.conflict,
    contentDuplicateOf: claim.duplicateOfReceiptId,
    complete: chainComplete(state),
    ...extra,
  });

  // 单执行者控制：同一事件正在被处理（首发仍在跑 / 另一次重发在跑）→ 返回当前状态，不并行
  if (claim.busy) {
    const state = await inspectChain(orgId, receipt, v, now, origin);
    return snapshot(state, await spineSnapshot(orgId, state, true), null, { busy: true });
  }

  try {
    const state = await inspectChain(orgId, receipt, v, now, origin);

    // ── 步骤 1：Trade 线索 + 消息 ──
    let notified = 0;
    if (!state.tradeMessageId) {
      const campaignId = await ensureInquiryCampaign(orgId, o.campaign, o.campaignDesc);
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
          source: o.prospectSource,
          stage: "new",
        });
        prospect = { id: created.id, stage: created.stage, companyName: created.companyName, convertedToSalesOpportunityId: null };
        await ensureOutreachSequence({ orgId, prospectId: created.id }).catch(() => undefined);
      }
      const message = await db.tradeMessage.create({
        data: {
          prospectId: prospect.id,
          direction: "inbound",
          channel: o.messageChannel,
          subject: v.product ? `${o.label}：${v.product}` : o.label,
          content: buildInquiryMessage(v, o.label, o.pageLabel),
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
        channel: o.messageChannel,
        meta: { email: v.email || null, companyName: prospect.companyName, phone: v.phone || null, country: v.country || null, website: v.website || null },
      });

      if (o.notify) {
        const summaryBits = [v.product, v.message].filter(Boolean).join(" — ");
        notified = await notifyInquiryMembers(orgId, {
          title: `${o.label}：${prospect.companyName}`,
          summary: (summaryBits || v.email || v.phone).slice(0, 140),
          prospectId: prospect.id,
          source: o.prospectSource,
          sourceKey: `website-inquiry:${message.id}`,
        });
      }
      prospectExisted = existingProspect;
    }

    // ── 步骤 2：Revenue Spine（客户 / 商机 / 互动 / FDE 行动） ──
    let intake: IntakeResult | null = null;
    if (!state.interactionId) {
      try {
        intake = await intakeInquiry(intakeInputFor(orgId, v, state.prospectId!, state.tradeMessageId!, now, origin));
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
      const action = await recreateFdeAction(orgId, v, state.interactionId, state.customerId!, state.opportunityId!, now, origin);
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
    let fdeTask: (() => Promise<void>) | null = null;
    state.fde = await loadFdeState(orgId, state.interactionId!, now);
    state.salesActionId = state.fde.salesActionId ?? state.salesActionId;
    const wantsFde = opts?.runFde !== false && !state.fde.terminal && FDE_RERUNNABLE.has(state.fde.status);
    const trigger: FdeTrigger = intake && intake.ok && intake.attachedToExisting ? "customer_reply" : "inquiry";
    if (wantsFde && state.salesActionId) {
      const salesActionId = state.salesActionId;
      if (fdeMode === "inline") {
        // 请求内执行，但同样先认领：cron / after() 回调正在跑同一 FDE 时本次不并行
        const run = await runQueuedInboundFde(orgId, salesActionId, { by: "inline", trigger, now });
        fde = run.result;
        if (run.ran && !claim.created) recoveredSteps.push("fde");
        state.fde = await loadFdeState(orgId, state.interactionId!, now);
        await linkReceipt(receipt.id, { agentRunId: state.fde.agentRunId, pendingActionId: state.fde.pendingActionId });
      } else {
        // 请求路径不跑 FDE：响应之后由调度器执行（收据此前已释放）；认领在回调里做
        const by: FdeClaimant = claim.created ? "after" : "replay";
        fdeTask = async () => {
          try {
            await runInboundFdeAndSettle(orgId, salesActionId, { by, trigger, now: opts?.now });
          } catch (err) {
            console.error("[website-inquiry] deferred FDE failed:", err instanceof Error ? err.message : err);
          }
        };
      }
    } else if (wantsFde && fdeMode === "inline") {
      // 没有可认领的 SalesAction（商机无负责人，行动补建不了）：保持原行为，按商机直接跑一次
      fde = await runInboundSalesFde({ orgId, opportunityId: state.opportunityId!, salesActionId: null, trigger, now });
      if (!claim.created) recoveredSteps.push("fde");
      state.fde = await loadFdeState(orgId, state.interactionId!, now);
      await linkReceipt(receipt.id, { agentRunId: state.fde.agentRunId, pendingActionId: state.fde.pendingActionId });
    }

    const complete = chainComplete(state);
    await releaseReceipt(receipt.id, complete ? "complete" : "linked", now);

    // 收据释放之后才安排：回调在响应之后执行，不与本请求重叠
    let fdeScheduled = false;
    if (fdeTask) {
      try {
        (opts?.scheduleFde ?? schedulerOverrideForTest ?? scheduleAfterResponse)(fdeTask);
        fdeScheduled = true;
      } catch (err) {
        // 不在请求上下文（脚本）等：留在 queued，由 cron 或下一次重发接手
        console.warn("[website-inquiry] FDE scheduling unavailable, left for cron/replay:", err instanceof Error ? err.message : err);
      }
    }

    const spine: IngestResult["spine"] = intake ?? (await spineSnapshot(orgId, state, true));
    return snapshot(state, spine, fde, { notified, complete, fdeScheduled });
  } catch (err) {
    await releaseReceipt(receipt.id, "linked", now).catch(() => undefined);
    throw err;
  }
}

/**
 * FDE 在请求之外执行完后回填收据：链接 run / 草稿 id；全链终态则标 complete。
 * 正被某个请求处理（processing）的收据不改状态——那个请求结束时会按真实记录自行判定；
 * 收据状态只是记录，响应里的 complete 一律由 inspectChain 从真实记录算出。
 */
export async function settleReceiptsForSalesAction(orgId: string, salesActionId: string, now: Date = new Date()): Promise<number> {
  const receipts = await db.websiteInquiryReceipt.findMany({ where: { orgId, salesActionId, status: { not: "processing" } } });
  let completed = 0;
  for (const r of receipts) {
    const state = await inspectChain(orgId, r, fromReceiptPayload(r.payload), now, originOfReceipt(r));
    await linkReceipt(r.id, { agentRunId: state.fde.agentRunId, pendingActionId: state.fde.pendingActionId });
    if (r.status !== "complete" && chainComplete(state)) {
      const done = await db.websiteInquiryReceipt.updateMany({
        where: { id: r.id, orgId, status: { not: "processing" } },
        data: { status: "complete", processingSince: null, completedAt: now },
      });
      completed += done.count;
    }
  }
  return completed;
}

/** 请求之外的 FDE 执行入口（after() 回调 / cron）：认领 → 执行 → 回填收据 */
export async function runInboundFdeAndSettle(orgId: string, salesActionId: string, opts: RunQueuedFdeOptions): Promise<QueuedFdeRun> {
  const run = await runQueuedInboundFde(orgId, salesActionId, opts);
  if (run.ran) await settleReceiptsForSalesAction(orgId, salesActionId, opts.now ?? new Date());
  return run;
}

/**
 * 只读状态查询（GET /api/trade/webhook/website/status）：按事件 id 读收据并逐项核对真实记录。
 * 不认领收据、不增加 attempts、不安排或执行任何步骤。未知事件返回 null。
 */
export async function readWebsiteInquiryStatus(
  orgId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<(IngestResult & { receiptStatus: string }) | null> {
  const receipt = await findReceiptByEventId(orgId, eventId, WEBSITE_INQUIRY_SOURCE);
  if (!receipt) return null;
  const state = await inspectChain(orgId, receipt, fromReceiptPayload(receipt.payload), now, originOfReceipt(receipt));
  const inFlight =
    receipt.status === "processing" &&
    !!receipt.processingSince &&
    now.getTime() - receipt.processingSince.getTime() <= RECEIPT_PROCESSING_STALE_MS;
  return {
    prospectId: state.prospectId ?? "",
    messageId: state.tradeMessageId ?? "",
    duplicate: false,
    notified: 0,
    replay: true,
    spine: await spineSnapshot(orgId, state, true),
    fde: null,
    fdeScheduled: false,
    recovered: false,
    recoveredSteps: [],
    fdeState: state.opportunityId ? state.fde : null,
    eventId: receipt.eventId,
    receiptId: receipt.id,
    busy: inFlight,
    conflict: receipt.conflictCount > 0,
    contentDuplicateOf: receipt.duplicateOfReceiptId,
    complete: chainComplete(state),
    receiptStatus: receipt.status,
  };
}

/**
 * webhook 响应体（POST 与状态查询共用）。字段是真实记录，不由 HTTP 状态推断：
 * 调用方按 spine / opportunityId / complete / fde.terminal 判定，HTTP 200 不代表全链完成。
 * 官网侧站点桥接（classifyQingyanResponse / processingStateFrom）依赖这些字段名与语义。
 */
export function websiteWebhookBody(result: IngestResult) {
  const fde = result.fdeState
    ? {
        status: result.fdeState.status,
        terminal: result.fdeState.terminal,
        reason: result.fdeState.reason,
        agentRunId: result.fdeState.agentRunId,
        pendingActionId: result.fdeState.pendingActionId,
        scheduled: result.fdeScheduled,
      }
    : result.fde
      ? {
          status: result.fde.ok ? "completed" : "failed",
          terminal: false,
          reason: result.fde.error ?? "FDE just ran",
          agentRunId: result.fde.agentRunId,
          pendingActionId: result.fde.pendingActionId,
          scheduled: false,
        }
      : null;
  return {
    ok: true as const,
    eventId: result.eventId,
    receiptId: result.receiptId,
    prospectId: result.prospectId,
    messageId: result.messageId,
    duplicate: result.duplicate,
    replay: result.replay,
    recovered: result.recovered,
    recoveredSteps: result.recoveredSteps,
    busy: result.busy,
    conflict: result.conflict,
    contentDuplicateOf: result.contentDuplicateOf,
    complete: result.complete,
    opportunityId: result.spine.ok ? result.spine.opportunityId : null,
    spine: result.spine.ok ? (result.spine.replay ? "replay" : "ok") : result.spine.code,
    fde,
  };
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
