/**
 * Security-1：Permission Registry（代码注册为主）
 */

import type { PermissionDefinition } from "./types";

function def(
  key: string,
  resource: string,
  action: string,
  label: string,
  description: string,
  scopes: PermissionDefinition["supportedScopes"],
  risk: PermissionDefinition["riskLevel"] = "MEDIUM",
): PermissionDefinition {
  return {
    key,
    resource,
    action,
    label,
    description,
    allowedPrincipalTypes: ["HUMAN", "DIGITAL_EMPLOYEE"],
    supportedScopes: scopes,
    riskLevel: risk,
  };
}

export const PERMISSION_REGISTRY: PermissionDefinition[] = [
  def("organization.read", "organization", "read", "查看企业", "查看企业基础信息", ["ORG"], "LOW"),
  def("organization.settings.manage", "organization", "manage", "管理企业设置", "修改企业配置", ["ORG"], "HIGH"),

  def("identity.member.read", "identity.member", "read", "查看成员", "查看企业成员目录", ["ORG"], "LOW"),
  def("identity.member.manage", "identity.member", "manage", "管理成员", "邀请/移除/改角色", ["ORG"], "HIGH"),
  def("identity.role.manage", "identity.role", "manage", "管理岗位角色", "分配 Role Profile", ["ORG"], "HIGH"),

  def("sales.customer.read", "sales.customer", "read", "查看客户", "读取销售客户", ["PRINCIPAL", "ASSIGNED", "ORG"], "MEDIUM"),
  def("sales.customer.create", "sales.customer", "create", "创建客户", "创建销售客户", ["PRINCIPAL", "ORG"], "MEDIUM"),
  def("sales.customer.update", "sales.customer", "update", "更新客户", "修改销售客户", ["PRINCIPAL", "ASSIGNED", "ORG"], "MEDIUM"),
  def("sales.customer.archive", "sales.customer", "archive", "归档客户", "归档销售客户", ["PRINCIPAL", "ORG"], "HIGH"),

  def("sales.opportunity.read", "sales.opportunity", "read", "查看商机", "读取商机", ["PRINCIPAL", "ASSIGNED", "ORG"], "MEDIUM"),
  def("sales.opportunity.create", "sales.opportunity", "create", "创建商机", "创建商机", ["PRINCIPAL", "ORG"], "MEDIUM"),
  def("sales.opportunity.update", "sales.opportunity", "update", "更新商机", "修改商机", ["PRINCIPAL", "ASSIGNED", "ORG"], "MEDIUM"),

  def("sales.quote.read", "sales.quote", "read", "查看报价", "读取报价", ["PRINCIPAL", "ORG"], "MEDIUM"),
  def("sales.quote.create", "sales.quote", "create", "创建报价", "创建报价", ["PRINCIPAL", "ORG"], "MEDIUM"),
  def("sales.quote.update", "sales.quote", "update", "更新报价", "修改报价", ["PRINCIPAL", "ORG"], "MEDIUM"),
  def("sales.quote.send", "sales.quote", "send", "发送报价", "发送报价给客户", ["PRINCIPAL", "ORG"], "HIGH"),

  def("sales.analytics.read", "sales.analytics", "read", "销售分析", "查看销售分析", ["PRINCIPAL", "ORG"], "MEDIUM"),

  def("operations.read", "operations", "read", "查看运营", "查看运营数据", ["ORG"], "LOW"),
  def("operations.manage", "operations", "manage", "管理运营", "修改运营配置", ["ORG"], "HIGH"),
  def(
    "operations.tasks.team.read",
    "operations.tasks",
    "team.read",
    "查看团队任务",
    "查看组织内团队运营任务",
    ["ORG"],
    "MEDIUM",
  ),
  def(
    "operations.tasks.team.manage",
    "operations.tasks",
    "team.manage",
    "管理团队任务",
    "管理组织内团队运营任务",
    ["ORG"],
    "HIGH",
  ),
  def(
    "operations.projects.team.read",
    "operations.projects",
    "team.read",
    "查看团队执行项目",
    "查看组织内全部执行项目",
    ["ORG"],
    "MEDIUM",
  ),
  def(
    "operations.projects.manage",
    "operations.projects",
    "manage",
    "管理执行项目",
    "管理执行项目阶段、负责人与状态",
    ["ORG"],
    "HIGH",
  ),

  def("project.read", "project", "read", "查看项目", "查看项目", ["PRINCIPAL", "ORG"], "LOW"),
  def("project.create", "project", "create", "创建项目", "创建项目", ["ORG"], "MEDIUM"),
  def("project.update", "project", "update", "更新项目", "修改项目", ["PRINCIPAL", "ORG"], "MEDIUM"),

  def(
    "bids.handoff.preview",
    "bids.handoff",
    "preview",
    "预览中标交接",
    "预览中标项目转执行项目",
    ["ORG"],
    "MEDIUM",
  ),
  def(
    "bids.handoff.execute",
    "bids.handoff",
    "execute",
    "执行中标交接",
    "将中标项目交接为执行项目",
    ["ORG"],
    "HIGH",
  ),
  def(
    "bids.handoff.override",
    "bids.handoff",
    "override",
    "历史交接 override",
    "无完整 Bid Data 时的管理层交接 override",
    ["ORG"],
    "CRITICAL",
  ),
  def(
    "operations.projects.create",
    "operations.projects",
    "create",
    "创建执行项目",
    "创建运营执行项目",
    ["ORG"],
    "MEDIUM",
  ),

  def("authorization.policy.read", "authorization.policy", "read", "查看权限策略", "读取权限蓝图", ["ORG"], "MEDIUM"),
  def("authorization.policy.manage", "authorization.policy", "manage", "管理权限策略", "修改权限蓝图", ["ORG"], "CRITICAL"),

  def("audit.read", "audit", "read", "查看审计", "读取审计日志", ["ORG"], "HIGH"),
];

const BY_KEY = new Map(PERMISSION_REGISTRY.map((p) => [p.key, p]));

export function getPermissionDefinition(
  key: string,
): PermissionDefinition | undefined {
  return BY_KEY.get(key);
}

export function isKnownPermission(key: string): boolean {
  return BY_KEY.has(key);
}
