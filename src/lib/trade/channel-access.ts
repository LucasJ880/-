/**
 * 外贸消息通道 — 谁能管理（查看 / 轮换凭证、增删通道、改嵌入表单来源白名单）
 *
 * 读通道列表：外贸读写或设置键任一（凭证一律只显示末 4 位）；管理只给：
 * - 平台 super_admin（组织须显式指定，由 resolveTradeOrgId 校验）
 * - 本组织持 trade.settings.manage 的人（PERM-6a：系统模板 org_owner / org_admin、窗饰 owner）
 * 组织一律由 resolveTradeOrgId 在服务端解析。
 */

import { NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { holdsTradePermission, TRADE_SETTINGS_MANAGE } from "@/lib/trade/access";
import { isOrgSystemAdmin, isPlatformSuperAdmin } from "@/lib/rbac/roles";

/**
 * 纯函数：旧模式企业的等价角色矩阵（供单测；运行时判定见 canManageTradeChannels，按权限键）。
 * PERM-6a：平台 admin 不再隐含；企业 org_owner / org_admin 经系统模板持 trade.settings.manage。
 */
export function roleCanManageTradeChannels(
  platformRole: string | null | undefined,
  orgRole: string | null | undefined,
  membershipActive: boolean,
): boolean {
  if (isPlatformSuperAdmin(platformRole)) return true;
  return membershipActive && isOrgSystemAdmin(orgRole);
}

export async function canManageTradeChannels(user: AuthUser, orgId: string): Promise<boolean> {
  // PERM-6a：按岗位权限键（平台 admin 不再隐含；super_admin 恒真）
  return holdsTradePermission(user, orgId, [TRADE_SETTINGS_MANAGE]);
}

export function channelManageForbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: "仅企业负责人或企业管理员可以管理消息通道、查看密钥", code: "CHANNEL_MANAGE_FORBIDDEN" },
    { status: 403 },
  );
}

/** 列表接口用响应头告诉页面当前用户能否管理（列表本身保持数组，兼容既有调用方） */
export const CAN_MANAGE_CHANNELS_HEADER = "x-qingyan-can-manage-channels";
