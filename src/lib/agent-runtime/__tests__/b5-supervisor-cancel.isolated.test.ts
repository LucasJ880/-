/**
 * B5 — Supervisor cancel 门：真实 DB 集成矩阵（隔离库）。
 * 运行（隔离库）：DATABASE_URL=... NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 * 无隔离库自动跳过。B0 守卫先行验证目标（调用方负责用 db:target:check / 本地库）。
 *
 * 证明矩阵：
 *  - PRE：修复前路由行为 = cancelAgentRun(orgId, id) 裸调——同 org 任意成员可
 *    取消 runtime_v2 / workforce_job / 他人 run（principal 根本未参与）
 *  - POST：发起人/org 管理员/平台管理员可取消 Supervisor run；其余 forbidden；
 *    非 Supervisor run（v2/workforce/conversation）一律 not_found 零变更；
 *    终态不可改写、二次取消幂等、并发取消单一合法迁移；
 *    PendingAction 联动仅限本 run。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 B5 Supervisor cancel 矩阵（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "B5 supervisor cancel gate matrix" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { cancelAgentRun } = await import("../run");
  const { cancelSupervisorRunGated } = await import("../supervisor-cancel-gate");

  const stamp = "b5" + Date.now().toString(36);
  const ORG_A = `orgA_${stamp}`, ORG_B = `orgB_${stamp}`;
  const U_INIT = `uinit_${stamp}`, U_MEMBER = `umember_${stamp}`, U_ADMIN = `uadmin_${stamp}`,
    U_PLAT = `uplat_${stamp}`, U_INACTIVE_ADMIN = `uinactadm_${stamp}`, U_B = `ub_${stamp}`;

  for (const [id, role] of [
    [U_INIT, "user"], [U_MEMBER, "user"], [U_ADMIN, "user"],
    [U_PLAT, "admin"], [U_INACTIVE_ADMIN, "user"], [U_B, "user"],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@f.test`, name: id, role } });
  }
  await db.organization.create({ data: { id: ORG_A, name: "B5 Org A", code: `b5a-${stamp}`, ownerId: U_ADMIN } });
  await db.organization.create({ data: { id: ORG_B, name: "B5 Org B", code: `b5b-${stamp}`, ownerId: U_B } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_A, userId: U_INIT, role: "org_member", status: "active" },
      { orgId: ORG_A, userId: U_MEMBER, role: "org_member", status: "active" },
      { orgId: ORG_A, userId: U_ADMIN, role: "org_admin", status: "active" },
      { orgId: ORG_A, userId: U_INACTIVE_ADMIN, role: "org_admin", status: "inactive" },
      { orgId: ORG_B, userId: U_B, role: "org_admin", status: "active" },
    ],
  });
  const sInit = await db.agentSession.create({ data: { orgId: ORG_A, userId: U_INIT, channel: "web_supervisor" }, select: { id: true } });
  const sB = await db.agentSession.create({ data: { orgId: ORG_B, userId: U_B, channel: "web_supervisor" }, select: { id: true } });

  type RunOver = { runType: string; status?: string; supervisorState?: object; orgId?: string; sessionId?: string };
  const mkRun = (over: RunOver) =>
    db.agentRun.create({
      data: {
        orgId: over.orgId ?? ORG_A,
        sessionId: over.sessionId ?? sInit.id,
        runType: over.runType,
        status: over.status ?? "running",
        ...(over.supervisorState ? { supervisorState: over.supervisorState } : {}),
      },
      select: { id: true, status: true },
    });
  const statusOf = async (id: string) =>
    (await db.agentRun.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  // ══ PRE：修复前路由 cancel 分支 = cancelAgentRun(orgId, id)（无任何附加门）══
  {
    const v2Pre = await mkRun({ runType: "runtime_v2" });
    const wfPre = await mkRun({ runType: "workforce_job" });
    const supPre = await mkRun({ runType: "supervisor" });
    // 旧代码从不传 caller —— 任意活跃成员（U_MEMBER 等）经端点均触发同一调用
    await cancelAgentRun(ORG_A, v2Pre.id);
    await cancelAgentRun(ORG_A, wfPre.id);
    await cancelAgentRun(ORG_A, supPre.id);
    ok((await statusOf(v2Pre.id)) === "cancelled", "PRE：runtime_v2 run 被 Supervisor 端点路径取消（跨执行栈越权实证）");
    ok((await statusOf(wfPre.id)) === "cancelled", "PRE：workforce_job run 同样被取消（生产 Tender 流水线可被任意成员杀）");
    ok((await statusOf(supPre.id)) === "cancelled", "PRE：他人 supervisor run 无属主/角色校验即被取消（principal 未参与）");
  }

  // ══ POST：允许面 ══
  {
    const supRun = await mkRun({ runType: "supervisor" });
    const paTarget = await db.pendingAction.create({
      data: { orgId: ORG_A, agentRunId: supRun.id, type: "test.noop", title: "t", preview: "p", payload: {}, createdById: U_INIT, expiresAt: new Date(Date.now() + 3600_000) },
      select: { id: true },
    });
    const otherRun = await mkRun({ runType: "conversation" });
    const paOther = await db.pendingAction.create({
      data: { orgId: ORG_A, agentRunId: otherRun.id, type: "test.noop", title: "t", preview: "p", payload: {}, createdById: U_INIT, expiresAt: new Date(Date.now() + 3600_000) },
      select: { id: true },
    });

    const r1 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supRun.id, actor: { userId: U_INIT, role: "user" } });
    ok(r1.decision === "cancelled" && (await statusOf(supRun.id)) === "cancelled", "发起人取消自己的 running supervisor run → cancelled", r1);
    const pa1 = await db.pendingAction.findUniqueOrThrow({ where: { id: paTarget.id }, select: { status: true } });
    const pa2 = await db.pendingAction.findUniqueOrThrow({ where: { id: paOther.id }, select: { status: true } });
    ok(pa1.status === "rejected" && pa2.status === "pending", "PendingAction 联动仅限本 run（他 run 的 pending 不受波及）", { pa1, pa2 });

    const evBefore = await db.agentRunEvent.count({ where: { runId: supRun.id } });
    const cAtBefore = (await db.agentRun.findUniqueOrThrow({ where: { id: supRun.id }, select: { cancelledAt: true } })).cancelledAt;
    const r2 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supRun.id, actor: { userId: U_INIT, role: "user" } });
    const evAfter = await db.agentRunEvent.count({ where: { runId: supRun.id } });
    const cAtAfter = (await db.agentRun.findUniqueOrThrow({ where: { id: supRun.id }, select: { cancelledAt: true } })).cancelledAt;
    ok(r2.decision === "already_terminal" && r2.status === "cancelled" && evAfter === evBefore &&
      String(cAtBefore) === String(cAtAfter), "二次取消幂等：already_terminal、零新事件、cancelledAt 不变", r2);

    const supRun2 = await mkRun({ runType: "supervisor" });
    const r3 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supRun2.id, actor: { userId: U_ADMIN, role: "user" } });
    ok(r3.decision === "cancelled", "org_admin 可取消他人 supervisor run（管理员政策）", r3);

    const supRun3 = await mkRun({ runType: "supervisor" });
    const r4 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supRun3.id, actor: { userId: U_PLAT, role: "admin" } });
    ok(r4.decision === "cancelled", "平台管理员（isSuperAdmin）可取消（既有平台政策）", r4);

    const legacySup = await mkRun({ runType: "conversation", supervisorState: { legacy: true } });
    const r5 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: legacySup.id, actor: { userId: U_MEMBER, role: "user" } });
    ok(r5.decision === "forbidden" && (await statusOf(legacySup.id)) === "running", "普通成员（非发起人非管理员）→ forbidden 零变更", r5);
    const r6 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: legacySup.id, actor: { userId: U_INIT, role: "user" } });
    ok(r6.decision === "cancelled", "历史兼容：supervisorState 标记的休眠 supervisor run 发起人仍可取消（窄放行）", r6);
  }

  // ══ POST：拒绝面（共享 AgentRun 表防护）══
  {
    const v2Run = await mkRun({ runType: "runtime_v2" });
    const v2Weird = await mkRun({ runType: "runtime_v2", supervisorState: { anomaly: true } });
    const wfRun = await mkRun({ runType: "workforce_job" });
    const convRun = await mkRun({ runType: "conversation" });
    for (const [run, name] of [
      [v2Run, "runtime_v2"], [v2Weird, "runtime_v2+异常 supervisorState"],
      [wfRun, "workforce_job"], [convRun, "conversation(无 supervisorState)"],
    ] as const) {
      const r = await cancelSupervisorRunGated({ orgId: ORG_A, runId: run.id, actor: { userId: U_ADMIN, role: "user" } });
      ok(r.decision === "not_found" && (await statusOf(run.id)) === "running", `${name} run → not_found 零变更（org_admin 也不行）`, r);
    }

    const supDone = await mkRun({ runType: "supervisor", status: "completed" });
    const r = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supDone.id, actor: { userId: U_INIT, role: "user" } });
    ok(r.decision === "already_terminal" && r.status === "completed" && (await statusOf(supDone.id)) === "completed",
      "completed 终态不被改写为 cancelled（幂等 already_terminal 报真实状态）", r);
  }

  // ══ POST：跨租户 / 伪造 / 身份异常 ══
  {
    const supB = await mkRun({ runType: "supervisor", orgId: ORG_B, sessionId: sB.id });
    const r1 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supB.id, actor: { userId: U_ADMIN, role: "user" } });
    ok(r1.decision === "not_found" && (await statusOf(supB.id)) === "running", "跨 org runId → not_found（租户 scoped 读取，不泄漏存在性）", r1);
    const r2 = await cancelSupervisorRunGated({ orgId: ORG_B, runId: supB.id, actor: { userId: U_ADMIN, role: "user" } });
    ok(r2.decision === "forbidden" && (await statusOf(supB.id)) === "running", "伪造 orgId（B org + A 管理员）→ forbidden 零变更（纵深防御；路由层 orgId 本就服务端解析）", r2);
    const r3 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supB.id, actor: { userId: `ghost_${stamp}`, role: "user" } });
    ok(r3.decision === "not_found", "未知 user × 跨 org → not_found", r3);

    const supLocal = await mkRun({ runType: "supervisor" });
    const r4 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supLocal.id, actor: { userId: `ghost_${stamp}`, role: "user" } });
    ok(r4.decision === "forbidden" && (await statusOf(supLocal.id)) === "running", "未知 userId → forbidden 零变更", r4);
    const r5 = await cancelSupervisorRunGated({ orgId: ORG_A, runId: supLocal.id, actor: { userId: U_INACTIVE_ADMIN, role: "user" } });
    ok(r5.decision === "forbidden" && (await statusOf(supLocal.id)) === "running", "非活跃 org_admin 成员 → forbidden（活跃成员资格必需）", r5);
    ok((await cancelSupervisorRunGated({ orgId: "", runId: supLocal.id, actor: { userId: U_INIT } })).decision === "not_found", "orgId 空 → not_found（fail-closed）");
    ok((await cancelSupervisorRunGated({ orgId: ORG_A, runId: "", actor: { userId: U_INIT } })).decision === "not_found", "runId 空 → not_found");
    ok((await cancelSupervisorRunGated({ orgId: ORG_A, runId: supLocal.id, actor: { userId: "" } })).decision === "not_found", "userId 空 → not_found");
    await cancelSupervisorRunGated({ orgId: ORG_A, runId: supLocal.id, actor: { userId: U_INIT, role: "user" } });
  }

  // ══ 并发：两个取消请求 → 单一合法迁移 ══
  {
    const supRace = await mkRun({ runType: "supervisor" });
    const evBefore = await db.agentRunEvent.count({ where: { runId: supRace.id } });
    const [ra, rb] = await Promise.all([
      cancelSupervisorRunGated({ orgId: ORG_A, runId: supRace.id, actor: { userId: U_INIT, role: "user" } }),
      cancelSupervisorRunGated({ orgId: ORG_A, runId: supRace.id, actor: { userId: U_ADMIN, role: "user" } }),
    ]);
    const evAfter = await db.agentRunEvent.count({ where: { runId: supRace.id } });
    const decisions = [ra.decision, rb.decision];
    ok((await statusOf(supRace.id)) === "cancelled" &&
      decisions.every((d) => d === "cancelled" || d === "already_terminal") &&
      evAfter - evBefore === 1,
      "并发双取消：终态 cancelled、恰 1 条终态事件（锁内复核单一合法迁移，无 last-write-wins）", { decisions, evDelta: evAfter - evBefore });
  }

  // 清理
  await db.pendingAction.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.agentRunEvent.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.agentRun.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.agentSession.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
  await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
  await db.user.deleteMany({ where: { id: { in: [U_INIT, U_MEMBER, U_ADMIN, U_PLAT, U_INACTIVE_ADMIN, U_B] } } });

  console.log(`\nB5 Supervisor cancel 门 DB 矩阵 结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("B5 隔离矩阵异常退出:", e);
  process.exit(1);
});
