/**
 * M1.1 — 自动提取检索词 + 多线交叉验证（纯测）
 * 运行：npx tsx src/lib/tender-intel/__tests__/canadabuys-auto.test.ts
 */
import { deriveAwardQueries, rankAwardCandidates, autoSearchAwardHistory, type AwardFinding } from "../canadabuys";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.error("  ✗ " + n); } };

console.log("tender-intel auto search");

// 提取：中文名+英文括号 → 产品线；采购机构 → 全名+去前缀变体
const qs = deriveAwardQueries({
  projectName: "09-02 床垫 UAT-P0 (COS-0265 One-Piece Foam Mattresses)",
  buyerText: "Ontario Ministry of the Solicitor General（安大略省）",
  productTexts: ["采购一体式泡沫床垫（One-Piece Foam Mattresses with Built-In Pillow）供惩教设施使用"],
});
ok(qs.some((q) => /One-Piece Foam Mattresses/i.test(q)), "提取产品英文短语");
ok(qs.some((q) => /Ministry of the Solicitor General/i.test(q)), "提取机构全名");
ok(qs.some((q) => /^Solicitor General$/i.test(q)), "机构去前缀变体");
ok(qs.length <= 5, "检索线上限 5");

// 交叉验证：同一 vendor 命中两条线 > 只命中一条线
const f = (vendor: string, value: number | null): AwardFinding => ({
  source: "open_canada_contracts", vendorName: vendor, descriptionEn: null,
  contractValue: value, currency: "CAD", contractDate: "2023-01-01",
  buyerName: null, ownerOrg: null, referenceNumber: null, sourceUrl: "https://x", raw: {},
});
const ranked = rankAwardCandidates([
  { query: "product line", findings: [f("ACME LTD", 100), f("BETA INC", null)] },
  { query: "buyer line", findings: [f("acme ltd", null), f("GAMMA CO", 50)] },
]);
ok(ranked[0].vendorName.toUpperCase() === "ACME LTD", "跨线命中排第一");
ok(ranked[0].hitQueries.length === 2, "记录命中线");
ok(ranked[0].bestFinding.contractValue === 100, "保留带金额的最佳记录");
ok(ranked.length === 3, "vendor 归并去重");

// 自动检索：flag OFF 零出站
(async () => {
  let called = 0;
  const spy = (async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as typeof fetch;
  const off = await autoSearchAwardHistory({ queries: ["x y"], env: {} as NodeJS.ProcessEnv, fetchImpl: spy });
  ok(!off.ok && called === 0, "auto: flag OFF → 零出站");
  const env = { TENDER_EXTERNAL_INTEL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
  const good = await autoSearchAwardHistory({
    queries: ["foam mattress"],
    env,
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ success: true, result: { total: 1, records: [{ vendor_name: "ACME", contract_value: "5" }] } }) })) as unknown as typeof fetch,
  });
  ok(good.ok && good.candidates.length === 1, "auto: 多线检索产出候选");
  console.log(`\ntender-intel-auto: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
