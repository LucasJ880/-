/**
 * Mention Gateway M1 — Final Review Fixes（PR #154）
 * 运行：npx tsx src/lib/mention-gateway/__tests__/m1-final-review.test.ts
 *
 * B1 authenticated idempotency boundary：
 *   - 未通过 identity / caller verification 的请求不得污染进程 dedupe 状态
 *   - dedupe 键含已验证 org + principal 边界（provider:orgId:userId:channelId:eventId）
 *   - AgentRun.userMessageId 的 org 作用域幂等不变
 * B2 terminal lifecycle ordering：
 *   - agent.output < response.completed < run.completed
 *   - 投递失败：response.failed 存在、run.completed 不存在、completeRun 未被调用、Run 终态 = failed
 *   - completeRun 失败不得静默：RUN_FINALIZE_FAILED + delivered=true + best-effort failRun
 *   - canonical 事件流中终态 run 事件绝不早于 response 生命周期结束
 */

import { DuplicateEventGuard, buildMentionDedupeKey, handleMentionEvent } from "../handle";
import {
  ORG_A,
  ORG_B,
  USER_A,
  USER_B,
  TEST_ENV,
  baseRaw,
  called,
  finish,
  isCode,
  makeFakeDeps,
  ok,
  terminalAfterResponseLifecycle,
} from "./helpers";

type Timeline = { eventType: string; payload?: Record<string, unknown> }[];
const idx = (events: Timeline, type: string) => events.findIndex((e) => e.eventType === type);
const lastIdx = (events: Timeline, type: string) => {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].eventType === type) return i;
  return -1;
};

async function main() {
  let b1PrincipalIsolation = true;
  let b1FailedIdentityCannotPoison = true;
  let b1CrossTenantIsolation = true;
  let b2DeliveryBeforeTerminal = true;
  let b2DeliveryFailureNotCompleted = true;
  let b2EventOrdering = true;
  const timelines: Timeline[] = [];

  console.log("B1-1 dedupe 键含已验证 org + principal 边界");
  {
    const event = {
      provider: "mock" as const,
      providerTenantId: "mock",
      eventId: "evt-1",
      channel: { id: "mock-project-a", type: "dm" as const },
      messageId: "m1",
      externalUserId: "mock-user-a",
      text: "hi",
      mentionedAgent: true,
      timestamp: "2026-08-22T12:00:00Z",
    };
    const key = buildMentionDedupeKey(event, { orgId: ORG_A, userId: USER_A });
    ok(key === "mock:mock:org_a:user_a:mock-project-a:evt-1", `key = ${key}`);
    ok(
      buildMentionDedupeKey(event, { orgId: ORG_B, userId: USER_B }) !== key,
      "同一 eventId 在不同 org/principal 下得到不同键",
    );
    if (key !== "mock:mock:org_a:user_a:mock-project-a:evt-1") b1PrincipalIsolation = false;
  }

  console.log("B1-2 失败的 caller verification 不得预占他人 eventId（User A 冒充 User B → DENY；User B 随后正常执行）");
  {
    const guard = new DuplicateEventGuard();
    const { deps, adapter, calls } = makeFakeDeps({ duplicateGuard: guard });
    const attack = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-b", channelId: "mock-project-b", eventId: "evt-shared", messageId: "msg-shared" }),
      adapter,
      deps,
      env: TEST_ENV,
      caller: { userId: USER_A, isPlatformAdmin: false },
    });
    ok(isCode(attack, "IDENTITY_OR_MEMBERSHIP_DENIED") && attack.stage === "identity", "User A 以 User B 外部身份发起 → caller_mismatch DENY");
    ok(guard.size() === 0, "被拒请求未写入任何 dedupe 状态（guard.size = 0）");
    ok(called(calls, "createRun") === 0 && called(calls, "runAgent") === 0, "被拒请求未建 Run / 未调模型");
    if (guard.size() !== 0) b1FailedIdentityCannotPoison = false;

    const legit = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-b", channelId: "mock-project-b", eventId: "evt-shared", messageId: "msg-shared" }),
      adapter,
      deps,
      env: TEST_ENV,
      caller: { userId: USER_B, isPlatformAdmin: false },
    });
    ok(legit.ok && legit.status === "completed", "User B 合法调用同一 eventId → 不是 DUPLICATE，正常执行");
    ok(called(calls, "runAgent") === 1 && adapter.outbox.length === 1, "runAgent ×1，DM ×1（发给 User B 的外部身份）");
    ok(adapter.outbox[0]?.target.externalUserId === "mock-user-b", "回复只发给合法 initiating user");
    ok(guard.size() === 1 && guard.has(`mock:mock:${ORG_B}:${USER_B}:mock-project-b:evt-shared`), "dedupe 键只在 User B 通过校验后写入，且带 org/principal");
    if (!legit.ok) b1FailedIdentityCannotPoison = false;

    const replay = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-b", channelId: "mock-project-b", eventId: "evt-shared", messageId: "msg-shared" }),
      adapter,
      deps,
      env: TEST_ENV,
      caller: { userId: USER_B, isPlatformAdmin: false },
    });
    ok(isCode(replay, "DUPLICATE_EVENT"), "User B 重放同一 eventId → DUPLICATE_EVENT（同 principal 才去重）");
    ok(called(calls, "runAgent") === 1, "重放未再次执行");
  }

  console.log("B1-3 其它身份失败路径同样不污染 dedupe（未知外部用户 / 无 membership / 账号停用）");
  {
    const guard = new DuplicateEventGuard();
    const { deps, adapter } = makeFakeDeps({ duplicateGuard: guard });
    for (const externalUserId of ["mock-user-unknown", "mock-user-no-org", "mock-user-disabled", "mock-user-inactive-member"]) {
      const r = await handleMentionEvent({
        raw: baseRaw({ externalUserId, eventId: "evt-poison" }),
        adapter,
        deps,
        env: TEST_ENV,
      });
      ok(isCode(r, "IDENTITY_OR_MEMBERSHIP_DENIED"), `${externalUserId} → DENY`);
    }
    ok(guard.size() === 0, "四次身份失败后 dedupe 状态仍为空");
    if (guard.size() !== 0) b1FailedIdentityCannotPoison = false;
    const legit = await handleMentionEvent({ raw: baseRaw({ eventId: "evt-poison" }), adapter, deps, env: TEST_ENV });
    ok(legit.ok, "合法用户随后使用同一 eventId 正常执行");
  }

  console.log("B1-4 跨租户 eventId 隔离：Org A evt-1 与 Org B evt-1 互不干扰");
  {
    const guard = new DuplicateEventGuard();
    const { deps, adapter, calls } = makeFakeDeps({ duplicateGuard: guard });
    const a = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-a", channelId: "mock-project-a", eventId: "evt-1", messageId: "m-a" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    const b = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-b", channelId: "mock-project-b", eventId: "evt-1", messageId: "m-b" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(a.ok && b.ok, "Org A / Org B 同 eventId 均正常执行");
    ok(called(calls, "runAgent") === 2 && adapter.outbox.length === 2, "runAgent ×2，DM ×2");
    ok(guard.size() === 2, "两个独立 dedupe 键");
    const aAgain = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-a", channelId: "mock-project-a", eventId: "evt-1", messageId: "m-a" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(isCode(aAgain, "DUPLICATE_EVENT"), "Org A 重放自己的 evt-1 → DUPLICATE（仅同 principal 去重）");
    if (!(a.ok && b.ok && called(calls, "runAgent") === 2)) b1CrossTenantIsolation = false;
    // 同一用户、不同频道、同 eventId：键含 channelId → 不互相误判
    const aOtherChannel = await handleMentionEvent({
      raw: baseRaw({ externalUserId: "mock-user-a", channelId: "mock-sales-a", eventId: "evt-1", messageId: "m-a2" }),
      adapter,
      deps,
      env: TEST_ENV,
    });
    ok(aOtherChannel.ok && called(calls, "runAgent") === 3, "同用户、不同频道、同 eventId → 不同键，正常执行（runAgent ×3）");
  }

  console.log("B1-5 AgentRun.userMessageId 的 org 作用域幂等保持不变");
  {
    const { deps, adapter, calls } = makeFakeDeps();
    await handleMentionEvent({ raw: baseRaw({ eventId: "evt-x", messageId: "msg-x" }), adapter, deps, env: TEST_ENV });
    const runInput = calls.find((c) => c.name === "createRun")?.args[0] as { userMessageId: string; orgId: string };
    ok(runInput.userMessageId === "mock:mock:mock-project-a:msg-x" && runInput.orgId === ORG_A, "userMessageId = <provider>:<providerTenantId>:<channelId>:<messageId>，与 orgId 一并传给 createAgentRun");
    const { deps: deps2, adapter: adapter2, calls: calls2 } = makeFakeDeps({ createRunReused: () => true });
    const r = await handleMentionEvent({ raw: baseRaw({ eventId: "evt-y", messageId: "msg-x" }), adapter: adapter2, deps: deps2, env: TEST_ENV });
    ok(isCode(r, "DUPLICATE_EVENT") && r.runId === "run-reused", "createAgentRun 返回 reused → DUPLICATE_EVENT（DB 层幂等）");
    ok(called(calls2, "runAgent") === 0, "未执行");
  }

  console.log("B2-1 SUCCESS：agent.output < response.completed < run.completed；投递先于终态化");
  {
    const { deps, adapter, calls, events } = makeFakeDeps();
    const origSend = adapter.sendMessage.bind(adapter);
    adapter.sendMessage = async (target, text) => {
      calls.push({ name: "sendMessage", args: [target.externalUserId] });
      return origSend(target, text);
    };
    const r = await handleMentionEvent({ raw: baseRaw(), adapter, deps, env: TEST_ENV });
    ok(r.ok && r.delivered, "completed + delivered");
    const iOut = idx(events, "agent.output");
    const iRc = idx(events, "response.completed");
    const iRunC = idx(events, "run.completed");
    ok(iOut >= 0 && iRc > iOut && iRunC > iRc, `agent.output(${iOut}) < response.completed(${iRc}) < run.completed(${iRunC})`);
    const order = calls.map((c) => c.name);
    ok(order.indexOf("sendMessage") < order.indexOf("completeRun"), "adapter.sendMessage 先于 completeRun");
    ok(called(calls, "completeRun") === 1 && called(calls, "failRun") === 0, "completeRun ×1 / failRun ×0");
    ok(!events.some((e) => e.eventType === "run.failed"), "无 run.failed");
    const inv = terminalAfterResponseLifecycle(events);
    ok(inv.ok, `终态事件不早于 response 生命周期结束：${inv.detail}`);
    timelines.push(events);
    if (!(iOut >= 0 && iRc > iOut && iRunC > iRc && order.indexOf("sendMessage") < order.indexOf("completeRun"))) {
      b2DeliveryBeforeTerminal = false;
    }
    if (!inv.ok) b2EventOrdering = false;
  }

  console.log("B2-2 DELIVERY FAILURE：response.failed 存在、run.completed 不存在、completeRun 未调用、Run 终态 = failed");
  {
    const { deps, adapter, calls, events } = makeFakeDeps();
    adapter.failNextSend = "mock transport down";
    const r = await handleMentionEvent({ raw: baseRaw(), adapter, deps, env: TEST_ENV });
    ok(!r.ok && r.code === "DELIVERY_FAILED" && r.stage === "deliver" && r.runId === "run-1" && r.delivered === false, "DELIVERY_FAILED（runId, delivered=false）");
    ok(idx(events, "response.failed") >= 0, "response.failed 存在");
    ok(idx(events, "run.completed") === -1, "run.completed 不存在");
    ok(called(calls, "completeRun") === 0, "completeRun 未被调用");
    ok(called(calls, "failRun") === 1 && idx(events, "run.failed") > idx(events, "response.failed"), "failRun ×1，且 run.failed 晚于 response.failed");
    const failArgs = calls.find((c) => c.name === "failRun")?.args[2] as { code: string; message: string };
    ok(/^delivery_failed/.test(failArgs.message) && !!failArgs.code, `Run 终态 failed（code=${failArgs.code}, message 前缀 delivery_failed）`);
    ok(idx(events, "agent.output") >= 0 && idx(events, "agent.output") < idx(events, "response.failed"), "agent.output 仍先于 response.failed（生成成功但投递失败）");
    const inv = terminalAfterResponseLifecycle(events);
    ok(inv.ok, `终态事件不早于 response 生命周期结束：${inv.detail}`);
    timelines.push(events);
    if (!(idx(events, "run.completed") === -1 && called(calls, "completeRun") === 0 && called(calls, "failRun") === 1)) {
      b2DeliveryFailureNotCompleted = false;
    }
    if (!inv.ok) b2EventOrdering = false;
  }

  console.log("B2-3 DELIVERY THROWS：适配器抛异常与返回失败同语义");
  {
    const { deps, adapter, calls, events } = makeFakeDeps();
    adapter.sendMessage = async () => {
      throw new Error("socket hang up");
    };
    const r = await handleMentionEvent({ raw: baseRaw(), adapter, deps, env: TEST_ENV });
    ok(!r.ok && r.code === "DELIVERY_FAILED" && r.delivered === false, "DELIVERY_FAILED");
    ok(called(calls, "completeRun") === 0 && called(calls, "failRun") === 1 && idx(events, "run.completed") === -1, "未 completeRun；failRun ×1；无 run.completed");
    ok(!r.ok && !/socket|hang up/.test(r.message), "对外文案不泄漏内部错误");
    const inv = terminalAfterResponseLifecycle(events);
    ok(inv.ok, `不变量：${inv.detail}`);
    timelines.push(events);
    if (called(calls, "completeRun") !== 0) b2DeliveryFailureNotCompleted = false;
    if (!inv.ok) b2EventOrdering = false;
  }

  console.log("B2-4 FINALIZE FAILURE：completeRun 抛错不得静默返回成功");
  {
    const { deps, adapter, calls, events } = makeFakeDeps({ completeRunThrows: true });
    const r = await handleMentionEvent({ raw: baseRaw(), adapter, deps, env: TEST_ENV });
    ok(!r.ok && r.status === "failed" && r.code === "RUN_FINALIZE_FAILED" && r.stage === "complete", "RUN_FINALIZE_FAILED（status=failed, stage=complete）");
    ok(!r.ok && r.runId === "run-1" && r.delivered === true, "runId 可追踪；delivered=true（回复已送达）");
    ok(adapter.outbox.length === 1, "用户确实收到了回复（投递在终态化之前）");
    ok(idx(events, "response.completed") >= 0 && idx(events, "run.completed") === -1, "response.completed 存在；run.completed 不存在");
    ok(called(calls, "completeRun") === 1 && called(calls, "failRun") === 1, "completeRun 尝试 ×1 → best-effort failRun ×1（Run 终态 failed，可追踪）");
    const failArgs = calls.find((c) => c.name === "failRun")?.args[2] as { code: string; message: string };
    ok(failArgs.code === "db_error" && /^finalize_failed_after_delivery/.test(failArgs.message), "failRun(db_error, finalize_failed_after_delivery…)");
    ok(!r.ok && !/simulated/.test(r.message), "对外文案不泄漏内部错误");
    const inv = terminalAfterResponseLifecycle(events);
    ok(inv.ok, `不变量：${inv.detail}`);
    timelines.push(events);
    if (!inv.ok) b2EventOrdering = false;
  }

  console.log("B2-5 GENERATION FAILURE：response.failed < run.failed；无 response.completed；completeRun 未调用");
  {
    const { deps, adapter, calls, events } = makeFakeDeps({
      runAgent: async () => {
        throw new Error("model timeout");
      },
    });
    const r = await handleMentionEvent({ raw: baseRaw(), adapter, deps, env: TEST_ENV });
    ok(!r.ok && r.code === "RUN_FAILED" && r.delivered === false, "RUN_FAILED, delivered=false");
    ok(idx(events, "response.failed") >= 0 && idx(events, "run.failed") > idx(events, "response.failed"), "response.failed < run.failed");
    ok(idx(events, "response.completed") === -1 && idx(events, "agent.output") === -1, "无 response.completed / agent.output");
    ok(called(calls, "completeRun") === 0, "completeRun 未调用");
    ok(adapter.outbox.length === 1, "仅一条安全失败通知（不属于 response 生命周期）");
    const inv = terminalAfterResponseLifecycle(events);
    ok(inv.ok, `不变量：${inv.detail}`);
    timelines.push(events);
    if (!inv.ok) b2EventOrdering = false;
  }

  console.log("B2-6 canonical 事件流全量不变量（所有已捕获时间线）");
  {
    for (let i = 0; i < timelines.length; i++) {
      const events = timelines[i];
      const inv = terminalAfterResponseLifecycle(events);
      ok(inv.ok, `timeline#${i + 1}: ${inv.detail}`);
      const terminals = events.filter((e) => e.eventType === "run.completed" || e.eventType === "run.failed");
      ok(terminals.length <= 1, `timeline#${i + 1}: 至多一个终态 run 事件`);
      const hasCompleted = idx(events, "run.completed") >= 0;
      const hasRespCompleted = idx(events, "response.completed") >= 0;
      ok(!hasCompleted || hasRespCompleted, `timeline#${i + 1}: run.completed ⇒ response.completed 已存在且更早`);
      if (!inv.ok || terminals.length > 1 || (hasCompleted && lastIdx(events, "response.completed") > idx(events, "run.completed"))) {
        b2EventOrdering = false;
      }
    }
  }

  console.log("");
  console.log(`B1_IDEMPOTENCY_PRINCIPAL_ISOLATION = ${b1PrincipalIsolation ? "PASS" : "FAIL"}`);
  console.log(`B1_FAILED_IDENTITY_CANNOT_POISON_DEDUPE = ${b1FailedIdentityCannotPoison ? "PASS" : "FAIL"}`);
  console.log(`B1_CROSS_TENANT_EVENT_ID_ISOLATION = ${b1CrossTenantIsolation ? "PASS" : "FAIL"}`);
  console.log(`B2_DELIVERY_BEFORE_TERMINAL = ${b2DeliveryBeforeTerminal ? "PASS" : "FAIL"}`);
  console.log(`B2_DELIVERY_FAILURE_NOT_COMPLETED = ${b2DeliveryFailureNotCompleted ? "PASS" : "FAIL"}`);
  console.log(`B2_EVENT_ORDERING = ${b2EventOrdering ? "PASS" : "FAIL"}`);
  if (!(b1PrincipalIsolation && b1FailedIdentityCannotPoison && b1CrossTenantIsolation && b2DeliveryBeforeTerminal && b2DeliveryFailureNotCompleted && b2EventOrdering)) {
    console.error("  ✗ Final Review 断言未全部通过");
    process.exit(1);
  }
  finish("M1 Final Review Fixes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
