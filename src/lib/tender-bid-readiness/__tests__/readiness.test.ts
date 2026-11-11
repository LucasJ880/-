/**
 * TI-3b 可投标判定（纯逻辑 + 源码断言）
 * 运行：npx tsx src/lib/tender-bid-readiness/__tests__/readiness.test.ts
 * 覆盖任务书验收项 A7（认证未到即阻断，即使尺寸相符）、A16（已过截标）、A21（无支撑的结论不放行）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchDimensions } from "@/lib/tender-price-schedule/dimension-match";
import { OTTAWA_18026, OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";
import type { CertificateEvidence } from "../certification-gate";
import { assessBidReadiness, type CostReadinessInput, type ReadinessInput } from "../readiness";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

const BEFORE_CLOSE = new Date("2026-11-08T15:00:00Z");
const AFTER_CLOSE = new Date("2026-11-11T15:00:00Z");
const goodCost: CostReadinessInput = {
  lines: OTTAWA_18026_LINES.map((l) => ({ lineNo: l.lineNo, complete: true })),
  flags: { incomplete: false, hasSensitivityDuty: false, hasIndicativePrice: false },
};
// 每行都拿与招标一致的尺寸去对照：区间取下限，最小尺寸取等值
const dimsOk = OTTAWA_18026_LINES.filter((l) => l.dimensions || l.minimumDimensions).map((l) => {
  const required = (l.dimensions ?? l.minimumDimensions)!;
  const offered = required.replace(/(\d+(?:\.\d+)?)-\d+(?:\.\d+)?/g, "$1");
  return { lineNo: l.lineNo, ...matchDimensions({ required, offered, mode: l.minimumDimensions ? "minimum" : "exact" }) };
});
const cert = (model: string): CertificateEvidence => ({ id: `CERT-${model}`, status: "VERIFIED", coverage: "WHOLE_UNIT", issuerAccreditedInCanada: true, coveredModels: [model], expiresAt: "2028-01-01" });
const certified = {
  products: { 13: { make: "合成品牌", model: "TC-S" }, 14: { make: "合成品牌", model: "TC-M" }, 15: { make: "合成品牌", model: "TC-L" } },
  certificates: { 13: [cert("TC-S")], 14: [cert("TC-M")], 15: [cert("TC-L")] },
};
const base = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  now: BEFORE_CLOSE, closingAt: OTTAWA_18026.opportunity.closingAt, lines: OTTAWA_18026_LINES, cost: goodCost, dimensionChecks: dimsOk, ...certified, ...o,
});
const codes = (r: ReturnType<typeof assessBidReadiness>) => r.blockers.map((b) => b.code);

console.log("tender-bid-readiness readiness");

{
  ok("夹具自检：17 个带尺寸的行全部相符", dimsOk.length === 17 && dimsOk.every((d) => d.verdict === "MATCH"));
  const r = assessBidReadiness(base({ now: AFTER_CLOSE, products: {}, certificates: {} }));
  ok("渥太华回归：不可投标", r.state === "NOT_READY" && r.stateZh === "不可投标");
  const certBlockers = r.blockers.filter((b) => b.code === "CERTIFICATION_BLOCKED").map((b) => b.lineNo);
  ok("第 13、14、15 行的认证各一个阻断项", certBlockers.join() === "13,14,15");
  ok("另有「已过截标」一项", r.blockers.some((b) => b.code === "WINDOW_EXPIRED" && b.messageZh.includes("已过截标")));
  ok("恰好 4 个阻断项，每项带类别、行号与说明", r.blockers.length === 4 && r.blockers.every((b) => b.code && b.messageZh.length > 0 && "lineNo" in b) && r.summaryZh.includes("4 个阻断项"));
}
{
  const r = assessBidReadiness(base({ products: {}, certificates: {} }));
  ok("尺寸全部相符、成本已算出，只有认证未过 → 仍不可投标", r.state === "NOT_READY" && codes(r).every((c) => c === "CERTIFICATION_BLOCKED") && r.blockers.length === 3);
}
{
  const r = assessBidReadiness(base());
  ok("没有阻断项 → 可提交 Owner 决定", r.state === "READY_FOR_OWNER_DECISION" && r.blockers.length === 0 && r.stateZh === "可提交 Owner 决定");
  ok("说明写明这不是批准", r.summaryZh.includes("不是批准") && r.summaryZh.includes("不代表可以直接投标"));
  const indicative = assessBidReadiness(base({ cost: { ...goodCost, flags: { ...goodCost.flags, hasIndicativePrice: true } } }));
  ok("含指示性价格只是提示，不阻断", indicative.state === "READY_FOR_OWNER_DECISION" && indicative.warnings.some((w) => w.code === "INDICATIVE_PRICE" && w.messageZh.includes("指示性价格")));
}
{
  const duty = assessBidReadiness(base({ cost: { ...goodCost, flags: { ...goodCost.flags, hasSensitivityDuty: true } } }));
  ok("成本含未核实的关税假设 → 阻断", duty.state === "NOT_READY" && codes(duty).join() === "DUTY_UNVERIFIED");
  const partial = assessBidReadiness(base({ cost: { lines: goodCost.lines.map((l) => (l.lineNo === 5 ? { lineNo: 5, complete: false, blockers: [{ messageZh: "缺关税率" }] } : l)), flags: { ...goodCost.flags, incomplete: true } } }));
  ok("一行成本为空 → 阻断并带原因", partial.blockers.length === 1 && partial.blockers[0].code === "COST_INCOMPLETE" && partial.blockers[0].lineNo === 5 && partial.blockers[0].messageZh.includes("缺关税率"));
  ok("没有成本核算 → 阻断", codes(assessBidReadiness(base({ cost: null }))).join() === "COST_MISSING");
  const mismatch = assessBidReadiness(base({ dimensionChecks: dimsOk.map((d) => (d.lineNo === 18 ? { lineNo: 18, ...matchDimensions({ required: "36 x 38", offered: "36 x 39" }) } : d)) }));
  ok("第 18 行 36×39 → 尺寸不符阻断", mismatch.blockers.length === 1 && mismatch.blockers[0].code === "DIMENSION_MISMATCH" && mismatch.blockers[0].lineNo === 18);
  const unknown = assessBidReadiness(base({ dimensionChecks: dimsOk.filter((d) => d.lineNo !== 1) }));
  ok("有尺寸要求而未核对 → 阻断（无法判断不算相符）", unknown.blockers.length === 1 && unknown.blockers[0].code === "DIMENSION_UNKNOWN" && unknown.blockers[0].lineNo === 1);
  const stale = assessBidReadiness(base({ addenda: [{ number: 1, affectedLineNos: [13, 14, 15] }], conclusions: [{ key: "cost:13", kind: "COST_ASSUMPTION", lineNo: 13, basedOnAddendum: 0 }] }));
  ok("补遗后有待复核的结论 → 阻断", stale.blockers.length === 1 && stale.blockers[0].code === "STALE_AFTER_ADDENDUM" && stale.blockers[0].lineNo === 13);
  const broken = OTTAWA_18026_LINES.map((l) => ({ ...l })); broken[3].lineNo = 3;
  ok("价格表结构无效 → 阻断", codes(assessBidReadiness(base({ lines: broken }))).includes("SCHEDULE_INVALID"));
  ok("截标时间不带时区 → 阻断", codes(assessBidReadiness(base({ closingAt: "2026-11-10T15:00:00" }))).join() === "CLOSING_TIME_INVALID");
  const submitted = assessBidReadiness(base({ now: AFTER_CLOSE, submission: { receiptRef: "MERX-RCPT-1" } }));
  ok("已过截标但有带回执的提交 → 不算过期，提示仅供复盘", !codes(submitted).includes("WINDOW_EXPIRED") && submitted.warnings.some((w) => w.code === "ALREADY_SUBMITTED"));
}
{
  const r = assessBidReadiness(base());
  ok("输出里没有批准、已提交之类的字段", !/approv|submitted|authoriz/i.test(Object.keys(r).join(",")) && Object.keys(r).join() === "state,stateZh,blockers,warnings,summaryZh");
  const dir = join(process.cwd(), "src/lib/tender-bid-readiness");
  const files = ["evidence-status.ts", "certification-gate.ts", "staleness.ts", "readiness.ts"].map((f) => readFileSync(join(dir, f), "utf8"));
  const banned = /@\/lib\/db\b|@\/lib\/ai\b|\bfetch\s*\(\s*["'`h]|createCompletion|\bdb\.[a-zA-Z]+\.(find|create|update|delete|upsert)|sendGmail|requestApproval|google-email|pending-actions/;
  ok("可投标判定四个文件没有数据库 / 网络 / 模型 / 发信 / 审批的引用", files.every((t) => !banned.test(t)));
}

console.log(`\ntender-bid-readiness readiness: ${passed} passed`);
