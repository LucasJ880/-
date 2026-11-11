/**
 * TI-4a 投标工作区读取结果与成本核算（纯逻辑）
 * 运行：npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts
 */
import assert from "node:assert/strict";
import { mergeWorkspace, type CostSheetRequest, type StoredWorkspace } from "../contract";
import { buildCostSheet, buildWorkspaceView, deriveMaterials, type WorkspaceContext } from "../workspace-view";
import { OTTAWA_18026, OTTAWA_18026_LINES } from "@/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026";
import { OTTAWA_SYNTHETIC_SCENARIO } from "@/lib/tender-bid-cost/__tests__/fixtures/ottawa-synthetic-scenario";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const now = new Date("2026-11-11T15:00:00Z");
const ctx = (o: Partial<WorkspaceContext> = {}): WorkspaceContext => ({
  now, closingAtIso: new Date(OTTAWA_18026.opportunity.closingAt).toISOString(), ownNames: ["Sunny Shutter Inc."], documentCount: 3, quotedSupplierCount: 0, ...o,
});
const HOLDERS = ["Northfield Pest Supply Inc.", "Lakeshore Linen Co.", "Maple Facility Products Ltd.", "Harbour Bedding Wholesale", "Rideau Janitorial Supply", "Capital Textile Imports Inc.", "SUNNY SHUTTER INC", "Prairie Hospitality Goods", "Summit Thermal Equipment"];
const stored: StoredWorkspace = mergeWorkspace(null, {
  priceSchedule: { lines: OTTAWA_18026_LINES },
  lineDetails: { "18": { offeredDimensions: "36 x 39" }, "1": { offeredDimensions: "39 x 77.5 x 12" } },
  documentHolders: { solicitationId: "18026-93121-T01", portal: "MERX", sourceKind: "USER_UPLOAD_SCREENSHOT", capturedAt: "2026-11-06T10:00:00-05:00", entries: HOLDERS.map((name) => ({ name })) },
  addenda: [{ number: 1, issuedOn: "2026-11-05", affectedLineNos: [13, 14, 15], effect: "整机加拿大电气认证" }],
}, "user_1", now);
const costRequest: CostSheetRequest = {
  label: "合成数据",
  lines: OTTAWA_SYNTHETIC_SCENARIO.lines.map(({ line, ...rest }) => ({ lineNo: line.lineNo, ...rest })) as CostSheetRequest["lines"],
  importGst: OTTAWA_SYNTHETIC_SCENARIO.importGst as CostSheetRequest["importGst"],
  freight: OTTAWA_SYNTHETIC_SCENARIO.freight as CostSheetRequest["freight"],
  reserves: OTTAWA_SYNTHETIC_SCENARIO.reserves as CostSheetRequest["reserves"],
  pricing: OTTAWA_SYNTHETIC_SCENARIO.pricing as CostSheetRequest["pricing"],
};

console.log("tender-bid-workspace view");

{
  const v = buildWorkspaceView(stored, ctx());
  ok("渥太华：价格表有效，18 行", v.hasPriceSchedule && v.schedule.validation.valid && v.schedule.lines.length === 18);
  ok("领取方数 9、竞争对手领取方数 8、投标人数未知", !!v.documentHolders && v.documentHolders.ok && v.documentHolders.documentHolderCount === 9 && v.documentHolders.competitorHolderCount === 8 && v.documentHolders.bidderCount === null);
  const cert = (n: number) => v.lineChecks.find((c) => c.lineNo === n)!.certification.verdict;
  ok("第 13–15 行认证阻断，第 1 行不适用", [13, 14, 15].every((n) => cert(n) === "BLOCKED") && cert(1) === "NOT_APPLICABLE");
  ok("第 18 行 36×39 → 尺寸不符；第 1 行在区间内 → 相符", v.lineChecks.find((c) => c.lineNo === 18)!.dimension?.verdict === "MISMATCH" && v.lineChecks.find((c) => c.lineNo === 1)!.dimension?.verdict === "MATCH");
  ok("没填产品尺寸的行没有对照结果（判定里报尚未核对）", v.lineChecks.find((c) => c.lineNo === 2)!.dimension === null && v.readiness.blockers.some((b) => b.code === "DIMENSION_UNKNOWN" && b.lineNo === 2));
  ok("可投标判定：不可投标，含已过截标与三行认证", v.readiness.state === "NOT_READY" && v.readiness.blockers.some((b) => b.code === "WINDOW_EXPIRED") && v.readiness.blockers.filter((b) => b.code === "CERTIFICATION_BLOCKED").length === 3);
  ok("读取时没有成本 → 阻断项里写明还没有成本核算", v.readiness.blockers.some((b) => b.code === "COST_MISSING"));
  assert.ok(v.stages.ok);
  ok("阶段清单：四项停下等批准", v.stages.lists.awaitingApproval.map((a) => a.stageKey).join() === "owner_decision,supplier_outreach,records_request,submission");
  ok("阶段清单：成本核算缺供应商报价，进口线索未接通", v.stages.lists.missingMaterials.some((m) => m.stageKey === "costing") && v.stages.lists.notConnected.some((n) => n.sourceKey === "LICENSED_TRADE_DATA"));
  ok("读取结果里没有成本、报价金额、利润、毛利率字段", !/"(goods|duty|freight|directCost|unitCost|unitBid|extended|profit|grossMarginPct|markupPct|bidExclHst)"\s*:/.test(JSON.stringify(v)));
}
{
  ok("材料推导：有文件或有价格表 → 有招标文件", deriveMaterials(null, { documentCount: 1, quotedSupplierCount: 0 }).join() === "TENDER_DOCUMENTS" && deriveMaterials(stored, { documentCount: 0, quotedSupplierCount: 0 }).includes("TENDER_DOCUMENTS"));
  ok("材料推导：已存名单 → 有领取方名单；有已报价供应商 → 有供应商报价", deriveMaterials(stored, { documentCount: 0, quotedSupplierCount: 2 }).join() === "TENDER_DOCUMENTS,DOCUMENT_HOLDER_LIST,SUPPLIER_QUOTES");
  ok("什么都没有 → 没有材料", deriveMaterials(null, { documentCount: 0, quotedSupplierCount: 0 }).length === 0);
  const empty = buildWorkspaceView(null, ctx({ documentCount: 0 }));
  assert.ok(empty.stages.ok);
  ok("空工作区：文件接收等材料，不抛错", !empty.hasPriceSchedule && empty.stages.stages.find((s) => s.key === "intake")!.decision === "WAIT_MATERIAL");
  const withQuotes = buildWorkspaceView(stored, ctx({ quotedSupplierCount: 3 }));
  assert.ok(withQuotes.stages.ok);
  ok("询价里已有报价 → 成本核算阶段直接执行", withQuotes.stages.stages.find((s) => s.key === "costing")!.decision === "RUN");
}
{
  const r = buildCostSheet(stored, costRequest, ctx());
  assert.ok(r.ok);
  const rows = r.view.groups.flatMap((g) => g.rows);
  const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
  ok("核算表：行项 18 行，四块齐全", rows.length === 18 && r.view.assumptions.length > 0 && ["## 行项", "## 合计", "## 假设与出处", "## 阻断与提示"].every((h) => r.markdown.includes(h)));
  ok("合计等于逐行之和", rows.reduce((a, x) => a + cents(x.directCost), 0) === cents(r.view.totals.directCost) && rows.reduce((a, x) => a + cents(x.extended), 0) === cents(r.view.totals.bidExclHst));
  ok("带成本的可投标判定：不再报还没有成本核算，改报未核实的关税假设", !r.readiness.blockers.some((b) => b.code === "COST_MISSING") && r.readiness.blockers.some((b) => b.code === "DUTY_UNVERIFIED"));
  const partial = buildCostSheet(stored, { ...costRequest, lines: costRequest.lines.filter((l) => l.lineNo !== 5) }, ctx());
  ok("少给一行成本输入 → 该行在表上为空并写明缺供应商报价，合计标不完整", partial.ok && partial.view.blockers.some((b) => b.lineNo === 5 && b.reasons.includes("缺供应商报价")) && partial.view.totals.marks.includes("不完整"));
  const stray = buildCostSheet(stored, { ...costRequest, lines: [...costRequest.lines, { ...costRequest.lines[0], lineNo: 99 }] }, ctx());
  ok("成本输入引用不存在的行号 → 400", !stray.ok && stray.status === 400 && stray.code === "UNKNOWN_LINE" && stray.messageZh.includes("99"));
  const none = buildCostSheet(null, costRequest, ctx());
  ok("还没有价格表 → 409", !none.ok && none.status === 409 && none.code === "NO_PRICE_SCHEDULE");
  const rejected = buildCostSheet(stored, { ...costRequest, freight: { plans: [{ key: "a", mode: "FCL", charges: [] }, { key: "b", mode: "LCL", charges: [] }] } }, ctx());
  ok("自相矛盾的成本输入（两个运费方案）→ 400 并带原因", !rejected.ok && rejected.status === 400 && rejected.code === "COST_INPUT_REJECTED" && rejected.messageZh.includes("只能选一个"));
}

console.log(`\ntender-bid-workspace view: ${passed} passed`);
