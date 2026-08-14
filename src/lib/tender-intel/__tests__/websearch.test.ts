/**
 * M2 — Web 情报纯测（注入 fetch，零真实外呼）
 * 运行：npx tsx src/lib/tender-intel/__tests__/websearch.test.ts
 */
import { deriveWebQueries, rankWebFindings, autoWebIntel, hasWebSearchKey, type WebFinding } from "../websearch";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.error("  ✗ " + n); } };

console.log("tender-intel websearch");

// 多线提取：中标方线 ×2 + 产品机构线 + 编号线
const qs = deriveWebQueries({
  confirmedWinner: "ACME FOAM LTD",
  productPhrase: "One-Piece Foam Mattresses",
  buyerPhrase: "Solicitor General",
  solicitationNumber: "COS-0265",
});
ok(qs.some((q) => q.includes('"ACME FOAM LTD"')), "中标方线");
ok(qs.some((q) => /Solicitor General awarded contract/.test(q)), "产品+机构线");
ok(qs.some((q) => q.includes('"COS-0265"')), "招标编号线");
ok(qs.length <= 4, "检索线上限 4");

// 域名跨线交叉验证
const wf = (url: string, q: string): WebFinding => ({ title: "t", url, snippet: "", sourceQuery: q });
const ranked = rankWebFindings([
  { query: "A", findings: [wf("https://www.acmefoam.com/case", "A"), wf("https://news.example.com/x", "A")] },
  { query: "B", findings: [wf("https://acmefoam.com/about", "B")] },
]);
ok(ranked[0].domain === "acmefoam.com" && ranked[0].hitQueries.length === 2, "跨线域名排第一（www 归一）");
ok(ranked.length === 2, "域名归并");

(async () => {
  // 总闸 OFF / 无 key → 零出站
  let called = 0;
  const spy = (async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as typeof fetch;
  const off = await autoWebIntel({ queries: ["x y"], env: {} as NodeJS.ProcessEnv, fetchImpl: spy });
  ok(!off.ok && called === 0, "总闸 OFF → 零出站");
  const noKey = await autoWebIntel({ queries: ["x"], env: { TENDER_EXTERNAL_INTEL_ENABLED: "1" } as unknown as NodeJS.ProcessEnv, fetchImpl: spy });
  ok(!noKey.ok && called === 0 && /TAVILY/.test(noKey.note ?? ""), "无 key → 零出站 + 明确提示");
  ok(!hasWebSearchKey({} as NodeJS.ProcessEnv), "key 检测");
  const env = { TENDER_EXTERNAL_INTEL_ENABLED: "1", TAVILY_API_KEY: "k" } as unknown as NodeJS.ProcessEnv;
  const good = await autoWebIntel({
    queries: ["foam mattress award"],
    env,
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ results: [{ title: "Case", url: "https://comp.com/a", content: "..." }] }) })) as unknown as typeof fetch,
  });
  ok(good.ok && good.candidates[0]?.domain === "comp.com", "正常检索产出域名候选");
  console.log(`\ntender-intel-web: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
