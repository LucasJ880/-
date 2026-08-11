/**
 * Tender T3 Corporate Memory — 纯逻辑不变量（无 DB）。
 *
 * 覆盖确定性 buyer normalization、域名归一、trust/freshness 排序比较器、
 * 词表/长度/JSON 字节校验器、evidence 源类型排除 AI_DERIVED。
 * 可进 CI 子集（DB-free）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBuyerName,
  normalizeWebsiteDomain,
} from "../normalize";
import { compareClaimTrustFreshness } from "../retrieval";
import {
  CorporateMemoryError,
  MEMORY_EVIDENCE_SOURCE_TYPES,
  MEMORY_LIMITS,
  MEMORY_TRUST_ORDER,
  isCorporateMemoryError,
  requireBoundedJson,
  requireBoundedString,
  requireVocab,
} from "../types";

test("normalizeBuyerName：冠词/大小写/标点/倒装归一到同一 canonical 键", () => {
  const canonical = "city of toronto";
  assert.equal(normalizeBuyerName("City of Toronto"), canonical);
  assert.equal(normalizeBuyerName("The City of Toronto"), canonical);
  assert.equal(normalizeBuyerName("  CITY  OF   TORONTO "), canonical);
  assert.equal(normalizeBuyerName("Toronto, City of"), canonical);
  assert.equal(normalizeBuyerName("City of Toronto."), canonical);
});

test("normalizeBuyerName：近似名的不同实体绝不塌缩（§10 身份规则）", () => {
  // TDSB 与 TCDSB 名称近似但不同实体：归一后仍不同 → 不会自动合并
  const tdsb = normalizeBuyerName("Toronto District School Board");
  const tcdsb = normalizeBuyerName("Toronto Catholic District School Board");
  assert.notEqual(tdsb, tcdsb);
  assert.equal(tdsb, "toronto district school board");
  assert.equal(tcdsb, "toronto catholic district school board");
});

test("normalizeBuyerName：& → and，跨语言 fold 稳定", () => {
  assert.equal(
    normalizeBuyerName("Parks & Recreation"),
    normalizeBuyerName("Parks and Recreation"),
  );
});

test("normalizeWebsiteDomain：去 scheme/www/path/port，非法返回 null", () => {
  assert.equal(normalizeWebsiteDomain("https://www.toronto.ca/procurement"), "toronto.ca");
  assert.equal(normalizeWebsiteDomain("HTTP://Toronto.CA"), "toronto.ca");
  assert.equal(normalizeWebsiteDomain("toronto.ca:443"), "toronto.ca");
  assert.equal(normalizeWebsiteDomain("sub.toronto.ca"), "sub.toronto.ca");
  assert.equal(normalizeWebsiteDomain("not a domain"), null);
  assert.equal(normalizeWebsiteDomain(""), null);
  assert.equal(normalizeWebsiteDomain(null), null);
});

test("compareClaimTrustFreshness：trust 优先，其次 freshness，最后 id", () => {
  const older = new Date("2026-01-01T00:00:00Z");
  const newer = new Date("2026-06-01T00:00:00Z");

  // trust 主序：HUMAN_CONFIRMED 先于 AI_EXTRACTED，即使后者更新
  assert.ok(
    compareClaimTrustFreshness(
      { verificationStatus: "HUMAN_CONFIRMED", capturedAt: older, claimId: "b" },
      { verificationStatus: "AI_EXTRACTED", capturedAt: newer, claimId: "a" },
    ) < 0,
  );
  // 同 trust：更新的在前
  assert.ok(
    compareClaimTrustFreshness(
      { verificationStatus: "AI_EXTRACTED", capturedAt: newer, claimId: "b" },
      { verificationStatus: "AI_EXTRACTED", capturedAt: older, claimId: "a" },
    ) < 0,
  );
  // 同 trust 同 freshness：id 稳定 tie-break
  assert.ok(
    compareClaimTrustFreshness(
      { verificationStatus: "AI_EXTRACTED", capturedAt: older, claimId: "a" },
      { verificationStatus: "AI_EXTRACTED", capturedAt: older, claimId: "b" },
    ) < 0,
  );
});

test("MEMORY_TRUST_ORDER：HUMAN_CONFIRMED > SYSTEM_VERIFIED > AI_EXTRACTED > NEEDS_REVIEW", () => {
  assert.ok(MEMORY_TRUST_ORDER.HUMAN_CONFIRMED < MEMORY_TRUST_ORDER.SYSTEM_VERIFIED);
  assert.ok(MEMORY_TRUST_ORDER.SYSTEM_VERIFIED < MEMORY_TRUST_ORDER.AI_EXTRACTED);
  assert.ok(MEMORY_TRUST_ORDER.AI_EXTRACTED < MEMORY_TRUST_ORDER.NEEDS_REVIEW);
});

test("MEMORY_EVIDENCE_SOURCE_TYPES 排除 AI_DERIVED（AI 产物不是独立证据）", () => {
  assert.ok(!(MEMORY_EVIDENCE_SOURCE_TYPES as readonly string[]).includes("AI_DERIVED"));
  assert.ok((MEMORY_EVIDENCE_SOURCE_TYPES as readonly string[]).includes("TENDER_DOCUMENT"));
});

test("requireVocab：非法值抛 INVALID_INPUT", () => {
  assert.equal(requireVocab("HIGH", ["HIGH", "MEDIUM", "LOW"], "confidence"), "HIGH");
  assert.throws(
    () => requireVocab("URGENT", ["HIGH", "MEDIUM", "LOW"], "confidence"),
    (e: unknown) => isCorporateMemoryError(e, "INVALID_INPUT"),
  );
});

test("requireBoundedString：超长抛错，可选空值返回 null", () => {
  assert.equal(requireBoundedString("  hi ", "f", 10), "hi");
  assert.equal(requireBoundedString(undefined, "f", 10, { optional: true }), null);
  assert.throws(
    () => requireBoundedString("x".repeat(11), "f", 10),
    (e: unknown) => isCorporateMemoryError(e, "INVALID_INPUT"),
  );
  assert.throws(
    () => requireBoundedString("", "f", 10),
    (e: unknown) => isCorporateMemoryError(e, "INVALID_INPUT"),
  );
});

test("requireBoundedJson：超字节上限抛错", () => {
  assert.equal(requireBoundedJson(null, "meta"), null);
  const small = { a: 1 };
  assert.equal(requireBoundedJson(small, "meta"), small);
  const huge = { blob: "x".repeat(MEMORY_LIMITS.JSON_MAX_BYTES) };
  assert.throws(
    () => requireBoundedJson(huge, "meta"),
    (e: unknown) => isCorporateMemoryError(e, "INVALID_INPUT"),
  );
});

test("CorporateMemoryError：code 可判别", () => {
  const err = new CorporateMemoryError("EVIDENCE_REQUIRED", "x");
  assert.ok(isCorporateMemoryError(err));
  assert.ok(isCorporateMemoryError(err, "EVIDENCE_REQUIRED"));
  assert.ok(!isCorporateMemoryError(err, "CLAIM_NOT_FOUND"));
  assert.ok(!isCorporateMemoryError(new Error("plain")));
});
