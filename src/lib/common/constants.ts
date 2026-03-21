// ============================================================
// 全局共享常量
// ============================================================

/** 实体状态 */
export const ENTITY_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  SUSPENDED: "suspended",
} as const;
export type EntityStatus = (typeof ENTITY_STATUS)[keyof typeof ENTITY_STATUS];

/** 成员状态 */
export const MEMBER_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;
export type MemberStatus = (typeof MEMBER_STATUS)[keyof typeof MEMBER_STATUS];

/** 用户认证方式 */
export const AUTH_PROVIDERS = {
  EMAIL: "email",
  GOOGLE: "google",
  GITHUB: "github",
  WECHAT: "wechat",
} as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS];

/** 组织计划类型 */
export const ORG_PLAN_TYPES = {
  FREE: "free",
  PRO: "pro",
  ENTERPRISE: "enterprise",
} as const;
export type OrgPlanType = (typeof ORG_PLAN_TYPES)[keyof typeof ORG_PLAN_TYPES];

/** 默认分页 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** 默认环境 */
export const DEFAULT_ENVIRONMENTS = [
  { name: "测试环境", code: "test" },
  { name: "生产环境", code: "prod" },
] as const;
