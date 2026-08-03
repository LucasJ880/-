import assert from "node:assert/strict";
import { registry } from "../tool-registry";
import type { ToolDefinition, ToolExecutionContext } from "../types";
import {
  assertToolAllowlist,
  assertArgsMatchScopeGuard,
  runPreExecuteGuards,
} from "../pre-execute-guard";
import {
  handleRequiresApproval,
  APPROVAL_REQUIRED_UNSUPPORTED,
} from "../approval-gate";

function makeTool(
  name: string,
  execute: ToolDefinition["execute"],
): ToolDefinition {
  return {
    name,
    description: name,
    domain: "project",
    risk: "l1_internal_write",
    allowRoles: "*",
    parameters: { type: "object", properties: {} },
    execute,
  };
}

async function main() {
  // ── allowlist 语义 ──
  assert.equal(assertToolAllowlist("a", undefined).ok, true);
  assert.equal(assertToolAllowlist("a", []).ok, false);
  assert.equal(assertToolAllowlist("a", ["b"]).ok, false);
  assert.equal(assertToolAllowlist("a", ["a"]).ok, true);

  // ── Registry 集成：空 allowlist = 零工具暴露 ──
  {
    const t = makeTool("qm_test_read_a", async () => ({
      success: true,
      data: { ran: true },
    }));
    registry.register(t);
    assert.equal(registry.list({ names: [] }).length, 0);
    assert.equal(registry.list({ names: ["qm_test_read_a"] }).length, 1);
    assert.ok(registry.list({ names: undefined }).some((x) => x.name === "qm_test_read_a"));

    const ctx: ToolExecutionContext = {
      userId: "u1",
      orgId: "orgA",
      orgRole: "org_admin",
      hasMembership: true,
      role: "admin",
      args: {},
      allowedToolNames: [],
      scopeGuard: { orgId: "orgA", principalUserId: "u1", projectId: "p1" },
    };
    let execCount = 0;
    registry.register(
      makeTool("qm_test_blocked", async () => {
        execCount += 1;
        return { success: true, data: {} };
      }),
    );
    const denied = await registry.execute("qm_test_blocked", {
      ...ctx,
      allowedToolNames: [],
    });
    assert.equal(denied.success, false);
    assert.equal(execCount, 0);
    assert.match(denied.error ?? "", /allowlist/i);
  }

  // ── Scope 冲突在 executor 前拒绝 ──
  {
    let execCount = 0;
    const tool = makeTool("qm_test_scope", async () => {
      execCount += 1;
      return { success: true, data: {} };
    });
    registry.register(tool);
    const r = await registry.execute("qm_test_scope", {
      userId: "u1",
      orgId: "orgA",
      orgRole: "org_admin",
      hasMembership: true,
      role: "admin",
      args: { orgId: "orgB" },
      allowedToolNames: ["qm_test_scope"],
      scopeGuard: { orgId: "orgA", principalUserId: "u1", projectId: "p1" },
    });
    assert.equal(r.success, false);
    assert.equal(execCount, 0);
    assert.equal(
      (r.data as { code?: string } | null)?.code,
      "SCOPE_ORG_OVERRIDE",
    );
  }

  // project override
  {
    const d = assertArgsMatchScopeGuard(
      { projectId: "pOther" },
      { orgId: "orgA", principalUserId: "u1", projectId: "p1" },
    );
    assert.equal(d.ok, false);
  }

  // 流式/非流式共用 runPreExecuteGuards
  {
    const ok = runPreExecuteGuards({
      toolName: "x",
      ctx: {
        userId: "u1",
        orgId: "orgA",
        args: {},
        allowedToolNames: ["x"],
        scopeGuard: { orgId: "orgA", principalUserId: "u1" },
      },
    });
    assert.equal(ok.ok, true);
  }

  // ── forceApproval：executor 调用次数 0，支持映射则 PendingAction ──
  {
    let execCount = 0;
    const tool = makeTool("qm_internal_note_add", async () => {
      execCount += 1;
      return { success: true, data: { sideEffect: true } };
    });
    let draftCalls = 0;
    const result = await handleRequiresApproval({
      tool,
      ctx: {
        userId: "u1",
        orgId: "orgA",
        args: { note: "hello note", projectId: "p1" },
        scopeGuard: { orgId: "orgA", principalUserId: "u1", projectId: "p1" },
        agentRunId: "run1",
      },
      deps: {
        createDraftFn: async (input) => {
          draftCalls += 1;
          assert.equal(input.type, "grader.internal_note");
          assert.ok(input.idempotencyKey);
          return {
            success: true,
            data: {
              status: "pending_approval",
              actionId: "pa_1",
              type: input.type,
              title: input.title,
              preview: input.preview,
              hint: "x",
            },
          };
        },
      },
    });
    assert.equal(execCount, 0);
    assert.equal(draftCalls, 1);
    assert.equal(result.success, true);

    // 不支持映射 → APPROVAL_REQUIRED_UNSUPPORTED，仍不执行
    const unsupported = await handleRequiresApproval({
      tool: makeTool("qm_shell_exec", async () => {
        execCount += 1;
        return { success: true, data: {} };
      }),
      ctx: {
        userId: "u1",
        orgId: "orgA",
        args: { cmd: "rm -rf /" },
        scopeGuard: { orgId: "orgA", principalUserId: "u1" },
      },
      deps: {
        createDraftFn: async () => {
          draftCalls += 1;
          return { success: true, data: {} };
        },
      },
    });
    assert.equal(unsupported.success, false);
    assert.match(unsupported.error ?? "", new RegExp(APPROVAL_REQUIRED_UNSUPPORTED));
    assert.equal(execCount, 0);
    assert.equal(draftCalls, 1);
  }

  // registry + forceApprovalTools 路径
  {
    let execCount = 0;
    registry.register(
      makeTool("qm_force_approve_tool", async () => {
        execCount += 1;
        return { success: true, data: { ran: true } };
      }),
    );
    const r = await registry.execute("qm_force_approve_tool", {
      userId: "u1",
      orgId: "orgA",
      orgRole: "org_admin",
      hasMembership: true,
      role: "admin",
      args: { note: "n", projectId: "p1" },
      allowedToolNames: ["qm_force_approve_tool"],
      scopeGuard: { orgId: "orgA", principalUserId: "u1", projectId: "p1" },
      toolPolicy: { forceApprovalTools: ["qm_force_approve_tool"] },
      agentRunId: "run2",
    });
    // 工具名不含 internal_note → unsupported，且不执行
    assert.equal(execCount, 0);
    assert.equal(r.success, false);
    assert.match(r.error ?? "", /APPROVAL_REQUIRED_UNSUPPORTED/);
  }

  console.log("pre-execute-guard: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
