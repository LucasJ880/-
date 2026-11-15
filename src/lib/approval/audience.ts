/**
 * VIS-1d：审批的可见集合（spec approvals/visibility；change vis-1d-approvals-split，design D1–D5）
 *
 * 一条审批对某成员可见（岗位模式企业）：本人提交 ∪ 本人是指定审批人 ∪ 所在工作区成员 ∪ 所属项目的负责人 / project_admin
 * ∪ 按类型的可见岗位条件（业务页面经路由门放行 ∧ 持该类型审批键）。没有业务归属的草稿对执行期认的企业处理人可见。
 * 平台 super_admin 全部可见；旧模式企业（无岗位模板）不按可见集合收窄。
 *
 * 纯模块：不导入数据库与 next/*。服务端取 viewer 见 audience-server.ts。
 */

import { canOpenHref } from "@/lib/navigation/landing";
import type { RouteGateContext } from "@/lib/navigation/filter-context";

export type ApprovalSource = "PENDING_ACTION" | "APPROVAL_REQUEST" | "PRODUCT_CONTENT";

export type ApprovalFamily = {
  key: string;
  label: string;
  /** PendingAction.type 精确匹配 */
  types?: readonly string[];
  /** PendingAction.type 前缀匹配 */
  prefixes?: readonly string[];
  /** 整个来源归这一族（项目智能体审批 / 产品内容审批） */
  sources?: readonly ApprovalSource[];
  /** 业务页面（探测路径，动态段用 `_`） */
  page: string;
  /** 审批键：任一即可；为空表示只看页面 */
  keys: readonly string[];
};

/** 类型 → 可见岗位条件（design D2） */
export const APPROVAL_FAMILIES: readonly ApprovalFamily[] = [
  { key: "sales.approve_quote_promotion", label: "报价让利审批", types: ["sales.approve_quote_promotion"], page: "/sales/quote-sheet", keys: ["sales.quote.discount.over_limit.approve"] },
  { key: "sales.update_signed_quote", label: "签约改价", types: ["sales.update_signed_quote"], page: "/sales/quote-sheet", keys: ["sales.quote.signed_amount.approve"] },
  { key: "sales.update_quote_settings", label: "折扣设置变更", types: ["sales.update_quote_settings"], page: "/sales/cockpit", keys: ["sales.settings.manage"] },
  { key: "orders.cancel_blinds_order", label: "作废工艺单", types: ["orders.cancel_blinds_order"], page: "/blinds-orders/_", keys: ["orders.cancel"] },
  { key: "install.send_warranty_email", label: "质保邮件", types: ["install.send_warranty_email"], page: "/accounting", keys: ["install.balance.confirm"] },
  { key: "install.send_repair_visit_email", label: "返修上门邮件", types: ["install.send_repair_visit_email"], page: "/install", keys: ["install.task.assign"] },
  // 询盘回复没有专属审批键，按外贸营收的管理键收口（与商务事实提案、营收策略同一个键）
  { key: "revenue", label: "外贸营收", types: ["sales.send_inquiry_reply"], prefixes: ["revenue_spine."], page: "/revenue", keys: ["trade.settings.manage"] },
  { key: "tender", label: "招投标", prefixes: ["tender."], sources: ["APPROVAL_REQUEST"], page: "/bids", keys: [] },
  { key: "marketing", label: "营销", prefixes: ["marketing."], page: "/marketing", keys: [] },
  { key: "product_content", label: "产品内容", sources: ["PRODUCT_CONTENT"], page: "/product-content", keys: [] },
];

/** 判定所需的一条审批（三个来源统一形状） */
export type ApprovalItem = {
  sourceType: ApprovalSource;
  /** PendingAction.type；其他来源为 null */
  type: string | null;
  orgId: string | null;
  createdById: string | null;
  approverUserId: string | null;
  workspaceId: string | null;
  projectId: string | null;
};

export type ApprovalViewer = {
  userId: string;
  /** viewer 所对应的企业（审批所属企业或当前企业） */
  orgId: string | null;
  isPlatformAdmin: boolean;
  /** 执行期认的企业处理人：企业所有者或成员角色 org_admin（design D3） */
  isOrgHandler: boolean;
  /** 成员角色 org_owner / org_admin（只用于旧模式列表的原规则） */
  isOrgAdminRole: boolean;
  workspaceIds: readonly string[];
  /** 本企业内本人负责或任 project_admin 的项目 */
  projectIds: readonly string[];
  /** 判定输入（与路由门同源）；取不到为 null */
  ctx: RouteGateContext | null;
};

export function approvalFamilyOf(item: Pick<ApprovalItem, "sourceType" | "type">): ApprovalFamily | null {
  return (
    APPROVAL_FAMILIES.find((f) => {
      if (f.sources?.includes(item.sourceType)) return true;
      if (item.sourceType !== "PENDING_ACTION" || !item.type) return false;
      const type = item.type;
      return f.types?.includes(type) === true || f.prefixes?.some((p) => type.startsWith(p)) === true;
    }) ?? null
  );
}

function familyAllows(family: ApprovalFamily, ctx: RouteGateContext): boolean {
  if (!canOpenHref(family.page, ctx)) return false;
  if (family.keys.length === 0) return true;
  const held = new Set(ctx.permissionKeys ?? []);
  return family.keys.some((k) => held.has(k));
}

/** 本人放行的对照项（每次请求算一次） */
export function visibleFamilies(viewer: ApprovalViewer): ApprovalFamily[] {
  if (viewer.isPlatformAdmin) return [...APPROVAL_FAMILIES];
  const ctx = viewer.ctx;
  if (!ctx) return [];
  return APPROVAL_FAMILIES.filter((f) => familyAllows(f, ctx));
}

type Mode = "all" | "none" | "legacy" | "position";

/** 顺序同 design D5：旧模式（按企业的行业包判，与成员身份无关）在「非成员」之前 */
function modeOf(viewer: ApprovalViewer): Mode {
  if (viewer.isPlatformAdmin) return "all";
  if (!viewer.ctx) return "none";
  if (!viewer.ctx.positionMode) return "legacy";
  return viewer.ctx.hasMembership ? "position" : "none";
}

function relatedToMe(item: ApprovalItem, viewer: ApprovalViewer): boolean {
  return item.createdById === viewer.userId || item.approverUserId === viewer.userId;
}

/**
 * 没有企业的卡：创建人、指定审批人，以及卡所属项目的负责人 / project_admin
 * （与执行器对无企业卡认的处理人一致，所有模式相同；viewer.projectIds 须含该项目，见 audience-server 的 viewerForCard）。
 */
function noOrgCardVisible(item: ApprovalItem, viewer: ApprovalViewer): boolean {
  return relatedToMe(item, viewer) || (!!item.projectId && viewer.projectIds.includes(item.projectId));
}

/**
 * 单条判定（审批中心的项目智能体 / 产品内容审批、详情与端口用）。顺序：
 * super_admin → 无企业的卡只给创建人、指定审批人与所属项目的负责人 → 不是 viewer 企业的不可见 → 旧模式可见
 * → 非成员不可见 → 本人相关 / 工作区 / 项目 → 类型对照 → 无业务归属给企业处理人。
 */
export function isApprovalVisible(item: ApprovalItem, viewer: ApprovalViewer): boolean {
  if (viewer.isPlatformAdmin) return true;
  if (!item.orgId) return noOrgCardVisible(item, viewer);
  if (item.orgId !== viewer.orgId) return false;
  const mode = modeOf(viewer);
  if (mode === "none") return false;
  if (mode === "legacy") return true;
  if (relatedToMe(item, viewer)) return true;
  if (item.workspaceId && viewer.workspaceIds.includes(item.workspaceId)) return true;
  if (item.projectId && viewer.projectIds.includes(item.projectId)) return true;
  const family = approvalFamilyOf(item);
  if (family) return visibleFamilies(viewer).some((f) => f.key === family.key);
  return viewer.isOrgHandler;
}

/**
 * 审批端口的判定（design D5）：在单条判定之前，调用方带了企业且与卡的企业不同 → 视为不存在。
 * viewer 必须按卡所属企业取（微信等调用方传的企业为空）。
 */
export function portCardVisible(item: ApprovalItem, viewer: ApprovalViewer, callerOrgId: string | null | undefined): boolean {
  if (viewer.isPlatformAdmin) return true;
  if (!item.orgId) return noOrgCardVisible(item, viewer);
  if (callerOrgId && callerOrgId !== item.orgId) return false;
  return isApprovalVisible(item, viewer);
}

/** viewer 所在企业是旧模式（行业包没有岗位模板）：按企业判，与 super_admin、成员身份无关 */
export function isLegacyOrg(viewer: ApprovalViewer): boolean {
  return !!viewer.ctx && !viewer.ctx.positionMode;
}

/** 三个来源的行 → 统一判定形状（只取判定用到的列） */
export function pendingActionItem(row: {
  type: string;
  orgId: string | null;
  createdById: string | null;
  approverUserId: string | null;
  workspaceId: string | null;
  projectId: string | null;
}): ApprovalItem {
  return {
    sourceType: "PENDING_ACTION",
    type: row.type,
    orgId: row.orgId,
    createdById: row.createdById,
    approverUserId: row.approverUserId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
  };
}

export function approvalRequestItem(row: {
  approverUserId: string | null;
  task: { createdById: string | null; project: { id: string; orgId: string | null; workspaceId: string | null } };
}): ApprovalItem {
  return {
    sourceType: "APPROVAL_REQUEST",
    type: null,
    orgId: row.task.project.orgId,
    createdById: row.task.createdById,
    approverUserId: row.approverUserId,
    workspaceId: row.task.project.workspaceId,
    projectId: row.task.project.id,
  };
}

export function productContentItem(row: { orgId: string; requestedById: string | null }): ApprovalItem {
  return {
    sourceType: "PRODUCT_CONTENT",
    type: null,
    orgId: row.orgId,
    createdById: row.requestedById,
    approverUserId: null,
    workspaceId: null,
    projectId: null,
  };
}

/** 旧模式审批中心列表的原规则（改动前 query.ts 的过滤） */
export function legacyListVisible(
  item: Pick<ApprovalItem, "createdById" | "approverUserId" | "workspaceId">,
  viewer: ApprovalViewer,
): boolean {
  if (viewer.isOrgAdminRole) return true;
  if (item.createdById === viewer.userId || item.approverUserId === viewer.userId) return true;
  return !!item.workspaceId && viewer.workspaceIds.includes(item.workspaceId);
}

export type PendingActionWhere = Record<string, unknown>;

function familyClauses(families: readonly ApprovalFamily[]): PendingActionWhere[] {
  const out: PendingActionWhere[] = [];
  for (const f of families) {
    if (f.types?.length) out.push({ type: { in: [...f.types] } });
    for (const p of f.prefixes ?? []) out.push({ type: { startsWith: p } });
  }
  return out;
}

const ALL_PENDING_ACTION_FAMILY_CLAUSES = familyClauses(APPROVAL_FAMILIES);

/**
 * PendingAction 的可见条件（Prisma where），与 `isApprovalVisible` 在「本人个人草稿 + viewer 企业」的行上逐行同义。
 * 调用方另 AND 自己的企业范围与处理人范围。super_admin 与旧模式为 `{}`（不收窄，design D4 / D5）。
 */
export function pendingActionAudienceWhere(viewer: ApprovalViewer): PendingActionWhere {
  const personal = {
    orgId: null,
    OR: [
      { createdById: viewer.userId },
      { approverUserId: viewer.userId },
      ...(viewer.projectIds.length ? [{ projectId: { in: [...viewer.projectIds] } }] : []),
    ],
  };
  const mode = modeOf(viewer);
  if (mode === "all" || mode === "legacy") return {};
  if (mode === "none" || !viewer.orgId) return personal;
  const inOrg: PendingActionWhere[] = [
    { createdById: viewer.userId },
    { approverUserId: viewer.userId },
    ...(viewer.workspaceIds.length ? [{ workspaceId: { in: [...viewer.workspaceIds] } }] : []),
    ...(viewer.projectIds.length ? [{ projectId: { in: [...viewer.projectIds] } }] : []),
    ...familyClauses(visibleFamilies(viewer)),
    ...(viewer.isOrgHandler ? [{ NOT: { OR: ALL_PENDING_ACTION_FAMILY_CLAUSES } }] : []),
  ];
  return { OR: [personal, { orgId: viewer.orgId, OR: inOrg }] };
}
