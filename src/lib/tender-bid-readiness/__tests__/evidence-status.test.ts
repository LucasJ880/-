/**
 * TI-3b 证据状态投影（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-readiness/__tests__/evidence-status.test.ts
 * 覆盖任务书验收项 A21（过期 / 矛盾显示为未知 / 互相矛盾，并压掉无支撑的结论）。
 */
import assert from "node:assert/strict";
import { DISPLAY_STATUSES, detectContradictions, projectClaims, projectEvidenceStatus, type ClaimInput } from "../evidence-status";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const now = new Date("2026-11-11T15:00:00Z");
const claim = (o: Partial<ClaimInput> = {}): ClaimInput => ({
  id: "c1", subjectKey: "cert:ABC-123", field: "status", value: "valid", nature: "FACT", verificationStatus: "HUMAN_CONFIRMED", evidenceCount: 1, ...o,
});
const st = (c: ClaimInput) => projectEvidenceStatus(c, { now });

console.log("tender-bid-readiness evidence-status");

{
  ok("显示状态恰为五个", DISPLAY_STATUSES.join() === "CONFIRMED,INDICATIVE,INFERRED,UNKNOWN,CONTRADICTED");
  const confirmed = st(claim());
  ok("人工确认的事实 → 已确认，可支撑结论", confirmed.status === "CONFIRMED" && confirmed.supportsConclusion && confirmed.statusZh === "已确认");
  ok("系统核验的事实 → 已确认", st(claim({ verificationStatus: "SYSTEM_VERIFIED" })).status === "CONFIRMED");
  const expired = st(claim({ validTo: "2026-10-01" }));
  ok("过期 → 未知，不支撑结论", expired.status === "UNKNOWN" && !expired.supportsConclusion && expired.reasonZh.includes("过有效期"));
  ok("有效期还没到 → 仍为已确认", st(claim({ validTo: "2027-01-01" })).status === "CONFIRMED");
  ok("有效期无法解析 → 未知", st(claim({ validTo: "next year" })).status === "UNKNOWN");
  const ai = st(claim({ verificationStatus: "AI_EXTRACTED" }));
  ok("模型抽取的事实 → 指示性，不是已确认", ai.status === "INDICATIVE" && ai.supportsConclusion);
  ok("解读 → 指示性", st(claim({ nature: "INTERPRETATION" })).status === "INDICATIVE");
  ok("推断 → 推断（即使人工确认过）", st(claim({ nature: "INFERENCE" })).status === "INFERRED");
  ok("没有证据 → 未知", st(claim({ evidenceCount: 0 })).status === "UNKNOWN");
  ok("已撤回 → 未知", st(claim({ lifecycle: "RETRACTED" })).status === "UNKNOWN");
  ok("已被取代 → 未知", st(claim({ lifecycle: "SUPERSEDED" })).status === "UNKNOWN");
}
{
  const a = claim({ id: "a", value: "valid" });
  const b = claim({ id: "b", value: "revoked" });
  const ids = detectContradictions([a, b], now);
  ok("同一证书的状态两条有效声明取值不同 → 都标矛盾", ids.has("a") && ids.has("b"));
  const projected = projectClaims([a, b], now);
  ok("互相矛盾的都不支撑结论", projected.every((p) => p.status === "CONTRADICTED" && !p.supportsConclusion));
  const superseding = claim({ id: "b", value: "revoked", supersedesClaimId: "a" });
  const p2 = projectClaims([a, superseding], now);
  ok("旧的一条被新的取代 → 不算矛盾：新的按自身状态，旧的为未知", p2.find((p) => p.id === "b")!.status === "CONFIRMED" && p2.find((p) => p.id === "a")!.status === "UNKNOWN");
  ok("取值只差大小写与空白不算矛盾", detectContradictions([a, claim({ id: "b", value: " VALID " })], now).size === 0);
  ok("不同字段不互相比较", detectContradictions([a, claim({ id: "b", field: "issuer", value: "CSA" })], now).size === 0);
  ok("过期的声明不参与矛盾判断", detectContradictions([a, claim({ id: "b", value: "revoked", validTo: "2026-01-01" })], now).size === 0);
}

console.log(`\ntender-bid-readiness evidence-status: ${passed} passed`);
