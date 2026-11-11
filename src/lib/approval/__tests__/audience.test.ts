/**
 * VIS-1d 审批的可见集合（spec approvals/visibility；change vis-1d-approvals-split）
 * 运行：npx tsx src/lib/approval/__tests__/audience.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  APPROVAL_FAMILIES,
  approvalFamilyOf,
  approvalRequestItem,
  isApprovalVisible,
  isLegacyOrg,
  pendingActionItem,
  productContentItem,
  legacyListVisible,
  pendingActionAudienceWhere,
  portCardVisible,
  visibleFamilies,
  type ApprovalItem,
  type ApprovalViewer,
  type PendingActionWhere,
} from "../audience";
import { buildNavigationFilterContext } from "@/lib/navigation/filter-context";
import { gateCtx, sunnyInputs, type IdentityName } from "@/lib/navigation/__tests__/identity-fixtures";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ORG = "org-1";
const ME = "u-me";
function viewer(name: IdentityName, partial: Partial<ApprovalViewer> = {}): ApprovalViewer {
  const ctx = gateCtx(name);
  return {
    userId: ME,
    orgId: ORG,
    isPlatformAdmin: ctx.isPlatformAdmin,
    isOrgHandler: false,
    isOrgAdminRole: false,
    workspaceIds: [],
    projectIds: [],
    ctx,
    ...partial,
  };
}
const legacyCtx = buildNavigationFilterContext(sunnyInputs({ positionMode: false, orgRole: "org_admin" }), { role: "user" }, { autopilotAllowed: false, wechatEntryEnabled: false });
function legacyViewer(partial: Partial<ApprovalViewer> = {}): ApprovalViewer {
  return { userId: ME, orgId: ORG, isPlatformAdmin: false, isOrgHandler: false, isOrgAdminRole: false, workspaceIds: [], projectIds: [], ctx: legacyCtx, ...partial };
}
const pa = (type: string, over: Partial<ApprovalItem> = {}): ApprovalItem => ({
  sourceType: "PENDING_ACTION",
  type,
  orgId: ORG,
  createdById: "u-other",
  approverUserId: null,
  workspaceId: null,
  projectId: null,
  ...over,
});
const other = (sourceType: "APPROVAL_REQUEST" | "PRODUCT_CONTENT", over: Partial<ApprovalItem> = {}): ApprovalItem => ({ ...pa("", over), sourceType, type: null, ...over });

const SALES6 = [
  "sales.approve_quote_promotion",
  "sales.update_signed_quote",
  "sales.update_quote_settings",
  "orders.cancel_blinds_order",
  "install.send_warranty_email",
  "install.send_repair_visit_email",
];
const visibleTypes = (v: ApprovalViewer, types: readonly string[]) => types.filter((t) => isApprovalVisible(pa(t), v));

console.log("audience（审批的可见集合）");

console.log("\n类型对照");
{
  const src = read("src/lib/pending-actions/types.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const body = src.match(/export type PendingActionType =([\s\S]*?);/)?.[1] ?? "";
  const registered = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const expectUnclassified = ["sales.update_followup", "sales.update_stage", "calendar.create_event", "grader.internal_note", "grader.project_task", "grader.email_draft"];
  ok(registered.length >= 20, `PendingActionType 已登记 ${registered.length} 个`);
  const unclassified = registered.filter((t) => !approvalFamilyOf({ sourceType: "PENDING_ACTION", type: t }));
  ok(JSON.stringify(unclassified.sort()) === JSON.stringify([...expectUnclassified].sort()), "无业务归属的恰好是助手 / Grader / 日历草稿", unclassified);
  ok(approvalFamilyOf({ sourceType: "PENDING_ACTION", type: "revenue_spine.propose_commercial_fact" })?.key === "revenue", "revenue_spine.* 归外贸营收");
  ok(approvalFamilyOf({ sourceType: "PENDING_ACTION", type: "sales.send_inquiry_reply" })?.key === "revenue", "询盘回复归外贸营收");
  ok(approvalFamilyOf({ sourceType: "APPROVAL_REQUEST", type: null })?.key === "tender", "项目智能体审批归招投标");
  ok(approvalFamilyOf({ sourceType: "PRODUCT_CONTENT", type: null })?.key === "product_content", "产品内容审批归产品内容");
  const keys = APPROVAL_FAMILIES.map((f) => f.key);
  ok(new Set(keys).size === keys.length, "对照项键不重复");
}

console.log("\n审批的可见集合");
{
  const sales = viewer("sales_rep");
  ok(!isApprovalVisible(pa("sales.approve_quote_promotion"), sales), "销售：另一位销售提交的让利审批不可见");
  ok(isApprovalVisible(pa("sales.approve_quote_promotion", { createdById: ME }), sales), "销售：自己提交的可见");
  const bidsless = viewer("no_position");
  ok(isApprovalVisible(pa("sales.approve_quote_promotion", { approverUserId: ME }), bidsless), "指定审批人可见");
  ok(isApprovalVisible(pa("tender.send_rfq", { projectId: "p1" }), viewer("no_position", { projectIds: ["p1"] })), "项目负责人（不持招投标）可见本项目的询价卡");
  ok(!isApprovalVisible(pa("tender.send_rfq", { projectId: "p2" }), viewer("no_position", { projectIds: ["p1"] })), "别的项目的询价卡不可见");
  ok(isApprovalVisible(pa("marketing.activate_campaign", { workspaceId: "w1" }), viewer("no_position", { workspaceIds: ["w1"] })), "工作区成员可见本工作区的审批");
  const sa = viewer("super_admin");
  ok([...SALES6, "tender.send_rfq", "revenue_spine.x", "grader.email_draft"].every((t) => isApprovalVisible(pa(t), sa)), "未绑岗位的平台 super_admin：全部可见");
  ok(!isApprovalVisible(pa("grader.email_draft"), viewer("no_position", { isOrgAdminRole: true })), "成员角色 org_admin / org_owner 本身不使人看到他人草稿（需是企业处理人）");
}

console.log("\n销售、订单与安装审批的可见岗位");
{
  ok(visibleTypes(viewer("owner"), SALES6).length === 6, "Sunny 老板：六类都可见", visibleTypes(viewer("owner"), SALES6));
  ok(JSON.stringify(visibleTypes(viewer("accounting"), SALES6)) === JSON.stringify(["install.send_warranty_email", "install.send_repair_visit_email"]), "会计：只见两类安装邮件", visibleTypes(viewer("accounting"), SALES6));
  ok(visibleTypes(viewer("pricing_lead"), SALES6).length === 0, "合价：一类都不见");
  ok(JSON.stringify(visibleTypes(viewer("ops_lead"), SALES6)) === JSON.stringify(["install.send_repair_visit_email"]), "运营主管：只见返修上门邮件（持 install.task.assign）");
}

console.log("\n外贸、招投标、营销与产品内容审批的可见岗位");
{
  const owner = viewer("owner");
  ok(!isApprovalVisible(pa("revenue_spine.propose_commercial_fact"), owner) && !isApprovalVisible(pa("sales.send_inquiry_reply"), owner), "Sunny 老板（未启用 trade）：看不到营收类与询盘回复");
  ok(isApprovalVisible(pa("tender.send_rfq"), owner) && isApprovalVisible(pa("marketing.activate_campaign"), owner) && isApprovalVisible(other("PRODUCT_CONTENT"), owner), "Sunny 老板：看得到招投标、营销与产品内容");
  const cathy = viewer("mx_cathy");
  ok(
    isApprovalVisible(pa("revenue_spine.propose_commercial_fact"), cathy) &&
      isApprovalVisible(pa("sales.send_inquiry_reply"), cathy) &&
      isApprovalVisible(pa("marketing.create_campaign_draft"), cathy) &&
      isApprovalVisible(other("PRODUCT_CONTENT"), cathy),
    "梦馨 Cathy：营收类、询盘回复、营销、产品内容都可见",
  );
  ok(!isApprovalVisible(pa("tender.send_rfq"), cathy) && !isApprovalVisible(other("APPROVAL_REQUEST"), cathy), "梦馨 Cathy：看不到招投标与项目智能体审批");
  const all = ["tender.send_rfq", "marketing.activate_campaign", "revenue_spine.x", ...SALES6];
  ok(JSON.stringify(visibleTypes(viewer("ops_staff"), all)) === JSON.stringify(["marketing.activate_campaign"]), "运营：只见营销", visibleTypes(viewer("ops_staff"), all));
  const bids = viewer("bids");
  ok(JSON.stringify(visibleTypes(bids, all)) === JSON.stringify(["tender.send_rfq"]) && isApprovalVisible(other("APPROVAL_REQUEST"), bids) && !isApprovalVisible(other("PRODUCT_CONTENT"), bids), "招投标：只见招投标与项目智能体审批");
  ok(visibleFamilies(viewer("no_position", { isOrgHandler: true })).length === 0, "不持岗位的管理员：没有放行的对照项");
}

console.log("\n没有业务归属的草稿");
{
  const draft = pa("grader.email_draft", { createdById: "u-sales" });
  ok(isApprovalVisible(draft, viewer("no_position", { isOrgHandler: true, isOrgAdminRole: true })), "企业处理人（成员角色 org_admin 或企业所有者）可见");
  ok(!isApprovalVisible(draft, viewer("owner", { isOrgHandler: false, isOrgAdminRole: true })), "成员角色 org_owner 但不是企业所有者：不可见（执行期也不认）");
  ok(!isApprovalVisible(draft, viewer("sales_rep")), "另一位销售：不可见");
}

console.log("\n旧模式企业沿用原规则");
{
  const admin = legacyViewer({ isOrgAdminRole: true });
  ok(legacyListVisible(pa("tender.send_rfq"), admin), "旧模式 org_admin：审批中心列表可见他人的询价卡");
  ok(!legacyListVisible(pa("tender.send_rfq"), legacyViewer()) && legacyListVisible(pa("tender.send_rfq", { createdById: ME }), legacyViewer()), "旧模式普通成员：列表只见本人相关（原规则）");
  ok(isApprovalVisible(pa("tender.send_rfq", { projectId: "p1" }), legacyViewer({ projectIds: ["p1"] })), "旧模式：单条判定不收窄（详情 / 端口照旧）");
  ok(JSON.stringify(pendingActionAudienceWhere(legacyViewer({ projectIds: ["p1"] }))) === "{}", "旧模式：项目负责人的可见集合条件为不限制（与改动前相同）");
  const legacyNonMember = legacyViewer({ ctx: { ...legacyCtx, hasMembership: false, orgRole: null } });
  ok(isApprovalVisible(pa("tender.send_rfq"), legacyNonMember), "旧模式：判定在「非成员」之前（端口顺序 4 → 5），照旧交给执行器");
}

console.log("\n可见集合条件与单条判定同义（小求值器）");
{
  type Row = Record<string, unknown>;
  function matches(row: Row, where: PendingActionWhere): boolean {
    return Object.entries(where).every(([key, cond]) => {
      if (key === "OR") return (cond as PendingActionWhere[]).some((w) => matches(row, w));
      if (key === "AND") return (cond as PendingActionWhere[]).every((w) => matches(row, w));
      if (key === "NOT") return !matches(row, cond as PendingActionWhere);
      const value = row[key];
      if (cond === null) return value === null || value === undefined;
      if (typeof cond !== "object") return value === cond;
      const c = cond as Record<string, unknown>;
      if ("in" in c) return (c.in as unknown[]).includes(value);
      if ("startsWith" in c) return typeof value === "string" && value.startsWith(String(c.startsWith));
      return false;
    });
  }
  const types = ["sales.approve_quote_promotion", "install.send_warranty_email", "tender.send_rfq", "tender.send_chase", "marketing.activate_campaign", "revenue_spine.propose_commercial_fact", "sales.send_inquiry_reply", "grader.email_draft", "calendar.create_event", "sales.update_stage"];
  const rows: ApprovalItem[] = [];
  for (const type of types) {
    rows.push(pa(type));
    rows.push(pa(type, { createdById: ME }));
    rows.push(pa(type, { approverUserId: ME }));
    rows.push(pa(type, { projectId: "p1" }));
    rows.push(pa(type, { workspaceId: "w1" }));
    rows.push(pa(type, { orgId: null }));
    rows.push(pa(type, { orgId: null, createdById: ME }));
    rows.push(pa(type, { orgId: "org-2" }));
    rows.push(pa(type, { orgId: "org-2", createdById: ME }));
  }
  // 调用方总会另 AND「当前企业 ∪ 本人个人草稿」：同义只要求在这个范围内成立。
  // 岗位模式与非成员的条件本身就排除范围外的行，按全部行比；旧模式 / super_admin 的 `{}` 按范围内的行比。
  const inScope = (r: ApprovalItem, v: ApprovalViewer) => r.orgId === v.orgId || (r.orgId === null && (r.createdById === ME || r.approverUserId === ME));
  const viewers: [string, ApprovalViewer][] = [
    ["Sunny 老板", viewer("owner", { isOrgHandler: true, isOrgAdminRole: true })],
    ["会计", viewer("accounting")],
    ["销售", viewer("sales_rep")],
    ["招投标（项目负责人）", viewer("bids", { projectIds: ["p1"] })],
    ["运营（工作区成员）", viewer("ops_staff", { workspaceIds: ["w1"] })],
    ["不持岗位的管理员", viewer("no_position", { isOrgHandler: true, isOrgAdminRole: true })],
    ["梦馨 Cathy", viewer("mx_cathy", { isOrgHandler: true })],
    ["旧模式管理员", legacyViewer({ isOrgAdminRole: true })],
    ["super_admin", viewer("super_admin")],
    ["非成员", viewer("sales_rep", { ctx: { ...gateCtx("sales_rep"), hasMembership: false } })],
  ];
  for (const [label, v] of viewers) {
    const where = pendingActionAudienceWhere(v);
    const scoped = JSON.stringify(where) === "{}" ? rows.filter((r) => inScope(r, v)) : rows;
    const diff = scoped.filter((r) => matches(r as unknown as Row, where) !== isApprovalVisible(r, v));
    ok(diff.length === 0, `${label}：查询条件与单条判定逐行一致（${scoped.length} 行）`, diff.slice(0, 3));
  }
}

console.log("\n端口判定顺序");
{
  const v = viewer("no_position", { isOrgHandler: true });
  ok(portCardVisible(pa("tender.send_rfq"), viewer("super_admin"), "org-x"), "1 super_admin：可见");
  ok(portCardVisible(pa("grader.email_draft", { orgId: null, createdById: ME }), v, null) && !portCardVisible(pa("grader.email_draft", { orgId: null }), v, null), "2 个人草稿：只给创建人 / 指定审批人");
  ok(!portCardVisible(pa("grader.email_draft"), v, "org-2"), "3 调用方企业与卡的企业不同：视为不存在");
  ok(portCardVisible(pa("tender.send_rfq"), legacyViewer(), null), "4 旧模式：可见（微信传空企业也按卡所属企业判）");
  ok(!portCardVisible(pa("grader.email_draft", { createdById: ME }), viewer("sales_rep", { ctx: { ...gateCtx("sales_rep"), hasMembership: false } }), null), "5 非成员：不可见");
  ok(!portCardVisible(pa("tender.send_rfq"), v, ORG) && portCardVisible(pa("grader.email_draft"), v, ORG), "6 其余按可见集合：不持岗位的管理员看不到询价、看得到无业务归属草稿");
}

console.log("\n三个来源的判定形状");
{
  const prc = pendingActionItem({ type: "tender.send_rfq", orgId: ORG, createdById: "a", approverUserId: "b", workspaceId: "w", projectId: "p" });
  ok(prc.sourceType === "PENDING_ACTION" && prc.type === "tender.send_rfq" && prc.projectId === "p" && prc.workspaceId === "w", "PendingAction：类型、项目、工作区照列取");
  const ar = approvalRequestItem({ approverUserId: "b", task: { createdById: "a", project: { id: "p", orgId: ORG, workspaceId: "w" } } });
  ok(ar.sourceType === "APPROVAL_REQUEST" && ar.orgId === ORG && ar.createdById === "a" && ar.projectId === "p" && ar.workspaceId === "w", "项目智能体审批：企业 / 项目 / 工作区取任务所属项目，提交人取任务创建人");
  const pc = productContentItem({ orgId: ORG, requestedById: "a" });
  ok(pc.sourceType === "PRODUCT_CONTENT" && pc.createdById === "a" && pc.approverUserId === null, "产品内容审批：提交人取 requestedById");
  ok(isLegacyOrg(legacyViewer()) && isLegacyOrg(legacyViewer({ isPlatformAdmin: true })) && !isLegacyOrg(viewer("owner")) && !isLegacyOrg(viewer("no_position", { ctx: null })), "旧模式按企业判（super_admin 在旧模式企业也走原列表规则）");
}

console.log("\n审批中心接入（源码）");
{
  const query = code("src/lib/capabilities/approvals/query.ts");
  ok(!/if \(!isOrgAdminRole\(access\.orgRole\)\) \{\s*filtered = filtered\.filter/.test(query), "query.ts 不再有按 isOrgAdminRole(access.orgRole) 的整段放行");
  ok(/legacy \? \{\} : \{ AND: \[pendingActionAudienceWhere\(viewer\)\] \}/.test(query), "列表：PendingAction 在查询里按可见集合过滤（旧模式除外）");
  ok(/if \(legacy\) \{[\s\S]*?legacyListVisible\(/.test(query), "列表：旧模式改调 legacyListVisible");
  ok((query.match(/if \(!visible\((approvalRequestItem|productContentItem)\(row\)\)\) continue;/g) ?? []).length === 2, "列表：项目智能体与产品内容审批投影前判可见");
  ok((query.match(/if \(!row \|\| !isApprovalVisible\((pendingActionItem|approvalRequestItem|productContentItem)\(row\), viewer\)\)/g) ?? []).length === 3, "详情：三个来源不可见与不存在同一个 404");

  const decision = code("src/lib/capabilities/approvals/decision.ts");
  const fn = decision.slice(decision.indexOf("export async function decideCapabilityApproval"));
  const firstDetail = fn.indexOf("await getCapabilityApproval(access, input.approvalId, viewer)");
  const idem = fn.indexOf("await loadIdempotency(");
  const expiry = fn.indexOf('projection.status === "EXPIRED"');
  const cap = fn.indexOf("const capOk");
  ok(firstDetail > 0 && idem > firstDetail && expiry > idem && cap > expiry, "decision.ts：幂等读取在第一次详情加载之后、过期与能力检查之前", { firstDetail, idem, expiry, cap });
  ok(/existing\.approvalKey !== approvalKey \|\| existing\.action !== action\) return null/.test(decision) && /loadIdempotency\(\s*access\.orgId,\s*input\.idempotencyKey,\s*input\.approvalId,\s*input\.action,?\s*\)/.test(fn), "decision.ts：幂等缓存只在审批与动作都相同时命中");
  ok((fn.match(/loadApprovalViewer\(/g) ?? []).length === 1 && (fn.match(/getCapabilityApproval\(access, input\.approvalId, viewer\)/g) ?? []).length === 6 && !/getCapabilityApproval\(access, input\.approvalId\)/.test(fn), "decision.ts：判定输入只取一次，6 处详情加载都用它");
  ok((fn.match(/note: input\.note,\s*viewer,/g) ?? []).length === 3, "decision.ts：3 处端口调用都带上同一个判定输入");

  const rfq = code("src/lib/tender-rfq/web-entry-approval.ts");
  const loop = rfq.indexOf("for (const actionId of actionIds)");
  ok(rfq.indexOf("loadApprovalViewer(") > 0 && rfq.indexOf("loadApprovalViewer(") < loop && /getCapabilityApproval\(usable, approvalId, viewer\)/.test(rfq), "RFQ 原地审批：一个项目只取一次判定输入");
}

console.log("\n纯模块");
{
  const src = code("src/lib/approval/audience.ts");
  ok(!/@\/lib\/db|from "next\/|from "react"/.test(src), "audience.ts 不导入数据库、next 与 react");
  const server = code("src/lib/approval/audience-server.ts");
  ok(/ROUTE_GATE_LOADER\.loadContextForOrg\(user, orgId\)/.test(server) && /ROUTE_GATE_LOADER\.loadUser\(userId\)/.test(server), "viewer：平台角色按 userId 读库，判定输入走路由门缓存");
  ok(/org\?\.ownerId === userId \|\| activeRole === "org_admin"/.test(server), "企业处理人与执行器同口径（企业所有者或成员角色 org_admin）");
  const loader = code("src/lib/navigation/context-server.ts");
  ok(/loadContextForOrg: \(user, orgId\) => contextFor\(user, orgId\)/.test(loader) && /return contextFor\(user, pickGateOrgId\(/.test(loader), "路由门加载器按企业取与按当前企业取共用同一缓存函数");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
