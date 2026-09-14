/**
 * S4-A 纯核：确定性匹配规则（CI 可执行，无 DB）。
 *   G6 数值满足 → PASS；G7 数值不满足 → FAIL；单位不可靠换算 → UNKNOWN（不猜）；
 *   认证类型识别：VERIFIED + 有效 + scope → PASS 且证据是那张证书；CLAIMED → UNKNOWN；
 *   Offering A 的产品级证书对候选 B → UNKNOWN；没有适用规则 → null（交给人工）。
 */
import assert from "node:assert/strict";

async function main() {
  const m = await import("../deterministic-match");
  const NOW = new Date("2026-09-14T00:00:00.000Z");
  const entry = (text: string, category = "technical") => ({ id: "r", code: "R", text, category, mandatory: true as const, mandatorySignal: null });

  console.log("阈值解析");
  assert.deepEqual(m.parseNumericThreshold("Minimum weight capacity 300 lb.")?.op, ">=");
  assert.equal(m.parseNumericThreshold("Minimum weight capacity 300 lb.")?.canonicalValue, 300);
  assert.equal(m.parseNumericThreshold("Bench tops shall be at least 25 mm thick.")?.family, "mm");
  assert.equal(m.parseNumericThreshold("Width >= 60\" per room schedule.")?.canonicalValue, 60 * 25.4);
  assert.equal(m.parseNumericThreshold("Warranty: not less than 10 years on structure.")?.family, "year");
  assert.equal(m.parseNumericThreshold("Maximum 55 mm").op, "<=");
  assert.equal(m.parseNumericThreshold("Chairs shall be comfortable."), null, "没有阈值 → null");
  assert.equal(m.parseNumericThreshold("min 5 mm and max 10 mm"), null, "同时上下限 → 不处理");
  assert.equal(m.parseNumericThreshold("at least 3 furlongs"), null, "未知单位 → null");

  console.log("G6：600 lb ≥ 300 lb → PASS，证据为规则 note（可回放）");
  {
    const s = m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), { 承重: "600 lb" });
    assert.equal(s?.ruleId, "NUMERIC_THRESHOLD_V1");
    assert.equal(s?.verdict, "PASS");
    assert.ok(s?.evidence[0]?.kind === "note" && s.evidence[0].snippet.startsWith("NUMERIC_THRESHOLD_V1 |"));
  }
  console.log("G6b：单位换算 140 kg（308.6 lb）≥ 300 lb → PASS");
  assert.equal(m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), { 承重: "140kg" })?.verdict, "PASS");
  console.log("G6b2：136 kg = 299.8 lb < 300 lb → FAIL（规则不四舍五入、不迁就营销换算）");
  assert.equal(m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), { 承重: "136kg" })?.verdict, "FAIL");

  console.log("G7：55\" < 60\" → FAIL");
  assert.equal(m.suggestNumericMatch(entry("Width >= 60\" per schedule"), { 宽度: "55 in" })?.verdict, "FAIL");

  console.log("G6c：单位无法可靠对齐 → UNKNOWN，不猜");
  assert.equal(m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), { 承重: "600" })?.verdict, "UNKNOWN");
  assert.equal(m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), { 宽度: "600 mm" })?.verdict, "UNKNOWN", "不同单位族不比较");
  assert.equal(m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), { 静载: "600 lb", 动载: "400 lb" })?.verdict, "UNKNOWN", "多个同族值无法确定用哪个");
  assert.equal(m.suggestNumericMatch(entry("Minimum weight capacity 300 lb."), null)?.verdict, "UNKNOWN");

  console.log("认证类型识别");
  assert.equal(m.detectRequiredCertificationType("Chairs shall be certified to ANSI/BIFMA X5.1."), "BIFMA");
  assert.equal(m.detectRequiredCertificationType("Must be UL listed."), "UL");
  assert.equal(m.detectRequiredCertificationType("ISO 9001 certified manufacturer required."), "ISO_9001");
  assert.equal(m.detectRequiredCertificationType("UL or CSA listed."), null, "多个类型 → 不猜");
  assert.equal(m.detectRequiredCertificationType("Mesh back preferred."), null);

  const certs = (over: Partial<import("../deterministic-match").DeterministicCertInput>[]) =>
    over.map((o, i) => ({ id: `c${i}`, certificationType: "UL", scope: "SUPPLIER", offeringId: null, status: "VERIFIED", expiresAt: "2030-01-01T00:00:00.000Z", ...o }));

  console.log("G1：VERIFIED + 有效 + SUPPLIER scope → PASS，证据是那张证书");
  {
    const s = m.suggestCertificationMatch(entry("Must be UL listed.", "safety"), { offeringId: "off-A" }, certs([{}]), NOW);
    assert.equal(s?.verdict, "PASS");
    assert.deepEqual(s?.evidence, [{ kind: "certification", certificationId: "c0" }]);
  }
  console.log("G2：只有 CLAIMED → UNKNOWN（不是 FAIL：没有证据证明「没有认证」）");
  assert.equal(m.suggestCertificationMatch(entry("Must be UL listed."), { offeringId: "off-A" }, certs([{ status: "CLAIMED" }]), NOW)?.verdict, "UNKNOWN");
  console.log("G3：VERIFIED 但已过期 → UNKNOWN");
  assert.equal(m.suggestCertificationMatch(entry("Must be UL listed."), { offeringId: "off-A" }, certs([{ expiresAt: "2020-01-01T00:00:00.000Z" }]), NOW)?.verdict, "UNKNOWN");
  console.log("G4：PRODUCT 级证书绑定 off-A，候选 off-B → UNKNOWN；候选 off-A → PASS");
  assert.equal(m.suggestCertificationMatch(entry("Must be UL listed."), { offeringId: "off-B" }, certs([{ scope: "PRODUCT", offeringId: "off-A" }]), NOW)?.verdict, "UNKNOWN");
  assert.equal(m.suggestCertificationMatch(entry("Must be UL listed."), { offeringId: "off-A" }, certs([{ scope: "PRODUCT", offeringId: "off-A" }]), NOW)?.verdict, "PASS");
  console.log("没有该类型证书 → UNKNOWN；要求里没点名认证 → null");
  assert.equal(m.suggestCertificationMatch(entry("Must be UL listed."), { offeringId: null }, [], NOW)?.verdict, "UNKNOWN");
  assert.equal(m.suggestCertificationMatch(entry("Mesh back preferred."), { offeringId: null }, certs([{}]), NOW), null);

  console.log("组合入口：认证规则优先；都不适用 → null（交给人工）");
  assert.equal(m.suggestDeterministicMatch(entry("Must be UL listed."), { offeringId: "off-A", offeringAttributes: null }, certs([{}]), NOW)?.ruleId, "CERT_TYPE_V1");
  assert.equal(m.suggestDeterministicMatch(entry("Minimum 300 lb"), { offeringId: "off-A", offeringAttributes: { 承重: "600 lb" } }, [], NOW)?.ruleId, "NUMERIC_THRESHOLD_V1");
  assert.equal(m.suggestDeterministicMatch(entry("Shop drawings required prior to fabrication."), { offeringId: null, offeringAttributes: null }, [], NOW), null);

  console.log("\nS4-A 确定性匹配纯核全部通过");
}

main().catch((e) => { console.error(e); process.exit(1); });
