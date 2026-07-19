/**
 * Agent Runtime Phase-1 纯逻辑测试（无模型调用）
 * 运行：npx tsx src/lib/agent-runtime/__tests__/runtime.test.ts
 */

import {
  matchStatusCommand,
  matchCancelRunCommand,
} from "../deterministic";
import { buildAckText } from "../ack";
import { createAgentPlanFromRules } from "../plan";
import { classifyWechatGraderIntent } from "@/lib/ai-grader/wechat-intent-classifier";
import { ACTIVE_RUN_STATUSES } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// 1) /status、状态 — 确定性匹配
ok(matchStatusCommand("状态"), "状态命令");
ok(matchStatusCommand("/status"), "/status 命令");
ok(matchStatusCommand("进度"), "进度命令");
ok(!matchStatusCommand("帮我看看项目状态如何"), "长句不误匹配状态");

// 2) /cancel、停止 — 确定性匹配
ok(matchCancelRunCommand("停止").match, "停止命令");
ok(matchCancelRunCommand("/cancel").match, "cancel 命令");
ok(matchCancelRunCommand("取消").match, "取消命令");
ok(matchCancelRunCommand("取消").preferPendingIfNoRun, "取消在无 Run 时交给 Pending");
ok(!matchCancelRunCommand("停止").preferPendingIfNoRun, "停止不交给 Pending");
ok(!matchCancelRunCommand("请帮我取消这个报价").match, "长句不误匹配取消");

// 3) ACK 文案固定、不调用模型（纯函数）
ok(buildAckText({ content: "你好" }) === "收到，我正在处理。", "普通 ACK");
ok(
  buildAckText({ content: "查一下项目进度" }).includes("项目"),
  "项目 ACK",
);
ok(
  buildAckText({ content: "帮我整理一下邮件" }).includes("邮件"),
  "邮件 ACK",
);
ok(
  buildAckText({ content: "x".repeat(100) }).includes("开始处理"),
  "复杂任务 ACK",
);

// 4) 普通闲聊不触发 Grader（规则意图 = CHAT）
{
  const intent = classifyWechatGraderIntent("今天天气怎么样");
  ok(intent.intent === "CHAT", "普通消息 intent=CHAT，不跑四个 Grader");
}
{
  const intent = classifyWechatGraderIntent("帮我记一下明天开会");
  ok(intent.intent === "CHAT", "普通任务消息不无条件跑 Grader");
}

// 5) PendingAction：普通「发送」不是纯数字确认
{
  const intent = classifyWechatGraderIntent("请帮我发送这封邮件");
  ok(
    intent.intent !== "CONFIRM_PENDING_ACTION",
    "含「发送」的普通文本不走 Pending 确认意图",
  );
}
{
  const intent = classifyWechatGraderIntent("1");
  ok(
    intent.intent === "CONFIRM_PENDING_ACTION",
    "纯数字走 Pending 确认意图（执行仍校验批次与 org）",
  );
}

// 6) AgentPlan 规则生成不调模型
{
  const plan = createAgentPlanFromRules({
    content: "这个项目进度怎样",
    session: { currentProjectId: "p1" },
  });
  ok(plan.intent === "project", "plan.intent=project");
  ok(plan.entities.projectId === "p1", "plan 带 session 实体");
  ok(plan.tools.length === 0, "规则计划不预置工具（由主模型决定）");
}

// 7) 活动状态集合包含可取消状态
ok(ACTIVE_RUN_STATUSES.includes("running"), "running 可取消");
ok(ACTIVE_RUN_STATUSES.includes("acknowledged"), "acknowledged 可取消");
ok(!ACTIVE_RUN_STATUSES.includes("completed"), "completed 不可取消");
ok(!ACTIVE_RUN_STATUSES.includes("cancelled"), "cancelled 不可再取消");

// ── 可选：有 DATABASE_URL 时测 Session / Run 幂等与 org 隔离 ──
async function dbTests() {
  if (!process.env.DATABASE_URL) {
    console.log("  · 跳过 DB 集成（无 DATABASE_URL）");
    return;
  }

  const { db } = await import("@/lib/db");
  const {
    getOrCreateAgentSession,
    createAgentRun,
    appendAgentRunEvent,
    completeAgentRun,
    failAgentRun,
    cancelAgentRun,
    updateAgentSessionResponseId,
    isAgentRunCancelled,
  } = await import("../index");

  const orgA = `test_org_a_${Date.now()}`;
  const orgB = `test_org_b_${Date.now()}`;
  const userId = `test_user_${Date.now()}`;

  try {
    const s1 = await getOrCreateAgentSession({
      orgId: orgA,
      userId,
      channel: "wecom",
      channelUserId: "wx_u1",
    });
    const s2 = await getOrCreateAgentSession({
      orgId: orgA,
      userId,
      channel: "wecom",
      channelUserId: "wx_u1",
    });
    ok(s1.id === s2.id, "同微信用户复用活动 Session");

    const sOtherOrg = await getOrCreateAgentSession({
      orgId: orgB,
      userId,
      channel: "wecom",
      channelUserId: "wx_u1",
    });
    ok(sOtherOrg.id !== s1.id, "不同 orgId 不共享 Session");

    const msgId = `msg_${Date.now()}`;
    const r1 = await createAgentRun({
      orgId: orgA,
      sessionId: s1.id,
      userMessageId: msgId,
    });
    const r2 = await createAgentRun({
      orgId: orgA,
      sessionId: s1.id,
      userMessageId: msgId,
    });
    ok(r1.reused === false, "首次创建 Run");
    ok(r2.reused === true && r2.run.id === r1.run.id, "重复消息不创建两次 Run");

    const e1 = await appendAgentRunEvent({
      orgId: orgA,
      runId: r1.run.id,
      eventType: "ack.sent",
      title: "ack",
    });
    const e2 = await appendAgentRunEvent({
      orgId: orgA,
      runId: r1.run.id,
      eventType: "planning.started",
      title: "plan",
    });
    ok(
      !!e1 && !!e2 && e1.sequence !== e2.sequence,
      "Event sequence 不重复",
    );

    await updateAgentSessionResponseId({
      orgId: orgA,
      sessionId: s1.id,
      lastResponseId: "resp_test_1",
    });
    const refreshed = await db.agentSession.findFirst({
      where: { id: s1.id, orgId: orgA },
    });
    ok(refreshed?.lastResponseId === "resp_test_1", "lastResponseId 可更新");

    await completeAgentRun(orgA, r1.run.id);
    const done = await db.agentRun.findFirst({
      where: { id: r1.run.id, orgId: orgA },
    });
    ok(done?.status === "completed", "成功时 status=completed");

    const failRun = await createAgentRun({
      orgId: orgA,
      sessionId: s1.id,
      userMessageId: `msg_fail_${Date.now()}`,
    });
    await failAgentRun(orgA, failRun.run.id, {
      code: "model_failed",
      message: "boom",
    });
    const failed = await db.agentRun.findFirst({
      where: { id: failRun.run.id, orgId: orgA },
    });
    ok(failed?.status === "failed", "模型失败 status=failed");
    ok(failed?.errorCode === "model_failed", "工具/模型失败保存 errorCode");

    const cancelTarget = await createAgentRun({
      orgId: orgA,
      sessionId: s1.id,
      userMessageId: `msg_cancel_${Date.now()}`,
    });
    await cancelAgentRun(orgA, cancelTarget.run.id);
    ok(
      await isAgentRunCancelled(orgA, cancelTarget.run.id),
      "取消后 isAgentRunCancelled=true",
    );
    // 取消后不应再 complete 覆盖
    await completeAgentRun(orgA, cancelTarget.run.id);
    const still = await db.agentRun.findFirst({
      where: { id: cancelTarget.run.id },
    });
    ok(still?.status === "cancelled", "取消后不继续变为 completed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AgentSession") && msg.includes("does not exist")) {
      console.log("  · 跳过 DB 集成（请先 prisma migrate deploy）");
      return;
    }
    throw e;
  } finally {
    // 清理测试数据
    await db.agentRunEvent
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
    await db.agentRun
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
    await db.agentSession
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
  }
}

async function main() {
  console.log("▶ Agent Runtime Phase-1");
  await dbTests();
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
