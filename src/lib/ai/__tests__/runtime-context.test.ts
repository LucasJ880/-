/**
 * Phase 1.1 — AIRuntimeContext 契约测试
 * 运行：npx tsx src/lib/ai/__tests__/runtime-context.test.ts
 *
 * 覆盖：normalize / rootRunId 推导 / 子 Run 派生（Case E）/
 * AgentScopeContext 桥接（Case A）/ metadata 与遥测投影
 */

import {
  normalizeRuntimeContext,
  runtimeContextFromScope,
  deriveChildRunContext,
  runtimeContextToTelemetry,
  runtimeContextToRunMetadata,
  readRootRunIdFromUnknown,
  type AIRuntimeContext,
} from "../runtime-context";
import type { AgentScopeContext } from "@/lib/agent-scope/types";

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

console.log("── normalizeRuntimeContext ──");
{
  const n = normalizeRuntimeContext({
    orgId: " org1 ",
    runId: "run-1",
    actor: { type: "USER", id: "u1", userId: "u1" },
  })!;
  ok(n.orgId === "org1", "trim orgId");
  ok(!!n.traceId && n.traceId.startsWith("tr_"), "缺省生成 traceId");
  ok(n.rootRunId === "run-1", "无 parent 时 rootRunId = 自身 runId");

  const n2 = normalizeRuntimeContext({
    runId: "run-2",
    parentRunId: "run-1",
  })!;
  ok(n2.rootRunId === undefined, "有 parent 而未知 root 时不猜测 rootRunId");

  const n3 = normalizeRuntimeContext({
    runId: "run-3",
    parentRunId: "run-2",
    rootRunId: "run-1",
    traceId: "tr_fixed",
  })!;
  ok(n3.rootRunId === "run-1" && n3.traceId === "tr_fixed", "显式 root/trace 保留");

  ok(normalizeRuntimeContext(undefined) === undefined, "undefined 透传（legacy 兼容）");
}

console.log("── deriveChildRunContext（Case E：Root → Child A → Child B）──");
{
  const root = normalizeRuntimeContext({
    orgId: "org1",
    runId: "RUN-ROOT",
    traceId: "tr_root",
    actor: { type: "USER", id: "lucas", userId: "lucas" },
    jobId: "JOB-001",
    taskId: "TASK-01",
    projectId: "W0103",
  })!;
  const childA = deriveChildRunContext(root, {
    runId: "RUN-A",
    actor: { type: "AGENT", id: "requirement-agent", userId: "lucas" },
    agent: { id: "requirement-agent", role: "requirement" },
    owner: { type: "USER", id: "lucas" },
  });
  const childB = deriveChildRunContext(childA, {
    runId: "RUN-B",
    agent: { id: "compliance-agent", role: "tender-compliance" },
  });

  ok(childA.parentRunId === "RUN-ROOT" && childA.rootRunId === "RUN-ROOT", "child A parent/root 正确");
  ok(childB.parentRunId === "RUN-A" && childB.rootRunId === "RUN-ROOT", "child B parent=A, root=ROOT");
  ok(childB.traceId === "tr_root", "traceId 全链继承");
  ok(childB.jobId === "JOB-001" && childB.taskId === "TASK-01", "job/task correlation 继承");
  ok(childB.projectId === "W0103", "业务实体继承");
  ok(childA.actor?.type === "AGENT" && childA.agent?.id === "requirement-agent", "Actor 与 Agent 可区分");
  ok(childA.owner?.id === "lucas" && childA.owner?.type === "USER", "Owner 可表达且独立于 actor");
  ok(childB.agent?.id === "compliance-agent" && childB.actor?.type === "AGENT", "child B 覆盖 agent、继承 actor");
}

console.log("── runtimeContextFromScope（Case A：Human AI Chat）──");
{
  const scope: AgentScopeContext = {
    principalUserId: "u1",
    principalPlatformRole: "sales",
    orgId: "org1",
    orgRole: "org_member",
    isPlatformAdmin: false,
    hasMembership: true,
    projectId: "p1",
    threadId: "th1",
    channel: "web_chat",
    traceId: "tr_scope",
  };
  const rt = runtimeContextFromScope(scope);
  ok(rt.actor?.type === "USER" && rt.actor.id === "u1", "actor = USER");
  ok(rt.orgId === "org1" && rt.projectId === "p1", "org/project 桥接");
  ok(rt.traceId === "tr_scope", "traceId 复用 scope（不重复生成）");
  ok(rt.channel === "web_chat" && rt.threadId === "th1", "channel/thread 桥接");
}

console.log("── metadata / telemetry 投影 ──");
{
  const ctx: AIRuntimeContext = {
    orgId: "org1",
    runId: "r1",
    rootRunId: "r0",
    parentRunId: "r0",
    traceId: "tr_x",
    actor: { type: "AGENT", id: "tender-compliance", userId: "lucas" },
    agent: { id: "tender-compliance", role: "compliance" },
    owner: { type: "USER", id: "owner1" },
    jobId: "J1",
    taskId: "T1",
    customerId: "c1",
  };
  const meta = runtimeContextToRunMetadata(ctx);
  ok(meta.rootRunId === "r0" && meta.jobId === "J1" && meta.taskId === "T1", "metadata 含 root/job/task");
  ok(meta.actorType === "AGENT" && meta.actorId === "tender-compliance" && meta.actorUserId === "lucas", "metadata 含 actor 三元组");
  ok(meta.ownerType === "USER" && meta.ownerId === "owner1", "metadata 含 owner");
  ok(!("projectId" in meta), "trace 已管的字段不重复写（projectId 由 TraceContext 负责）");
  ok(runtimeContextToRunMetadata(undefined) && Object.keys(runtimeContextToRunMetadata(undefined)).length === 0, "undefined → 空对象（legacy）");

  const tel = runtimeContextToTelemetry(ctx);
  ok(tel.traceId === "tr_x" && tel.runId === "r1" && tel.rootRunId === "r0", "telemetry 含 trace/run 树");
  ok(tel.actorType === "AGENT" && tel.agentId === "tender-compliance", "telemetry 含 actor/agent");

  ok(readRootRunIdFromUnknown({ rootRunId: "r0" }) === "r0", "readRootRunIdFromUnknown 正常");
  ok(readRootRunIdFromUnknown({ rootRunId: 42 }) === null, "非字符串 rootRunId → null");
  ok(readRootRunIdFromUnknown(null) === null, "null metadata → null");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
