import type { OrgRole, ProjectRole } from "./roles";

// ============================================================
// 细粒度权限定义
//
// 设计原则：
//   - 权限 = resource:action 格式
//   - 每个角色映射到一组权限
//   - 通过 hasPermission 检查用户是否有某个权限
//   - 后续可扩展为数据库动态权限
// ============================================================

export const PERMISSIONS = {
  // 组织管理
  ORG_READ: "org:read",
  ORG_UPDATE: "org:update",
  ORG_DELETE: "org:delete",
  ORG_MEMBER_LIST: "org:member:list",
  ORG_MEMBER_INVITE: "org:member:invite",
  ORG_MEMBER_REMOVE: "org:member:remove",
  ORG_MEMBER_ROLE_CHANGE: "org:member:role_change",
  ORG_BILLING: "org:billing",

  // 项目管理
  PROJECT_CREATE: "project:create",
  PROJECT_READ: "project:read",
  PROJECT_UPDATE: "project:update",
  PROJECT_DELETE: "project:delete",
  PROJECT_MEMBER_LIST: "project:member:list",
  PROJECT_MEMBER_INVITE: "project:member:invite",
  PROJECT_MEMBER_REMOVE: "project:member:remove",
  PROJECT_MEMBER_ROLE_CHANGE: "project:member:role_change",

  // 环境管理
  ENV_CREATE: "env:create",
  ENV_READ: "env:read",
  ENV_UPDATE: "env:update",
  ENV_ARCHIVE: "env:archive",

  // Prompt 管理
  PROMPT_CREATE: "prompt:create",
  PROMPT_READ: "prompt:read",
  PROMPT_UPDATE: "prompt:update",
  PROMPT_DELETE: "prompt:delete",
  PROMPT_PUBLISH: "prompt:publish",

  // 知识库管理
  KB_CREATE: "kb:create",
  KB_READ: "kb:read",
  KB_UPDATE: "kb:update",
  KB_DELETE: "kb:delete",
  KB_PUBLISH: "kb:publish",

  // 审计日志
  AUDIT_LOG_READ: "audit_log:read",

  // T2-P1.5 项目财务控制（预算/费用/审核）
  PROJECT_COST_READ: "project:cost:read",
  // 提交/管理「本人」费用（含上传票据）。产品要求：所有 active 项目成员均可提交本人费用，
  // 因此与预算编辑 / 财务审核解耦 —— 授予每个项目角色（含 viewer/tester）。
  // 注意：这不是财务读写权；「本人」归属由 route 层 submittedById 校验强制。
  PROJECT_EXPENSE_SUBMIT: "project:expense:submit",
  PROJECT_COST_WRITE: "project:cost:write", // 编辑预算版本/行（规划）；非费用提交
  PROJECT_COST_REVIEW: "project:cost:review", // accounting 审批/拒绝费用
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// --- 组织角色 → 权限映射 ---

const ORG_ADMIN_PERMISSIONS: Permission[] = [
  PERMISSIONS.ORG_READ,
  PERMISSIONS.ORG_UPDATE,
  PERMISSIONS.ORG_DELETE,
  PERMISSIONS.ORG_MEMBER_LIST,
  PERMISSIONS.ORG_MEMBER_INVITE,
  PERMISSIONS.ORG_MEMBER_REMOVE,
  PERMISSIONS.ORG_MEMBER_ROLE_CHANGE,
  PERMISSIONS.ORG_BILLING,
  PERMISSIONS.PROJECT_CREATE,
  PERMISSIONS.AUDIT_LOG_READ,
];

/** 企业负责人：至少拥有企业管理员全部组织管理权限（业务数据另走 Permission Registry） */
const ORG_OWNER_PERMISSIONS: Permission[] = [...ORG_ADMIN_PERMISSIONS];

const ORG_MEMBER_PERMISSIONS: Permission[] = [
  PERMISSIONS.ORG_READ,
  PERMISSIONS.ORG_MEMBER_LIST,
  PERMISSIONS.PROJECT_CREATE,
];

const ORG_VIEWER_PERMISSIONS: Permission[] = [
  PERMISSIONS.ORG_READ,
  PERMISSIONS.ORG_MEMBER_LIST,
];

const ORG_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  org_owner: ORG_OWNER_PERMISSIONS,
  org_admin: ORG_ADMIN_PERMISSIONS,
  org_member: ORG_MEMBER_PERMISSIONS,
  org_viewer: ORG_VIEWER_PERMISSIONS,
};

// --- 项目角色 → 权限映射 ---

const PROJECT_ADMIN_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_UPDATE,
  PERMISSIONS.PROJECT_DELETE,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.PROJECT_MEMBER_INVITE,
  PERMISSIONS.PROJECT_MEMBER_REMOVE,
  PERMISSIONS.PROJECT_MEMBER_ROLE_CHANGE,
  PERMISSIONS.ENV_CREATE,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.ENV_UPDATE,
  PERMISSIONS.ENV_ARCHIVE,
  PERMISSIONS.PROMPT_CREATE,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.PROMPT_UPDATE,
  PERMISSIONS.PROMPT_DELETE,
  PERMISSIONS.PROMPT_PUBLISH,
  PERMISSIONS.KB_CREATE,
  PERMISSIONS.KB_READ,
  PERMISSIONS.KB_UPDATE,
  PERMISSIONS.KB_DELETE,
  PERMISSIONS.KB_PUBLISH,
  // 财务：admin 可读/提交/写预算/审
  PERMISSIONS.PROJECT_COST_READ,
  PERMISSIONS.PROJECT_EXPENSE_SUBMIT,
  PERMISSIONS.PROJECT_COST_WRITE,
  PERMISSIONS.PROJECT_COST_REVIEW,
];

const OPERATOR_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.PROMPT_CREATE,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.PROMPT_UPDATE,
  PERMISSIONS.PROMPT_PUBLISH,
  PERMISSIONS.KB_CREATE,
  PERMISSIONS.KB_READ,
  PERMISSIONS.KB_UPDATE,
  PERMISSIONS.KB_PUBLISH,
  // 财务：operator 可读/提交费用/编辑预算，不可审核
  PERMISSIONS.PROJECT_COST_READ,
  PERMISSIONS.PROJECT_EXPENSE_SUBMIT,
  PERMISSIONS.PROJECT_COST_WRITE,
];

/** T2-P1.5 财务审核角色：读/提交/写预算 + 审核（唯一新增 review 能力的项目角色） */
const ACCOUNTING_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.PROJECT_COST_READ,
  PERMISSIONS.PROJECT_EXPENSE_SUBMIT,
  PERMISSIONS.PROJECT_COST_WRITE,
  PERMISSIONS.PROJECT_COST_REVIEW,
];

const TESTER_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.PROMPT_UPDATE,
  PERMISSIONS.KB_READ,
  PERMISSIONS.KB_UPDATE,
  PERMISSIONS.PROJECT_COST_READ,
  // 所有 active 项目成员均可提交本人费用（与预算编辑/审核解耦）
  PERMISSIONS.PROJECT_EXPENSE_SUBMIT,
];

const VIEWER_PERMISSIONS: Permission[] = [
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.PROJECT_MEMBER_LIST,
  PERMISSIONS.ENV_READ,
  PERMISSIONS.PROMPT_READ,
  PERMISSIONS.KB_READ,
  PERMISSIONS.PROJECT_COST_READ,
  // 所有 active 项目成员均可提交本人费用（read-only 项目角色亦然；财务读写/审核仍受限）
  PERMISSIONS.PROJECT_EXPENSE_SUBMIT,
];

const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  project_admin: PROJECT_ADMIN_PERMISSIONS,
  operator: OPERATOR_PERMISSIONS,
  accounting: ACCOUNTING_PERMISSIONS,
  tester: TESTER_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

// --- 权限检查 ---

/** 检查组织角色是否拥有某个权限 */
export function hasOrgPermission(role: string, permission: Permission): boolean {
  const perms = ORG_ROLE_PERMISSIONS[role as OrgRole];
  if (!perms) return false;
  return perms.includes(permission);
}

/** 检查项目角色是否拥有某个权限 */
export function hasProjectPermission(role: string, permission: Permission): boolean {
  const perms = PROJECT_ROLE_PERMISSIONS[role as ProjectRole];
  if (!perms) return false;
  return perms.includes(permission);
}

/** 获取组织角色的所有权限 */
export function getOrgRolePermissions(role: string): Permission[] {
  return ORG_ROLE_PERMISSIONS[role as OrgRole] ?? [];
}

/** 获取项目角色的所有权限 */
export function getProjectRolePermissions(role: string): Permission[] {
  return PROJECT_ROLE_PERMISSIONS[role as ProjectRole] ?? [];
}
