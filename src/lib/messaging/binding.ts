/**
 * 微信绑定管理
 *
 * 管理微信用户 ID ↔ 青砚用户的映射关系。
 */

import { db } from "@/lib/db";
import type { ChannelType, BindingInfo, FilterMode } from "./types";
import { ROLE_DEFAULT_DOMAINS } from "./types";

export async function createBinding(params: {
  userId: string;
  orgId?: string;
  channel: ChannelType;
  externalId: string;
  displayName?: string;
  avatarUrl?: string;
}): Promise<BindingInfo> {
  // 查询用户角色，自动设置推送域
  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { role: true },
  });
  const defaultDomains = ROLE_DEFAULT_DOMAINS[user?.role ?? "user"] ?? "project";
  const isSalesRole = user?.role === "sales" || user?.role === "admin" || user?.role === "super_admin";
  const isTradeRole = user?.role === "trade" || user?.role === "admin" || user?.role === "super_admin";

  const binding = await db.weChatBinding.upsert({
    where: {
      channel_externalId: {
        channel: params.channel,
        externalId: params.externalId,
      },
    },
    create: {
      userId: params.userId,
      orgId: params.orgId,
      channel: params.channel,
      externalId: params.externalId,
      displayName: params.displayName,
      avatarUrl: params.avatarUrl,
      status: "active",
      lastActiveAt: new Date(),
      pushDomains: defaultDomains,
      pushBriefing: isTradeRole,
      pushFollowup: isTradeRole,
      pushReport: isTradeRole,
      pushSales: isSalesRole,
    },
    update: {
      userId: params.userId,
      displayName: params.displayName,
      avatarUrl: params.avatarUrl,
      status: "active",
      lastActiveAt: new Date(),
    },
  });

  return toBindingInfo(binding);
}

export async function findBindingByExternal(
  channel: ChannelType,
  externalId: string,
): Promise<BindingInfo | null> {
  const binding = await db.weChatBinding.findUnique({
    where: { channel_externalId: { channel, externalId } },
  });
  return binding ? toBindingInfo(binding) : null;
}

export async function findBindingsByUser(userId: string): Promise<BindingInfo[]> {
  const bindings = await db.weChatBinding.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return bindings.map(toBindingInfo);
}

export interface BindingPreferences {
  pushBriefing?: boolean;
  pushFollowup?: boolean;
  pushReport?: boolean;
  pushSales?: boolean;
  pushDomains?: string;
  silentStart?: string | null;
  silentEnd?: string | null;
  filterMode?: FilterMode;
  filterKeyword?: string | null;
}

const BOOLEAN_PREFS = ["pushBriefing", "pushFollowup", "pushReport", "pushSales"] as const;
const PUSH_DOMAINS = ["trade", "sales", "project", "all"];
const FILTER_MODES: FilterMode[] = ["all", "keyword", "whitelist"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 纯函数：从请求体里只挑出允许用户自己改的偏好字段（白名单 + 类型校验）。
 * userId / orgId / status / externalId 等字段一律丢弃，防止借偏好接口改绑定归属。
 */
export function sanitizeBindingPreferences(raw: unknown): BindingPreferences {
  const out: BindingPreferences = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const key of BOOLEAN_PREFS) {
    if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
  }
  if (typeof r.pushDomains === "string") {
    const domains = [...new Set(r.pushDomains.split(",").map((d) => d.trim()).filter((d) => PUSH_DOMAINS.includes(d)))];
    if (domains.length) out.pushDomains = domains.join(",");
  }
  for (const key of ["silentStart", "silentEnd"] as const) {
    const v = r[key];
    if (v === null || v === "") out[key] = null;
    else if (typeof v === "string" && HHMM.test(v.trim())) out[key] = v.trim();
  }
  if (typeof r.filterMode === "string" && (FILTER_MODES as string[]).includes(r.filterMode)) out.filterMode = r.filterMode as FilterMode;
  if (r.filterKeyword === null) out.filterKeyword = null;
  else if (typeof r.filterKeyword === "string") out.filterKeyword = r.filterKeyword.trim().slice(0, 200);
  return out;
}

/**
 * 只改本人的绑定：where 同时带 id 与 userId，不是本人的绑定一行都不会改（不先查后改，无竞态）。
 * @returns 是否命中本人的绑定
 */
export async function updateBindingPreferences(userId: string, bindingId: string, prefs: BindingPreferences): Promise<boolean> {
  const r = await db.weChatBinding.updateMany({
    where: { id: bindingId, userId },
    data: prefs,
  });
  return r.count > 0;
}

/** 只解绑本人的绑定（同上） */
export async function removeBinding(userId: string, bindingId: string): Promise<boolean> {
  const r = await db.weChatBinding.updateMany({
    where: { id: bindingId, userId },
    data: { status: "disconnected" },
  });
  return r.count > 0;
}

export async function touchBinding(channel: ChannelType, externalId: string): Promise<void> {
  await db.weChatBinding.updateMany({
    where: { channel, externalId },
    data: { lastActiveAt: new Date() },
  });
}

/**
 * 解析绑定对应的业务组织：绑定上的 orgId → 用户 activeOrg / 唯一所属组织。
 * 平台级企微进线时绑定可能未写 orgId，必须在此补齐。
 */
export async function resolveBindingOrgId(
  binding: Pick<BindingInfo, "id" | "userId" | "orgId">,
): Promise<string | null> {
  const { PLATFORM_WECOM_ORG_ID } = await import("./platform-wecom");
  if (binding.orgId && binding.orgId !== PLATFORM_WECOM_ORG_ID) {
    return binding.orgId;
  }

  const user = await db.user.findUnique({
    where: { id: binding.userId },
    select: { role: true },
  });
  const { resolvePreferredOrgId } = await import("@/lib/organizations/active-org");
  const { orgId } = await resolvePreferredOrgId(
    binding.userId,
    user?.role ?? "user",
  );
  if (!orgId) return null;

  if (orgId !== binding.orgId) {
    await db.weChatBinding
      .update({ where: { id: binding.id }, data: { orgId } })
      .catch(() => {});
  }
  return orgId;
}

function toBindingInfo(row: {
  id: string;
  userId: string;
  orgId: string | null;
  channel: string;
  externalId: string;
  displayName: string | null;
  status: string;
  pushBriefing: boolean;
  pushFollowup: boolean;
  pushReport: boolean;
  pushSales: boolean;
  pushDomains: string;
  filterMode: string;
  filterKeyword: string | null;
}): BindingInfo {
  return {
    id: row.id,
    userId: row.userId,
    orgId: row.orgId,
    channel: row.channel as ChannelType,
    externalId: row.externalId,
    displayName: row.displayName,
    status: row.status,
    pushBriefing: row.pushBriefing,
    pushFollowup: row.pushFollowup,
    pushReport: row.pushReport,
    pushSales: row.pushSales,
    pushDomains: row.pushDomains,
    filterMode: row.filterMode as FilterMode,
    filterKeyword: row.filterKeyword,
  };
}
