/**
 * PERM-5b：数字员工岗位绑定与工具授权（不连库）
 *   主体解析决策、岗位映射、工具授权主体分支、审批映射（审批人 = sponsor）、审计展示、绑定校验、助手主体契约
 * 运行：npx tsx src/lib/authorization/__tests__/digital-employee.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideDigitalEmployeePrincipal,
  describeAuditActor,
  digitalEmployeeCorrelation,
  DIGITAL_EMPLOYEE_POSITION_KEYS,
} from "../digital-employee";
import { parseBindingFile, parsePrincipalType, validateDigitalEmployeeBindings } from "../position-binding";
import { DIGITAL_EMPLOYEE_ROLES } from "@/lib/agent-core/skills/digital-employee-roles";
import { canInvokeTool, type CanInvokeToolInput } from "@/lib/tenancy/tool-auth";
import { buildDigitalEmployeeApprovalInput } from "@/lib/approval/digital-employee";
import { buildPendingActionDraftInput } from "@/lib/approval/request";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

const ROOT = join(__dirname, "..", "..", "..", "..");

console.log("PERM-5b 主体解析决策");
{
  const agent = { id: "ag1", name: "销售助手", status: "active", createdById: "alex", projectOrgId: "org1" };
  const good = decideDigitalEmployeePrincipal({ orgId: "org1", agent, sponsorMembershipStatus: "active" });
  ok(good.ok && good.principal.type === "DIGITAL_EMPLOYEE" && good.principal.sponsorUserId === "alex" && good.principal.id === "ag1", "active + 本企业 + sponsor 是成员 → 主体，sponsor = 创建人");
  const r = (over: Partial<typeof agent> | null, member: string | null = "active") =>
    decideDigitalEmployeePrincipal({ orgId: "org1", agent: over === null ? null : { ...agent, ...over }, sponsorMembershipStatus: member });
  const code = (x: ReturnType<typeof r>) => (x.ok ? "OK" : x.reasonCode);
  ok(code(r(null)) === "AGENT_NOT_FOUND", "Agent 不存在 → AGENT_NOT_FOUND");
  ok(code(r({ status: "disabled" })) === "AGENT_INACTIVE", "Agent 停用 → AGENT_INACTIVE");
  ok(code(r({ projectOrgId: "org2" })) === "AGENT_ORG_MISMATCH", "跨企业 → AGENT_ORG_MISMATCH");
  ok(code(r({ projectOrgId: null })) === "AGENT_ORG_MISMATCH", "项目无企业 → AGENT_ORG_MISMATCH");
  ok(code(r({}, "inactive")) === "SPONSOR_NOT_MEMBER", "sponsor 非 active 成员 → SPONSOR_NOT_MEMBER");
  ok(code(r({}, null)) === "SPONSOR_NOT_MEMBER", "sponsor 不是成员 → SPONSOR_NOT_MEMBER");
}

console.log("PERM-5b 角色默认岗位");
{
  const map = Object.fromEntries(DIGITAL_EMPLOYEE_ROLES.map((r) => [r.id, r.positionKey]));
  ok(map["sales-digital-employee"] === "sales_rep", "销售数字员工 → sales_rep");
  ok(map["marketing-growth-digital-employee"] === "ops_staff", "营销增长数字员工 → ops_staff");
  ok(map["tender-digital-employee"] === "bids", "投标数字员工 → bids");
  ok(map["analytics-digital-employee"] === "accounting", "数据分析数字员工 → accounting");
  ok(
    [...new Set(DIGITAL_EMPLOYEE_ROLES.map((r) => r.positionKey))].sort().join() === [...DIGITAL_EMPLOYEE_POSITION_KEYS].sort().join(),
    "角色岗位集合 = 数字员工允许岗位集合",
  );
}

console.log("PERM-5b 工具授权主体分支");
{
  const base: CanInvokeToolInput = {
    tenant: { userId: "alex", orgId: "org1", orgRole: "org_member", isPlatformAdmin: false, workspaceIds: [] },
    hasMembership: true,
    tool: { name: "sales_list_customers", domain: "sales", risk: "l0_read", allowRoles: ["sales"] },
  };
  const legacy = canInvokeTool(base);
  ok(legacy.allowed && !legacy.requiresApproval, "不传主体：行为不变（org_member + 白名单 sales → 允许）");
  const legacyAdminOnly = canInvokeTool({ ...base, tool: { ...base.tool, allowRoles: undefined } });
  ok(!legacyAdminOnly.allowed && legacyAdminOnly.code === "org_role_denied", "不传主体：未声明白名单仍视为 admin-only");

  const withReq = { ...base.tool, requiredPermission: "sales.customer.read" };
  const humanHas = canInvokeTool({ ...base, tool: { ...withReq, allowRoles: undefined }, principal: { type: "HUMAN", permissionKeys: ["sales.customer.read"] } });
  ok(humanHas.allowed, "人类持所需权限 → 允许（不再看白名单）");
  const humanMiss = canInvokeTool({ ...base, tool: withReq, principal: { type: "HUMAN", permissionKeys: ["sales.quote.read"] } });
  ok(!humanMiss.allowed && humanMiss.code === "permission_denied", "人类缺所需权限 → permission_denied");

  const de = (tool: CanInvokeToolInput["tool"], keys: string[] = ["sales.customer.read"]) =>
    canInvokeTool({ ...base, tool, principal: { type: "DIGITAL_EMPLOYEE", permissionKeys: keys } });
  const deRead = de(withReq);
  ok(deRead.allowed && !deRead.requiresApproval, "数字员工 l0_read + 持所需权限 → 允许不审批");
  const deL1 = de({ ...withReq, risk: "l1_internal_write" });
  ok(deL1.allowed && !deL1.requiresApproval, "数字员工 l1_internal_write → 按原规则（不强制审批）");
  const deL2 = de({ ...withReq, risk: "l2_soft" });
  ok(deL2.allowed && deL2.requiresApproval, "数字员工 l2_soft → 需审批");
  const deL3 = de({ ...withReq, risk: "l3_strong" });
  ok(deL3.allowed && deL3.requiresApproval, "数字员工 l3_strong → 需审批");
  const deNoReq = de(base.tool);
  ok(!deNoReq.allowed && deNoReq.code === "permission_required", "数字员工调用未声明所需权限的工具 → permission_required（不回退白名单）");
  const deNoKeys = canInvokeTool({ ...base, tool: withReq, principal: { type: "DIGITAL_EMPLOYEE" } });
  ok(!deNoKeys.allowed && deNoKeys.code === "permission_required", "数字员工未带权限键 → permission_required");
  const deMiss = de(withReq, ["sales.quote.read"]);
  ok(!deMiss.allowed && deMiss.code === "permission_denied", "数字员工缺所需权限 → permission_denied");
  const deViewer = canInvokeTool({
    ...base,
    tenant: { ...base.tenant, orgRole: "org_viewer" },
    tool: { ...withReq, risk: "l1_internal_write" },
    principal: { type: "DIGITAL_EMPLOYEE", permissionKeys: ["sales.customer.read"] },
  });
  ok(!deViewer.allowed && deViewer.code === "viewer_write_denied", "sponsor 是 viewer 时数字员工写工具仍被收紧");
  const deNoMember = canInvokeTool({ ...base, hasMembership: false, tool: withReq, principal: { type: "DIGITAL_EMPLOYEE", permissionKeys: ["sales.customer.read"] } });
  ok(!deNoMember.allowed && deNoMember.code === "no_membership", "sponsor 无成员身份 → no_membership");
}

console.log("PERM-5b 数字员工审批映射");
{
  const canonical = buildDigitalEmployeeApprovalInput(
    {
      agentId: "ag1",
      positionKey: "sales_rep",
      orgId: "org1",
      actionType: "sales.send_inquiry_reply",
      title: "跟进邮件",
      preview: "发给客户",
      payload: { to: "c@example.com", metadata: { foo: 1 } },
      risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong" },
      source: { module: "digital-employee.test" },
      idempotencyKey: "de:ag1:1",
    },
    { agentId: "ag1", agentName: "销售助手", sponsorUserId: "alex" },
  );
  const { draft } = buildPendingActionDraftInput(canonical);
  ok(draft.userId === "alex", "PendingAction 归属 = sponsor");
  ok(draft.approverUserId === "alex" && draft.approverUserId !== "ag1", "审批人 = sponsor，不是 Agent");
  const meta = (draft.payload as { metadata: Record<string, unknown> }).metadata;
  ok(meta.principalActorType === "agent", "执行者类型 = agent");
  ok(
    JSON.stringify(meta._digitalEmployee) === JSON.stringify({ agentId: "ag1", agentName: "销售助手", positionKey: "sales_rep", sponsorUserId: "alex" }) && meta.foo === 1,
    "metadata 记录 Agent / 岗位 / sponsor，保留原 metadata",
  );
}

console.log("PERM-5b 审计标记与展示");
{
  const corr = digitalEmployeeCorrelation({
    principal: { type: "DIGITAL_EMPLOYEE", id: "ag1", orgId: "org1", sponsorUserId: "alex" },
    agentName: "销售助手",
    positionKey: "sales_rep",
  });
  ok(corr.actorKind === "digital_employee" && corr.agentId === "ag1" && corr.sponsorUserId === "alex" && corr.positionKey === "sales_rep", "correlation 含 actorKind / Agent / 岗位 / sponsor");
  ok(describeAuditActor({ x: 1, _runtimeCorrelation: corr }) === "数字员工 销售助手 代 岗位 sales_rep", "展示文本：数字员工 销售助手 代 岗位 sales_rep");
  ok(describeAuditActor({ _runtimeCorrelation: { actorType: "user", actorId: "alex" } }) === null, "人类记录无展示文本");
  ok(describeAuditActor(JSON.stringify({ _runtimeCorrelation: corr })) === "数字员工 销售助手 代 岗位 sales_rep", "落库 JSON 字符串形态同样识别");
  ok(describeAuditActor(null) === null && describeAuditActor("x") === null && describeAuditActor("{bad _runtimeCorrelation") === null, "无 afterData / 非法 JSON → null");
  const q = readFileSync(join(ROOT, "src/lib/audit/query.ts"), "utf-8");
  const route = readFileSync(join(ROOT, "src/app/api/audit-logs/route.ts"), "utf-8");
  ok(/data\.map\(toAuditLogListItem\)/.test(q) && /data\.map\(toAuditLogListItem\)/.test(route), "审计列表两条查询路径都追加展示文本");
}

console.log("PERM-5b 绑定校验");
{
  ok(parsePrincipalType(null) === "HUMAN" && parsePrincipalType("DIGITAL_EMPLOYEE") === "DIGITAL_EMPLOYEE" && parsePrincipalType("GROUP") === null, "主体类型解析：缺省 HUMAN、未知类型 null");
  const cfg = parseBindingFile(readFileSync(join(ROOT, "config/positions/sunny-digital-employees.json"), "utf-8"));
  ok(cfg.ok, "占位配置可解析");
  const known = ["owner", "sales_rep", "ops_staff", "bids", "accounting"];
  const agents = {
    ag1: { id: "ag1", name: "销售助手", status: "active", orgId: "org1" },
    ag2: { id: "ag2", name: "停用助手", status: "disabled", orgId: "org1" },
    ag3: { id: "ag3", name: "别家助手", status: "active", orgId: "org2" },
  };
  const v = (bindings: Record<string, string[]>) =>
    validateDigitalEmployeeBindings({ file: { bindings }, orgId: "org1", knownProfileKeys: known, allowedPositionKeys: DIGITAL_EMPLOYEE_POSITION_KEYS, agentsById: agents });
  if (cfg.ok) {
    const r = validateDigitalEmployeeBindings({ file: cfg.value, orgId: "org1", knownProfileKeys: known, allowedPositionKeys: DIGITAL_EMPLOYEE_POSITION_KEYS, agentsById: agents });
    ok(!r.ok && r.errors.some((e) => e.includes("TODO:销售数字员工")), "占位配置整文件拒绝并列出占位键");
  }
  const good = v({ ag1: ["sales_rep"] });
  ok(good.ok && good.resolved[0].userId === "ag1" && good.resolved[0].email === "销售助手", "合法：Agent id → sales_rep");
  const owner = v({ ag1: ["owner"] });
  ok(!owner.ok && owner.errors.some((e) => e.includes("ag1") && e.includes("owner")), "数字员工不能绑 owner");
  ok(!v({ ag2: ["sales_rep"] }).ok, "停用 Agent 拒绝");
  const cross = v({ ag3: ["sales_rep"] });
  ok(!cross.ok && cross.errors.some((e) => e.includes("不属于本企业")), "跨企业 Agent 拒绝");
  const missing = v({ nope: ["sales_rep"] });
  ok(!missing.ok && missing.errors.some((e) => e.includes("不存在")), "不存在的 Agent 拒绝");
  const notSeeded = validateDigitalEmployeeBindings({ file: { bindings: { ag1: ["bids"] } }, orgId: "org1", knownProfileKeys: ["sales_rep"], allowedPositionKeys: DIGITAL_EMPLOYEE_POSITION_KEYS, agentsById: agents });
  ok(!notSeeded.ok && notSeeded.errors.some((e) => e.includes("未落地")), "本企业未落地的岗位拒绝");
  const script = readFileSync(join(ROOT, "scripts/bind-positions.ts"), "utf-8");
  ok(/where: \{ orgId: org\.id, principalType \}/.test(script) && /principalType, principalId: c\.userId/.test(script), "脚本按主体类型读写绑定（人类 / 数字员工互不影响）");
}

console.log("PERM-5b 助手模式主体 = 操作者");
{
  const p = readFileSync(join(ROOT, "src/lib/agent-runtime-v2/principal.ts"), "utf-8");
  ok(/readInitiatedByUserId\(run\.metadata\)/.test(p) && !/DIGITAL_EMPLOYEE/.test(p), "运行时 v2 主体取发起人 user id，不以数字员工执行");
  for (const f of ["src/lib/agent-runtime-v2/executor.ts", "src/lib/agent-core/engine.ts", "src/lib/agent-core/tool-registry.ts", "src/lib/assistant/followup-task.ts"]) {
    ok(!/type: "DIGITAL_EMPLOYEE"/.test(readFileSync(join(ROOT, f), "utf-8")), `${f} 不以数字员工主体调用工具授权`);
  }
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
