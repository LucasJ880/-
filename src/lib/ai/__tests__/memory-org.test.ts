/**
 * 记忆 org 隔离与 Session 摘要策略（纯逻辑 + 可选 DB）
 * 运行：npx tsx src/lib/ai/__tests__/memory-org.test.ts
 */

import {
  buildTurnSummaryLine,
  mergeSessionSummary,
} from "@/lib/agent-runtime/session-memory";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// Session 摘要：不无限膨胀
{
  const line = buildTurnSummaryLine({
    userText: "继续跟进华南客户",
    assistantText: "好的，已记住当前客户上下文",
    entities: { customerId: "cust_abc12345" },
  });
  ok(line.includes("华南"), "摘要包含用户要点");
  ok(line.includes("客户:"), "摘要带实体标记");
  ok(line.length <= 160, "单行摘要有上限");
}

{
  let summary = "";
  for (let i = 0; i < 20; i++) {
    summary = mergeSessionSummary(summary, `轮次${i} → 回复${i}`);
  }
  const lines = summary.split("\n").filter(Boolean);
  ok(lines.length <= 12, "摘要最多保留 12 行");
  ok(summary.length <= 1800, "摘要总长截断");
  ok(summary.includes("轮次19"), "保留最近轮次");
  ok(!summary.includes("轮次0"), "丢弃过旧轮次");
}

async function dbTests() {
  if (!process.env.DATABASE_URL) {
    console.log("  · 跳过 DB 集成（无 DATABASE_URL）");
    return;
  }

  const { db } = await import("@/lib/db");
  const { saveMemory, listMemories, getWakeUpMemories } = await import(
    "@/lib/ai/user-memory"
  );

  const orgA = `mem_org_a_${Date.now()}`;
  const orgB = `mem_org_b_${Date.now()}`;
  const userId = `mem_user_${Date.now()}`;

  try {
    await saveMemory({
      orgId: orgA,
      userId,
      memoryType: "preference",
      content: "组织A：我偏好简洁中文回复",
      layer: 0,
      importance: 5,
    });
    await saveMemory({
      orgId: orgB,
      userId,
      memoryType: "preference",
      content: "组织B：我偏好英文详细回复",
      layer: 0,
      importance: 5,
    });

    const listA = await listMemories(userId, orgA, { layer: 0 });
    const listB = await listMemories(userId, orgB, { layer: 0 });
    ok(
      listA.items.every((m) => m.content.includes("组织A")),
      "orgA 列表只有 A 记忆",
    );
    ok(
      listB.items.every((m) => m.content.includes("组织B")),
      "orgB 列表只有 B 记忆",
    );
    ok(listA.items.length >= 1 && listB.items.length >= 1, "两边各自有记忆");

    const wakeA = await getWakeUpMemories(userId, orgA, 5);
    ok(
      wakeA.l0.every((m) => !m.content.includes("组织B")),
      "唤醒记忆不串 orgB",
    );

    let threw = false;
    try {
      await saveMemory({
        orgId: "",
        userId,
        memoryType: "fact",
        content: "无 org 应失败",
      });
    } catch {
      threw = true;
    }
    ok(threw, "缺少 orgId 时拒绝写入");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("orgId") && msg.includes("does not exist")) {
      console.log("  · 跳过 DB 集成（请先 prisma migrate deploy）");
      return;
    }
    if (msg.includes("UserMemory") && msg.includes("does not exist")) {
      console.log("  · 跳过 DB 集成（请先 prisma migrate deploy）");
      return;
    }
    // column orgId missing
    if (msg.includes("orgId") || msg.includes("P2022") || msg.includes("P2021")) {
      console.log("  · 跳过 DB 集成（请先 prisma migrate deploy）");
      return;
    }
    throw e;
  } finally {
    await db.userMemory
      .deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
      .catch(() => {});
  }
}

async function main() {
  console.log("▶ Memory org isolation + session summary");
  await dbTests();
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
