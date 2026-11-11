/**
 * TI-3a 进口线索与来源连接状态（纯逻辑）
 * 运行：npx tsx src/lib/tender-competition/__tests__/leads-and-sources.test.ts
 * 覆盖任务书验收项 A5（2024 年的运单只是线索）、A6（未接通的连接器报 NOT_CONNECTED，不造数据）。
 * 测试里的公司名全部虚构。
 */
import assert from "node:assert/strict";
import { confirmCurrentSupply, createImportLead, IMPORT_LEAD_CAVEAT_ZH, type ImportLeadInput } from "../import-leads";
import { DEFAULT_INTEL_SOURCES, readSource, resolveSourceState, type IntelSource } from "../source-status";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const now = new Date("2026-11-11T15:00:00Z");
const input = (o: Partial<ImportLeadInput> = {}): ImportLeadInput => ({
  importerName: "COMPETITOR_A", exporterName: "EXPORTER_A", sourceKind: "USER_ENTRY", capturedAt: "2026-11-08T09:00:00-05:00",
  shipmentDate: "2024-06-15", goodsDescription: "mattress encasements", evidenceRef: "upload:trade-record-1", ...o,
});
const source = (key: string): IntelSource => DEFAULT_INTEL_SOURCES.find((s) => s.key === key)!;

console.log("tender-competition leads-and-sources");

{
  const r = createImportLead(input(), now);
  assert.ok(r.ok);
  ok("2024 年的运单：状态为线索、未证实当前供货", r.lead.status === "LEAD_UNVERIFIED" && r.lead.statusZh === "线索，未证实当前供货");
  ok("标为历史线索", r.lead.isHistorical === true);
  ok("说明文字写明不代表当前供货、独家或投标价", r.lead.caveatZh === IMPORT_LEAD_CAVEAT_ZH && ["不代表当前供货", "不代表独家", "投标价"].every((k) => r.lead.caveatZh.includes(k)));
  ok("新建线索没有确认记录", r.lead.confirmation === null);

  const old = confirmCurrentSupply(r.lead, { evidenceDate: "2024-06-15", evidenceRef: "upload:trade-record-1", confirmedBy: "user_lucas", now });
  ok("用 2024 年的证据确认 → 拒绝，说明超过 12 个月", !old.ok && old.code === "EVIDENCE_TOO_OLD" && old.messageZh.includes("12 个月"));
  ok("被拒后原线索状态不变", r.lead.status === "LEAD_UNVERIFIED");
  const noOne = confirmCurrentSupply(r.lead, { evidenceDate: "2026-09-01", evidenceRef: "upload:po-2026", confirmedBy: "", now });
  ok("缺确认人 → 拒绝", !noOne.ok && noOne.code === "CONFIRMER_MISSING");
  const future = confirmCurrentSupply(r.lead, { evidenceDate: "2027-01-01", evidenceRef: "x", confirmedBy: "user_lucas", now });
  ok("证据日期在未来 → 拒绝", !future.ok && future.code === "EVIDENCE_IN_FUTURE");
  const good = confirmCurrentSupply(r.lead, { evidenceDate: "2026-09-01", evidenceRef: "upload:po-2026", confirmedBy: "user_lucas", now });
  ok("当期证据 + 确认人 → 已确认当前供货，留下确认人、时间、证据", good.ok && good.lead.status === "CONFIRMED_CURRENT" && good.lead.confirmation?.confirmedBy === "user_lucas" && good.lead.confirmation.evidenceRef === "upload:po-2026" && !!good.lead.confirmation.confirmedAt);
}
{
  const recent = createImportLead(input({ shipmentDate: "2026-08-20" }), now);
  ok("12 个月内的运单不标历史，但仍只是线索", recent.ok && recent.lead.isHistorical === false && recent.lead.status === "LEAD_UNVERIFIED");
  const boundary = createImportLead(input({ shipmentDate: "2025-11-11" }), now);
  ok("恰好 12 个月前的当天不算历史", boundary.ok && boundary.lead.isHistorical === false);
  const noDate = createImportLead(input({ shipmentDate: null }), now);
  ok("没有运单日期 → 时效未知（null），不当作当期", noDate.ok && noDate.lead.isHistorical === null);
  const noEvidence = createImportLead(input({ evidenceRef: " " }), now);
  ok("没有证据引用的线索不收", !noEvidence.ok && noEvidence.code === "EVIDENCE_MISSING");
  const naive = createImportLead(input({ capturedAt: "2026-11-08T09:00:00" }), now);
  ok("采集时间缺时区 → 拒绝", !naive.ok && naive.code === "CAPTURED_AT_INVALID");
  const badDate = createImportLead(input({ shipmentDate: "2024-13-40" }), now);
  ok("运单日期无效 → 拒绝", !badDate.ok && badDate.code === "SHIPMENT_DATE_INVALID");
}
{
  let called = 0;
  const fetch = () => { called += 1; return [{ id: "invented" }]; };
  const trade = readSource(source("LICENSED_TRADE_DATA"), fetch);
  ok("授权贸易数据缺省未接通：状态 NOT_CONNECTED，记录为空", trade.status === "NOT_CONNECTED" && trade.records.length === 0);
  ok("未接通时取数函数根本不会被调用", called === 0);
  ok("说明写明未接通不等于没有记录", trade.messageZh.includes("未接通") && trade.messageZh.includes("不表示没有记录"));

  const connected: IntelSource = { key: "OFFICIAL_AWARDS", labelZh: "官方授标与合同披露", access: "PUBLIC", configuredState: "CONNECTED" };
  const empty = readSource(connected, () => []);
  ok("已接通但查无结果 → EMPTY，与未接通不同", empty.status === "EMPTY" && empty.status !== trade.status && empty.messageZh.includes("没有结果"));
  const some = readSource(connected, () => [{ id: 1 }, { id: 2 }]);
  ok("已接通且有结果 → OK，带回记录", some.status === "OK" && some.records.length === 2);

  const portal: IntelSource = { key: "TENDER_PORTAL_LOGIN", labelZh: "需要登录的招标门户", access: "AUTHENTICATED_PORTAL", configuredState: "CONNECTED" };
  ok("登录门户配置成已接通也仍是按纪律禁用", resolveSourceState(portal) === "DISABLED_BY_POLICY");
  const portalRead = readSource(portal, fetch);
  ok("登录门户不取数、不带记录", portalRead.status === "DISABLED_BY_POLICY" && portalRead.records.length === 0 && called === 0);
  ok("用户上传类来源缺省为仅人工", resolveSourceState(source("DOCUMENT_HOLDER_UPLOAD")) === "MANUAL_ONLY" && readSource(source("DOCUMENT_HOLDER_UPLOAD"), fetch).status === "MANUAL_ONLY" && called === 0);
  ok("缺省清单里没有任何来源是已接通", DEFAULT_INTEL_SOURCES.every((s) => resolveSourceState(s) !== "CONNECTED"));
}

console.log(`\ntender-competition leads-and-sources: ${passed} passed`);
