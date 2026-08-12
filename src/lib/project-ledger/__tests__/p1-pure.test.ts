/**
 * Tender T2-P1 — 纯逻辑不变量（零 DB）
 *
 * ①eventKey 确定性契约 ②activation flag 默认关/fail-closed
 * ③EV-05 重试耗尽 THROW（mock tx，绝不 return null）④EV-08 actor 伪造拒绝
 * ⑤producer 路由静态纪律（事务内 append / flag 门 / 无直接 create / 无事件修改 API）
 * ⑥Deletion Gate 静态存在性
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

/** 剥离注释后的代码文本（负向断言只针对真实代码，不误伤文档注释） */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("*/");
    })
    .join("\n");
}
import { Prisma } from "@prisma/client";
import {
  projectCreatedEventKey,
  projectUpdatedEventKey,
  projectMemberAddedEventKey,
  projectMemberRemovedEventKey,
  costRevisionEventKey,
  costStatusEventKey,
} from "../event-keys";
import {
  isLedgerProducersEnabledWithEnv,
  isLedgerSchemaReadyWithEnv,
  isLedgerProducerActiveWithEnv,
  isLedgerDeletionGateActiveWithEnv,
} from "../flags";
import {
  appendProjectEvent,
  PROJECT_EVENT_SEQUENCE_MAX_RETRIES,
} from "../event-service";
import {
  LedgerContractError,
  LedgerSeqContentionError,
} from "../types";

test("eventKey：确定性 / 动作区分 / 禁随机源", () => {
  assert.equal(projectCreatedEventKey("p1"), "project.created:p1");

  const k1 = projectUpdatedEventKey("p1", "2026-08-11T00:00:00.000Z", ["name"], { name: "B" });
  const k2 = projectUpdatedEventKey("p1", "2026-08-11T00:00:00.000Z", ["name"], { name: "B" });
  assert.equal(k1, k2, "同一逻辑动作 retry → 同 key");

  // A→B→A→B：第三次变更前置 updatedAt 不同 → 新 key
  const k3 = projectUpdatedEventKey("p1", "2026-08-11T01:00:00.000Z", ["name"], { name: "B" });
  assert.notEqual(k1, k3, "不同前置状态 → 新动作新 key");

  // 加入→移除→再加入：membership-version 区分
  assert.notEqual(
    projectMemberAddedEventKey("m1", 1),
    projectMemberAddedEventKey("m1", 2),
  );
  assert.equal(projectMemberRemovedEventKey("m1", 1), "project.member.removed:m1:v1");

  assert.equal(costStatusEventKey("c1", "PLANNED"), "cost:c1:PLANNED");
  assert.notEqual(costRevisionEventKey("c1", 1), costRevisionEventKey("c1", 2));

  // 禁止随机/墙钟参与 key 的静态纪律（仅检查真实代码，文档注释可提及禁令本身）
  assert.doesNotMatch(codeOf("src/lib/project-ledger/event-keys.ts"), /Math\.random|Date\.now|randomUUID/);
});

test("activation flag：default OFF / fail-closed", () => {
  assert.equal(isLedgerProducersEnabledWithEnv({}), false);
  assert.equal(isLedgerProducersEnabledWithEnv({ T2_LEDGER_PRODUCERS_ENABLED: "" }), false);
  assert.equal(isLedgerProducersEnabledWithEnv({ T2_LEDGER_PRODUCERS_ENABLED: "0" }), false);
  assert.equal(isLedgerProducersEnabledWithEnv({ T2_LEDGER_PRODUCERS_ENABLED: "maybe" }), false);
  assert.equal(isLedgerProducersEnabledWithEnv({ T2_LEDGER_PRODUCERS_ENABLED: "true" }), true);
  assert.equal(isLedgerProducersEnabledWithEnv({ T2_LEDGER_PRODUCERS_ENABLED: "1" }), true);
});

test("T3.5 flag 解耦契约：SCHEMA_READY 默认关；Producer = SCHEMA && PRODUCER（fail-closed）；Deletion Gate = SCHEMA", () => {
  // SCHEMA_READY 默认关 / fail-closed
  assert.equal(isLedgerSchemaReadyWithEnv({}), false);
  assert.equal(isLedgerSchemaReadyWithEnv({ T2_LEDGER_SCHEMA_READY: "true" }), true);
  assert.equal(isLedgerSchemaReadyWithEnv({ T2_LEDGER_SCHEMA_READY: "0" }), false);

  const on = { T2_LEDGER_SCHEMA_READY: "true", T2_LEDGER_PRODUCERS_ENABLED: "true" };
  const schemaOnly = { T2_LEDGER_SCHEMA_READY: "true" };
  const producerOnly = { T2_LEDGER_PRODUCERS_ENABLED: "true" };

  // Producer Write = SCHEMA && PRODUCER
  assert.equal(isLedgerProducerActiveWithEnv({}), false);
  assert.equal(isLedgerProducerActiveWithEnv(on), true);
  assert.equal(isLedgerProducerActiveWithEnv(schemaOnly), false); // 有 schema 无 producer → OFF
  // fail-closed 关键：producer=ON 但 schema=OFF → producer 仍 OFF（绝不在 schema 未就绪时写 M1）
  assert.equal(isLedgerProducerActiveWithEnv(producerOnly), false);

  // Deletion Gate = SCHEMA（与 producer 完全解耦：producer OFF 也保护已有历史）
  assert.equal(isLedgerDeletionGateActiveWithEnv({}), false);
  assert.equal(isLedgerDeletionGateActiveWithEnv(schemaOnly), true);   // producer OFF 但 gate ON
  assert.equal(isLedgerDeletionGateActiveWithEnv(producerOnly), false); // 无 schema → gate OFF
  assert.equal(isLedgerDeletionGateActiveWithEnv(on), true);

  // 决定性证明：Producer Kill Switch ≠ Deletion Protection Kill Switch
  assert.equal(isLedgerProducerActiveWithEnv(schemaOnly), false);
  assert.equal(isLedgerDeletionGateActiveWithEnv(schemaOnly), true);
});

function seqConflictError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.2",
    meta: { target: ["projectId", "seq"] },
  });
}

function mockTx(overrides: Record<string, unknown> = {}) {
  let createCalls = 0;
  const tx = {
    project: { findFirst: async () => ({ id: "p1" }) },
    // T3.5 授权锚锁：lockProjectHistoryAnchorShared 走 tx.$queryRaw(FOR KEY SHARE)；
    // mock 返回锚点存在（[{id}]），使 append 进入 seq 逻辑而非提前抛租户错误。
    $queryRaw: async () => [{ id: "p1" }],
    projectEvent: {
      findUnique: async () => null,
      aggregate: async () => ({ _max: { seq: 1 } }),
      create: async () => {
        createCalls += 1;
        throw seqConflictError();
      },
    },
    projectEventActor: { create: async () => ({}) },
    $executeRawUnsafe: async () => 0,
    ...overrides,
  };
  return { tx: tx as never, calls: () => createCalls };
}

test("EV-05：seq 竞争重试耗尽 → THROW（有界、绝不 return null）", async () => {
  const { tx, calls } = mockTx();
  await assert.rejects(
    appendProjectEvent({
      tx,
      orgId: "o1",
      projectId: "p1",
      eventType: "project.updated",
      eventKey: "k",
      occurredAt: new Date(),
      actor: { actorType: "user", actorId: "u1" },
      title: "t",
      maxSeqRetries: 3,
    }),
    (e: unknown) =>
      e instanceof LedgerSeqContentionError && e.attempts === 4,
  );
  assert.equal(calls(), 4, "attempts = maxRetries + 1（有界）");
});

test("EV-05 默认上限 = #96 冻结值 8", async () => {
  const { tx, calls } = mockTx();
  await assert.rejects(
    appendProjectEvent({
      tx,
      orgId: "o1",
      projectId: "p1",
      eventType: "project.updated",
      eventKey: "k",
      occurredAt: new Date(),
      actor: { actorType: "user", actorId: "u1" },
      title: "t",
    }),
    (e: unknown) => e instanceof LedgerSeqContentionError,
  );
  assert.equal(PROJECT_EVENT_SEQUENCE_MAX_RETRIES, 8);
  assert.equal(calls(), 9);
});

test("EV-08：actor 伪造/契约违规拒绝（THROW 而非忽略）", async () => {
  const { tx } = mockTx();
  await assert.rejects(
    appendProjectEvent({
      tx,
      orgId: "o1",
      projectId: "p1",
      eventType: "x",
      eventKey: "k",
      occurredAt: new Date(),
      actor: { actorType: "hacker" as never, actorId: "u1" },
      title: "t",
    }),
    (e: unknown) => e instanceof LedgerContractError,
  );
  // 缺 tx = 编程错误（authoritative atomicity 由类型+运行时双重强制）
  await assert.rejects(
    appendProjectEvent({
      tx: undefined as never,
      orgId: "o1",
      projectId: "p1",
      eventType: "x",
      eventKey: "k",
      occurredAt: new Date(),
      actor: { actorType: "user" },
      title: "t",
    }),
    (e: unknown) => e instanceof LedgerContractError,
  );
});

test("producer 静态纪律：事务内 append + flag 门 + server-authored", () => {
  const producers = [
    "src/app/api/projects/route.ts",
    "src/app/api/projects/[id]/route.ts",
    "src/app/api/projects/[id]/members/route.ts",
    "src/app/api/projects/[id]/members/[memberId]/route.ts",
  ];
  for (const p of producers) {
    const src = readFileSync(p, "utf8");
    assert.match(src, /appendProjectEvent\(\{\s*\n?\s*tx/, `${p} 必须以 tx 调用 canonical service`);
    // T3.5：producer 站点必须用 isLedgerProducerActive()（= SCHEMA_READY && PRODUCERS_ENABLED，fail-closed），
    // 不得单独用 isLedgerProducersEnabled()（会绕过 schema-ready 前置）
    assert.match(src, /isLedgerProducerActive\(\)/, `${p} 必须过 producer-active 复合闸`);
    assert.doesNotMatch(src, /isLedgerProducersEnabled\(\)/, `${p} 不得单独用 producers-enabled（须用 producer-active）`);
    assert.doesNotMatch(src, /projectEvent\.create/, `${p} 禁止直接 create`);
    // 客户端不得注入 ledger 身份字段：actor 取自服务端 user 上下文
    assert.match(src, /actorType: "user", actorId: user\.id/, `${p} actor 必须来自服务端上下文`);
    assert.doesNotMatch(src, /body\.(eventKey|eventType|actorId|actorType)/, `${p} 禁止客户端提交 ledger 字段`);
  }
});

test("canonical 唯一写入口：全库无旁路 projectEvent 写", () => {
  // event-service 是唯一 projectEvent.create 调用点（测试文件除外）
  const svc = codeOf("src/lib/project-ledger/event-service.ts");
  assert.match(svc, /tx\.projectEvent\.create/);
  assert.match(svc, /throw new LedgerSeqContentionError/);
  assert.doesNotMatch(svc, /return null/);
  assert.doesNotMatch(svc, /console\.error\([^)]*\);\s*return/, "禁止 log-and-continue");
});

test("无事件修改 API：不存在 /api/project-events 写路由", () => {
  assert.equal(existsSync("src/app/api/project-events"), false);
  assert.equal(existsSync("src/app/api/projects/[id]/events"), false);
});

test("Deletion Gate（T3.5）：锚锁 + 历史检查 + hard delete 同一事务、顺序正确", () => {
  const src = readFileSync("src/app/api/projects/[id]/route.ts", "utf8");
  const deleteStart = src.indexOf("export async function DELETE");
  assert.ok(deleteStart > -1, "DELETE handler 存在");
  const body = src.slice(deleteStart);

  const txIdx = body.indexOf("db.$transaction");
  const lockIdx = body.indexOf("lockProjectHistoryAnchorForDelete");
  const countIdx = body.indexOf("countProjectAuthoritativeHistory");
  const gateIdx = body.indexOf("PROJECT_HAS_LEDGER_HISTORY");
  const deleteIdx = body.indexOf("tx.project.delete");

  for (const [label, idx] of [
    ["db.$transaction", txIdx],
    ["FOR UPDATE 锚锁", lockIdx],
    ["历史统计委托", countIdx],
    ["PROJECT_HAS_LEDGER_HISTORY", gateIdx],
    ["tx.project.delete", deleteIdx],
  ] as const) {
    assert.ok(idx > -1, `${label} 存在`);
  }
  // TOCTOU 关闭：整套逻辑在事务内；FOR UPDATE 锚锁 → 历史统计 → （无历史才）删除
  assert.ok(txIdx < lockIdx, "锚锁必须在删除事务内");
  assert.ok(lockIdx < countIdx, "FOR UPDATE 锚锁必须先于历史统计（关闭 check↔delete 窗口）");
  assert.ok(countIdx < deleteIdx, "历史统计必须先于 hard delete");
  // 历史统计委托给共享 helper（不在 route 内散写 count），route 自身不得直接 count M1 表
  assert.doesNotMatch(body, /tx\.projectEvent\.count/, "route 不得内联 projectEvent.count（委托 helper）");
});

test("Dark-merge 安全（T3.5）：Deletion Gate 的 M1 访问受 SCHEMA_READY 门控、与 producer 解耦", () => {
  const src = readFileSync("src/app/api/projects/[id]/route.ts", "utf8");
  const deleteStart = src.indexOf("export async function DELETE");
  const body = src.slice(deleteStart);

  // gate 用 deletion-gate 闸（= SCHEMA_READY），不得用 producer 闸
  const gateFlagIdx = body.indexOf("isLedgerDeletionGateActive()");
  assert.ok(gateFlagIdx > -1, "DELETE 用 isLedgerDeletionGateActive() 门控历史访问");
  assert.doesNotMatch(body, /isLedgerProducerActive\(\)/, "DELETE gate 不得复用 producer 闸（须解耦）");
  assert.doesNotMatch(body, /isLedgerProducersEnabled\(\)/, "DELETE gate 不得用旧 producers-enabled 闸");

  // M1 访问（委托 helper）必须在 gate 判定之后
  const countIdx = body.indexOf("countProjectAuthoritativeHistory");
  assert.ok(gateFlagIdx < countIdx, "SCHEMA_READY 判定必须先于任何 M1 表访问");

  // helper 内的 count 也必须只在 SCHEMA_READY 分支被调用（route 内 gate 变量控制）
  assert.match(body, /if \(gateActive\)/, "M1 历史访问包在 gateActive 分支内");
});

test("写入侧授权锚锁（T3.5）：appendProjectEvent / createProjectCost 写历史前取 FOR KEY SHARE", () => {
  const ev = readFileSync("src/lib/project-ledger/event-service.ts", "utf8");
  const cost = readFileSync("src/lib/project-ledger/cost-service.ts", "utf8");
  const anchor = readFileSync("src/lib/project-ledger/history-anchor.ts", "utf8");

  // 共享 helper 定义 FOR KEY SHARE / FOR UPDATE 两把锁
  assert.match(anchor, /FOR KEY SHARE/, "shared 锁 = FOR KEY SHARE（writer 间兼容）");
  assert.match(anchor, /FOR UPDATE/, "delete 锁 = FOR UPDATE（与 writer 互斥）");

  // appendProjectEvent：锚锁先于 create（关闭 append↔delete 窗口）
  assert.match(ev, /lockProjectHistoryAnchorShared/, "appendProjectEvent 取共享锚锁");
  const evLock = ev.indexOf("lockProjectHistoryAnchorShared");
  const evCreate = ev.indexOf("tx.projectEvent.create");
  assert.ok(evLock > -1 && evCreate > -1 && evLock < evCreate, "锚锁必须先于 projectEvent.create");

  // createProjectCost：锚锁先于 cost.create（cost 行本身即权威历史）
  assert.match(cost, /lockProjectHistoryAnchorShared/, "createProjectCost 取共享锚锁");
  const costLock = cost.indexOf("lockProjectHistoryAnchorShared");
  const costCreate = cost.indexOf("tx.projectCost.create");
  assert.ok(costLock > -1 && costCreate > -1 && costLock < costCreate, "锚锁必须先于 projectCost.create");
});

test("ProjectCost：AI/DATA_API 类别在默认路径被拒（AiUsageLedger 唯一权威）", () => {
  const src = codeOf("src/lib/project-ledger/cost-service.ts");
  assert.match(src, /COST_CATEGORIES_RESERVED_FOR_AI_LEDGER/);
  // 禁止对 AiUsageLedger 的任何读写（不迁移、不双写）
  assert.doesNotMatch(src, /\.(aiUsageLedger)\./);
});
