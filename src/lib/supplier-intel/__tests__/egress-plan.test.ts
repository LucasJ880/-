/**
 * BL-4A（S2 Final Remediation）：egress 查询过滤——真实 buildExternalQueryPlan → bindQueryPlan →
 * adapter.discover 路径，CI 可执行：不依赖真实数据库、真实 API key、真实 provider。
 *
 * 证明：敏感查询被丢弃 / 安全查询保留 / 混合输入不误丢安全项 / 全部被过滤时零 provider 调用 /
 * egressDropped 与 budgetTrimmed 计数正确 / 预算规则仍有效 / 断言输出不回显敏感词本身。
 *
 * 注意：本文件只给 Prisma 一个永不连接的占位 URL（与 CI 注入值同形），零数据库副作用。
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://ci:ci@127.0.0.1:5432/ci?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

// 与 china-supplier-brief SENSITIVE_PATTERNS 命中的词闸样本（只用于构造输入，不回显到断言消息）
const SENSITIVE_TOKENS = ["毛利", "底价", "estimatedValue", "内部成本"];
const SAFE_TOKENS = ["办公椅厂家", "人体工学办公椅 源头工厂", "钣金喷粉厂家", "ergonomic chair manufacturer China"];

function containsSensitive(q: string): boolean {
  return SENSITIVE_TOKENS.some((t) => q.includes(t));
}

async function main() {
  const { buildExternalQueryPlan, bindQueryPlan, EXTERNAL_BUDGET } = await import("../discovery-service");
  const { buildDeterministicBrief } = await import("../search-brief");
  const { openWebSupplierAdapter, douyinSupplierDiscoveryAdapter, DEFAULT_DISCOVERY_ADAPTERS } = await import("../adapters");
  type Provider = import("../providers").DiscoveryProvider;
  type Brief = import("../search-brief").SupplierSearchBrief;

  const requirements = [
    { id: "r1", code: "R-001", text: "ANSI/BIFMA X5.1 certification required", category: "MANDATORY", mandatory: true, mandatorySignal: "must" },
  ];
  const base: Brief = buildDeterministicBrief(
    { requirements, productKeywordsZh: ["人体工学办公椅"], productKeywordsEn: ["ergonomic chair"] },
    { now: new Date("2026-09-08T00:00:00Z") },
  );

  const countingProvider = (calls: { n: number; queries: string[] }): Provider => ({
    providerId: "fake-counting",
    policy: { respectsRobots: true, requiresPlatformLogin: false, dataLicense: "test" },
    isAvailable: () => true,
    search: async (q) => {
      calls.n += 1;
      calls.queries.push(q);
      return { status: "SUCCESS", results: [{ title: "t", url: "https://v.douyin.com/x/", snippet: "", sourceQuery: q }] };
    },
  });

  console.log("A1：敏感查询被丢弃，安全查询保留（混合输入不误丢安全项）");
  const mixed: Brief = {
    ...base,
    commercialSearchTermsZh: [`${SENSITIVE_TOKENS[0]}${SAFE_TOKENS[0]}`, SAFE_TOKENS[0], `${SENSITIVE_TOKENS[1]}椅`],
    searchTermsEn: [SAFE_TOKENS[3], `${SENSITIVE_TOKENS[2]} chair`],
  };
  const mixedPlan = buildExternalQueryPlan(mixed, [openWebSupplierAdapter]);
  const mixedQueries = (mixedPlan.plans.get("OPEN_WEB") ?? []).map((q) => q.query);
  assert.equal(mixedPlan.egressDropped, 3, "三条含敏感词的查询被丢弃");
  assert.equal(mixedPlan.budgetTrimmed, 0);
  assert.ok(mixedQueries.length === 2, `安全项必须保留（数量=${mixedQueries.length}）`);
  assert.ok(mixedQueries.every((q) => !containsSensitive(q)), "计划里零敏感词");
  assert.ok(mixedQueries.includes(SAFE_TOKENS[0]) && mixedQueries.includes(SAFE_TOKENS[3]), "两条安全查询原样保留");

  console.log("A2：安全输入零丢弃");
  const safe: Brief = { ...base, commercialSearchTermsZh: [SAFE_TOKENS[0], SAFE_TOKENS[1], SAFE_TOKENS[2]], searchTermsEn: [SAFE_TOKENS[3]] };
  const safePlan = buildExternalQueryPlan(safe, [openWebSupplierAdapter]);
  assert.equal(safePlan.egressDropped, 0);
  assert.equal((safePlan.plans.get("OPEN_WEB") ?? []).length, 4);

  console.log("A3：全部查询被过滤 → 计划为空 → 真实 discover 路径零 provider 调用");
  const allSensitive: Brief = {
    ...base,
    commercialSearchTermsZh: [`${SENSITIVE_TOKENS[0]}A`, `${SENSITIVE_TOKENS[1]}B`],
    searchTermsEn: [`${SENSITIVE_TOKENS[2]} C`],
    socialSearchTermsZh: [`${SENSITIVE_TOKENS[3]}D`],
    capabilitySearchTermsZh: [`${SENSITIVE_TOKENS[0]}E`],
  };
  const allPlan = buildExternalQueryPlan(allSensitive, DEFAULT_DISCOVERY_ADAPTERS);
  assert.ok(allPlan.egressDropped > 0);
  for (const [, plan] of allPlan.plans) assert.equal(plan.length, 0, "全部被过滤时每个 adapter 计划为空");
  const calls = { n: 0, queries: [] as string[] };
  for (const adapter of DEFAULT_DISCOVERY_ADAPTERS) {
    const bound = bindQueryPlan(adapter, allPlan.plans.get(adapter.platform) ?? []);
    const outcome = await bound.discover(allSensitive, countingProvider(calls));
    assert.ok(outcome.ok, "discover 不抛");
    if (outcome.ok) assert.ok(outcome.sourceStatus === "EMPTY" || outcome.sourceStatus === "DISABLED");
  }
  assert.equal(calls.n, 0, "零 provider 调用（敏感内容不出站）");

  console.log("A4：bindQueryPlan 只走过滤后的计划——provider 收到的查询与计划一致且零敏感词");
  const calls2 = { n: 0, queries: [] as string[] };
  const openBound = bindQueryPlan(openWebSupplierAdapter, mixedPlan.plans.get("OPEN_WEB") ?? []);
  const res = await openBound.discover(mixed, countingProvider(calls2));
  assert.ok(res.ok);
  assert.equal(calls2.n, 2);
  assert.deepEqual([...calls2.queries].sort(), [...mixedQueries].sort());
  assert.ok(calls2.queries.every((q) => !containsSensitive(q)), "provider 侧收到的查询零敏感词");

  console.log("A5：预算规则仍有效——默认 adapter 集合天花板 11 < 12；用合成 adapter 触发 MAX_QUERIES_PER_RUN 封顶，budgetTrimmed 与 egressDropped 分开计数");
  const manyTerms = Array.from({ length: 10 }, (_, i) => `${SAFE_TOKENS[0]}${i}`);
  const big: Brief = {
    ...base,
    commercialSearchTermsZh: manyTerms,
    socialSearchTermsZh: manyTerms,
    capabilitySearchTermsZh: manyTerms,
    searchTermsEn: manyTerms,
  };
  const defaultPlan = buildExternalQueryPlan(big, DEFAULT_DISCOVERY_ADAPTERS);
  const defaultTotal = [...defaultPlan.plans.values()].reduce((n, p) => n + p.length, 0);
  assert.equal(defaultTotal, 11, "默认 adapter 集合各自封顶（抖音 4 + 小红书 2 + 视频号 0 + OpenWeb 5）= 11");
  assert.ok(defaultTotal <= EXTERNAL_BUDGET.MAX_QUERIES_PER_RUN);
  assert.equal(defaultPlan.budgetTrimmed, 0);
  assert.equal(defaultPlan.egressDropped, 0);

  const synthetic = {
    platform: "OPEN_WEB" as const,
    buildQueryPlan: (): import("../adapters").PlannedQuery[] => [
      ...Array.from({ length: 15 }, (_, i) => ({
        source: "OPEN_WEB",
        query: `${SAFE_TOKENS[0]} ${i}`,
        language: "zh" as const,
        queryType: "COMMERCIAL" as const,
        priority: i + 1,
        generatedFrom: ["test"],
      })),
      { source: "OPEN_WEB", query: `${SENSITIVE_TOKENS[0]} Z`, language: "zh" as const, queryType: "COMMERCIAL" as const, priority: 16, generatedFrom: ["test"] },
    ],
    discover: openWebSupplierAdapter.discover,
  };
  const synthPlan = buildExternalQueryPlan(big, [synthetic]);
  const kept = synthPlan.plans.get("OPEN_WEB") ?? [];
  assert.equal(kept.length, EXTERNAL_BUDGET.MAX_QUERIES_PER_RUN, "封顶到 MAX_QUERIES_PER_RUN");
  assert.equal(synthPlan.budgetTrimmed, 3, "15 条安全查询保留 12 条，3 条计入 budgetTrimmed");
  assert.equal(synthPlan.egressDropped, 1, "敏感查询计入 egressDropped，且不占预算");
  assert.ok(kept.every((q) => !containsSensitive(q.query)));
  // 绑定后执行：provider 恰好收到封顶后的 12 条，零敏感词
  const calls3 = { n: 0, queries: [] as string[] };
  const boundSynth = bindQueryPlan(synthetic, kept);
  const res3 = await boundSynth.discover(big, countingProvider(calls3));
  assert.ok(res3.ok);
  assert.equal(calls3.n, EXTERNAL_BUDGET.MAX_QUERIES_PER_RUN);
  assert.ok(calls3.queries.every((q) => !containsSensitive(q)));

  // 两类计数互不混淆：只含敏感词 → egressDropped=1、budgetTrimmed=0
  const onlySensitive: Brief = { ...base, commercialSearchTermsZh: [`${SENSITIVE_TOKENS[0]}Y`] };
  const p2 = buildExternalQueryPlan(onlySensitive, [openWebSupplierAdapter]);
  assert.equal(p2.egressDropped, 1);
  assert.equal(p2.budgetTrimmed, 0);
  // 抖音 adapter：计划 ≤4，安全词全部保留且带 site: 前缀
  const dy = buildExternalQueryPlan({ ...base, socialSearchTermsZh: [SAFE_TOKENS[1]], capabilitySearchTermsZh: [SAFE_TOKENS[2]] }, [douyinSupplierDiscoveryAdapter]);
  assert.equal(dy.egressDropped, 0);
  assert.ok((dy.plans.get("DOUYIN") ?? []).every((q) => q.query.startsWith("site:douyin.com ")));

  console.log("\negress-plan（BL-4A）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
