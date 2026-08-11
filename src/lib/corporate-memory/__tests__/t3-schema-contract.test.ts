/**
 * Tender T3 Corporate Memory schema 契约静态测试（无 DB）。
 *
 * 守护 Buyer / MemoryClaim / MemoryClaimEvidence 三表的形状纪律：
 * additive-only、orgId 非空、无破坏性 Project/User FK、唯一内部 FK=Evidence→Claim(Restrict)、
 * 事实语义字段就位、供应链/租户列就位。
 * DB 级约束行为由 t3-corporate-memory-integration.test.ts 在隔离 Neon 分支验证。
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

test("Buyer：org 级 canonical identity，normalizedName 非唯一，无破坏性 FK", () => {
  const m = modelBlock("Buyer");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /canonicalName\s+String\n/);
  assert.match(m, /normalizedName\s+String\n/);
  assert.match(m, /websiteDomain\s+String\?/);
  assert.match(m, /aliases\s+String\[\]/);
  assert.match(m, /externalIdentifiers\s+Json\?/);
  assert.match(m, /status\s+String\s+@default\("ACTIVE"\)/);
  assert.match(m, /@@index\(\[orgId, normalizedName\]\)/);
  assert.match(m, /@@index\(\[orgId, websiteDomain\]\)/);
  // canonical identity 不得仅靠名字自动合并：normalizedName 刻意非 @@unique
  assert.doesNotMatch(m, /@@unique\(\[orgId, normalizedName\]\)/);
  // 无 Organization/User 破坏性关系
  assert.doesNotMatch(m, /org\s+Organization\s+@relation/);
  assert.doesNotMatch(m, /onDelete: Cascade/);
});

test("MemoryClaim：事实语义字段 + 生命周期 + supersession 链 + 分级/租户", () => {
  const m = modelBlock("MemoryClaim");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /subjectType\s+String\n/);
  assert.match(m, /subjectKey\s+String\n/);
  assert.match(m, /claimType\s+String\n/);
  // FACT vs INTERPRETATION vs INFERENCE 区分
  assert.match(m, /claimNature\s+String\n/);
  assert.match(m, /statement\s+String\s+@db\.Text/);
  // Confidence 与 Verification 分离
  assert.match(m, /confidence\s+String\n/);
  assert.match(m, /verificationStatus\s+String\n/);
  assert.match(m, /sourceType\s+String\n/);
  // 双时态
  assert.match(m, /capturedAt\s+DateTime\n/);
  assert.match(m, /validFrom\s+DateTime\?/);
  assert.match(m, /validTo\s+DateTime\?/);
  // 生命周期 + 新→旧 supersession 单向指针
  assert.match(m, /status\s+String\s+@default\("ACTIVE"\)/);
  assert.match(m, /supersedesClaimId\s+String\?/);
  assert.match(m, /retractedAt\s+DateTime\?/);
  // 访问分级 + actor
  assert.match(m, /accessClass\s+String\s+@default\("INTERNAL_COMPANY"\)/);
  assert.match(m, /createdByType\s+String\n/);
  // evidence 一等关系
  assert.match(m, /evidence\s+MemoryClaimEvidence\[\]/);
  // 索引契约
  assert.match(m, /@@index\(\[orgId, subjectType, subjectKey, status\]\)/);
  assert.match(m, /@@index\(\[orgId, claimType, status\]\)/);
  assert.match(m, /@@index\(\[orgId, status, capturedAt\]\)/);
  // capturedAt 是业务时间：无 @default（对齐 T2-M1 producer 供给纪律）
  assert.doesNotMatch(m, /capturedAt\s+DateTime\s+@default/);
  // 无破坏性 Project/User FK：subjectKey 是逻辑引用
  assert.doesNotMatch(m, /project\s+Project\s+@relation/);
  assert.doesNotMatch(m, /onDelete: Cascade/);
});

test("MemoryClaimEvidence：唯一内部 FK=Claim(Restrict)，逻辑来源引用无级联", () => {
  const m = modelBlock("MemoryClaimEvidence");
  assert.match(m, /orgId\s+String\n/);
  assert.match(m, /claimId\s+String\n/);
  assert.match(m, /claim\s+MemoryClaim\s+@relation/);
  assert.match(m, /onDelete: Restrict/);
  // 证据定位符
  assert.match(m, /archiveItemId\s+String\?/);
  assert.match(m, /documentId\s+String\?/);
  assert.match(m, /pageNumber\s+Int\?/);
  assert.match(m, /sourceSnippet\s+String\?\s+@db\.Text/);
  assert.match(m, /contentHash\s+String\?/);
  assert.match(m, /capturedAt\s+DateTime\n/);
  // per-evidence 访问分级（禁止 public/internal 塌缩）
  assert.match(m, /accessClass\s+String\s+@default\("INTERNAL_COMPANY"\)/);
  assert.match(m, /@@index\(\[claimId\]\)/);
  assert.match(m, /@@index\(\[orgId, archiveItemId\]\)/);
  // 证据表 append-only：无 updatedAt
  assert.doesNotMatch(m, /updatedAt/);
  // archiveItemId/documentId 无破坏性 FK（记忆保留 ≠ 来源保留）
  assert.doesNotMatch(m, /archiveItem\s+TenderArchiveItem\s+@relation/);
  assert.doesNotMatch(m, /onDelete: Cascade/);
});

test("T3 migration 为 additive-only（无 DROP / 无破坏性 ALTER）", () => {
  const sql = readFileSync(
    "prisma/migrations/20260811040000_add_tender_t3_corporate_memory_foundation/migration.sql",
    "utf8",
  );
  assert.match(sql, /CREATE TABLE "Buyer"/);
  assert.match(sql, /CREATE TABLE "MemoryClaim"/);
  assert.match(sql, /CREATE TABLE "MemoryClaimEvidence"/);
  // 唯一 FK = Evidence→Claim Restrict
  assert.match(
    sql,
    /ALTER TABLE "MemoryClaimEvidence" ADD CONSTRAINT[\s\S]*REFERENCES "MemoryClaim"[\s\S]*ON DELETE RESTRICT/,
  );
  // additive-only 纪律：不得触碰既有表 / 不得 DROP / 不得 TRUNCATE
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DROP COLUMN/i);
  assert.doesNotMatch(sql, /TRUNCATE/i);
  assert.doesNotMatch(sql, /ALTER TABLE "Project"/);
  assert.doesNotMatch(sql, /ALTER TABLE "ProjectInsight"/);
  assert.doesNotMatch(sql, /ALTER TABLE "User"/);
  assert.doesNotMatch(sql, /ALTER TABLE "Organization"/);
  assert.doesNotMatch(sql, /ALTER TABLE "TenderArchiveItem"/);
  // 不引入第二套向量基建
  assert.doesNotMatch(sql, /vector\(/i);
  assert.doesNotMatch(sql, /hnsw/i);
});
