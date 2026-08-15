/**
 * M1 — 外部情报 adapter 纯测（注入 fetch，零真实外呼）
 * 运行：npx tsx src/lib/tender-intel/__tests__/canadabuys.test.ts
 */
import { searchAwardHistory, isExternalIntelEnabled } from "../canadabuys";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.error("  ✗ " + n); } };

const fakeFetch = (payload: unknown, status = 200) =>
  (async () => ({ ok: status === 200, status, json: async () => payload })) as unknown as typeof fetch;

console.log("tender-intel canadabuys");
(async () => {
  let called = 0;
  const spy = (async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as typeof fetch;
  const off = await searchAwardHistory({ query: "mattress", env: {} as NodeJS.ProcessEnv, fetchImpl: spy });
  ok(!off.ok && called === 0, "flag OFF → 零出站调用");
  ok(!isExternalIntelEnabled({} as NodeJS.ProcessEnv), "flag 默认关");

  const env = { TENDER_EXTERNAL_INTEL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;
  const good = await searchAwardHistory({
    query: "mattress",
    env,
    fetchImpl: fakeFetch({
      success: true,
      result: {
        total: 2,
        records: [
          { vendor_name: "ACME FOAM LTD", description_en: "Mattresses", contract_value: "120000.5", contract_date: "2023-05-01", buyer_name: "X", owner_org_title: "Solicitor General", reference_number: "C-1" },
          { vendor_name: "", description_en: "no vendor dropped" },
        ],
      },
    }),
  });
  ok(good.ok && good.findings.length === 1, "规范化：无 vendor 的记录被丢弃");
  ok(good.findings[0].contractValue === 120000.5 && good.findings[0].currency === "CAD", "金额数值化 + CAD");
  ok(good.findings[0].sourceUrl.includes("datastore_search"), "finding 带可核验来源 URL");
  ok(good.total === 2, "total 透传");

  const bad = await searchAwardHistory({ query: "x", env, fetchImpl: fakeFetch({}, 503) });
  ok(!bad.ok && /503/.test(bad.note ?? ""), "HTTP 失败 → note 降级");
  const empty = await searchAwardHistory({ query: "  ", env, fetchImpl: fakeFetch({}) });
  ok(!empty.ok, "空查询拒绝");

  console.log(`\ntender-intel: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
