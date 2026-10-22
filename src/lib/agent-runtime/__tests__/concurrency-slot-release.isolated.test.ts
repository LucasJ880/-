/**
 * MAX_CONCURRENT_RUNS 并发额度：run 终态即释放（隔离库集成测试）。
 * 运行（隔离库）：DATABASE_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 * 无隔离库自动跳过。
 *
 * 修复前：createAgentRun 预留的并发额度只在创建失败时释放，终态路径从不释放，
 * 只能等 5 分钟 TTL 过期 → 同一组织 5 分钟内最多开始 10 个 run，第 11 个被 QUOTA 拒绝
 * （docs/QINGYAN_MENGXIN_FDE_V1_PRODUCTION_VALIDATION.md R4-2）。
 *
 * 证明矩阵：
 *  - complete / fail / cancel 三条终态路径都把本 run 的并发预留置为 RELEASED，用量归零
 *  - 日配额预留保持 COMMITTED，不被并发释放误伤
 *  - 重复终态幂等：只写一条 QUOTA_RELEASED 审计
 *  - 绕过 run.ts 直接写终态的模块（v2 / workforce / reconcile）：用量计数时惰性释放
 *  - 仍在进行中的 run 不被释放，且只占 1 个额度（修复前预留 + run 行各算一次 = 2 个）；
 *    TTL 过期后仍按 run 行占 1 个；按 workspace 计数同样只占 1 个
 *  - 释放只作用于本组织
 *  - 生产症状：同一窗口内连续 12 个「创建 → 完成」全部成功（修复前第 11 个被拒）
 *  - 同时进行中的 run 能到上限 10 个，第 11 个被拒（修复前第 6 个就被拒）
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过并发额度释放矩阵（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "agent-run concurrency slot release matrix" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { createAgentRun, completeAgentRun, failAgentRun, cancelAgentRun } = await import("../run");
  const { getQuotaCurrentUsage } = await import("@/lib/capabilities/governance/usage-counters");

  const stamp = "cs" + Date.now().toString(36);
  const ORG_A = `orgA_${stamp}`, ORG_B = `orgB_${stamp}`;
  const U_A = `ua_${stamp}`, U_B = `ub_${stamp}`;

  await db.user.create({ data: { id: U_A, email: `${U_A}@f.test`, name: U_A, role: "user" } });
  await db.user.create({ data: { id: U_B, email: `${U_B}@f.test`, name: U_B, role: "user" } });
  await db.organization.create({ data: { id: ORG_A, name: "CS Org A", code: `csa-${stamp}`, ownerId: U_A } });
  await db.organization.create({ data: { id: ORG_B, name: "CS Org B", code: `csb-${stamp}`, ownerId: U_B } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_A, userId: U_A, role: "org_admin", status: "active" },
      { orgId: ORG_B, userId: U_B, role: "org_admin", status: "active" },
    ],
  });
  const sA = await db.agentSession.create({ data: { orgId: ORG_A, userId: U_A, channel: "web" }, select: { id: true } });
  const sB = await db.agentSession.create({ data: { orgId: ORG_B, userId: U_B, channel: "web" }, select: { id: true } });

  const usage = (orgId: string) => getQuotaCurrentUsage({ orgId, metric: "MAX_CONCURRENT_RUNS" });
  const slotsOf = (runId: string) =>
    db.capabilityQuotaReservation.findMany({
      where: { runId, metric: "MAX_CONCURRENT_RUNS" },
      select: { id: true, status: true, releasedAt: true },
    });
  const newRun = async (orgId = ORG_A, sessionId = sA.id, workspaceId?: string) =>
    (await createAgentRun({ orgId, sessionId, runType: "conversation", workspaceId })).run;
  const clearSlots = (orgId: string) =>
    db.capabilityQuotaReservation.deleteMany({ where: { orgId, metric: "MAX_CONCURRENT_RUNS" } });

  try {
    // ══ 三条终态路径 ══
    for (const [label, end] of [
      ["completeAgentRun", (id: string) => completeAgentRun(ORG_A, id)],
      ["failAgentRun", (id: string) => failAgentRun(ORG_A, id, { code: "unknown", message: "test" })],
      ["cancelAgentRun", (id: string) => cancelAgentRun(ORG_A, id)],
    ] as const) {
      await clearSlots(ORG_A);
      const run = await newRun();
      const before = await slotsOf(run.id);
      ok(before.length === 1 && before[0].status === "RESERVED", `${label}：创建后持有 1 个 RESERVED 并发预留`, before);
      await end(run.id);
      const after = await slotsOf(run.id);
      ok(after.length === 1 && after[0].status === "RELEASED" && after[0].releasedAt !== null,
        `${label}：终态后并发预留 RELEASED`, after);
      const u = await usage(ORG_A);
      ok(u === 0, `${label}：终态后并发用量归零（修复前为 1，直到 5 分钟 TTL）`, { usage: u });
    }

    // ══ 日配额不受影响 ══
    {
      await db.capabilityQuotaReservation.deleteMany({ where: { orgId: ORG_A, metric: "DAILY_AGENT_RUNS" } });
      const run = await newRun();
      await completeAgentRun(ORG_A, run.id);
      const daily = await db.capabilityQuotaReservation.findMany({
        where: { orgId: ORG_A, metric: "DAILY_AGENT_RUNS" },
        select: { status: true },
      });
      ok(daily.length === 1 && daily[0].status === "COMMITTED", "日配额预留保持 COMMITTED", daily);
    }

    // ══ 重复终态幂等 ══
    {
      const run = await newRun();
      await completeAgentRun(ORG_A, run.id);
      await completeAgentRun(ORG_A, run.id);
      await failAgentRun(ORG_A, run.id, { code: "unknown", message: "late" });
      const [slot] = await slotsOf(run.id);
      const audits = await db.auditLog.count({
        where: { orgId: ORG_A, action: "QUOTA_RELEASED", targetId: slot.id },
      });
      ok(slot.status === "RELEASED" && audits === 1, "重复终态：仍为 RELEASED，只写 1 条 QUOTA_RELEASED 审计", { slot, audits });
    }

    // ══ 绕过 run.ts 直接写终态：计数时惰性释放 ══
    {
      await clearSlots(ORG_A);
      const direct = await newRun();
      await db.agentRun.update({ where: { id: direct.id }, data: { status: "failed", completedAt: new Date() } });
      ok((await slotsOf(direct.id))[0]?.status === "RESERVED", "直接写 failed：预留暂仍 RESERVED（未经 run.ts）");
      const u = await usage(ORG_A);
      const [slot] = await slotsOf(direct.id);
      ok(u === 0 && slot.status === "RELEASED", "直接写终态：用量计数时惰性释放，用量归零", { usage: u, slot });
    }

    // ══ 进行中的 run 不释放，且只占 1 个额度 ══
    {
      await clearSlots(ORG_A);
      const live = await newRun();
      const u = await usage(ORG_A);
      const [slot] = await slotsOf(live.id);
      ok(slot.status === "RESERVED" && u === 1, "进行中的 run：预留保持 RESERVED，只占 1 个额度（修复前为 2）", { usage: u, slot });

      await db.capabilityQuotaReservation.update({ where: { id: slot.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const uAfterTtl = await usage(ORG_A);
      const [expired] = await slotsOf(live.id);
      ok(expired.status === "EXPIRED" && uAfterTtl === 1, "TTL 过期后：进行中的 run 仍按 run 行占 1 个", { usage: uAfterTtl, expired });
      await completeAgentRun(ORG_A, live.id);
    }

    // ══ 按 workspace 计数：同样只占 1 个 ══
    {
      await clearSlots(ORG_A);
      const WS = `ws_${stamp}`;
      const live = await newRun(ORG_A, sA.id, WS);
      const uWs = await getQuotaCurrentUsage({ orgId: ORG_A, workspaceId: WS, metric: "MAX_CONCURRENT_RUNS" });
      const uOrg = await usage(ORG_A);
      ok(uWs === 1 && uOrg === 1, "workspace 内进行中的 run：workspace 与组织用量都只算 1 个", { uWs, uOrg });
      await completeAgentRun(ORG_A, live.id);
    }

    // ══ 组织隔离 ══
    {
      await clearSlots(ORG_A);
      await clearSlots(ORG_B);
      const runB = await newRun(ORG_B, sB.id);
      const runA = await newRun();
      await completeAgentRun(ORG_A, runA.id);
      await db.agentRun.update({ where: { id: runB.id }, data: { status: "running" } });
      await usage(ORG_A);
      const [slotB] = await slotsOf(runB.id);
      ok(slotB.status === "RESERVED", "释放只作用于本组织：B 组织进行中的预留不受 A 的终态 / 计数影响", slotB);
      await completeAgentRun(ORG_B, runB.id);
    }

    // ══ 生产症状：同一 5 分钟窗口内连续 12 个 run ══
    {
      await clearSlots(ORG_A);
      let started = 0;
      let firstError: string | null = null;
      for (let i = 0; i < 12; i++) {
        try {
          const run = await newRun();
          started++;
          await completeAgentRun(ORG_A, run.id);
        } catch (e) {
          firstError = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      ok(started === 12, "同一窗口内连续 12 个「创建 → 完成」全部成功（修复前第 11 个被 QUOTA 拒绝）", { started, firstError });
    }

    // ══ 同时进行中：能到上限 10 个，第 11 个被拒 ══
    {
      await clearSlots(ORG_A);
      const live: string[] = [];
      let refusal: string | null = null;
      for (let i = 0; i < 11; i++) {
        try {
          live.push((await newRun()).id);
        } catch (e) {
          refusal = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      ok(live.length === 10 && refusal !== null && refusal.includes("配额限制"),
        "同时进行中的 run 能开到 10 个，第 11 个被 QUOTA 拒绝（修复前第 6 个就被拒）", { started: live.length, refusal });
      ok((await usage(ORG_A)) === 10, "10 个进行中的 run：用量正好 10");
      for (const id of live) await completeAgentRun(ORG_A, id);
      ok((await usage(ORG_A)) === 0, "全部结束后用量归零");
    }
  } finally {
    await db.capabilityQuotaReservation.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.auditLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.autopilotTelemetryOutbox.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } }).catch(() => {});
    await db.agentRunEvent.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.agentRun.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.agentSession.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await db.notification.deleteMany({ where: { userId: { in: [U_A, U_B] } } });
    await db.user.deleteMany({ where: { id: { in: [U_A, U_B] } } });
    await db.$disconnect();
  }

  console.log(`\n并发额度释放矩阵：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
