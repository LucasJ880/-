/**
 * Phase 1.1 — Context Propagation / Security / Parity 测试
 * 运行：npx tsx src/lib/agent-core/__tests__/phase1-1-context-propagation.test.ts
 *
 * 覆盖：
 * - buildToolContextBase：runtime/scopeGuard 注入 + legacy 缺省行为（Case G）
 * - 流式/非流式 parity（共用同一构造函数，Case F）
 * - Security：LLM 工具参数不能伪造 scope（Case C）；runtimeContext 仅来自服务端
 * - Approval：PendingAction 草稿保留完整 correlation（Case D）
 * - Audit：writeAuditLog correlation 合并
 */

import { buildToolContextBase } from "../engine";
import { runPreExecuteGuards } from "../pre-execute-guard";
import { handleRequiresApproval } from "../approval-gate";
import { writeAuditLog } from "@/lib/audit/logger";
import type { AgentRunOptions, ToolDefinition, ToolExecutionContext } from "../types";

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

async function main() {
  console.log("── buildToolContextBase：注入与 legacy 兼容 ──");
  {
    const base: AgentRunOptions = {
      systemPrompt: "x",
      messages: [{ role: "user", content: "hi" }],
      userId: "u1",
      orgId: "org1",
      sessionId: "s1",
      role: "sales",
    };

    // Case G：legacy 调用方不提供新字段 → 行为不变
    const legacy = buildToolContextBase(base);
    ok(legacy.runtimeContext === undefined, "legacy：无 runtime → runtimeContext undefined");
    ok(legacy.scopeGuard === undefined, "legacy：无 scopeGuard → undefined");
    ok(legacy.userId === "u1" && legacy.orgId === "org1", "legacy：既有字段不变");
    ok(legacy.allowedToolNames === undefined, "legacy：未声明 tools → 不限制 allowlist");

    // Phase 1.1：注入 runtime + scopeGuard
    const withRt = buildToolContextBase({
      ...base,
      runtime: {
        orgId: "org1",
        actor: { type: "USER", id: "u1", userId: "u1" },
        agent: { id: "qingyan-operator" },
        runId: "run-1",
        projectId: "p1",
        threadId: "th1",
      },
      scopeGuard: { orgId: "org1", principalUserId: "u1", projectId: "p1" },
    });
    ok(withRt.runtimeContext?.actor?.type === "USER", "runtimeContext 注入 actor");
    ok(!!withRt.runtimeContext?.traceId, "normalize 自动补 traceId");
    ok(withRt.runtimeContext?.rootRunId === "run-1", "无 parent 时 root=自身");
    ok(withRt.scopeGuard?.orgId === "org1" && withRt.scopeGuard.projectId === "p1", "scopeGuard 透传");
    ok(withRt.agentRunId === "run-1", "agentRunId 缺省回填 runtime.runId");

    // agentRunId 显式传入时优先
    const explicit = buildToolContextBase({
      ...base,
      agentRunId: "explicit-run",
      runtime: { runId: "run-1" },
    });
    ok(explicit.agentRunId === "explicit-run", "显式 agentRunId 优先于 runtime.runId");

    // Case F：流式/非流式 parity —— 两条路径共用 buildToolContextBase，
    // 这里验证同一 options 两次构造除自动生成的 traceId 外完全一致
    const a = buildToolContextBase({ ...base, runtime: { traceId: "tr_p", runId: "r1" } });
    const b = buildToolContextBase({ ...base, runtime: { traceId: "tr_p", runId: "r1" } });
    ok(JSON.stringify(a) === JSON.stringify(b), "parity：同输入 → 同 ToolExecutionContext");
  }

  console.log("── Security（Case C）：工具参数不能伪造 scope ──");
  {
    const guard = { orgId: "org-A", principalUserId: "u1", projectId: "proj-A" };
    const forgeOrg = runPreExecuteGuards({
      toolName: "t",
      ctx: { args: { orgId: "org-B" }, userId: "u1", orgId: "org-A", scopeGuard: guard } as ToolExecutionContext,
    });
    ok(!forgeOrg.ok && forgeOrg.code === "SCOPE_ORG_OVERRIDE", "伪造 orgId → 拒绝");

    const forgeProject = runPreExecuteGuards({
      toolName: "t",
      ctx: { args: { projectId: "proj-B" }, userId: "u1", orgId: "org-A", scopeGuard: guard } as ToolExecutionContext,
    });
    ok(!forgeProject.ok && forgeProject.code === "SCOPE_PROJECT_OVERRIDE", "伪造 projectId（读 Project B）→ 拒绝");

    // runtimeContext 不从 args 读取：即使模型在参数里塞 runtimeContext/role 也不影响服务端上下文
    const ctx = buildToolContextBase({
      systemPrompt: "x",
      messages: [],
      userId: "u1",
      orgId: "org-A",
      runtime: { orgId: "org-A", actor: { type: "USER", id: "u1" } },
    });
    const argsFromLlm = { runtimeContext: { orgId: "org-B", actor: { type: "SYSTEM" } }, role: "admin" };
    const merged = { args: argsFromLlm, ...ctx };
    ok(
      merged.runtimeContext?.orgId === "org-A" && merged.runtimeContext?.actor?.type === "USER",
      "LLM args 中的 runtimeContext/role 不覆盖服务端上下文（展开顺序保证）",
    );
  }

  console.log("── Approval（Case D）：审批草稿保留完整 correlation ──");
  {
    let captured: Record<string, unknown> | null = null;
    const tool: ToolDefinition = {
      name: "grader_add_internal_note",
      description: "t",
      domain: "project",
      parameters: { type: "object", properties: {} },
      risk: "l2_soft",
      allowRoles: "*",
      execute: async () => {
        throw new Error("绝不能执行");
      },
    };
    const ctx = {
      args: { note: "测试备注", projectId: "proj-A" },
      userId: "u1",
      orgId: "org-A",
      agentRunId: "run-1",
      scopeGuard: { orgId: "org-A", principalUserId: "u1", projectId: "proj-A" },
      runtimeContext: {
        orgId: "org-A",
        traceId: "tr_d",
        runId: "run-1",
        rootRunId: "run-0",
        parentRunId: "run-0",
        actor: { type: "AGENT" as const, id: "tender-compliance", userId: "u1" },
        agent: { id: "tender-compliance", role: "compliance" },
        owner: { type: "USER" as const, id: "owner1" },
        jobId: "JOB-1",
        taskId: "TASK-1",
        threadId: "th-1",
      },
    } as ToolExecutionContext;

    const res = await handleRequiresApproval({
      tool,
      ctx,
      deps: {
        createDraftFn: (async (input: Record<string, unknown>) => {
          captured = input;
          return { success: true, data: { pending_approval: true, actionId: "pa1" } };
        }) as never,
      },
    });

    ok(res.success === true, "审批闸返回草稿结果（未执行原工具）");
    const payload = captured ? ((captured as Record<string, unknown>).payload as Record<string, unknown>) : null;
    const corr = payload
      ? ((payload.metadata as Record<string, unknown>)?.runtimeCorrelation as Record<string, unknown>)
      : null;
    ok(corr?.traceId === "tr_d" && corr?.runId === "run-1" && corr?.rootRunId === "run-0", "correlation：trace/run 树完整");
    ok(corr?.actorType === "AGENT" && corr?.actorId === "tender-compliance", "correlation：actor");
    ok(corr?.agentId === "tender-compliance" && corr?.ownerId === "owner1", "correlation：agent/owner");
    ok(corr?.jobId === "JOB-1" && corr?.taskId === "TASK-1", "correlation：job/task");
    ok(captured !== null && (captured as Record<string, unknown>).threadId === "th-1", "createDraft 收到 threadId");
    ok(captured !== null && (captured as Record<string, unknown>).agentRunId === "run-1", "createDraft 收到 agentRunId");
  }

  console.log("── Audit：writeAuditLog correlation 合并 ──");
  {
    let created: Record<string, unknown> | null = null;
    const fakeClient = {
      auditLog: {
        create: async (input: { data: Record<string, unknown> }) => {
          created = input.data;
          return input.data;
        },
      },
    };
    await writeAuditLog(fakeClient as never, {
      userId: "u1",
      orgId: "org-A",
      action: "ai_generate",
      targetType: "runtime",
      afterData: { foo: 1 },
      correlation: { traceId: "tr_a", runId: "r1", agentId: "qingyan-operator" },
    });
    const after = created ? JSON.parse(String((created as Record<string, unknown>).afterData)) : null;
    ok(after?.foo === 1, "原 afterData 保留");
    ok(
      after?._runtimeCorrelation?.traceId === "tr_a" && after?._runtimeCorrelation?.agentId === "qingyan-operator",
      "correlation 合并进 afterData._runtimeCorrelation",
    );

    // legacy：不传 correlation → afterData 原样
    created = null;
    await writeAuditLog(fakeClient as never, {
      userId: "u1",
      action: "update",
      targetType: "task",
      afterData: { bar: 2 },
    });
    const after2 = created ? JSON.parse(String((created as Record<string, unknown>).afterData)) : null;
    ok(after2?.bar === 2 && !("_runtimeCorrelation" in (after2 ?? {})), "legacy：无 correlation 不改变 afterData");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
