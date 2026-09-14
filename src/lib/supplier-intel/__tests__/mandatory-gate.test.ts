/**
 * S4-A 纯核：强制项硬门（CI 可执行，无 DB）。
 *
 * 覆盖任务书 §21–§25 与黄金用例 G1–G9 中可以纯函数证明的部分：
 *   UNKNOWN / PARTIAL / 缺 Match / uncertain 一律 fail-closed；FAIL 优先；
 *   证书要 VERIFIED + 评估当时未过期 + scope 兼容；社媒 / 网页 / 备注单独不算；
 *   AI_ASSISTED 不能独立满足；DETERMINISTIC 必须带可回放证据；
 *   过期按冻结时刻算，不随读取时的时钟漂移；非强制项 FAIL 不影响门；
 *   PASS 不产生任何最终推荐（只有 NOT_ELIGIBLE / NEEDS_VERIFICATION 两个硬门结论）。
 */
import assert from "node:assert/strict";

type Entry = { id: string; code: string; text: string; category: string | null; mandatory: true | false | "uncertain"; mandatorySignal: string | null };

async function main() {
  const { computeMandatoryGate, classifyEvidenceForGate } = await import("../mandatory-gate");

  const NOW = new Date("2026-09-14T00:00:00.000Z");
  const T0 = "2026-09-14T00:00:00.000Z";
  const req = (code: string, mandatory: Entry["mandatory"], category = "safety", text = `${code} requirement`): Entry =>
    ({ id: `ref-${code}`, code, text, category, mandatory, mandatorySignal: null });
  const cert = (over: Record<string, unknown> = {}) => ({
    kind: "certification", certificationId: "c1", certificationType: "UL", scope: "SUPPLIER", offeringId: null,
    statusAtEvaluation: "VERIFIED", expiresAt: "2030-01-01T00:00:00.000Z", capturedAt: T0, ...over,
  });
  const match = (requirementKey: string, verdict: string, evidence: unknown[], evaluatedBy = "HUMAN") => ({
    id: `m-${requirementKey}`, requirementKey, verdict, evaluatedBy, evidence, createdAt: T0,
  });
  const gate = (snapshot: Entry[], matches: ReturnType<typeof match>[], offeringId: string | null = "off-A") =>
    computeMandatoryGate({ requirementSnapshot: snapshot, candidate: { offeringId }, matches, evaluationVersion: "supplier-eval-v1", computedAt: NOW });

  console.log("G1/T11/T22：全部 mandatory PASS 且证据可采信（VERIFIED + 有效 + scope）→ PASS，且无最终推荐");
  {
    const g = gate([req("R1", true), req("R2", false)], [match("R1", "PASS", [cert()])]);
    assert.equal(g.snapshot.result, "PASS");
    assert.equal(g.recommendation, null, "PASS 时不提前给 PRIMARY/BACKUP，也不给 NEEDS_VERIFICATION");
    assert.equal(g.rejectionReason, null);
    assert.equal(g.snapshot.items.length, 1, "非强制项不进门");
    assert.equal(g.snapshot.items[0].reasonCode, "OK");
    assert.equal(g.snapshot.gateRuleVersion, "mandatory-gate-v1");
  }

  console.log("T12/G7：任一 mandatory FAIL → FAIL + NOT_ELIGIBLE + 确定性 rejectionReason");
  {
    const g = gate([req("R1", true), req("R2", true)], [match("R1", "PASS", [cert()]), match("R2", "FAIL", [{ kind: "note", snippet: "55 in < 60 in" }])]);
    assert.equal(g.snapshot.result, "FAIL");
    assert.equal(g.recommendation, "NOT_ELIGIBLE");
    assert.equal(g.rejectionReason, "R2:MANDATORY_MATCH_FAIL");
  }

  console.log("T13/G8：mandatory UNKNOWN → INCOMPLETE + NEEDS_VERIFICATION");
  {
    const g = gate([req("R1", true)], [match("R1", "UNKNOWN", [])]);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.recommendation, "NEEDS_VERIFICATION");
    assert.equal(g.snapshot.items[0].reasonCode, "MANDATORY_MATCH_UNKNOWN");
  }

  console.log("T14：mandatory PARTIAL → INCOMPLETE（PARTIAL ≠ PASS）");
  assert.equal(gate([req("R1", true)], [match("R1", "PARTIAL", [cert()])]).snapshot.result, "INCOMPLETE");
  assert.equal(gate([req("R1", true)], [match("R1", "PARTIAL", [cert()])]).snapshot.items[0].reasonCode, "MANDATORY_MATCH_PARTIAL");

  console.log("T15：mandatory 缺 Match → INCOMPLETE（缺 ≠ PASS）");
  {
    const g = gate([req("R1", true), req("R2", true)], [match("R1", "PASS", [cert()])]);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items.find((i) => i.requirementKey === "R2")?.reasonCode, "MANDATORY_MATCH_MISSING");
    assert.equal(g.snapshot.summary.missing, 1);
  }

  console.log("T16/G9：mandatoryUncertain → INCOMPLETE，即使 match 看似 PASS 且证据可采信");
  {
    const g = gate([req("R1", "uncertain")], [match("R1", "PASS", [cert()])]);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items[0].reasonCode, "MANDATORY_STATUS_UNCERTAIN");
    assert.equal(g.snapshot.summary.uncertain, 1);
  }

  console.log("§22：FAIL 与 UNKNOWN 并存 → 总门 FAIL（不是 INCOMPLETE）");
  {
    const g = gate([req("R1", true), req("R2", true)], [match("R1", "FAIL", [{ kind: "note", snippet: "x" }]), match("R2", "UNKNOWN", [])]);
    assert.equal(g.snapshot.result, "FAIL");
    assert.equal(g.recommendation, "NOT_ELIGIBLE");
  }

  console.log("T17：非强制项 FAIL 不触发门 FAIL");
  {
    const g = gate([req("R1", true), req("R2", false)], [match("R1", "PASS", [cert()]), match("R2", "FAIL", [{ kind: "note", snippet: "x" }])]);
    assert.equal(g.snapshot.result, "PASS");
  }

  console.log("G2/T21：CLAIMED 证书不能支撑硬门 PASS");
  {
    const g = gate([req("R1", true)], [match("R1", "PASS", [cert({ statusAtEvaluation: "CLAIMED" })])]);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items[0].reasonCode, "CERT_NOT_VERIFIED");
    assert.equal(g.recommendation, "NEEDS_VERIFICATION");
  }

  console.log("G3/T23：VERIFIED 但评估当时已过期 → 不能 PASS（INCOMPLETE / CERT_EXPIRED_AT_EVALUATION）");
  {
    const g = gate([req("R1", true)], [match("R1", "PASS", [cert({ expiresAt: "2026-01-01T00:00:00.000Z" })])]);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items[0].reasonCode, "CERT_EXPIRED_AT_EVALUATION");
  }

  console.log("§11.2：过期按冻结时刻 capturedAt 算——证书在 2027 到期，2026 的评估回放仍是 PASS");
  {
    const frozen = cert({ expiresAt: "2027-06-01T00:00:00.000Z", capturedAt: "2026-09-14T00:00:00.000Z" });
    const later = new Date("2028-01-01T00:00:00.000Z"); // 「今天」已经过了到期日
    const g = computeMandatoryGate({ requirementSnapshot: [req("R1", true)], candidate: { offeringId: "off-A" }, matches: [match("R1", "PASS", [frozen])], evaluationVersion: "v", computedAt: later });
    assert.equal(g.snapshot.result, "PASS", "读取时的时钟不改写历史门");
  }

  console.log("G4：PRODUCT 级证书绑定 Offering A，候选是 Offering B → 不可采信（CERT_SCOPE_MISMATCH）");
  {
    const g = gate([req("R1", true)], [match("R1", "PASS", [cert({ scope: "PRODUCT", offeringId: "off-A" })])], "off-B");
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items[0].reasonCode, "CERT_SCOPE_MISMATCH");
  }
  console.log("G4b：PRODUCT 级证书 + 候选无 Offering → 同样不可采信（非产品类别下单独看 scope 规则）");
  assert.equal(gate([req("R1", true, "installation")], [match("R1", "PASS", [cert({ scope: "PRODUCT", offeringId: "off-A" })])], null).snapshot.items[0].reasonCode, "CERT_SCOPE_MISMATCH");
  console.log("G4b2：产品类别 + 候选无 Offering → OFFERING_REQUIRED 优先（型号都没有，谈不上证书范围）");
  assert.equal(gate([req("R1", true, "safety")], [match("R1", "PASS", [cert({ scope: "PRODUCT", offeringId: "off-A" })])], null).snapshot.items[0].reasonCode, "OFFERING_REQUIRED");
  console.log("G4c：SUPPLIER 级证书对任一候选可采信");
  assert.equal(gate([req("R1", true, "installation")], [match("R1", "PASS", [cert({ scope: "SUPPLIER" })])], null).snapshot.result, "PASS");

  console.log("G5/T20：社媒自述 / 网页 / 备注单独不能满足硬门 PASS");
  for (const ev of [
    [{ kind: "signal", signalId: "s1", platform: "DOUYIN", snippet: "UL certified!" }],
    [{ kind: "url", url: "https://factory.example/about", snippet: "UL certified" }],
    [{ kind: "note", snippet: "供应商说有 UL" }],
    [],
  ]) {
    const g = gate([req("R1", true)], [match("R1", "PASS", ev)]);
    assert.equal(g.snapshot.result, "INCOMPLETE", JSON.stringify(ev));
    assert.equal(g.snapshot.items[0].reasonCode, "EVIDENCE_NOT_VERIFIED");
  }

  console.log("§13：AI_ASSISTED PASS 不能独立满足硬门，即使带了可采信证书");
  {
    const g = gate([req("R1", true)], [match("R1", "PASS", [cert()], "AI_ASSISTED")]);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items[0].reasonCode, "AI_ASSISTED_NOT_ADMISSIBLE");
  }

  console.log("§13：DETERMINISTIC PASS 需要可回放证据（规则 note 或可采信证书）；只有标签不算");
  {
    const withRule = gate([req("R1", true)], [match("R1", "PASS", [{ kind: "note", snippet: "NUMERIC_THRESHOLD_V1 | 承重 = 600 lb，要求 >= 300 lb" }], "DETERMINISTIC")]);
    assert.equal(withRule.snapshot.result, "PASS");
    const bare = gate([req("R1", true)], [match("R1", "PASS", [], "DETERMINISTIC")]);
    assert.equal(bare.snapshot.result, "INCOMPLETE");
    const fakeNote = gate([req("R1", true)], [match("R1", "PASS", [{ kind: "note", snippet: "looks fine" }], "DETERMINISTIC")]);
    assert.equal(fakeNote.snapshot.result, "INCOMPLETE");
  }

  console.log("§6.1：产品级要求 + 候选无 Offering → OFFERING_REQUIRED（供应商级能力不能替代具体型号）");
  {
    const g = gate([req("R1", true, "product")], [match("R1", "PASS", [cert({ scope: "SUPPLIER" })])], null);
    assert.equal(g.snapshot.result, "INCOMPLETE");
    assert.equal(g.snapshot.items[0].reasonCode, "OFFERING_REQUIRED");
  }

  console.log("档案证据可采信（项目档案：写入时已过归属校验）");
  assert.equal(gate([req("R1", true)], [match("R1", "PASS", [{ kind: "archive", archiveItemId: "a1" }])]).snapshot.result, "PASS");

  console.log("混合证据：一条不可采信 + 一条可采信 → PASS（有一条够用即可）");
  assert.equal(gate([req("R1", true)], [match("R1", "PASS", [{ kind: "signal", signalId: "s" }, cert()])]).snapshot.result, "PASS");

  console.log("T28：门输出里没有任何数值评分字段");
  {
    const g = gate([req("R1", true)], [match("R1", "PASS", [cert()])]);
    const keys = JSON.stringify(g);
    assert.ok(!/totalScore|technicalScore|commercialScore|PRIMARY|BACKUP|HIGH_RISK/.test(keys));
  }

  console.log("classifyEvidenceForGate：非对象 / 未知 kind 一律不可采信");
  assert.equal(classifyEvidenceForGate("x", { offeringId: null }, T0), "EVIDENCE_NOT_VERIFIED");
  assert.equal(classifyEvidenceForGate({ kind: "magic" }, { offeringId: null }, T0), "EVIDENCE_NOT_VERIFIED");

  console.log("幂等：同输入两次计算结果字节相同");
  {
    const a = gate([req("R1", true), req("R2", "uncertain")], [match("R1", "PASS", [cert()])]);
    const b = gate([req("R1", true), req("R2", "uncertain")], [match("R1", "PASS", [cert()])]);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  }

  console.log("\nS4-A 强制项硬门纯核全部通过");
}

main().catch((e) => { console.error(e); process.exit(1); });
