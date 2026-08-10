/**
 * Tender/Project Security P0 — AgentTask execute/cancel 路由级可执行测试。
 * 运行：npx tsx src/app/api/agent/tasks/__tests__/route-exec.test.ts
 *
 * 驱动 execute/cancel 路由实际委托的守卫编排 runGuardedTaskMutation（生产同一函数），
 * 注入带调用计数的假 flow-runner + 假授权，断言：
 *   1) execute 未授权 → 拦截 + executeFlowTask 调用数 = 0
 *   2) cancel  未授权 → 拦截 + cancelFlowTask 调用数 = 0
 *   3) execute 已授权 → flow runner 恰好一次
 *   4) cancel  已授权 → flow runner 恰好一次
 *   5) 跨 org taskId（授权 helper 返回 403/404）→ 拦截 + 零 flow-runner 调用
 *   6) 拒绝前后 AgentTask 状态不变（模拟状态存储）
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runGuardedTaskMutation } from "@/lib/agent-tasks/guarded-mutation";

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

const fakeRequest = () => new Request("https://x.test/api/agent/tasks/t1/execute", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
}) as unknown as NextRequest;

// —— 模拟 flow-runner 计数器 ——
function makeCounters() {
  return { execute: 0, cancel: 0 };
}

// —— 模拟一个可变的 AgentTask 状态存储（item 6）——
type TaskStore = { id: string; projectId: string; status: string };

/** 已授权：模拟 requireProjectManageAccess 放行（返回 access context，非 NextResponse） */
const allow = async () => ({ user: { id: "u1", role: "manager" }, project: { id: "p1" } });
/** 未授权（同 org 无管理权）：返回 403 */
const deny403 = async () => NextResponse.json({ error: "无权修改该项目" }, { status: 403 });
/** 跨 org / 不存在：requireProject*Access 对未分发/缺失项目返回 404 */
const deny404 = async () => NextResponse.json({ error: "项目不存在" }, { status: 404 });

async function main() {
console.log("security-p0 agent-task route-exec");

// 1) execute 未授权 → 拦截 + executeFlowTask 计数 0
{
  const c = makeCounters();
  const store: TaskStore = { id: "t1", projectId: "p1", status: "running" };
  const before = store.status;
  const res = await runGuardedTaskMutation({
    request: fakeRequest(),
    taskId: "t1",
    loadTaskProjectId: async () => store.projectId,
    authorize: deny403,
    onAuthorized: async () => {
      c.execute++;
      store.status = "executing"; // 若被错误调用，状态会变
      return NextResponse.json({ ok: true });
    },
  });
  ok(res.status === 403, "execute 未授权 → 403 拦截");
  ok(c.execute === 0, "execute 未授权 → executeFlowTask 调用数 = 0");
  ok(store.status === before, "execute 未授权 → AgentTask 状态不变（item 6）");
}

// 2) cancel 未授权 → 拦截 + cancelFlowTask 计数 0
{
  const c = makeCounters();
  const store: TaskStore = { id: "t1", projectId: "p1", status: "running" };
  const before = store.status;
  const res = await runGuardedTaskMutation({
    request: fakeRequest(),
    taskId: "t1",
    loadTaskProjectId: async () => store.projectId,
    authorize: deny403,
    onAuthorized: async () => {
      c.cancel++;
      store.status = "cancelled";
      return NextResponse.json({ success: true });
    },
  });
  ok(res.status === 403, "cancel 未授权 → 403 拦截");
  ok(c.cancel === 0, "cancel 未授权 → cancelFlowTask 调用数 = 0");
  ok(store.status === before, "cancel 未授权 → AgentTask 状态不变（item 6）");
}

// 3) execute 已授权 → flow runner 恰好一次
{
  const c = makeCounters();
  const res = await runGuardedTaskMutation({
    request: fakeRequest(),
    taskId: "t1",
    loadTaskProjectId: async () => "p1",
    authorize: allow,
    onAuthorized: async () => {
      c.execute++;
      return NextResponse.json({ ok: true });
    },
  });
  ok(res.status === 200, "execute 已授权 → 200");
  ok(c.execute === 1, "execute 已授权 → flow runner 恰好一次");
}

// 4) cancel 已授权 → flow runner 恰好一次
{
  const c = makeCounters();
  const res = await runGuardedTaskMutation({
    request: fakeRequest(),
    taskId: "t1",
    loadTaskProjectId: async () => "p1",
    authorize: allow,
    onAuthorized: async () => {
      c.cancel++;
      return NextResponse.json({ success: true });
    },
  });
  ok(res.status === 200, "cancel 已授权 → 200");
  ok(c.cancel === 1, "cancel 已授权 → flow runner 恰好一次");
}

// 5) 跨 org taskId（授权 helper 判定 404/403）→ 拦截 + 零 flow-runner 调用
{
  const c = makeCounters();
  const res = await runGuardedTaskMutation({
    request: fakeRequest(),
    taskId: "t-otherorg",
    loadTaskProjectId: async () => "p-otherorg", // 任务存在，但属于别的 org
    authorize: deny404, // requireProject*Access 对不可见项目返回 404（隐藏存在性）
    onAuthorized: async () => {
      c.execute++;
      return NextResponse.json({ ok: true });
    },
  });
  ok(res.status === 404, "跨 org taskId → 404 拦截");
  ok(c.execute === 0, "跨 org taskId → 零 flow-runner 调用");
}

// 附加：任务不存在 → 404，且 onAuthorized 不调用（authorize 也不调用）
{
  let authorizeCalled = 0;
  let actionCalled = 0;
  const res = await runGuardedTaskMutation({
    request: fakeRequest(),
    taskId: "missing",
    loadTaskProjectId: async () => null,
    authorize: async () => {
      authorizeCalled++;
      return NextResponse.json({}, { status: 200 });
    },
    onAuthorized: async () => {
      actionCalled++;
      return NextResponse.json({ ok: true });
    },
  });
  ok(res.status === 404, "任务不存在 → 404");
  ok(authorizeCalled === 0, "任务不存在 → 不调用 authorize");
  ok(actionCalled === 0, "任务不存在 → 不调用 flow-runner");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
