/**
 * 青砚统一 Navigation Registry
 * — 禁止在页面内各自定义侧栏
 * — 不写死 Sunny / 梦馨企业名
 */

import {
  LayoutDashboard,
  CheckSquare,
  Bell,
  CalendarDays,
  Inbox,
  MessageSquare,
  Radar,
  Shield,
  Layers,
  BookOpen,
  Building2,
  Settings,
  Users,
  Megaphone,
  BarChart3,
  Handshake,
  FileText,
  ScrollText,
  Package,
  Package2,
  PackageCheck,
  Upload,
  Eye,
  FolderKanban,
  Lightbulb,
  ClipboardList,
  CircleHelp,
  Brain,
  MessageCircle,
} from "lucide-react";
import type { NavigationGroup, NavigationItem } from "./types";

export const NAV_GROUP_META: Record<
  NavigationGroup,
  { label: string; labelKey?: string; order: number }
> = {
  WORK: { label: "工作台", order: 10 },
  OPERATIONS: { label: "企业经营", order: 20 },
  CAPABILITIES: { label: "企业能力中台", order: 30 },
  BUSINESS: { label: "业务运营", order: 40 },
  GROWTH: { label: "品牌增长", order: 50 },
  MANAGEMENT: { label: "企业管理", order: 60 },
  PLATFORM: { label: "平台运营", order: 70 },
  SYSTEM: { label: "系统", order: 90 },
};

/**
 * 桌面侧栏弱化分组标题。
 * 注意：一级产品顺序为 工作台→经营中心→企业能力中台→业务运营→品牌增长→企业管理，
 * 因此「企业经营」与「业务运营」不得合并为同一标题（中间夹着中台）。
 */
export const NAV_SECTION_LABEL: Partial<Record<NavigationGroup, string>> = {
  WORK: "日常工作",
  OPERATIONS: "企业经营",
  CAPABILITIES: "AI 能力",
  BUSINESS: "业务运营",
  GROWTH: "品牌增长",
  MANAGEMENT: "企业管理",
  PLATFORM: "平台运营",
  SYSTEM: "系统",
};

export const NAVIGATION_REGISTRY: NavigationItem[] = [
  // ── 工作台 ──
  {
    key: "work-home",
    label: "首页",
    labelKey: "nav_dashboard",
    href: "/",
    icon: LayoutDashboard,
    group: "WORK",
    exact: true,
    displayOrder: 10,
  },
  {
    key: "work-tasks",
    label: "我的任务",
    labelKey: "nav_tasks",
    href: "/tasks",
    icon: CheckSquare,
    group: "WORK",
    displayOrder: 20,
  },
  {
    key: "work-inbox",
    label: "收件箱",
    labelKey: "nav_service_inbox",
    href: "/service-inbox",
    icon: Inbox,
    group: "WORK",
    moduleKey: ["operations", "sales", "trade"],
    displayOrder: 30,
  },
  {
    key: "work-notifications",
    label: "待处理事项",
    labelKey: "nav_notifications",
    href: "/notifications",
    icon: Bell,
    group: "WORK",
    displayOrder: 40,
  },
  {
    key: "work-calendar",
    label: "日历",
    labelKey: "nav_appointment_calendar",
    href: "/sales/calendar",
    icon: CalendarDays,
    group: "WORK",
    moduleKey: "sales",
    requiredPlatformRoles: ["admin", "super_admin", "sales"],
    displayOrder: 50,
  },
  {
    key: "work-assistant",
    label: "AI 助手",
    labelKey: "nav_ai_assistant",
    href: "/assistant",
    icon: MessageSquare,
    group: "WORK",
    displayOrder: 60,
  },

  // ── 企业经营 ──
  {
    key: "ops-center",
    label: "经营中心",
    labelKey: "nav_operations_center",
    href: "/operations/center",
    icon: BarChart3,
    group: "OPERATIONS",
    moduleKey: "operations",
    requireMembership: true,
    matchPaths: ["/operations/center"],
    displayOrder: 10,
  },

  // ── 企业能力中台（可折叠） ──
  {
    key: "capabilities",
    label: "企业能力中台",
    labelKey: "nav_capabilities_hub",
    href: "/capabilities",
    icon: Layers,
    group: "CAPABILITIES",
    collapsible: true,
    requireMembership: true,
    capabilitiesAccess: "any_member",
    matchPaths: ["/capabilities"],
    displayOrder: 10,
    children: [
      {
        key: "cap-overview",
        label: "中台总览",
        labelKey: "nav_capabilities_overview",
        href: "/capabilities",
        group: "CAPABILITIES",
        exact: true,
        requireMembership: true,
        displayOrder: 10,
      },
      {
        key: "cap-catalog",
        label: "能力目录",
        labelKey: "nav_capabilities_catalog",
        href: "/capabilities/catalog",
        group: "CAPABILITIES",
        requireMembership: true,
        displayOrder: 20,
      },
      {
        key: "cap-runs",
        label: "运行中心",
        labelKey: "nav_capabilities_runs",
        href: "/capabilities/runs",
        group: "CAPABILITIES",
        requireMembership: true,
        displayOrder: 30,
      },
      {
        key: "cap-approvals",
        label: "审批中心",
        labelKey: "nav_capabilities_approvals",
        href: "/capabilities/approvals",
        group: "CAPABILITIES",
        requireMembership: true,
        displayOrder: 40,
      },
      {
        key: "cap-governance",
        label: "治理中心",
        labelKey: "nav_capabilities_governance",
        href: "/capabilities/governance",
        group: "CAPABILITIES",
        requireMembership: true,
        capabilitiesAccess: "org_admin",
        displayOrder: 50,
      },
      {
        key: "cap-health",
        label: "配置健康",
        labelKey: "nav_capabilities_health",
        href: "/capabilities/config-health",
        group: "CAPABILITIES",
        requireMembership: true,
        capabilitiesAccess: "operator",
        displayOrder: 60,
      },
    ],
  },

  // ── 业务运营：销售 ──
  {
    key: "biz-sales",
    label: "销售",
    labelKey: "nav_sales_pipeline",
    href: "/sales",
    icon: Handshake,
    group: "BUSINESS",
    moduleKey: "sales",
    requiredPlatformRoles: ["admin", "super_admin", "sales"],
    displayOrder: 10,
  },
  {
    key: "biz-quotes",
    label: "电子报价单",
    labelKey: "nav_quote_sheet",
    href: "/sales/quote-sheet",
    icon: FileText,
    group: "BUSINESS",
    moduleKey: "sales",
    requiredPlatformRoles: ["admin", "super_admin", "sales"],
    displayOrder: 11,
  },
  {
    key: "biz-all-quotes",
    label: "全部报价",
    labelKey: "nav_all_quotes",
    href: "/sales/quotes",
    icon: ScrollText,
    group: "BUSINESS",
    moduleKey: "sales",
    requiredPlatformRoles: ["admin", "super_admin", "sales"],
    displayOrder: 12,
  },
  {
    key: "biz-cockpit",
    label: "销售分析",
    labelKey: "nav_cockpit",
    href: "/sales/cockpit",
    icon: BarChart3,
    group: "BUSINESS",
    moduleKey: "sales",
    requiredPlatformRoles: ["admin", "super_admin", "sales"],
    displayOrder: 13,
  },
  {
    key: "biz-work-orders",
    label: "工艺单",
    labelKey: "nav_work_orders",
    href: "/blinds-orders",
    icon: ClipboardList,
    group: "BUSINESS",
    moduleKey: ["sales", "operations"],
    requiredPlatformRoles: ["admin", "super_admin", "sales"],
    badgeKey: "sidebar_badge_industry",
    displayOrder: 14,
  },
  {
    key: "biz-inventory",
    label: "面料库存",
    labelKey: "nav_fabric_inventory",
    href: "/inventory",
    icon: Package,
    group: "BUSINESS",
    moduleKey: ["sales", "supply_chain"],
    requiredPlatformRoles: ["admin", "super_admin"],
    displayOrder: 15,
  },

  // ── 业务运营：外贸 ──
  {
    key: "biz-trade",
    label: "外贸",
    labelKey: "nav_trade_dashboard",
    href: "/trade",
    icon: Handshake,
    group: "BUSINESS",
    moduleKey: "trade",
    requiredPlatformRoles: ["admin", "super_admin", "trade"],
    displayOrder: 20,
  },
  {
    key: "biz-prospects",
    label: "线索资产",
    labelKey: "nav_trade_prospects",
    href: "/trade/prospects",
    icon: Users,
    group: "BUSINESS",
    moduleKey: "trade",
    requiredPlatformRoles: ["admin", "super_admin", "trade"],
    displayOrder: 21,
  },
  {
    key: "biz-trade-intel",
    label: "企业情报",
    labelKey: "nav_trade_intelligence",
    href: "/trade/intelligence",
    icon: Radar,
    group: "BUSINESS",
    moduleKey: "trade",
    requiredPlatformRoles: ["admin", "super_admin", "trade"],
    displayOrder: 22,
  },
  {
    key: "biz-fulfillment",
    label: "履约协同",
    labelKey: "nav_trade_fulfillment",
    href: "/trade/fulfillment",
    icon: PackageCheck,
    group: "BUSINESS",
    moduleKey: ["trade", "supply_chain"],
    requiredPlatformRoles: ["admin", "super_admin", "trade"],
    displayOrder: 23,
  },
  {
    key: "biz-trade-import",
    label: "展会导入",
    labelKey: "nav_trade_import",
    href: "/trade/import",
    icon: Upload,
    group: "BUSINESS",
    moduleKey: "trade",
    requiredPlatformRoles: ["admin", "super_admin", "trade"],
    displayOrder: 24,
  },
  {
    key: "biz-signals",
    label: "市场监测",
    labelKey: "nav_trade_watch_signals",
    href: "/trade/signals",
    icon: Eye,
    group: "BUSINESS",
    moduleKey: "trade",
    requiredPlatformRoles: ["admin", "super_admin", "trade"],
    displayOrder: 25,
  },

  // ── 业务运营：项目 / 投标 ──
  {
    key: "biz-projects",
    label: "项目",
    labelKey: "nav_projects",
    href: "/projects",
    icon: FolderKanban,
    group: "BUSINESS",
    moduleKey: ["bids", "projects"],
    requiredPlatformRoles: ["admin", "super_admin", "user", "manager"],
    displayOrder: 30,
  },
  {
    key: "biz-project-intel",
    label: "项目智能",
    labelKey: "nav_project_intelligence",
    href: "/projects/intelligence",
    icon: Lightbulb,
    group: "BUSINESS",
    moduleKey: ["bids", "projects"],
    requiredPlatformRoles: ["admin", "super_admin", "user", "manager"],
    displayOrder: 31,
  },
  {
    key: "biz-suppliers",
    label: "供应商",
    labelKey: "nav_suppliers",
    href: "/suppliers",
    icon: Package2,
    group: "BUSINESS",
    moduleKey: ["bids", "supply_chain", "projects"],
    requiredPlatformRoles: ["admin", "super_admin", "user", "manager"],
    displayOrder: 32,
  },

  // ── 品牌增长 ──
  {
    key: "growth-hub",
    label: "品牌中心",
    labelKey: "nav_growth_hub",
    href: "/operations/growth",
    icon: Megaphone,
    group: "GROWTH",
    moduleKey: ["marketing", "operations"],
    requireMembership: true,
    displayOrder: 10,
  },
  {
    key: "growth-content",
    label: "内容生产",
    labelKey: "nav_publish_calendar",
    href: "/operations",
    icon: Megaphone,
    group: "GROWTH",
    moduleKey: ["operations", "marketing"],
    requiredPlatformRoles: ["admin", "super_admin", "manager"],
    displayOrder: 20,
  },
  {
    key: "growth-product-content",
    label: "产品内容",
    labelKey: "nav_product_content",
    href: "/product-content",
    icon: Layers,
    group: "GROWTH",
    moduleKey: ["product_content", "trade", "marketing"],
    displayOrder: 30,
  },
  {
    key: "growth-intel",
    label: "营销分析",
    labelKey: "nav_market_intelligence",
    href: "/operations/intelligence",
    icon: Radar,
    group: "GROWTH",
    moduleKey: ["operations", "marketing"],
    requiredPlatformRoles: ["admin", "super_admin", "manager"],
    displayOrder: 40,
  },
  {
    key: "growth-reports",
    label: "经营简报",
    labelKey: "nav_weekly_reports",
    href: "/reports",
    icon: FileText,
    group: "GROWTH",
    requiredPlatformRoles: ["admin", "super_admin", "user", "manager"],
    displayOrder: 50,
  },

  // ── 企业管理（非 /admin） ──
  {
    key: "mgmt-orgs",
    label: "成员与组织",
    labelKey: "nav_organizations",
    href: "/organizations",
    icon: Building2,
    group: "MANAGEMENT",
    requireMembership: true,
    displayOrder: 10,
  },
  {
    key: "mgmt-knowledge",
    label: "企业知识",
    labelKey: "nav_org_knowledge",
    href: "/knowledge",
    icon: BookOpen,
    group: "MANAGEMENT",
    requireMembership: true,
    displayOrder: 20,
  },
  {
    key: "mgmt-memory",
    label: "组织记忆",
    labelKey: "nav_ai_memory",
    href: "/memory",
    icon: Brain,
    group: "MANAGEMENT",
    requireMembership: true,
    displayOrder: 30,
  },
  {
    key: "mgmt-wechat",
    label: "微信集成",
    labelKey: "nav_wechat_messages",
    href: "/wechat",
    icon: MessageCircle,
    group: "MANAGEMENT",
    displayOrder: 40,
  },
  {
    key: "mgmt-settings",
    label: "企业设置",
    labelKey: "nav_settings",
    href: "/settings",
    icon: Settings,
    group: "MANAGEMENT",
    displayOrder: 50,
  },

  // ── 平台运营（绝不与企业管理混名） ──
  {
    key: "plat-users",
    label: "用户管理",
    labelKey: "nav_user_management",
    href: "/admin/users",
    icon: Users,
    group: "PLATFORM",
    requiredPlatformRoles: ["admin", "super_admin", "manager"],
    displayOrder: 10,
  },
  {
    key: "plat-invites",
    label: "邀请码",
    labelKey: "nav_invite_codes",
    href: "/admin/invite-codes",
    icon: Shield,
    group: "PLATFORM",
    platformAdminOnly: true,
    displayOrder: 20,
  },
  {
    key: "plat-audit",
    label: "平台审计",
    labelKey: "nav_audit_logs",
    href: "/admin/audit-logs",
    icon: ScrollText,
    group: "PLATFORM",
    platformAdminOnly: true,
    displayOrder: 30,
  },
  {
    key: "plat-intake",
    label: "待分发项目",
    labelKey: "nav_project_intake",
    href: "/admin/project-intake",
    icon: ClipboardList,
    group: "PLATFORM",
    platformAdminOnly: true,
    moduleKey: ["bids", "projects"],
    displayOrder: 40,
  },

];

/** 系统底栏（始终） */
export const SYSTEM_NAV_ITEMS: NavigationItem[] = [
  {
    key: "sys-help",
    label: "使用说明",
    labelKey: "nav_help",
    href: "/help",
    icon: CircleHelp,
    group: "SYSTEM",
    displayOrder: 10,
  },
];

/** 按分组切分（保持组内 displayOrder） */
export function groupNavigationItems(
  items: NavigationItem[],
): Array<{ group: NavigationGroup; items: NavigationItem[] }> {
  const order = Object.entries(NAV_GROUP_META)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([g]) => g as NavigationGroup);

  return order
    .map((group) => ({
      group,
      items: items
        .filter((i) => i.group === group)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    }))
    .filter((g) => g.items.length > 0);
}

/** 移动端一级分类 */
export const MOBILE_TOP_CATEGORIES: Array<{
  key: NavigationGroup;
  label: string;
  href?: string;
  matchPrefix?: string;
}> = [
  { key: "WORK", label: "工作台", href: "/" },
  { key: "OPERATIONS", label: "经营", href: "/operations/center" },
  { key: "CAPABILITIES", label: "能力中台", href: "/capabilities" },
  // 无默认落地页：有二级入口时进入 drill；modules 未就绪或无业务模块时不展示
  { key: "BUSINESS", label: "业务" },
  { key: "GROWTH", label: "增长", href: "/operations/growth" },
  { key: "MANAGEMENT", label: "管理", href: "/organizations" },
];
