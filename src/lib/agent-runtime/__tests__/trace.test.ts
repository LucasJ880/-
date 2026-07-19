/**
 * Agent Trace 只读查询冒烟（自建 fixture，跑完清理）
 * 运行：npx tsx src/lib/agent-runtime/__tests__/trace.test.ts
 */

import { db } from "@/lib/db";
import {
  getOrCreateAgentSession,
  createAgentRun,
  appendAgentRunEvent,
  completeAgentRun,
} from "../index";
import {
  listAgentSessionsForTrace,
  listAgentRunsForSession,
  getAgentRunTrace,
} from "../trace";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  console.log("▶ Agent Trace smoke");

  if (!process.env.DATABASE_URL) {
    console.log("  · 跳过（无 DATABASE_URL）");
    process.exit(0);
  }

  const stamp = Date.now();
  const orgA = `smoke_trace_org_a_${stamp}`;
  const orgB = `smoke_trace_org_b_${stamp}`;
  const userA = `smoke_trace_user_a_${stamp}`;
  const userB = `smoke_trace_user_b_${stamp}`;

  try {
    const session = await getOrCreateAgentSession({
      orgId: orgA,
      userId: userA,
      channel: "wecom",
      channelUserId: "smoke_wx_1",
    });
    await db.agentSession.update({
      where: { id: session.id },
      data: { summary: "冒烟摘要：询价跟进" },
    });

    const { run } = await createAgentRun({
      orgId: orgA,
      sessionId: session.id,
      userMessageId: `smoke_msg_${stamp}`,
      intent: "quote",
    });
    await appendAgentRunEvent({
      orgId: orgA,
      runId: run.id,
      eventType: "ack.sent",
      title: "已确认收到",
      payload: { preview: "ok", secretFull: "SHOULD_NOT_LEAK" },
    });
    await appendAgentRunEvent({
      orgId: orgA,
      runId: run.id,
      eventType: "planning.completed",
      title: "计划完成",
      payload: { complexity: "simple", needsTools: false },
    });
    await completeAgentRun(orgA, run.id);

    // 同 org 另一用户（用于 self 隔离）
    const otherSession = await getOrCreateAgentSession({
      orgId: orgA,
      userId: userB,
      channel: "wecom",
      channelUserId: "smoke_wx_2",
    });
    await createAgentRun({
      orgId: orgA,
      sessionId: otherSession.id,
      userMessageId: `smoke_msg_b_${stamp}`,
    });

    // orgB 干扰数据
    const foreign = await getOrCreateAgentSession({
      orgId: orgB,
      userId: userA,
      channel: "wecom",
      channelUserId: "smoke_wx_1",
    });
    await createAgentRun({
      orgId: orgB,
      sessionId: foreign.id,
      userMessageId: `smoke_msg_b_org_${stamp}`,
    });

    const selfSessions = await listAgentSessionsForTrace({
      orgId: orgA,
      userId: userA,
      scope: "self",
    });
    ok(selfSessions.length === 1, "self 只看自己的 Session");
    ok(selfSessions[0]?.id === session.id, "self Session id 正确");
    ok(
      selfSessions[0]?.summaryPreview?.includes("询价"),
      "摘要预览可读",
    );
    ok(selfSessions[0]?.latestRun?.status === "completed", "最新 Run 状态");

    const orgSessions = await listAgentSessionsForTrace({
      orgId: orgA,
      userId: userA,
      scope: "org",
    });
    ok(orgSessions.length === 2, "org scope 看本组织全部 Session");
    ok(
      orgSessions.every((s) => s.id !== foreign.id),
      "org scope 不泄露其他 org",
    );

    const runs = await listAgentRunsForSession({
      orgId: orgA,
      userId: userA,
      sessionId: session.id,
      scope: "self",
    });
    ok(!!runs && runs.length === 1, "Session 下 Run 列表");
    ok(runs?.[0]?.id === run.id, "Run id 正确");

    const deniedRuns = await listAgentRunsForSession({
      orgId: orgA,
      userId: userB,
      sessionId: session.id,
      scope: "self",
    });
    ok(deniedRuns === null, "self 不能读他人 Session 的 Run");

    const detail = await getAgentRunTrace({
      orgId: orgA,
      userId: userA,
      runId: run.id,
      scope: "self",
    });
    ok(!!detail, "Run Trace 可读");
    // create 会写 run.started，complete 会写 run.completed，另有手动 2 条
    ok((detail?.events.length ?? 0) >= 4, "Events 含生命周期与手动事件");
    ok(
      detail?.events.some((e) => e.eventType === "ack.sent"),
      "含 ack.sent",
    );
    ok(
      detail?.events.some((e) => e.eventType === "run.completed"),
      "含 run.completed",
    );
    const ackPayload = detail?.events.find((e) => e.eventType === "ack.sent")
      ?.payload;
    ok(ackPayload?.preview === "ok", "允许字段保留");
    ok(
      !ackPayload || !("secretFull" in ackPayload),
      "敏感/未允许字段不回传",
    );

    const crossOrg = await getAgentRunTrace({
      orgId: orgB,
      userId: userA,
      runId: run.id,
      scope: "org",
    });
    ok(crossOrg === null, "跨 org 读 Run 失败");

    const otherUser = await getAgentRunTrace({
      orgId: orgA,
      userId: userB,
      runId: run.id,
      scope: "self",
    });
    ok(otherUser === null, "self 不能读他人 Run");

    console.log(`  ${pass} passed, ${fail} failed`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("AgentSession") && msg.includes("does not exist")) {
      console.log("  · 跳过（请先 prisma migrate deploy）");
      return;
    }
    throw e;
  } finally {
    await db.agentRunEvent
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
    await db.agentRun
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
    await db.agentSession
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
    await db.$disconnect().catch(() => {});
  }

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
