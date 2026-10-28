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

const REGISTRY_ENTRIES: PermissionDefinition[] = [
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
  // PERM-4b：运营内容分权——运营人员 / 主管起草提交，主管 / 老板批准（不得自批）
  def("operations.content.draft", "operations.content", "draft", "起草运营内容", "起草 / 修改选题与 Playbook 草稿、提交审核", ["ORG"], "MEDIUM"),
  {
    key: "operations.content.approve",
    resource: "operations.content",
    action: "approve",
    label: "批准运营内容",
    description: "批准 / 驳回发布任务与 Playbook、通过选题；提交人 / 创建人不得自批",
    allowedPrincipalTypes: ["HUMAN"],
    supportedScopes: ["ORG"],
    riskLevel: "HIGH",
  },
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

  def(
    "autopilot.view",
    "autopilot",
    "view",
    "查看 Autopilot",
    "查看 Autopilot 总览。A0 仅 owner allowlist 授予，不绑定任何角色。",
    ["ORG"],
    "HIGH",
  ),
  def(
    "autopilot.runs.read",
    "autopilot.runs",
    "read",
    "读取 Autopilot Runs",
    "读取 Agent Run 观察数据。A0 仅 owner allowlist 授予。",
    ["ORG"],
    "HIGH",
  ),
  def(
    "autopilot.admin",
    "autopilot",
    "admin",
    "管理 Autopilot",
    "Autopilot 管理能力。A0 仅 owner allowlist 授予，admin 角色不自动获得。",
    ["ORG"],
    "CRITICAL",
  ),

  // PERM-1：岗位制新增（设计稿 docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md §2.3 / §3）
  def("sales.quote.pricing_close", "sales.quote", "pricing_close", "关合价", "对报价做最终合价确认", ["ORG"], "HIGH"),
  def(
    "sales.quote.discount.over_limit.submit",
    "sales.quote.discount",
    "over_limit.submit",
    "提交超限折扣",
    "给出超过销售上限的折扣（合价上限内直接生效，超出则提交审批）",
    ["ORG"],
    "HIGH",
  ),
  def(
    "sales.quote.discount.over_limit.approve",
    "sales.quote.discount",
    "over_limit.approve",
    "审批超限折扣",
    "批准他人提交的超限折扣；提交人不得自批",
    ["ORG"],
    "CRITICAL",
  ),
  {
    // PERM-4a：已签约报价改总价的第二人把关；只给老板，数字员工不可持有
    key: "sales.quote.signed_amount.approve",
    resource: "sales.quote",
    action: "signed_amount.approve",
    label: "批准签约单改价",
    description: "批准他人提交的已签约报价改总价；提交人不得自批",
    allowedPrincipalTypes: ["HUMAN"],
    supportedScopes: ["ORG"],
    riskLevel: "HIGH",
  },
  def("sales.settings.manage", "sales.settings", "manage", "管理销售设置", "修改折扣表 / 费用 / 税率 / 解锁码（走审批）", ["ORG"], "CRITICAL"),
  def("sales.order.create", "sales.order", "create", "创建订单", "从报价建立订单", ["PRINCIPAL", "ORG"], "MEDIUM"),
  def("orders.fulfillment.update", "orders.fulfillment", "update", "出单修改（全品类）", "修改任意品类的工艺单、推进状态；仅老板与平台管理员", ["ORG"], "HIGH"),
  // PERM-3：品类按权限键拆分（零 schema：绑定表无属性列，品类不能做 scope）
  def("orders.fulfillment.update.vinyl", "orders.fulfillment", "update.vinyl", "出单修改·Vinyl", "修改 Vinyl 品类工艺单、推进状态", ["ORG"], "HIGH"),
  def("orders.fulfillment.update.drapery", "orders.fulfillment", "update.drapery", "出单修改·布帘", "修改布帘品类工艺单、推进状态", ["ORG"], "HIGH"),
  def("orders.fulfillment.update.shades", "orders.fulfillment", "update.shades", "出单修改·Roller/Zebra/Roman", "修改 Roller / Zebra / Roman 品类工艺单、推进状态", ["ORG"], "HIGH"),
  def("orders.fulfillment.read", "orders.fulfillment", "read", "查看全企业工艺单", "列表 / 详情 / 导出企业内全部工艺单", ["ORG"], "MEDIUM"),
  def("orders.cancel", "orders", "cancel", "作废工艺单", "提交作废（另一位老板批准后生效）", ["ORG"], "CRITICAL"),
  def("inventory.manage", "inventory", "manage", "管理面料库存", "库存增减与盘点", ["ORG"], "HIGH"),
  def("inventory.read", "inventory", "read", "查看面料库存", "只读库存列表", ["ORG"], "LOW"),
  def("accounting.read", "accounting", "read", "查看财务", "查看成交金额、提成与项目结算", ["ORG"], "HIGH"),
  {
    key: "identity.position.manage",
    resource: "identity.position",
    action: "manage",
    label: "管理岗位绑定",
    description: "把人绑定到岗位 / 解除绑定；仅平台管理员，数字员工不可持有",
    allowedPrincipalTypes: ["HUMAN"],
    supportedScopes: ["ORG"],
    riskLevel: "CRITICAL",
  },

  // INSTALL-1：安装工岗位 / 安装任务 / 逐窗收口
  def("install.task.read", "install.task", "read", "查看安装任务", "查看安装任务（ASSIGNED=只看分配给本人的）", ["ASSIGNED", "ORG"], "LOW"),
  def("install.task.update", "install.task", "update", "推进安装任务", "开始安装 / 完成收口 / 备注", ["ASSIGNED", "ORG"], "MEDIUM"),
  def("install.window.complete", "install.window", "complete", "逐窗拍照收口", "按工艺单逐窗上传完工照片", ["ASSIGNED", "ORG"], "MEDIUM"),
  def("install.task.assign", "install.task", "assign", "安排安装", "指定安装工与安装时间（运营 / 会计）", ["ORG"], "HIGH"),
  def("install.photo.read", "install.photo", "read", "查看收口照片", "查看工艺单的逐窗收口照片", ["ORG"], "MEDIUM"),
];

/**
 * PERM-5b：数字员工禁区（设计稿 §4-10：永不审批、不改设置、不给折扣）。
 * 命中的键 allowedPrincipalTypes 只留 HUMAN；authorize 对不在允许类型内的主体一律拒绝，
 * 即使已绑定含该键的岗位。新加的 *.approve / identity.* / sales.quote.discount.* 自动进禁区。
 */
const DIGITAL_EMPLOYEE_DENIED_EXACT = new Set([
  "sales.quote.pricing_close",
  "sales.settings.manage",
  "organization.settings.manage",
  "authorization.policy.manage",
  "install.task.assign",
  "orders.cancel",
  "inventory.manage",
  "operations.manage",
]);
const DIGITAL_EMPLOYEE_DENIED_PREFIXES = ["identity.", "sales.quote.discount."];

export function isDigitalEmployeeDeniedKey(key: string): boolean {
  return (
    key.endsWith(".approve") ||
    DIGITAL_EMPLOYEE_DENIED_EXACT.has(key) ||
    DIGITAL_EMPLOYEE_DENIED_PREFIXES.some((p) => key.startsWith(p))
  );
}

export const PERMISSION_REGISTRY: PermissionDefinition[] = REGISTRY_ENTRIES.map((p) =>
  isDigitalEmployeeDeniedKey(p.key) ? { ...p, allowedPrincipalTypes: ["HUMAN"] } : p,
);

const BY_KEY = new Map(PERMISSION_REGISTRY.map((p) => [p.key, p]));

export function getPermissionDefinition(
  key: string,
): PermissionDefinition | undefined {
  return BY_KEY.get(key);
}

export function isKnownPermission(key: string): boolean {
  return BY_KEY.has(key);
}
