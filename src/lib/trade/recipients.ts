/**
 * PERM-6c：外贸收件人与默认询盘负责人——按岗位权限键选人（一处定义，各处共用）
 *
 * - 外贸工作收件人（询盘首次提醒、询盘到达通知）：持 trade.read / trade.manage 的在职成员
 * - 外贸管理层收件人（老板早报、展会小结、SLA 分级升级 / 草稿逾期、24 小时升级）：
 *   管理层（isManagementWorkspaceUser：岗位模式 = 老板岗位或 super_admin；旧模式 = 企业 org_owner / org_admin
 *   或平台 boss / manager / admin / super_admin）且持外贸读或写键
 * - 默认询盘负责人：最早加入的、岗位派生平台角色为 trade / sales 的在职成员（成员与用户都 active）→ 企业 owner
 *
 * 有效权限键含岗位绑定、旧模式企业的兼容回退与平台 super_admin 全权（loadPermissionKeys）。
 * 不引用 booth-summary（它反过来转调本文件，避免成环）。
 */

import { db } from "@/lib/db";
import { deriveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { loadPermissionKeys, loadPositionMode } from "@/lib/rbac/permission-keys";
import { isManagementWorkspaceUser } from "@/lib/rbac/workspace-policy";

const TRADE_WORK_KEYS = ["trade.read", "trade.manage"] as const;
const DEFAULT_OWNER_ROLES = ["trade", "sales"] as const;

export interface TradeMemberSignal {
  userId: string;
  /** 企业成员角色（org_owner / org_admin / org_member） */
  orgRole: string;
  /** 平台角色（User.role） */
  platformRole: string;
  /** User.status */
  userStatus: string;
  /** 有效权限键；解析失败为 null（按无键处理） */
  permissionKeys: readonly string[] | null;
}

/** 纯函数：持外贸读或写键 */
export function isTradeWorker(m: TradeMemberSignal): boolean {
  return TRADE_WORK_KEYS.some((k) => m.permissionKeys?.includes(k));
}

/** 纯函数：外贸管理层 = 管理层（两种模式同工作区口径）且持外贸读或写键 */
export function isTradeManager(m: TradeMemberSignal, positionMode: boolean): boolean {
  return (
    isTradeWorker(m) &&
    isManagementWorkspaceUser({
      platformRole: m.platformRole,
      orgRole: m.orgRole,
      positionMode,
      permissionKeys: m.permissionKeys,
    })
  );
}

/** 纯函数：默认询盘负责人候选（members 须按加入时间升序） */
export function pickDefaultInquiryOwner(members: readonly TradeMemberSignal[], positionMode: boolean): string | null {
  const hit = members.find(
    (m) =>
      m.userStatus === "active" &&
      (DEFAULT_OWNER_ROLES as readonly string[]).includes(
        deriveEffectivePlatformRole({ platformRole: m.platformRole, positionMode, permissionKeys: m.permissionKeys }),
      ),
  );
  return hit?.userId ?? null;
}

/** 企业在职成员（按加入时间升序）+ 各自有效权限键 + 企业岗位模式 */
export async function loadTradeMemberSignals(orgId: string): Promise<{ positionMode: boolean; members: TradeMemberSignal[] }> {
  const [positionMode, rows] = await Promise.all([
    loadPositionMode(orgId),
    db.organizationMember.findMany({
      where: { orgId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { userId: true, role: true, user: { select: { role: true, status: true } } },
    }),
  ]);
  const members = await Promise.all(
    rows.map(async (r) => ({
      userId: r.userId,
      orgRole: r.role,
      platformRole: r.user.role,
      userStatus: r.user.status,
      permissionKeys: await loadPermissionKeys(r.userId, orgId),
    })),
  );
  return { positionMode, members };
}

export async function tradeWorkRecipients(orgId: string): Promise<string[]> {
  const { members } = await loadTradeMemberSignals(orgId);
  return members.filter(isTradeWorker).map((m) => m.userId);
}

export async function tradeManagementRecipients(orgId: string): Promise<string[]> {
  const { positionMode, members } = await loadTradeMemberSignals(orgId);
  return members.filter((m) => isTradeManager(m, positionMode)).map((m) => m.userId);
}

/** 默认询盘负责人：派生角色 trade / sales 的最早在职成员 → 企业 owner */
export async function resolveDefaultInquiryOwner(orgId: string): Promise<string | null> {
  const { positionMode, members } = await loadTradeMemberSignals(orgId);
  const picked = pickDefaultInquiryOwner(members, positionMode);
  if (picked) return picked;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
  return org?.ownerId ?? null;
}
