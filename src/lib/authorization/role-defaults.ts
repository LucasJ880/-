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
    description: "企业业务负责人：组织级业务只读 + 审计；成员 / 岗位 / 策略管理仅平台管理员（PERM-2）",
    bindings: [
      { permissionKey: "identity.member.read", dataScope: "ORG" },
      { permissionKey: "authorization.policy.read", dataScope: "ORG" },
      { permissionKey: "audit.read", dataScope: "ORG" },
      { permissionKey: "sales.customer.read", dataScope: "ORG" },
      { permissionKey: "sales.opportunity.read", dataScope: "ORG" },
      { permissionKey: "sales.quote.read", dataScope: "ORG" },
      { permissionKey: "sales.analytics.read", dataScope: "ORG" },
      { permissionKey: "operations.read", dataScope: "ORG" },
      { permissionKey: "project.read", dataScope: "ORG" },
      { permissionKey: "bids.handoff.preview", dataScope: "ORG" },
      { permissionKey: "bids.handoff.execute", dataScope: "ORG" },
      { permissionKey: "bids.handoff.override", dataScope: "ORG" },
      { permissionKey: "operations.projects.create", dataScope: "ORG" },
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
      { permissionKey: "operations.tasks.team.read", dataScope: "ORG" },
      { permissionKey: "operations.tasks.team.manage", dataScope: "ORG" },
      { permissionKey: "operations.projects.team.read", dataScope: "ORG" },
      { permissionKey: "operations.projects.manage", dataScope: "ORG" },
      { permissionKey: "operations.projects.create", dataScope: "ORG" },
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
      { permissionKey: "bids.handoff.preview", dataScope: "ORG" },
      { permissionKey: "bids.handoff.execute", dataScope: "ORG" },
      { permissionKey: "operations.projects.create", dataScope: "ORG" },
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

// ─────────────────────────────────────────────────────────────
// PERM-1：按行业包落地的岗位模板集（设计稿 §3）
// 窗饰企业（industryPackId = window_covering_services_v1）在系统模板之上追加下列岗位；
// 同 key 的条目与系统模板做并集（seed 只 upsert、不删）。
// ─────────────────────────────────────────────────────────────

export const WINDOW_COVERING_INDUSTRY_PACK = "window_covering_services_v1" as const;

const ORG = "ORG" as const;
const PRINCIPAL = "PRINCIPAL" as const;
const ASSIGNED = "ASSIGNED" as const;

function org(...keys: string[]): DefaultBinding[] {
  return keys.map((permissionKey) => ({ permissionKey, dataScope: ORG }));
}

// PERM-3：出单岗只持自己品类的更新键；全品类伞键只给 owner
const FULFILLMENT_COMMON: string[] = [
  "orders.fulfillment.read",
  "inventory.read",
  "project.read",
  "sales.quote.read",
  // INSTALL-1：出单岗可看安装任务与收口照片，不能安排安装
  "install.task.read",
  "install.photo.read",
];
function fulfillment(category: "vinyl" | "drapery" | "shades"): DefaultBinding[] {
  return org(`orders.fulfillment.update.${category}`, ...FULFILLMENT_COMMON);
}

export const WINDOW_COVERING_ROLE_PROFILES: DefaultRoleProfile[] = [
  {
    key: "owner",
    name: "老板",
    description: "全看全改；审批超限折扣与敏感设置；不含成员 / 岗位管理（仅平台管理员）",
    bindings: org(
      "organization.read",
      "identity.member.read",
      "sales.customer.read",
      "sales.opportunity.read",
      "sales.quote.read",
      "sales.analytics.read",
      "operations.read",
      "operations.tasks.team.read",
      "operations.projects.team.read",
      "project.read",
      "bids.handoff.preview",
      "bids.handoff.execute",
      "bids.handoff.override",
      "accounting.read",
      "audit.read",
      "authorization.policy.read",
      "sales.settings.manage",
      "sales.quote.discount.over_limit.submit",
      "sales.quote.discount.over_limit.approve",
      // INSTALL-1：老板全看全改，含安排安装
      "install.task.assign",
      "install.task.read",
      "install.photo.read",
      // PERM-3：全品类出单伞键、作废（走审批）、库存
      "orders.fulfillment.update",
      "orders.fulfillment.read",
      "orders.cancel",
      "inventory.manage",
      "inventory.read",
      // PERM-4a："全看全改"落到权限键（不再靠平台 admin 短路）；签约单改总价的审批权
      "sales.customer.update",
      "sales.customer.archive",
      "sales.opportunity.update",
      "sales.quote.update",
      "sales.quote.signed_amount.approve",
      // PERM-4b：老板批准运营内容（不改运营配置：无 operations.manage）
      "operations.content.approve",
      // PERM-5a：项目结算汇总（全企业）
      "project.finance.read",
    ),
  },
  {
    // 与系统模板 sales_rep 并集：补发送与建单
    key: "sales_rep",
    name: "销售人员",
    description: "仅本人创建 / 分配的销售数据；可发报价、建订单",
    bindings: [
      { permissionKey: "sales.quote.send", dataScope: PRINCIPAL },
      { permissionKey: "sales.order.create", dataScope: PRINCIPAL },
      // PERM-3：只读库存（报价时查面料）
      { permissionKey: "inventory.read", dataScope: ORG },
    ],
  },
  {
    key: "pricing_lead",
    name: "销售合价",
    description: "看全部报价、关合价；合价上限内折扣直接生效，超出提交老板审批",
    bindings: org(
      "sales.quote.read",
      "sales.quote.update",
      "sales.customer.read",
      "sales.opportunity.read",
      "sales.quote.pricing_close",
      "sales.quote.discount.over_limit.submit",
      "sales.quote.send",
      "sales.analytics.read",
    ),
  },
  {
    key: "ops_lead",
    name: "运营主管",
    description: "运营任务、品牌内容、营销计划；面料库存",
    bindings: org(
      "operations.read",
      "operations.manage",
      "operations.tasks.team.read",
      "operations.tasks.team.manage",
      "operations.projects.team.read",
      "operations.projects.manage",
      "operations.projects.create",
      "inventory.manage",
      "inventory.read",
      "orders.fulfillment.read",
      "identity.member.read",
      // INSTALL-1：安排安装由运营 + 会计决定
      "install.task.assign",
      "install.task.read",
      "install.photo.read",
      // PERM-4b：运营内容起草 + 批准（批准不得自批）
      "operations.content.draft",
      "operations.content.approve",
    ),
  },
  {
    key: "accounting",
    name: "会计",
    description: "成交金额、提成、报价全过程、项目结算只读",
    bindings: org(
      "accounting.read",
      "sales.analytics.read",
      "sales.quote.read",
      "sales.customer.read",
      "project.read",
      // INSTALL-1：安排安装由运营 + 会计决定；收口照片是结算依据
      "install.task.assign",
      "install.task.read",
      "install.photo.read",
      // PERM-5a：项目结算汇总（全企业，/accounting 项目结算页签）
      "project.finance.read",
    ),
  },
  {
    key: "bids",
    name: "招投标",
    description: "投标项目全流程；中标交接到执行",
    bindings: [
      ...org(
        "project.read",
        "project.create",
        "project.update",
        "bids.handoff.preview",
        "bids.handoff.execute",
        "operations.projects.create",
      ),
      // PERM-5a：参与方知道价格即可——只看自己参与项目的结算汇总（拍板 3）
      { permissionKey: "project.finance.read", dataScope: ASSIGNED },
    ],
  },
  {
    // 与系统模板 ops_staff 并集：PERM-3 只读库存
    key: "ops_staff",
    name: "运营人员",
    description: "运营任务执行、内容起草；库存只读",
    // PERM-4b：起草 / 提交运营内容，不能批准
    bindings: org("inventory.read", "operations.content.draft"),
  },
  { key: "fulfillment_vinyl", name: "出单·Vinyl", description: "Vinyl 品类订单与工艺单", bindings: fulfillment("vinyl") },
  { key: "fulfillment_drapery", name: "出单·布帘", description: "布帘品类订单与工艺单", bindings: fulfillment("drapery") },
  { key: "fulfillment_shades", name: "出单·Roller/Zebra/Roman", description: "Roller / Zebra / Roman Shade 品类订单与工艺单", bindings: fulfillment("shades") },
  {
    // INSTALL-1：安装工——只看分配给本人的安装任务；逐窗拍照收口；不碰销售
    key: "installer",
    name: "安装工",
    description: "只看分配给自己的安装任务与日历；开始 / 完成安装；按工艺单逐窗拍照收口",
    bindings: [
      { permissionKey: "install.task.read", dataScope: ASSIGNED },
      { permissionKey: "install.task.update", dataScope: ASSIGNED },
      { permissionKey: "install.window.complete", dataScope: ASSIGNED },
    ],
  },
];

export const WINDOW_COVERING_POSITION_TEMPLATES: Array<{
  key: string;
  name: string;
  roleProfileKey: string;
}> = [
  { key: "owner", name: "老板", roleProfileKey: "owner" },
  { key: "pricing_lead", name: "销售合价", roleProfileKey: "pricing_lead" },
  { key: "ops_lead", name: "运营主管", roleProfileKey: "ops_lead" },
  { key: "accounting", name: "会计", roleProfileKey: "accounting" },
  { key: "bids", name: "招投标", roleProfileKey: "bids" },
  { key: "fulfillment_vinyl", name: "出单·Vinyl", roleProfileKey: "fulfillment_vinyl" },
  { key: "fulfillment_drapery", name: "出单·布帘", roleProfileKey: "fulfillment_drapery" },
  { key: "fulfillment_shades", name: "出单·Roller/Zebra/Roman", roleProfileKey: "fulfillment_shades" },
  { key: "installer", name: "安装工", roleProfileKey: "installer" },
];

/** 行业包 id → 追加岗位模板集；未登记的行业包为空 */
export const POSITION_PROFILE_SETS: Record<string, DefaultRoleProfile[]> = {
  [WINDOW_COVERING_INDUSTRY_PACK]: WINDOW_COVERING_ROLE_PROFILES,
};

export const POSITION_TEMPLATE_SETS: Record<
  string,
  Array<{ key: string; name: string; roleProfileKey: string }>
> = {
  [WINDOW_COVERING_INDUSTRY_PACK]: WINDOW_COVERING_POSITION_TEMPLATES,
};

export function profilesForIndustryPack(
  industryPackId: string | null | undefined,
): DefaultRoleProfile[] {
  if (!industryPackId) return [];
  return POSITION_PROFILE_SETS[industryPackId] ?? [];
}

export function positionTemplatesForIndustryPack(
  industryPackId: string | null | undefined,
): Array<{ key: string; name: string; roleProfileKey: string }> {
  if (!industryPackId) return [];
  return POSITION_TEMPLATE_SETS[industryPackId] ?? [];
}

/** 系统模板 + 行业包模板按 key 并集后的绑定（与 seed 落库后的实际内容一致，供测试与脚本） */
export function mergedProfileBindings(
  industryPackId: string | null | undefined,
  key: string,
): DefaultBinding[] {
  const sys = SYSTEM_ROLE_PROFILES.find((p) => p.key === key)?.bindings ?? [];
  const pack = profilesForIndustryPack(industryPackId).find((p) => p.key === key)?.bindings ?? [];
  const seen = new Set<string>();
  const out: DefaultBinding[] = [];
  for (const b of [...sys, ...pack]) {
    const id = `${b.permissionKey}|${b.dataScope}|${b.effect ?? "ALLOW"}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(b);
  }
  return out;
}

/** 该行业包下企业应存在的全部岗位 key（系统 + 行业包，去重） */
export function profileKeysForIndustryPack(
  industryPackId: string | null | undefined,
): string[] {
  const keys = new Set<string>(SYSTEM_ROLE_PROFILES.map((p) => p.key));
  for (const p of profilesForIndustryPack(industryPackId)) keys.add(p.key);
  return [...keys];
}
