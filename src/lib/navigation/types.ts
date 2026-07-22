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
};

export type NavigationFilterContext = {
  pathname: string;
  platformRole: string | null | undefined;
  orgRole: string | null | undefined;
  hasMembership: boolean;
  workspaceIds: string[];
  modules: import("@/lib/tenancy/modules").OrgModulesConfig | null;
  isPlatformAdmin: boolean;
};

export type ResolvedNavItem = Omit<NavigationItem, "children"> & {
  children?: ResolvedNavItem[];
  active: boolean;
  expanded: boolean;
};
