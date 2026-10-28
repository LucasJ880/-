import type { LucideIcon } from "lucide-react";
import type { OrgModule } from "@/lib/tenancy/modules";
import type { MessageKey } from "@/lib/i18n/messages";

export type NavigationGroup =
  | "WORK"
  | "OPERATIONS"
  | "CAPABILITIES"
  | "BUSINESS"
  | "PROJECTS"
  | "PROJECT_INTEL"
  | "SUPPLIERS"
  | "GROWTH"
  | "MANAGEMENT"
  | "PLATFORM"
  | "SYSTEM";

export type NavigationItem = {
  key: string;
  /** i18n key；优先于 label */
  labelKey?: MessageKey;
  /** 无 i18n 时的中文兜底 */
  label: string;
  href?: string;
  icon?: LucideIcon;
  group: NavigationGroup;
  children?: NavigationItem[];
  moduleKey?: OrgModule | OrgModule[];
  /** 平台账号角色（兼容现有 user.role；PERM-4c 删除） */
  requiredPlatformRoles?: string[];
  /**
   * PERM-3：岗位权限键（任一命中即可见）。与 requiredPlatformRoles 并存时二者任一命中即可；
   * 单独存在时必须命中。
   */
  requiredPermissions?: string[];
  /**
   * PERM-4c2：岗位模式下的可见键（任一命中即可见；岗位模式不看 requiredPlatformRoles）。
   * 旧模式（无岗位模板企业）忽略本字段，沿用 requiredPlatformRoles / requiredPermissions。
   */
  positionPermissions?: string[];
  /** PERM-4c2：外贸入口——岗位模式下对平台角色 trade 或管理层可见（PERM-6 前的例外） */
  tradeEntry?: boolean;
  /** PERM-4c2：只对平台 super_admin 可见（两种模式都生效；platformAdminOnly 含平台 admin） */
  superAdminOnly?: boolean;
  /** 企业成员角色 OrganizationMember.role */
  requiredOrgRoles?: string[];
  /** 需要至少一条企业 membership */
  requireMembership?: boolean;
  /** 能力中台可见：org_admin / 有 workspace / manager 等（见 filter） */
  capabilitiesAccess?: "any_member" | "operator" | "org_admin";
  /** 仅平台 admin 页 */
  platformAdminOnly?: boolean;
  featureFlag?: string;
  /** 仅 Autopilot owner（Lucas-only，非 admin 旁路） */
  autopilotOwnerOnly?: boolean;
  matchPaths?: string[];
  /** 精确匹配（如首页） */
  exact?: boolean;
  displayOrder: number;
  /** 可折叠父级：默认折叠，匹配子路径时展开 */
  collapsible?: boolean;
  badgeKey?: MessageKey;
  /**
   * 销售工作区可见：platformRole === "sales" 时，
   * 非 SYSTEM 条目必须为 true 才会显示（助手/设置走 SYSTEM 或显式标记）。
   */
  salesWorkspaceVisible?: boolean;
  /**
   * Phase 1 工作区门禁：与 workspace-policy 对齐。
   * 未设置时不额外按工作区过滤。
   */
  workspaceAccess?: "management" | "operations" | "bids" | "sales" | "install" | "accounting";
};

export type NavigationFilterContext = {
  pathname: string;
  /** 当前 URL search（含或不含 `?`），用于 `/sales?view=` 等叶子匹配 */
  search?: string;
  platformRole: string | null | undefined;
  orgRole: string | null | undefined;
  hasMembership: boolean;
  workspaceIds: string[];
  modules: import("@/lib/tenancy/modules").OrgModulesConfig | null;
  isPlatformAdmin: boolean;
  /** Autopilot 导航：由服务端计算的 boolean，不含 owner id 列表 */
  autopilotAllowed?: boolean;
  /** 有效项目成员关系等投标能力信号（来自 active-org） */
  hasBidCapability?: boolean;
  /** INSTALL-1：岗位权限键（来自 active-org），用于按权限放行的工作区（如 /install） */
  permissionKeys?: readonly string[] | null;
  /** PERM-4c2：岗位模式（来自 active-org）；缺省 false = 旧模式 */
  positionMode?: boolean;
};

export type ResolvedNavItem = Omit<NavigationItem, "children"> & {
  children?: ResolvedNavItem[];
  active: boolean;
  expanded: boolean;
};
