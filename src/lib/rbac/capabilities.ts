// ============================================================
// ROLE_CAPABILITIES — 平台角色到能力的集中映射
// ============================================================
//
// 这是 RBAC 的"真相源"。UI 可见性、数据访问范围、AI 可调用的
// 工具域，都从这里派生。任何角色能力调整都改这张表。
//
// 设计原则：
// - 最小权限：没有明确列出的域 / 工具都默认拒绝
// - admin 拥有全局能力；其他角色默认只能看自己名下数据
// - 未来新增角色只需在这里加一行
// ============================================================

import type { ToolDomain } from "@/lib/agent-core/types";
import type { PlatformRole } from "./roles";

/** 数据可见范围：own = 只能看自己创建/被分配的；all = 全局可见 */
export type DataScope = "own" | "all";

export interface RoleCapabilities {
  /** 允许 AI 调用的工具域 */
  aiDomains: readonly ToolDomain[];
  /** 默认数据可见范围 */
  dataScope: DataScope;
  /** 是否允许 AI 调用写工具（PR1 暂不启用，预留给 PR4） */
  canWrite: boolean;
  /** UI 可见模块（供前端路由 / 导航控制；PR1 信息性字段） */
  uiModules: readonly string[];
}

export const ROLE_CAPABILITIES: Record<PlatformRole, RoleCapabilities> = {
  admin: {
    aiDomains: ["sales", "trade", "project", "secretary", "knowledge", "cockpit", "system"],
    dataScope: "all",
    canWrite: true,
    uiModules: ["dashboard", "sales", "trade", "cockpit", "calendar", "inbox", "assistant", "knowledge", "admin"],
  },
  sales: {
    // 注意：当前代码库里 cockpit 工具的 domain 被登记为 "trade"，
    // 所以对 sales 不放开 "trade" 域即可顺带屏蔽 cockpit 工具。
    aiDomains: ["sales", "secretary", "system"],
    dataScope: "own",
    canWrite: false, // PR1 阶段：sales 走 runAgent 时只开只读
    uiModules: ["dashboard", "sales", "calendar", "inbox", "assistant"],
  },
  trade: {
    aiDomains: ["trade", "secretary", "system"],
    dataScope: "own",
    canWrite: false,
    uiModules: ["dashboard", "trade", "calendar", "inbox", "assistant"],
  },
  user: {
    aiDomains: ["secretary", "system"],
    dataScope: "own",
    canWrite: false,
    uiModules: ["dashboard", "assistant"],
  },
};

/** 安全获取能力；未知角色退回到最低权限（user） */
export function getCapabilities(role: string | null | undefined): RoleCapabilities {
  if (!role) return ROLE_CAPABILITIES.user;
  if (role === "super_admin") return ROLE_CAPABILITIES.admin;
  return ROLE_CAPABILITIES[role as PlatformRole] ?? ROLE_CAPABILITIES.user;
}

/** 角色能否访问某个 domain */
export function canAccessDomain(role: string | null | undefined, domain: ToolDomain): boolean {
  return getCapabilities(role).aiDomains.includes(domain);
}
