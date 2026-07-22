/**
 * Security-1：系统岗位 / Role Profile 默认权限矩阵
 */

import type { DataScope } from "./types";

export type DefaultBinding = {
  permissionKey: string;
  dataScope: DataScope;
  effect?: "ALLOW" | "DENY";
};

export type DefaultRoleProfile = {
  key: string;
  name: string;
  description: string;
  bindings: DefaultBinding[];
};

export const SYSTEM_ROLE_PROFILES: DefaultRoleProfile[] = [
  {
    key: "org_owner",
    name: "企业负责人",
    description: "企业业务负责人：权限蓝图 + 组织级业务只读",
    bindings: [
      { permissionKey: "identity.member.read", dataScope: "ORG" },
      { permissionKey: "identity.member.manage", dataScope: "ORG" },
      { permissionKey: "identity.role.manage", dataScope: "ORG" },
      { permissionKey: "authorization.policy.read", dataScope: "ORG" },
      { permissionKey: "authorization.policy.manage", dataScope: "ORG" },
      { permissionKey: "audit.read", dataScope: "ORG" },
      { permissionKey: "sales.customer.read", dataScope: "ORG" },
      { permissionKey: "sales.opportunity.read", dataScope: "ORG" },
      { permissionKey: "sales.quote.read", dataScope: "ORG" },
      { permissionKey: "sales.analytics.read", dataScope: "ORG" },
      { permissionKey: "operations.read", dataScope: "ORG" },
      { permissionKey: "project.read", dataScope: "ORG" },
    ],
  },
  {
    key: "org_admin",
    name: "企业管理员",
    description: "系统管理员：成员与配置；默认无全部销售数据",
    bindings: [
      { permissionKey: "organization.read", dataScope: "ORG" },
      { permissionKey: "organization.settings.manage", dataScope: "ORG" },
      { permissionKey: "identity.member.read", dataScope: "ORG" },
      { permissionKey: "identity.member.manage", dataScope: "ORG" },
      { permissionKey: "identity.role.manage", dataScope: "ORG" },
      { permissionKey: "authorization.policy.read", dataScope: "ORG" },
    ],
  },
  {
    key: "sales_manager",
    name: "销售经理",
    description: "销售团队管理视角（第一版暂用 ORG scope）",
    bindings: [
      { permissionKey: "sales.customer.read", dataScope: "ORG" },
      { permissionKey: "sales.opportunity.read", dataScope: "ORG" },
      { permissionKey: "sales.quote.read", dataScope: "ORG" },
      { permissionKey: "sales.analytics.read", dataScope: "ORG" },
    ],
  },
  {
    key: "sales_rep",
    name: "销售人员",
    description: "仅本人创建 / 分配的销售数据",
    bindings: [
      { permissionKey: "sales.customer.read", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.customer.create", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.customer.update", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.opportunity.read", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.opportunity.read", dataScope: "ASSIGNED" },
      { permissionKey: "sales.opportunity.create", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.opportunity.update", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.opportunity.update", dataScope: "ASSIGNED" },
      { permissionKey: "sales.quote.read", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.quote.create", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.quote.update", dataScope: "PRINCIPAL" },
      { permissionKey: "sales.analytics.read", dataScope: "PRINCIPAL" },
    ],
  },
  {
    key: "ops_manager",
    name: "运营经理",
    description: "运营管理",
    bindings: [
      { permissionKey: "operations.read", dataScope: "ORG" },
      { permissionKey: "operations.manage", dataScope: "ORG" },
      { permissionKey: "identity.member.read", dataScope: "ORG" },
    ],
  },
  {
    key: "ops_staff",
    name: "运营人员",
    description: "运营只读 + 成员目录只读",
    bindings: [
      { permissionKey: "operations.read", dataScope: "ORG" },
      { permissionKey: "identity.member.read", dataScope: "ORG" },
    ],
  },
  {
    key: "project_manager",
    name: "项目经理",
    description: "项目读写（组织级）",
    bindings: [
      { permissionKey: "project.read", dataScope: "ORG" },
      { permissionKey: "project.create", dataScope: "ORG" },
      { permissionKey: "project.update", dataScope: "ORG" },
    ],
  },
  {
    key: "viewer",
    name: "只读观察员",
    description: "最小只读",
    bindings: [
      { permissionKey: "organization.read", dataScope: "ORG" },
      { permissionKey: "identity.member.read", dataScope: "ORG" },
    ],
  },
];

export const SYSTEM_POSITION_TEMPLATES: Array<{
  key: string;
  name: string;
  roleProfileKey: string;
}> = [
  { key: "enterprise_owner", name: "企业负责人", roleProfileKey: "org_owner" },
  { key: "enterprise_admin", name: "企业管理员", roleProfileKey: "org_admin" },
  { key: "sales_manager", name: "销售经理", roleProfileKey: "sales_manager" },
  { key: "sales_rep", name: "销售人员", roleProfileKey: "sales_rep" },
  { key: "ops_manager", name: "运营经理", roleProfileKey: "ops_manager" },
  { key: "ops_staff", name: "运营人员", roleProfileKey: "ops_staff" },
  { key: "project_manager", name: "项目经理", roleProfileKey: "project_manager" },
  { key: "viewer", name: "只读观察员", roleProfileKey: "viewer" },
];
