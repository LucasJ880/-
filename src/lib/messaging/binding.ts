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

export async function updateBindingPreferences(
  bindingId: string,
  prefs: {
    pushBriefing?: boolean;
    pushFollowup?: boolean;
    pushReport?: boolean;
    pushSales?: boolean;
    pushDomains?: string;
    silentStart?: string;
    silentEnd?: string;
    filterMode?: FilterMode;
    filterKeyword?: string;
  },
): Promise<void> {
  await db.weChatBinding.update({
    where: { id: bindingId },
    data: prefs,
  });
}

export async function removeBinding(bindingId: string): Promise<void> {
  await db.weChatBinding.update({
    where: { id: bindingId },
    data: { status: "disconnected" },
  });
}

export async function touchBinding(channel: ChannelType, externalId: string): Promise<void> {
  await db.weChatBinding.updateMany({
    where: { channel, externalId },
    data: { lastActiveAt: new Date() },
  });
}

function toBindingInfo(row: {
  id: string;
  userId: string;
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
