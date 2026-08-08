/**
 * P0-1 / P0-2 / P0-3：统一 pre-execute 链
 * 运行：npx tsx src/lib/agent-core/__tests__/pre-execute-guard.test.ts
 */

import {
  assertToolAllowlist,
  assertArgsMatchScopeGuard,
  runPreExecuteGuards,
} from "../pre-execute-guard";
import {
  mapToolCallToPendingAction,
  handleRequiresApproval,
  APPROVAL_REQUIRED_UNSUPPORTED,
} from "../approval-gate";
import { registry } from "../tool-registry";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../types";
import "../tools";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const baseCtx: ToolExecutionContext = {
  args: {},
  userId: "u1",
  orgId: "org_a",
  orgRole: "org_member",
  hasMembership: true,
  role: "sales",
  modulesJson: {
    enabled: ["sales", "project", "secretary", "operations"],
  },
};

async function main() {
console.log("P0-2: allowlist fail-closed");
{
  ok(assertToolAllowlist("any_tool", undefined).ok, "undefined → 不按名称拦截");
  const empty = assertToolAllowlist("any_tool", []);
  ok(!empty.ok && empty.code === "TOOL_NOT_ALLOWLISTED", "[] → 零工具，全部拒绝");
  ok(assertToolAllowlist("t1", ["t1", "t2"]).ok, "命中 allowlist → 放行");
  const miss = assertToolAllowlist("t3", ["t1", "t2"]);
  ok(!miss.ok && miss.code === "TOOL_NOT_ALLOWLISTED", "未命中 → 拒绝");

  // registry.list 层
  const all = registry.list();
  ok(all.length > 0, "registry 无 filter → 全部工具");
  const zero = registry.list({ names: [] });
  ok(zero.length === 0, "registry.list({names: []}) → ZERO tools");
  const undef = registry.list({ names: undefined });
  ok(undef.length === all.length, "registry.list({names: undefined}) → 不按名称过滤");
}

console.log("P0-3: scopeGuard 防覆盖");
{
  const guard = { orgId: "org_a", principalUserId: "u1", projectId: "p1" };
  ok(assertArgsMatchScopeGuard({}, guard).ok, "无冲突参数 → 放行");
  ok(
    assertArgsMatchScopeGuard({ orgId: "org_a" }, guard).ok,
    "同 org 参数 → 放行",
  );
  const orgOverride = assertArgsMatchScopeGuard({ orgId: "org_b" }, guard);
  ok(!orgOverride.ok && orgOverride.code === "SCOPE_ORG_OVERRIDE", "跨 org 参数 → 拒绝");
  const userOverride = assertArgsMatchScopeGuard({ userId: "u2" }, guard);
  ok(!userOverride.ok && userOverride.code === "SCOPE_USER_OVERRIDE", "冒充 userId → 拒绝");
  const projOverride = assertArgsMatchScopeGuard({ projectId: "p2" }, guard);
  ok(!projOverride.ok && projOverride.code === "SCOPE_PROJECT_OVERRIDE", "跨 project 参数 → 拒绝");
  const missing = assertArgsMatchScopeGuard({}, { orgId: " ", principalUserId: "u1" });
  ok(!missing.ok && missing.code === "SCOPE_MISSING", "scopeGuard.orgId 空 → 拒绝");
  ok(assertArgsMatchScopeGuard({ orgId: "org_b" }, undefined).ok, "无 scopeGuard → 兼容放行");
}

console.log("P0-1: approval gate 不执行 executor");
{
  let executed = 0;
  const l3Tool: ToolDefinition = {
    name: "test_l3_tool",
    description: "测试 l3 工具",
    domain: "sales",
    parameters: { type: "object", properties: {} },
    risk: "l3_strong",
    allowRoles: ["admin", "sales"],
    execute: async () => {
      executed++;
      return { success: true, data: "SIDE_EFFECT" };
    },
  };

  // 无法映射 PendingAction → 阻断且不执行
  const res = await handleRequiresApproval({
    tool: l3Tool,
    ctx: { ...baseCtx, args: {} },
    deps: {
      createDraftFn: async () => {
        throw new Error("should not be called for unmapped tool");
      },
    },
  });
  ok(res.success === false, "未映射 → success=false");
  ok(
    typeof res.error === "string" && res.error.includes(APPROVAL_REQUIRED_UNSUPPORTED),
    "未映射 → APPROVAL_REQUIRED_UNSUPPORTED",
  );
  ok(executed === 0, "executor 未被调用");

  // 显式 proposal → 走 createDraft（mock），仍不执行 executor
  let drafted = 0;
  const draftRes = await handleRequiresApproval({
    tool: l3Tool,
    ctx: {
      ...baseCtx,
      args: {
        pendingActionProposal: {
          type: "sales.update_followup",
          title: "更新跟进",
          preview: "预览",
          payload: { customerId: "c1" },
        },
      },
    },
    deps: {
      createDraftFn: async (input) => {
        drafted++;
        ok(input.type === "sales.update_followup", "映射类型正确");
        ok(
          (input.payload.metadata as Record<string, unknown>)?.orgId === "org_a",
          "payload.metadata.orgId 注入",
        );
        return { success: true, data: { actionId: "pa1", status: "pending_approval" } } as ToolExecutionResult;
      },
    },
  });
  ok(draftRes.success === true && drafted === 1, "可映射 → createDraft 被调用");
  ok(executed === 0, "executor 始终未被调用");

  // mapToolCallToPendingAction 直测
  const unmapped = mapToolCallToPendingAction("sales_send_quote_email", {}, baseCtx);
  ok(unmapped === null, "sales_send_quote_email 无 proposal → 不可映射（阻断直发）");
}

console.log("P0-1: registry.execute 消费 requiresApproval（forceApprovalTools）");
{
  let executed = 0;
  registry.register({
    name: "__test_force_approval_l1__",
    description: "测试 forceApproval l1 工具",
    domain: "system",
    parameters: { type: "object", properties: {} },
    risk: "l1_internal_write",
    allowRoles: "*",
    execute: async () => {
      executed++;
      return { success: true, data: "WROTE" };
    },
  });

  const res = await registry.execute("__test_force_approval_l1__", {
    ...baseCtx,
    toolPolicy: { forceApprovalTools: ["__test_force_approval_l1__"] },
  });
  ok(executed === 0, "forceApprovalTools 命中 → executor 不执行");
  ok(res.success === false, "无法映射 → 明确失败（fail-closed）");
  ok(
    typeof res.error === "string" && res.error.includes(APPROVAL_REQUIRED_UNSUPPORTED),
    "返回 APPROVAL_REQUIRED_UNSUPPORTED",
  );

  // 不在 forceApproval 列表时正常执行
  const okRes = await registry.execute("__test_force_approval_l1__", { ...baseCtx });
  ok(okRes.success === true && executed === 1, "未要求审批 → 正常执行");
}

console.log("P0-1: l3 工具未审批不执行（registry.execute）");
{
  let executed = 0;
  registry.register({
    name: "__test_l3_direct__",
    description: "测试 l3 工具",
    domain: "sales",
    parameters: { type: "object", properties: {} },
    risk: "l3_strong",
    allowRoles: "*",
    execute: async () => {
      executed++;
      return { success: true, data: "SENT" };
    },
  });

  const res = await registry.execute("__test_l3_direct__", { ...baseCtx });
  ok(executed === 0, "l3_strong 默认 → executor 不执行");
  ok(res.success === false, "l3 未审批 → 失败返回");
}

console.log("P0-2: allowlist 在 execute 层强制（防幻觉工具名）");
{
  let executed = 0;
  registry.register({
    name: "__test_l0_allowlisted__",
    description: "测试 l0 工具",
    domain: "system",
    parameters: { type: "object", properties: {} },
    risk: "l0_read",
    allowRoles: "*",
    execute: async () => {
      executed++;
      return { success: true, data: "READ" };
    },
  });

  const denied = await registry.execute("__test_l0_allowlisted__", {
    ...baseCtx,
    allowedToolNames: [],
  });
  ok(denied.success === false && executed === 0, "allowlist=[] → execute 拒绝");

  const denied2 = await registry.execute("__test_l0_allowlisted__", {
    ...baseCtx,
    allowedToolNames: ["other_tool"],
  });
  ok(denied2.success === false && executed === 0, "不在 allowlist → execute 拒绝");

  const allowed = await registry.execute("__test_l0_allowlisted__", {
    ...baseCtx,
    allowedToolNames: ["__test_l0_allowlisted__"],
  });
  ok(allowed.success === true && executed === 1, "在 allowlist → 正常执行");
}

console.log("P0-3: registry.execute 强制 scopeGuard");
{
  let executed = 0;
  registry.register({
    name: "__test_scope_guarded__",
    description: "测试 scope 工具",
    domain: "system",
    parameters: { type: "object", properties: {} },
    risk: "l0_read",
    allowRoles: "*",
    execute: async () => {
      executed++;
      return { success: true, data: "OK" };
    },
  });

  const crossOrg = await registry.execute("__test_scope_guarded__", {
    ...baseCtx,
    args: { orgId: "org_b" },
    scopeGuard: { orgId: "org_a", principalUserId: "u1" },
  });
  ok(crossOrg.success === false && executed === 0, "args.orgId 跨 org → 拒绝");

  const sameOrg = await registry.execute("__test_scope_guarded__", {
    ...baseCtx,
    args: { orgId: "org_a" },
    scopeGuard: { orgId: "org_a", principalUserId: "u1" },
  });
  ok(sameOrg.success === true && executed === 1, "同 org → 放行");
}

console.log("");
console.log(`结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
