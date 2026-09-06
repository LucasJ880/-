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
import { intakeInquiry, type IntakeResult } from "@/lib/revenue-spine/inquiry-intake";
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

  if (honeypotTripped) {
    return {
      ok: true,
      value: {
        name, email, phone, company,
        country: "", message: "", product: "", website: "", page: "",
        utm: { source: "", medium: "", campaign: "", content: "", term: "" },
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

export interface IngestResult {
  prospectId: string;
  messageId: string;
  duplicate: boolean;
  notified: number;
  /** 同一表单在 REPLAY_WINDOW_MS 内重复提交：不新建任何业务对象，返回既有 message */
  replay: boolean;
  /** Revenue Spine（SalesCustomer → SalesOpportunity → FDE）结果；失败时 ok=false 且 Trade 线索仍已落库 */
  spine: IntakeResult | { ok: false; code: "SPINE_FAILED" | "REPLAY"; error: string };
  fde: InboundFdeResult | null;
}

/** 幂等窗口：同一线索、同一渲染正文的网站询盘视为重放（浏览器重试 / 双击提交 / 站点重发） */
export const WEBSITE_INQUIRY_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function ingestWebsiteInquiry(
  orgId: string,
  v: NormalizedInquiry,
  opts?: { runFde?: boolean; now?: Date },
): Promise<IngestResult> {
  const campaignId = await ensureInquiryCampaign(orgId);

  let prospect = v.email
    ? await db.tradeProspect.findFirst({
        where: { orgId, contactEmail: { equals: v.email, mode: "insensitive" } },
        select: { id: true, stage: true, companyName: true },
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
    prospect = { id: created.id, stage: created.stage, companyName: created.companyName };
  }

  const content = buildInquiryMessage(v);
  const now = opts?.now ?? new Date();
  if (duplicate) {
    const replayed = await db.tradeMessage.findFirst({
      where: {
        prospectId: prospect.id,
        direction: "inbound",
        channel: "website",
        content,
        createdAt: { gte: new Date(now.getTime() - WEBSITE_INQUIRY_REPLAY_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (replayed) {
      return {
        prospectId: prospect.id,
        messageId: replayed.id,
        duplicate: true,
        notified: 0,
        replay: true,
        spine: { ok: false, code: "REPLAY", error: "duplicate submission within replay window" },
        fde: null,
      };
    }
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

  const summaryBits = [v.product, v.message].filter(Boolean).join(" — ");
  const notified = await notifyInquiryMembers(orgId, {
    title: `网站询盘：${prospect.companyName}`,
    summary: (summaryBits || v.email || v.phone).slice(0, 140),
    prospectId: prospect.id,
    source: "website",
    sourceKey: `website-inquiry:${message.id}`,
  });

  // ── Revenue Spine：canonical 商业主干（SalesCustomer → SalesOpportunity → CustomerInteraction → SalesAction → FDE） ──
  // Trade 线索 / 询盘收件箱 / 通知已在上方落库；主干失败不回滚 Trade 侧（响应 spine.code 供排障）。
  let spine: IngestResult["spine"];
  let fde: InboundFdeResult | null = null;
  try {
    spine = await intakeInquiry({
      orgId,
      source: "website_inquiry",
      contact: { name: v.name, email: v.email, phone: v.phone, company: v.company, country: v.country, website: v.website },
      message: v.message,
      product: v.product,
      meta: { page: v.page, utm: v.utm, channel: "website" },
      sourceRef: { tradeProspectId: prospect.id, tradeMessageId: message.id },
      actorUserId: null,
      now,
    });
    if (spine.ok) {
      // 回填 Trade 线索 ↔ 商机链接（P1-2：TradeProspect 仅为展示视图，SalesOpportunity 为 canonical）
      await db.tradeProspect.update({
        where: { id: prospect.id },
        data: {
          convertedToSalesCustomerId: spine.customerId,
          convertedToSalesOpportunityId: spine.opportunityId,
          ...(duplicate ? {} : { convertedAt: now }),
        },
      });
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

  return { prospectId: prospect.id, messageId: message.id, duplicate, notified, replay: false, spine, fde };
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
