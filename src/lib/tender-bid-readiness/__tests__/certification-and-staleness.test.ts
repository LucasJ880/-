/**
 * TI-3b 强制认证闸与补遗失效（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-readiness/__tests__/certification-and-staleness.test.ts
 * 覆盖任务书验收项 A7（第 13–15 行须有品牌、型号与整机加拿大电气认证；证明未到即阻断）。
 */
import assert from "node:assert/strict";
import { evaluateCertificationGate, type CertificateEvidence } from "../certification-gate";
import { findStaleConclusions, latestAddendumFor, type Addendum, type DependentConclusion } from "../staleness";
import { OTTAWA_18026, OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const now = new Date("2026-11-08T15:00:00Z");
const line = (n: number) => OTTAWA_18026_LINES[n - 1];
const cert = (o: Partial<CertificateEvidence> = {}): CertificateEvidence => ({
  id: "CERT-1", status: "VERIFIED", coverage: "WHOLE_UNIT", issuer: "合成发证机构", issuerAccreditedInCanada: true, coveredModels: ["TC-200"], expiresAt: "2028-01-01", ...o,
});
const product = { make: "合成品牌", model: "TC-200" };
const gate = (n: number, o: { product?: typeof product | null; certificates?: CertificateEvidence[]; hasPlannedCertificationOnly?: boolean } = {}) =>
  evaluateCertificationGate({ lineNo: n, certificationGate: line(n).certificationGate, product: o.product, certificates: o.certificates, hasPlannedCertificationOnly: o.hasPlannedCertificationOnly, now });
const codes = (r: ReturnType<typeof gate>) => r.reasons.map((x) => x.code);

console.log("tender-bid-readiness certification-and-staleness");

{
  const pending = [13, 14, 15].map((n) => gate(n, { product: { make: "UNKNOWN", model: "UNKNOWN" } }));
  ok("渥太华第 13–15 行认证待定 → 三行都阻断", pending.every((r) => r.verdict === "BLOCKED"));
  ok("原因含品牌未填、型号未填、没有已核验的整机认证", pending.every((r) => ["MAKE_MISSING", "MODEL_MISSING", "NO_VERIFIED_WHOLE_UNIT_CERT"].every((c) => codes(r).includes(c as never))));
  ok("原因是中文说明", pending[0].reasons.map((x) => x.messageZh).join("；") === "品牌未填；型号未填；没有已核验的整机认证");
  ok("第 1 行没有认证要求 → 不适用", gate(1).verdict === "NOT_APPLICABLE" && gate(1).reasons.length === 0);
  ok("带认证闸的恰为第 13–15 行", OTTAWA_18026_LINES.filter((l) => gate(l.lineNo).verdict !== "NOT_APPLICABLE").map((l) => l.lineNo).join() === OTTAWA_18026.expected.electricalCertItems.join());
}
{
  const component = gate(13, { product, certificates: [cert({ coverage: "COMPONENT" })] });
  ok("只有部件认证 → 阻断，写明只覆盖部件", component.verdict === "BLOCKED" && component.reasons.some((r) => r.code === "CERT_COMPONENT_ONLY" && r.messageZh.includes("只覆盖部件")));
  const claimed = gate(13, { product, certificates: [cert({ status: "CLAIMED" })] });
  ok("只是供应商声称 → 阻断", claimed.verdict === "BLOCKED" && codes(claimed).includes("CERT_NOT_VERIFIED"));
  const planned = gate(13, { product, hasPlannedCertificationOnly: true });
  ok("只预留了认证费用 → 阻断，写明不等于证书", planned.verdict === "BLOCKED" && planned.reasons.some((r) => r.code === "PLANNED_CERTIFICATION_ONLY" && r.messageZh.includes("不等于证书")));
  const good = gate(13, { product, certificates: [cert()] });
  ok("六个条件全部满足 → 通过", good.verdict === "PASS" && good.reasons.length === 0 && good.passingCertificateId === "CERT-1");
  const mismatch = gate(13, { product, certificates: [cert({ coveredModels: ["TC-300"] })] });
  ok("型号不一致 → 阻断，写明型号", mismatch.verdict === "BLOCKED" && mismatch.reasons.some((r) => r.code === "MODEL_MISMATCH" && r.messageZh.includes("TC-200")));
  ok("型号写法只差空格与连字符 → 视为一致", gate(13, { product: { make: "合成品牌", model: "tc 200" }, certificates: [cert()] }).verdict === "PASS");
  const expired = gate(13, { product, certificates: [cert({ expiresAt: "2026-01-01" })] });
  ok("证书已过期 → 阻断", expired.verdict === "BLOCKED" && codes(expired).includes("CERT_EXPIRED"));
  const notAccredited = gate(13, { product, certificates: [cert({ issuerAccreditedInCanada: false })] });
  ok("发证机构在加拿大不受认可 → 阻断", notAccredited.verdict === "BLOCKED" && codes(notAccredited).includes("ISSUER_NOT_ACCREDITED"));
  const unconfirmed = gate(13, { product, certificates: [cert({ issuerAccreditedInCanada: null })] });
  ok("发证机构是否受认可未确认 → 阻断（未确认不算通过）", unconfirmed.verdict === "BLOCKED" && codes(unconfirmed).includes("ISSUER_ACCREDITATION_UNCONFIRMED"));
  const coverageUnknown = gate(13, { product, certificates: [cert({ coverage: "UNKNOWN" })] });
  ok("覆盖范围未确认 → 阻断", coverageUnknown.verdict === "BLOCKED" && codes(coverageUnknown).includes("CERT_COVERAGE_UNKNOWN"));
  const noModel = gate(13, { product: { make: "合成品牌", model: "" }, certificates: [cert()] });
  ok("有好证书但型号未填 → 仍阻断", noModel.verdict === "BLOCKED" && codes(noModel).includes("MODEL_MISSING"));
  const oneGood = gate(13, { product, certificates: [cert({ id: "CERT-0", coverage: "COMPONENT" }), cert({ id: "CERT-2" })] });
  ok("多张证书里有一张全部满足 → 通过，并指明是哪张", oneGood.verdict === "PASS" && oneGood.passingCertificateId === "CERT-2");
}
{
  const addenda: Addendum[] = [{ number: 1, issuedOn: "2026-11-05", affectedLineNos: [13, 14, 15], effect: OTTAWA_18026.addenda[0].effect }];
  const conclusions: DependentConclusion[] = [
    { key: "cost:13", kind: "COST_ASSUMPTION", lineNo: 13, basedOnAddendum: 0 },
    { key: "cost:1", kind: "COST_ASSUMPTION", lineNo: 1, basedOnAddendum: 0 },
    { key: "cert:13", kind: "CERTIFICATION", lineNo: 13, basedOnAddendum: 1 },
    { key: "match:14", kind: "SUPPLIER_MATCH", lineNo: 14, basedOnAddendum: 0 },
  ];
  const r = findStaleConclusions(addenda, conclusions);
  ok("第 13 行基于原始文件的成本假设 → 待复核", r.stale.some((s) => s.key === "cost:13" && s.latestAddendum === 1));
  ok("第 1 行不受第 1 号补遗影响 → 不标", !r.stale.some((s) => s.key === "cost:1"));
  ok("已基于第 1 号补遗的认证判定 → 不标", !r.stale.some((s) => s.key === "cert:13"));
  ok("复核清单两条，写明行号、哪类结论、基于什么、哪号补遗之后", r.reviewListZh.length === 2 && r.reviewListZh[0] === "第 13 行的成本假设基于原始文件，第 1 号补遗之后需要复核");
  ok("影响某行的最新补遗号", latestAddendumFor(13, addenda) === 1 && latestAddendumFor(1, addenda) === 0);
  const two = findStaleConclusions([...addenda, { number: 2, affectedLineNos: [13] }], conclusions);
  ok("第 2 号补遗再改第 13 行 → 基于第 1 号的认证判定也待复核", two.stale.some((s) => s.key === "cert:13" && s.latestAddendum === 2) && two.stale.some((s) => s.reasonZh.includes("基于第 1 号补遗")));
  ok("没有补遗 → 没有待复核", findStaleConclusions([], conclusions).stale.length === 0);
}

console.log(`\ntender-bid-readiness certification-and-staleness: ${passed} passed`);
