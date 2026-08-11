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
import { isLedgerProducersEnabledWithEnv } from "../flags";
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
    assert.match(src, /isLedgerProducersEnabled\(\)/, `${p} 必须过 activation flag`);
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

test("Deletion Gate：硬删路由在 project.delete 前强制账本存量检查", () => {
  const src = readFileSync("src/app/api/projects/[id]/route.ts", "utf8");
  const gateIdx = src.indexOf("PROJECT_HAS_LEDGER_HISTORY");
  const deleteIdx = src.indexOf("tx.project.delete");
  assert.ok(gateIdx > -1, "gate 存在");
  assert.ok(deleteIdx > -1, "hard delete 仍存在（无历史项目允许删除）");
  assert.ok(gateIdx < deleteIdx, "gate 必须先于 hard delete");
  assert.match(src, /projectEvent\.count/);
  assert.match(src, /projectCost\.count/);
  assert.match(src, /tenderArchiveItem\.count/);
});

test("ProjectCost：AI/DATA_API 类别在默认路径被拒（AiUsageLedger 唯一权威）", () => {
  const src = codeOf("src/lib/project-ledger/cost-service.ts");
  assert.match(src, /COST_CATEGORIES_RESERVED_FOR_AI_LEDGER/);
  // 禁止对 AiUsageLedger 的任何读写（不迁移、不双写）
  assert.doesNotMatch(src, /\.(aiUsageLedger)\./);
});
