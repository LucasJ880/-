import type { LucideIcon } from "lucide-react";
import type { OrgModule } from "@/lib/tenancy/modules";
import type { MessageKey } from "@/lib/i18n/messages";

export type NavigationGroup =
  | "WORK"
  | "OPERATIONS"
  | "CAPABILITIES"
  | "BUSINESS"
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
  /** 平台账号角色（兼容现有 user.role） */
  requiredPlatformRoles?: string[];
  /** 企业成员角色 OrganizationMember.role */
  requiredOrgRoles?: string[];
  /** 需要至少一条企业 membership */
  requireMembership?: boolean;
  /** 能力中台可见：org_admin / 有 workspace / manager 等（见 filter） */
  capabilitiesAccess?: "any_member" | "operator" | "org_admin";
  /** 仅平台 admin 页 */
  platformAdminOnly?: boolean;
  featureFlag?: string;
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
  workspaceAccess?: "management" | "operations" | "bids" | "sales";
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
  /** 有效项目成员关系等投标能力信号（来自 active-org） */
  hasBidCapability?: boolean;
};

export type ResolvedNavItem = Omit<NavigationItem, "children"> & {
  children?: ResolvedNavItem[];
  active: boolean;
  expanded: boolean;
};
