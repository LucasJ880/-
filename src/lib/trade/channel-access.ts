/**
 * 外贸消息通道 — 谁能管理（查看 / 轮换凭证、增删通道、改嵌入表单来源白名单）
 *
 * 读通道列表仍是外贸角色都可以（凭证一律只显示末 4 位）；管理只给：
 * - 平台管理员（admin / super_admin；组织须显式指定，由 resolveTradeOrgId 校验）
 * - 本组织的企业负责人 / 管理员（org_owner / org_admin，成员身份 active）
 * 组织一律由 resolveTradeOrgId 在服务端解析，这里只按解析出的 orgId 查成员身份。
 */

import { NextResponse } from "next/server";
import { getOrgMembership, type AuthUser } from "@/lib/auth";
import { isAdmin, isOrgSystemAdmin } from "@/lib/rbac/roles";

/** 纯函数：角色矩阵（供单测） */
export function roleCanManageTradeChannels(
  platformRole: string | null | undefined,
  orgRole: string | null | undefined,
  membershipActive: boolean,
): boolean {
  if (isAdmin(platformRole)) return true;
  return membershipActive && isOrgSystemAdmin(orgRole);
}

export async function canManageTradeChannels(user: AuthUser, orgId: string): Promise<boolean> {
  if (isAdmin(user.role)) return true;
  const m = await getOrgMembership(user.id, orgId);
  return roleCanManageTradeChannels(user.role, m?.role ?? null, m?.status === "active");
}

export function channelManageForbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: "仅企业负责人或企业管理员可以管理消息通道、查看密钥", code: "CHANNEL_MANAGE_FORBIDDEN" },
    { status: 403 },
  );
}

/** 列表接口用响应头告诉页面当前用户能否管理（列表本身保持数组，兼容既有调用方） */
export const CAN_MANAGE_CHANNELS_HEADER = "x-qingyan-can-manage-channels";
