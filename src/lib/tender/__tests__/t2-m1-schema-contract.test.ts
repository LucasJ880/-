/**
 * Tender T2-M1 schema 契约静态测试（无 DB）。
 *
 * 守护 PR #96 Final Contract 冻结的四表形状：唯一约束、FK 边界、租户列。
 * DB 级约束行为由 scripts/tender-t2-m1-isolated-migrate-verify.ts 在隔离 Neon 分支验证。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

function modelBlock(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `model ${name} missing`);
  return match[0];
}

test("ProjectEvent：账本核心形状与双唯一约束", () => {
  const m = modelBlock("ProjectEvent");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /projectId\s+String\n/);
  assert.match(m, /seq\s+Int\n/);
  assert.match(m, /eventKey\s+String\n/);
  assert.match(m, /occurredAt\s+DateTime\n/);
  assert.match(m, /correctionOfEventId\s+String\?/);
  assert.match(m, /relatedDocumentId\s+String\?/);
  assert.match(m, /relatedCostId\s+String\?/);
  assert.match(m, /@@unique\(\[projectId, seq\]\)/);
  assert.match(m, /@@unique\(\[projectId, eventKey\]\)/);
  // 无 update 语义字段：append-only 表不设 updatedAt
  assert.doesNotMatch(m, /updatedAt/);
  // 刻意无 Project/User FK：只允许 actors 关系
  assert.doesNotMatch(m, /project\s+Project\s+@relation/);
  assert.doesNotMatch(m, /user\s+User\s+@relation/i);
});

test("ProjectEventActor：唯一内部 FK 且 Restrict", () => {
  const m = modelBlock("ProjectEventActor");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /@@unique\(\[eventId, actorKey\]\)/);
  assert.match(m, /onDelete: Restrict/);
  assert.doesNotMatch(m, /onDelete: Cascade/);
});

test("ProjectCost：三金额留痕 + revisionCount 幂等号", () => {
  const m = modelBlock("ProjectCost");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /costStatus\s+String\n/);
  assert.match(m, /amountPlanned\s+Decimal\?\s+@db\.Decimal\(18, 2\)/);
  assert.match(m, /amountCommitted\s+Decimal\?\s+@db\.Decimal\(18, 2\)/);
  assert.match(m, /amountActual\s+Decimal\?\s+@db\.Decimal\(18, 2\)/);
  assert.match(m, /revisionCount\s+Int\s+@default\(0\)/);
  assert.match(m, /correctionOfCostId\s+String\?/);
  assert.match(m, /@@index\(\[orgId, projectId, costStatus\]\)/);
  assert.doesNotMatch(m, /project\s+Project\s+@relation/);
});

test("TenderArchiveItem：双唯一约束 + 无 default capturedAt + 无外部 FK", () => {
  const m = modelBlock("TenderArchiveItem");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /@@unique\(\[orgId, projectId, captureKey, contentHash\]\)/);
  assert.match(m, /@@unique\(\[orgId, projectId, captureKey, snapshotVersion\]\)/);
  // capturedAt 显式传入：不允许 default(now)（MarketSnapshot 语义错误教训）
  assert.match(m, /capturedAt\s+DateTime\n/);
  assert.doesNotMatch(m, /capturedAt\s+DateTime\s+@default/);
  assert.match(m, /supersedesSnapshotId\s+String\?/);
  // 证据链方向：新→旧；不允许 supersededBy 回写列（仅禁字段定义，注释中可提及）
  assert.doesNotMatch(m, /supersededBy\w*\s+(String|DateTime)/);
  assert.doesNotMatch(m, /project\s+Project\s+@relation/);
  assert.doesNotMatch(m, /document\s+ProjectDocument\s+@relation/i);
});

test("M1 边界：四表零 Cascade、migration 纯 additive", () => {
  for (const name of ["ProjectEvent", "ProjectCost", "TenderArchiveItem"]) {
    assert.doesNotMatch(modelBlock(name), /onDelete/);
  }
  const migration = readFileSync(
    "prisma/migrations/20260811002000_add_tender_t2_ledger_archive_foundation/migration.sql",
    "utf8",
  );
  assert.doesNotMatch(migration, /\bDROP\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "(?!ProjectEventActor")/);
  const creates = migration.match(/CREATE TABLE "([A-Za-z]+)"/g) ?? [];
  assert.deepEqual(
    creates.sort(),
    [
      'CREATE TABLE "ProjectCost"',
      'CREATE TABLE "ProjectEvent"',
      'CREATE TABLE "ProjectEventActor"',
      'CREATE TABLE "TenderArchiveItem"',
    ].sort(),
  );
  assert.match(migration, /ON DELETE RESTRICT/);
});
