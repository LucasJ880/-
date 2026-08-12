/**
 * Tender T2-P1 — Ledger/Cost DB 集成矩阵（隔离库；非隔离环境自动跳过）
 *
 * EV-01..08 幂等/并发/原子；COST-01..08 生命周期；DEL-01/04 删除保留；
 * producer 语义等价事务（create/update/member add+remove）；并发 2/5/10。
 * T3.5 Foundation Hardening：DEL-SCHEMA-01..05（gate=SCHEMA_READY，与 producer 解耦）、
 * DEL-DARK/DEL-ACTIVE（保留，tx 层观测 M1 访问）、DEL-RACE-01（真实事务交错，ORPHAN=0）。
 *
 * 运行：DATABASE_URL=<隔离分支> DIRECT_URL=<同> NODE_ENV=test \
 *       DATABASE_ENVIRONMENT=isolated npx tsx <本文件>
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

if (!process.env.DATABASE_URL?.trim()) {
  console.log("⏭  跳过 T2-P1 Ledger DB 测试（未提供 DATABASE_URL）");
  process.exit(0);
}
assertSafeTestDatabase({ scriptName: "project-ledger p1 db test" });
if (process.env.NODE_ENV !== "test") {
  console.log("⏭  跳过 T2-P1 Ledger DB 测试（需 NODE_ENV=test）");
  process.exit(0);
}

const P = "qy_t2p1_";
let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`, detail ?? "");
  }
}

function errCode(e: unknown): string | null {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code: unknown }).code)
    : null;
}

async function main() {
  const { db } = await import("@/lib/db");
  const { appendProjectEvent, listProjectEvents } = await import(
    "../event-service"
  );
  const {
    createProjectCost,
    revisePlannedCost,
    commitProjectCost,
    actualizeProjectCost,
    voidProjectCost,
  } = await import("../cost-service");
  const {
    projectCreatedEventKey,
    projectUpdatedEventKey,
    projectMemberAddedEventKey,
    projectMemberRemovedEventKey,
  } = await import("../event-keys");

  const actor = { actorType: "user" as const, actorId: `${P}user_a` };

  async function cleanup() {
    await db.projectEventActor.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectEvent.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectCost.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.tenderArchiveItem.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.projectMember.deleteMany({ where: { project: { orgId: { startsWith: P } } } });
    await db.project.deleteMany({ where: { orgId: { startsWith: P } } });
    // 真实 DELETE 路由会写 AuditLog（userId/orgId 指向 fixture）；须先清，否则 FK 阻塞 org/user 删除
    await db.auditLog.deleteMany({ where: { userId: { startsWith: P } } });
    await db.auditLog.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.organizationMember.deleteMany({ where: { orgId: { startsWith: P } } });
    await db.organization.deleteMany({ where: { id: { startsWith: P } } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  await cleanup();

  // ── fixture：两个 org、两个项目、一个用户 ──
  await db.user.create({
    data: {
      id: `${P}user_a`,
      email: `${P}a@test.local`,
      name: "P1 测试用户",
      role: "admin",
    },
  });
  await db.organization.create({
    data: { id: `${P}org_a`, name: `${P}Org A`, code: `${P}org-a`, ownerId: `${P}user_a` },
  });
  await db.organization.create({
    data: { id: `${P}org_b`, name: `${P}Org B`, code: `${P}org-b`, ownerId: `${P}user_a` },
  });
  const projectA = await db.project.create({
    data: {
      id: `${P}proj_a`,
      name: "P1 项目 A",
      orgId: `${P}org_a`,
      ownerId: `${P}user_a`,
      workDomain: "tender",
    },
  });
  await db.project.create({
    data: {
      id: `${P}proj_b`,
      name: "P1 项目 B",
      orgId: `${P}org_b`,
      ownerId: `${P}user_a`,
    },
  });

  console.log("━━ EV 矩阵 ━━");

  // EV-01 同 eventKey 顺序重试 → 恰一行
  const k1 = `${P}ev01`;
  const r1 = await db.$transaction((tx) =>
    appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: projectA.id,
      eventType: "project.updated", eventKey: k1,
      occurredAt: new Date(), actor, title: "EV-01",
    }),
  );
  const r2 = await db.$transaction((tx) =>
    appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: projectA.id,
      eventType: "project.updated", eventKey: k1,
      occurredAt: new Date(), actor, title: "EV-01 retry",
    }),
  );
  ok("EV-01 第一次 created=true", r1.created === true);
  ok("EV-01 重试 created=false 且同行", r2.created === false && r2.event.id === r1.event.id);
  ok(
    "EV-01 恰一行",
    (await db.projectEvent.count({ where: { projectId: projectA.id, eventKey: k1 } })) === 1,
  );

  // EV-02 同 eventKey 并发 → 恰一行（幂等：败者在赢者提交后经 eventKey 冲突返回既有行；
  // 提交前则短暂 seq 自旋，故并发同键场景同样给重试预算头寸，避免高延迟环境 flake）
  const k2 = `${P}ev02`;
  const conc = await Promise.all(
    Array.from({ length: 5 }, () =>
      db.$transaction((tx) =>
        appendProjectEvent({
          tx, orgId: `${P}org_a`, projectId: projectA.id,
          eventType: "project.updated", eventKey: k2,
          occurredAt: new Date(), actor, title: "EV-02",
          maxSeqRetries: 25,
        }),
      ),
    ),
  );
  ok(
    "EV-02 并发同 key 恰一行",
    (await db.projectEvent.count({ where: { projectId: projectA.id, eventKey: k2 } })) === 1,
  );
  ok("EV-02 全部调用成功返回同一事件", new Set(conc.map((r) => r.event.id)).size === 1);

  // EV-03 不同 eventKey 并发 → seq 单调致密。
  // 本项验证的是「并发下 seq 仍致密单调」，非「默认 8 次预算是否够用」
  // （后者由 pure 套件 EV-05 以 mock 确定性验证）。N 路同时到达是超出 #96
  // “human-frequency” 设计点的压力场景；在隔离 Neon 高网络延迟下，max(seq)+1
  // 乐观分配的重试次数与并发度线性相关，故给压力场景按并发度放宽预算（仍有界、
  // 仍在耗尽时 THROW）。服务默认值不变。
  for (const n of [2, 5, 10]) {
    const t0 = Date.now();
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        db.$transaction((tx) =>
          appendProjectEvent({
            tx, orgId: `${P}org_a`, projectId: projectA.id,
            eventType: "project.updated", eventKey: `${P}ev03:${n}:${i}`,
            occurredAt: new Date(), actor, title: `EV-03 ${n}/${i}`,
            maxSeqRetries: n * 5,
          }),
        ),
      ),
    );
    console.log(`    并发 ${n} 路耗时 ${Date.now() - t0}ms`);
  }
  const seqs = (
    await db.projectEvent.findMany({
      where: { projectId: projectA.id },
      select: { seq: true },
      orderBy: { seq: "asc" },
    })
  ).map((r) => r.seq);
  const dense = seqs.every((s, i) => s === i + 1);
  ok(`EV-03 seq 致密单调 1..${seqs.length}`, dense, seqs.join(","));

  // EV-04 有界重试在并发下实际发生且全部成功（EV-02/03 已证：无失败、无丢事件）
  ok("EV-04 P2002 竞争经有界重试全部收敛", dense && conc.length === 5);

  // EV-06 业务变更 + 账本失败 → 整体回滚
  const nameBefore = (await db.project.findUnique({ where: { id: projectA.id } }))!.name;
  let ev06Threw = false;
  try {
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id: projectA.id }, data: { name: "EV-06 不应保留" } });
      await appendProjectEvent({
        tx, orgId: `${P}org_b`, projectId: projectA.id, // 错误 org → 租户闸抛错
        eventType: "project.updated", eventKey: `${P}ev06`,
        occurredAt: new Date(), actor, title: "EV-06",
      });
    });
  } catch (e) {
    ev06Threw = errCode(e) === "LEDGER_TENANT_MISMATCH";
  }
  const nameAfter = (await db.project.findUnique({ where: { id: projectA.id } }))!.name;
  ok("EV-06 账本失败抛 LedgerTenantError", ev06Threw);
  ok("EV-06 业务变更整体回滚", nameAfter === nameBefore);
  ok(
    "EV-06 零事件残留",
    (await db.projectEvent.count({ where: { eventKey: `${P}ev06` } })) === 0,
  );

  // EV-07 跨 org → reject（append 与 read 双向）
  let ev07a = false;
  try {
    await db.$transaction((tx) =>
      appendProjectEvent({
        tx, orgId: `${P}org_a`, projectId: `${P}proj_b`,
        eventType: "project.updated", eventKey: `${P}ev07`,
        occurredAt: new Date(), actor, title: "EV-07",
      }),
    );
  } catch (e) {
    ev07a = errCode(e) === "LEDGER_TENANT_MISMATCH";
  }
  let ev07b = false;
  try {
    await listProjectEvents({ orgId: `${P}org_a`, projectId: `${P}proj_b` });
  } catch (e) {
    ev07b = errCode(e) === "LEDGER_TENANT_MISMATCH";
  }
  ok("EV-07 跨 org append 拒绝", ev07a);
  ok("EV-07 跨 org read 拒绝", ev07b);

  // Actor junction：与事件同事务 + 去重
  const withActors = await db.$transaction((tx) =>
    appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: projectA.id,
      eventType: "project.member.added", eventKey: `${P}ev_actor`,
      occurredAt: new Date(), actor,
      actors: [
        { actorKey: `user:${P}user_a`, userId: `${P}user_a`, role: "participant" },
        { actorKey: `user:${P}user_a`, userId: `${P}user_a` }, // 重复 → 去重
      ],
      title: "actor",
    }),
  );
  ok(
    "ACTOR 同事务写入且去重",
    (await db.projectEventActor.count({ where: { eventId: withActors.event.id } })) === 1,
  );

  // 读服务：seq DESC + cursor 稳定
  const page1 = await listProjectEvents({ orgId: `${P}org_a`, projectId: projectA.id, limit: 5 });
  ok(
    "READ seq DESC 稳定分页",
    page1.events.length === 5 &&
      page1.events.every((e, i) => i === 0 || page1.events[i - 1]!.seq > e.seq) &&
      page1.nextCursor !== null,
  );

  console.log("━━ Producer 语义等价（§28）━━");

  // P-CREATE：创建 + 账本同事务
  const created = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: { name: "P1 producer create", orgId: `${P}org_a`, ownerId: `${P}user_a` },
    });
    await appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: p.id,
      eventType: "project.created", eventKey: projectCreatedEventKey(p.id),
      occurredAt: p.createdAt, actor, title: "项目创建",
    });
    return p;
  });
  ok(
    "P-CREATE 恰一事件",
    (await db.projectEvent.count({ where: { projectId: created.id, eventType: "project.created" } })) === 1,
  );

  // P-UPDATE：同逻辑动作 key 稳定；相同重放 → 不重复
  const before = (await db.project.findUnique({ where: { id: created.id } }))!;
  const updKey = projectUpdatedEventKey(
    created.id, before.updatedAt.toISOString(), ["name"], { name: "更名后" },
  );
  const updKeyAgain = projectUpdatedEventKey(
    created.id, before.updatedAt.toISOString(), ["name"], { name: "更名后" },
  );
  ok("P-UPDATE eventKey 确定性", updKey === updKeyAgain);
  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id: created.id }, data: { name: "更名后" } });
    await appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: created.id,
      eventType: "project.updated", eventKey: updKey,
      occurredAt: new Date(), actor, title: "更新",
    });
  });
  const replay = await db.$transaction((tx) =>
    appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: created.id,
      eventType: "project.updated", eventKey: updKey,
      occurredAt: new Date(), actor, title: "更新重放",
    }),
  );
  ok("P-UPDATE 重放幂等", replay.created === false);

  // P-MUTATION-FAIL：业务失败 → 零事件
  let pFailThrew = false;
  try {
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id: created.id }, data: { name: "不应生效" } });
      throw new Error("business failure before ledger");
    });
  } catch {
    pFailThrew = true;
  }
  ok(
    "P-FAIL 业务失败零事件",
    pFailThrew &&
      (await db.projectEvent.count({ where: { projectId: created.id } })) === 2,
  );

  // P-MEMBER：加入→移除→再加入 各得独立 key/事件
  const mem = await db.projectMember.create({
    data: { projectId: created.id, userId: `${P}user_a`, role: "project_member", status: "active" },
  });
  async function memberEvent(kind: "added" | "removed") {
    return db.$transaction(async (tx) => {
      const prior = await tx.projectEvent.count({
        where: { projectId: created.id, eventKey: { startsWith: `project.member.${kind}:${mem.id}:` } },
      });
      const key =
        kind === "added"
          ? projectMemberAddedEventKey(mem.id, prior + 1)
          : projectMemberRemovedEventKey(mem.id, prior + 1);
      return appendProjectEvent({
        tx, orgId: `${P}org_a`, projectId: created.id,
        eventType: `project.member.${kind}`, eventKey: key,
        occurredAt: new Date(), actor,
        actors: [{ actorKey: `user:${P}user_a`, userId: `${P}user_a` }],
        title: kind,
      });
    });
  }
  const m1 = await memberEvent("added");
  const m2 = await memberEvent("removed");
  const m3 = await memberEvent("added");
  ok(
    "P-MEMBER 三次动作三个独立事件（v1/v1/v2）",
    m1.created && m2.created && m3.created &&
      m1.event.eventKey.endsWith(":v1") && m3.event.eventKey.endsWith(":v2"),
  );

  console.log("━━ COST 矩阵 ━━");

  // COST-01 PLANNED create
  const cost = await createProjectCost({
    orgId: `${P}org_a`, projectId: projectA.id, actor,
    costStatus: "PLANNED", category: "SITE_VISIT",
    amount: "10000.00", currency: "CAD",
    incurredAt: new Date("2026-08-11T10:00:00Z"),
    createdById: `${P}user_a`,
  });
  ok("COST-01 PLANNED 创建", cost.costStatus === "PLANNED" && cost.amountPlanned?.toString() === "10000");
  ok(
    "COST-01 cost.recorded 事件",
    (await db.projectEvent.count({ where: { relatedCostId: cost.id, eventType: "cost.recorded" } })) === 1,
  );

  // COST-02 修订 ×2 + no-op
  const rev1 = await revisePlannedCost({
    orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor,
    changes: { amount: "12000.00" },
  });
  const rev2 = await revisePlannedCost({
    orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor,
    changes: { amount: "15000.00", category: "CONSULTANT" },
  });
  const revNoop = await revisePlannedCost({
    orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor,
    changes: { amount: "15000.00" },
  });
  const revEvents = await db.projectEvent.findMany({
    where: { relatedCostId: cost.id, eventType: "cost.revised" },
    orderBy: { seq: "asc" },
  });
  const p2 = revEvents[1]?.payload as Record<string, unknown> | null;
  ok("COST-02 revisionCount 递增", rev1.cost.revisionCount === 1 && rev2.cost.revisionCount === 2);
  ok("COST-02 no-op 不产生修订", revNoop.revised === false && revEvents.length === 2);
  ok(
    "COST-02 cost.revised payload 契约",
    !!p2 && p2.revisionCount === 2 &&
      Array.isArray(p2.changedFields) &&
      (p2.changedFields as string[]).sort().join(",") === "amount,category" &&
      p2.previousAmount === "12000" && p2.newAmount === "15000" &&
      p2.previousCategory === "SITE_VISIT" && p2.newCategory === "CONSULTANT",
  );

  // COST-03/04 生命周期推进（金额列留痕）
  const committed = await commitProjectCost({
    orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor,
  });
  const actualized = await actualizeProjectCost({
    orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor, amount: "14550.00",
  });
  ok(
    "COST-03 COMMITTED 且 planned 留痕",
    committed.costStatus === "COMMITTED" &&
      committed.amountCommitted?.toString() === "15000" &&
      committed.amountPlanned?.toString() === "15000",
  );
  ok(
    "COST-04 ACTUAL 三列并存",
    actualized.costStatus === "ACTUAL" &&
      actualized.amountActual?.toString() === "14550" &&
      actualized.amountCommitted?.toString() === "15000",
  );

  // COST-05 ACTUAL 实质修改拒绝
  let cost05 = false;
  try {
    await revisePlannedCost({
      orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor,
      changes: { amount: "1.00" },
    });
  } catch (e) {
    cost05 = errCode(e) === "COST_LIFECYCLE_VIOLATION";
  }
  ok("COST-05 ACTUAL 修订拒绝", cost05);

  // COST-06 void + correction
  const { voided, correction } = await voidProjectCost({
    orgId: `${P}org_a`, projectId: projectA.id, costId: cost.id, actor,
    reason: "金额录入错误",
    correction: {
      costStatus: "ACTUAL", category: "CONSULTANT",
      amount: "14000.00", currency: "CAD",
      incurredAt: new Date("2026-08-11T10:00:00Z"),
      createdById: `${P}user_a`,
    },
  });
  ok(
    "COST-06 void+correction",
    voided.costStatus === "VOIDED" && voided.voidReason === "金额录入错误" &&
      correction?.correctionOfCostId === cost.id &&
      correction?.amountActual?.toString() === "14000",
  );
  ok(
    "COST-06 cost.voided 事件",
    (await db.projectEvent.count({ where: { relatedCostId: cost.id, eventType: "cost.voided" } })) === 1,
  );

  // COST-07 跨 org 拒绝
  let cost07 = false;
  try {
    await commitProjectCost({
      orgId: `${P}org_b`, projectId: projectA.id, costId: correction!.id, actor,
    });
  } catch (e) {
    cost07 = errCode(e) === "LEDGER_TENANT_MISMATCH";
  }
  ok("COST-07 跨 org 拒绝", cost07);

  // COST-08 AI 类别拒绝
  let cost08 = false;
  try {
    await createProjectCost({
      orgId: `${P}org_a`, projectId: projectA.id, actor,
      costStatus: "ACTUAL", category: "AI",
      amount: "5.00", currency: "USD",
      incurredAt: new Date(), createdById: `${P}user_a`,
    });
  } catch (e) {
    cost08 = errCode(e) === "COST_LIFECYCLE_VIOLATION";
  }
  ok("COST-08 AI 成本拒入 ProjectCost（AiUsageLedger 唯一权威）", cost08);

  console.log("━━ DEL 矩阵 ━━");

  // DEL-01 归档（soft anchor）后账本/成本/档案全保留
  await db.tenderArchiveItem.create({
    data: {
      orgId: `${P}org_a`, projectId: projectA.id, kind: "tender_document",
      captureKey: `${P}ck`, capturedAt: new Date(), captureMethod: "upload",
      mimeType: "application/pdf", fileSize: 10, contentHash: `${P}hash`,
      storageKey: `archive/${P}org_a/xx/${P}hash`,
    },
  });
  const [evBefore, costBefore, arcBefore] = [
    await db.projectEvent.count({ where: { projectId: projectA.id } }),
    await db.projectCost.count({ where: { projectId: projectA.id } }),
    await db.tenderArchiveItem.count({ where: { projectId: projectA.id } }),
  ];
  await db.project.update({ where: { id: projectA.id }, data: { status: "archived" } });
  const [evAfter, costAfter, arcAfter] = [
    await db.projectEvent.count({ where: { projectId: projectA.id } }),
    await db.projectCost.count({ where: { projectId: projectA.id } }),
    await db.tenderArchiveItem.count({ where: { projectId: projectA.id } }),
  ];
  ok(
    "DEL-01 归档后账本/成本/档案全保留",
    evBefore > 0 && evAfter === evBefore && costAfter === costBefore && arcAfter === arcBefore,
  );
  const archivedRead = await listProjectEvents({ orgId: `${P}org_a`, projectId: projectA.id, limit: 1 });
  ok("DEL-01 归档项目账本仍可读（授权锚保留）", archivedRead.events.length === 1);

  // DEL-04 跨 org 清理拒绝（deleteMany 带 org 约束返回 0）
  const crossDel = await db.projectEvent.deleteMany({
    where: { projectId: projectA.id, orgId: `${P}org_b` },
  });
  ok("DEL-04 跨 org 清理零命中", crossDel.count === 0);

  // ── Dark-merge 安全：真实 DELETE 路由 × activation flag（DEL-DARK / DEL-ACTIVE）──
  console.log("━━ DEL Dark-merge 矩阵（真实路由）━━");
  process.env.JWT_SECRET = process.env.JWT_SECRET || "t2p1-test-secret";
  const { NextRequest } = await import("next/server");
  const { DELETE } = await import("@/app/api/projects/[id]/route");
  const { createSession } = await import("@/lib/auth/session");
  const token = await createSession({
    sub: `${P}user_a`,
    email: `${P}a@test.local`,
    role: "admin", // isSuperAdmin → 绕过 intakeStatus/成员校验，专注 gate 行为
  });

  // T3.5：两个正交 flag 显式控制（deletion gate = SCHEMA_READY；producer = SCHEMA && PRODUCER）
  const SCHEMA_FLAG = "T2_LEDGER_SCHEMA_READY";
  const PRODUCER_FLAG = "T2_LEDGER_PRODUCERS_ENABLED";
  function setFlags(schemaReady: boolean, producersEnabled: boolean) {
    if (schemaReady) process.env[SCHEMA_FLAG] = "true";
    else delete process.env[SCHEMA_FLAG];
    if (producersEnabled) process.env[PRODUCER_FLAG] = "true";
    else delete process.env[PRODUCER_FLAG];
  }
  function clearFlags() {
    delete process.env[SCHEMA_FLAG];
    delete process.env[PRODUCER_FLAG];
  }

  async function seedDeletableProject(
    suffix: string,
    hist?: { event?: boolean; cost?: boolean; archive?: boolean },
  ) {
    const p = await db.project.create({
      data: {
        id: `${P}del_${suffix}`,
        name: `P1 删除测试 ${suffix}`,
        orgId: `${P}org_a`,
        ownerId: `${P}user_a`,
      },
    });
    if (hist?.event) {
      await db.$transaction((tx) =>
        appendProjectEvent({
          tx, orgId: `${P}org_a`, projectId: p.id,
          eventType: "project.created", eventKey: projectCreatedEventKey(p.id),
          occurredAt: p.createdAt, actor, title: "history",
        }),
      );
    }
    if (hist?.cost) {
      await db.projectCost.create({
        data: {
          orgId: `${P}org_a`, projectId: p.id, costStatus: "PLANNED",
          category: "OTHER", amountPlanned: "100.00", currency: "CAD",
          incurredAt: new Date(), createdById: `${P}user_a`,
        },
      });
    }
    if (hist?.archive) {
      await db.tenderArchiveItem.create({
        data: {
          orgId: `${P}org_a`, projectId: p.id, kind: "tender_document",
          captureKey: `${P}ck_${suffix}`, capturedAt: new Date(), captureMethod: "upload",
          mimeType: "application/pdf", fileSize: 10, contentHash: `${P}hash_${suffix}`,
          storageKey: `archive/${P}org_a/xx/${P}hash_${suffix}`,
        },
      });
    }
    return p;
  }

  function callDelete(pid: string) {
    const req = new NextRequest(`http://localhost/api/projects/${pid}`, {
      method: "DELETE",
      headers: { cookie: `qy_session=${token}` },
    });
    return DELETE(req as never, { params: Promise.resolve({ id: pid }) });
  }

  // M1 access spy（T3.5）：历史 count 已移入 DELETE 事务（tx.*），故须在 $transaction
  // 层拦截——包裹回调、代理传入的 tx 客户端，观测/拦截其对三张 M1 表的 .count 访问。
  // 证明 gate OFF 时 DELETE 对 M1 表 0 次访问（生产缺表也不会 table-not-found）。
  const M1_MODELS = ["projectEvent", "projectCost", "tenderArchiveItem"];
  const origTransaction = db.$transaction.bind(db) as (
    arg: unknown,
    opts?: unknown,
  ) => Promise<unknown>;
  let m1Touches = 0;
  let m1Mode: "count" | "throw" = "count";
  function makeTxProxy(realTx: object): object {
    return new Proxy(realTx, {
      get(t, prop, r) {
        if (typeof prop === "string" && M1_MODELS.includes(prop)) {
          const delegate = Reflect.get(t, prop, r) as object;
          return new Proxy(delegate, {
            get(d, dprop, dr) {
              if (dprop === "count") {
                return (...args: unknown[]) => {
                  if (m1Mode === "throw") {
                    throw new Error(`M1 ${prop}.count 不应在 gate OFF 时被调用`);
                  }
                  m1Touches += 1;
                  const fn = Reflect.get(d, dprop, dr) as (...a: unknown[]) => unknown;
                  return fn.apply(d, args);
                };
              }
              const v = Reflect.get(d, dprop, dr);
              return typeof v === "function"
                ? (v as (...a: unknown[]) => unknown).bind(d)
                : v;
            },
          });
        }
        const v = Reflect.get(t, prop, r);
        return typeof v === "function"
          ? (v as (...a: unknown[]) => unknown).bind(t)
          : v;
      },
    });
  }
  function installSpies(mode: "count" | "throw" = "count") {
    m1Touches = 0;
    m1Mode = mode;
    Object.defineProperty(db, "$transaction", {
      value: (arg: unknown, opts?: unknown) =>
        typeof arg === "function"
          ? origTransaction(
              (realTx: object) => (arg as (tx: object) => unknown)(makeTxProxy(realTx)),
              opts,
            )
          : origTransaction(arg, opts),
      configurable: true,
      writable: true,
    });
  }
  function restoreSpies() {
    Object.defineProperty(db, "$transaction", {
      value: origTransaction,
      configurable: true,
      writable: true,
    });
  }

  // ══ DEL-SCHEMA：Producer Kill Switch ≠ Deletion Protection Kill Switch（T3.5 核心）══
  // DEL-SCHEMA-01：schemaReady=false, producer=false → 0 次 M1 访问 → legacy 删除
  setFlags(false, false);
  const s1 = await seedDeletableProject("schema1");
  installSpies("count");
  const s1Res = await callDelete(s1.id);
  restoreSpies();
  const s1Gone = (await db.project.count({ where: { id: s1.id } })) === 0;
  ok("DEL-SCHEMA-01 schemaReady=false：DELETE 零访问 M1 表", m1Touches === 0);
  ok("DEL-SCHEMA-01 schemaReady=false：legacy hard delete 照常", s1Res.status === 200 && s1Gone);

  // DEL-DARK-01（保留）：两 flag 全 OFF → 与 T2 前删除行为一致
  setFlags(false, false);
  const darkProj = await seedDeletableProject("dark");
  installSpies("count");
  const darkRes = await callDelete(darkProj.id);
  restoreSpies();
  const darkGone = (await db.project.count({ where: { id: darkProj.id } })) === 0;
  ok("DEL-DARK-01 gate OFF：DELETE 零访问 M1 表", m1Touches === 0);
  ok("DEL-DARK-01 gate OFF：删除照常完成（前 T2 行为不变）", darkRes.status === 200 && darkGone);

  // DEL-SCHEMA-02：schemaReady=true, producer=false, ProjectEvent>0 → 409（producer OFF 仍保护）
  setFlags(true, false);
  const s2 = await seedDeletableProject("schema2", { event: true });
  const s2Res = await callDelete(s2.id);
  const s2Body = (await s2Res.json()) as { code?: string };
  ok(
    "DEL-SCHEMA-02 producer OFF + ProjectEvent>0：409（producer≠deletion kill switch）",
    s2Res.status === 409 && s2Body.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-SCHEMA-02 producer OFF + ProjectEvent>0：项目保留", (await db.project.count({ where: { id: s2.id } })) === 1);

  // DEL-SCHEMA-03：schemaReady=true, producer=false, ProjectCost>0 → 409
  const s3 = await seedDeletableProject("schema3", { cost: true });
  const s3Res = await callDelete(s3.id);
  const s3Body = (await s3Res.json()) as { code?: string };
  ok(
    "DEL-SCHEMA-03 producer OFF + ProjectCost>0：409",
    s3Res.status === 409 && s3Body.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-SCHEMA-03 producer OFF + ProjectCost>0：项目保留", (await db.project.count({ where: { id: s3.id } })) === 1);

  // DEL-SCHEMA-04：schemaReady=true, producer=false, TenderArchiveItem>0 → 409
  const s4 = await seedDeletableProject("schema4", { archive: true });
  const s4Res = await callDelete(s4.id);
  const s4Body = (await s4Res.json()) as { code?: string };
  ok(
    "DEL-SCHEMA-04 producer OFF + TenderArchiveItem>0：409",
    s4Res.status === 409 && s4Body.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-SCHEMA-04 producer OFF + TenderArchiveItem>0：项目保留", (await db.project.count({ where: { id: s4.id } })) === 1);

  // DEL-SCHEMA-05：schemaReady=true, producer=false, 无历史 → hard delete 继续
  const s5 = await seedDeletableProject("schema5");
  installSpies("count");
  const s5Res = await callDelete(s5.id);
  restoreSpies();
  const s5Gone = (await db.project.count({ where: { id: s5.id } })) === 0;
  ok("DEL-SCHEMA-05 producer OFF + 无历史：M1 表被查询（gate 运行）", m1Touches === 3);
  ok("DEL-SCHEMA-05 producer OFF + 无历史：hard delete 继续", s5Res.status === 200 && s5Gone);

  // ── DEL-ACTIVE（保留）：完全激活（schema+producer）× 历史矩阵 ──
  // DEL-ACTIVE-01：全激活 + 无历史 → 允许删除
  setFlags(true, true);
  const activeNoHist = await seedDeletableProject("active1");
  installSpies("count");
  const a1Res = await callDelete(activeNoHist.id);
  restoreSpies();
  const a1Gone = (await db.project.count({ where: { id: activeNoHist.id } })) === 0;
  ok("DEL-ACTIVE-01 全激活 + 无历史：M1 表被查询", m1Touches === 3);
  ok("DEL-ACTIVE-01 全激活 + 无历史：删除继续", a1Res.status === 200 && a1Gone);

  // DEL-ACTIVE-02：全激活 + 账本历史 → 409
  const activeHist = await seedDeletableProject("active2", { event: true });
  const a2Res = await callDelete(activeHist.id);
  const a2Body = (await a2Res.json()) as { code?: string };
  ok(
    "DEL-ACTIVE-02 全激活 + 账本历史：409 PROJECT_HAS_LEDGER_HISTORY",
    a2Res.status === 409 && a2Body.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-ACTIVE-02 全激活 + 账本历史：项目未被删除", (await db.project.count({ where: { id: activeHist.id } })) === 1);

  // DEL-ACTIVE-03：全激活 + 仅成本历史 → 409
  const activeCost = await seedDeletableProject("active3", { cost: true });
  const a3Res = await callDelete(activeCost.id);
  const a3Body = (await a3Res.json()) as { code?: string };
  ok(
    "DEL-ACTIVE-03 全激活 + ProjectCost>0：409 PROJECT_HAS_LEDGER_HISTORY",
    a3Res.status === 409 && a3Body.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-ACTIVE-03 全激活 + ProjectCost>0：项目未被删除", (await db.project.count({ where: { id: activeCost.id } })) === 1);

  // DEL-ACTIVE-04：全激活 + 仅档案历史 → 409
  const activeArc = await seedDeletableProject("active4", { archive: true });
  const a4Res = await callDelete(activeArc.id);
  const a4Body = (await a4Res.json()) as { code?: string };
  ok(
    "DEL-ACTIVE-04 全激活 + TenderArchiveItem>0：409 PROJECT_HAS_LEDGER_HISTORY",
    a4Res.status === 409 && a4Body.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-ACTIVE-04 全激活 + TenderArchiveItem>0：项目未被删除", (await db.project.count({ where: { id: activeArc.id } })) === 1);

  // DEL-ACTIVE-05：gate OFF + throw-if-called → 结构性 gate 完全不触 count（无 table-not-found）
  setFlags(false, false);
  const a5Proj = await seedDeletableProject("active5");
  installSpies("throw");
  let a5Threw = false;
  let a5Res: Awaited<ReturnType<typeof callDelete>> | null = null;
  try {
    a5Res = await callDelete(a5Proj.id);
  } catch {
    a5Threw = true;
  } finally {
    restoreSpies();
  }
  const a5Gone = (await db.project.count({ where: { id: a5Proj.id } })) === 0;
  ok(
    "DEL-ACTIVE-05 gate OFF + throw-if-called：DELETE 未触发 count（无 table-not-found）",
    !a5Threw && a5Res?.status === 200 && a5Gone,
  );

  // ══ DEL-RACE-01：hard delete × ledger writer 真实事务并发（关闭 TOCTOU）══
  console.log("━━ DEL-RACE-01 并发锚点竞争（真实事务交错）━━");
  const { lockProjectHistoryAnchorForDelete, countProjectAuthoritativeHistory } =
    await import("../history-anchor");
  setFlags(true, true);

  function deferred<T = void>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function orphanState(pid: string) {
    const pExists = (await db.project.count({ where: { id: pid } })) > 0;
    const ev = await db.projectEvent.count({ where: { projectId: pid } });
    const co = await db.projectCost.count({ where: { projectId: pid } });
    const ar = await db.tenderArchiveItem.count({ where: { projectId: pid } });
    const history = ev + co + ar;
    return { pExists, history, orphan: !pExists && history > 0 };
  }

  // Race A：writer 先持 FOR KEY SHARE → delete 的 FOR UPDATE 阻塞 → writer 提交历史
  //         → delete 锁内看到历史 → 409（项目保留，无 orphan）
  const raceA = await db.project.create({
    data: { id: `${P}race_a`, name: "race A", orgId: `${P}org_a`, ownerId: `${P}user_a` },
  });
  const aLocked = deferred();
  const aRelease = deferred();
  const aWriter = db.$transaction(async (tx) => {
    await appendProjectEvent({
      tx, orgId: `${P}org_a`, projectId: raceA.id,
      eventType: "project.created", eventKey: projectCreatedEventKey(raceA.id),
      occurredAt: raceA.createdAt, actor, title: "race A history",
    });
    aLocked.resolve();          // 已持 FOR KEY SHARE + 已插入事件（未提交）
    await aRelease.promise;      // 保持事务开启，持锁
  }, { timeout: 20000 });
  await aLocked.promise;
  const aDeleteP = callDelete(raceA.id);   // 路由内 FOR UPDATE 阻塞于 writer 的 FKS
  await sleep(500);                        // 让 delete 抵达并阻塞在锚锁
  aRelease.resolve();                      // writer 提交 → 事件可见
  const aDelRes = await aDeleteP;
  await aWriter;
  const aBody = (await aDelRes.json().catch(() => ({}))) as { code?: string };
  const aState = await orphanState(raceA.id);
  ok(
    "DEL-RACE-01 Race A：writer 先持锁 → delete 阻塞后看到历史 → 409",
    aDelRes.status === 409 && aBody.code === "PROJECT_HAS_LEDGER_HISTORY",
  );
  ok("DEL-RACE-01 Race A：项目保留、无 orphan", aState.pExists && !aState.orphan);

  // Race B：delete 先持 FOR UPDATE（helper 复刻路由 gate）→ writer 的 FKS 阻塞
  //         → delete 提交删除 → writer 见锚消失 → LedgerTenantError（writer 回滚，无 orphan）
  const raceB = await db.project.create({
    data: { id: `${P}race_b`, name: "race B", orgId: `${P}org_a`, ownerId: `${P}user_a` },
  });
  const bLocked = deferred();
  const bRelease = deferred();
  const bDeleteP = db.$transaction(async (tx) => {
    const exists = await lockProjectHistoryAnchorForDelete(tx, raceB.id);  // FOR UPDATE
    const hist = await countProjectAuthoritativeHistory(tx, raceB.id);     // 0
    bLocked.resolve();
    await bRelease.promise;
    if (!exists || hist.total > 0) return "gated" as const;
    await tx.task.updateMany({ where: { projectId: raceB.id }, data: { projectId: null } });
    await tx.blindsOrder.updateMany({ where: { projectId: raceB.id }, data: { projectId: null } });
    await tx.auditLog.updateMany({ where: { projectId: raceB.id }, data: { projectId: null } });
    await tx.agentTask.deleteMany({ where: { projectId: raceB.id } });
    await tx.project.delete({ where: { id: raceB.id } });
    return "deleted" as const;
  }, { timeout: 20000 });
  await bLocked.promise;
  const bWriterP = db.$transaction(
    async (tx) =>
      appendProjectEvent({
        tx, orgId: `${P}org_a`, projectId: raceB.id,
        eventType: "project.created", eventKey: projectCreatedEventKey(raceB.id),
        occurredAt: raceB.createdAt, actor, title: "race B late history",
      }),
    { timeout: 20000 },
  ).then(() => "committed").catch((e) => errCode(e) ?? "error");
  await sleep(500);              // 让 writer 抵达并阻塞在 FKS
  bRelease.resolve();           // delete 提交删除
  const bDelOutcome = await bDeleteP;
  const bWriter = await bWriterP;
  const bState = await orphanState(raceB.id);
  ok(
    "DEL-RACE-01 Race B：delete 先持锁 → writer 阻塞后见锚消失 → 拒绝（LEDGER_TENANT_MISMATCH）",
    bDelOutcome === "deleted" && bWriter === "LEDGER_TENANT_MISMATCH",
  );
  ok(
    "DEL-RACE-01 Race B：项目已删且无 orphan history",
    !bState.pExists && bState.history === 0,
  );

  ok(
    "DEL-RACE-01 ORPHAN_AUTHORITATIVE_HISTORY = 0（两向交错均无 orphan）",
    !aState.orphan && !bState.orphan,
  );

  clearFlags();

  await cleanup();
  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[p1-ledger-db] FAIL", e);
  process.exit(1);
});
