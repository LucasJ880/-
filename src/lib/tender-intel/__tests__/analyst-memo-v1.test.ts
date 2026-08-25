/**
 * 分析师备忘录 v1 · 单测（AM-01..AM-16）：M3 标准追查 / M4 市场基准 / 判断层合成 / HTML / 注册守卫
 * 运行：npx tsx src/lib/tender-intel/__tests__/analyst-memo-v1.test.ts
 * 纯函数 + 假 invoker/假 fetch，零 DB、零真实出站。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { extractStandardRefs, researchReferencedStandards } from "@/lib/tender-intel/referenced-standards";
import { researchMarketPricing, deriveMarketQueries } from "@/lib/tender-intel/market-pricing";
import { synthesizeAnalystMemo, type AnalystMemoDigest } from "@/lib/tender-analyst-memo/synthesize";
import { buildAnalystMemoHtml } from "@/lib/projects/generate/analyst-memo-html";
import { PROJECT_PDF_DOC_TYPES } from "@/lib/bid-workflow/pdf-doc-types";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };
const inv = (payload: unknown): LlmInvoker => async () => ({ content: JSON.stringify(payload), model: "fake", elapsedMs: 1 });
const fakeFetch = (results: Array<{ title: string; url: string; content: string }>): typeof fetch =>
  (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch;
const ENV_ON = { TAVILY_API_KEY: "tvly-fake" } as unknown as NodeJS.ProcessEnv;
const ENV_OFF = {} as NodeJS.ProcessEnv;

console.log("分析师备忘录 v1 单测");

(async () => {
  // ── M3 标准追查 ──
  {
    const texts = ["Kennels must be MVMA PIPS sections 2.11.2.8 - 2.11.2.12 compliant.", "Warranty is as stated in C11 of the General Conditions."];
    const refs = await extractStandardRefs({
      texts,
      invoker: inv({ refs: [
        { refCode: "PIPS 2.11.2.8-12", docName: "MVMA PIPS", sectionRange: "2.11.2.8-2.11.2.12", whyRelevantZh: "犬舍合规核心", sourceQuote: "MVMA PIPS sections 2.11.2.8 - 2.11.2.12 compliant" },
        { refCode: "FAKE-99", docName: "编造标准", sectionRange: null, whyRelevantZh: "无", sourceQuote: "this quote does not exist in corpus at all" },
      ] }),
    });
    ok(refs.length === 1 && refs[0]!.docName === "MVMA PIPS", "AM-01: 抽取的引用必须带真实原文引句——编造引句被锚点过滤", refs.length);

    const un = await researchReferencedStandards({ refs, env: ENV_OFF });
    ok(un.status === "unavailable" && un.note!.includes("TAVILY"), "AM-02: 无检索 key → unavailable（拒绝凭空展开标准）");

    const empty = await researchReferencedStandards({ refs, env: ENV_ON, fetchImpl: fakeFetch([]) , invoker: inv({}) });
    ok(empty.status === "ran" && empty.standards[0]!.status === "not_found", "AM-03: 检索无结果 → not_found（明说，不编条款）");

    const good = await researchReferencedStandards({
      refs,
      env: ENV_ON,
      fetchImpl: fakeFetch([{ title: "MVMA PIPS", url: "https://mvma.ca/pips", content: "2.11.2.10 five of six sides must be solid, impervious..." }]),
      invoker: inv({ clauses: [
        { clauseId: "2.11.2.10", clauseSummaryZh: "六面之五须实心防水", implicationZh: "国内普通六面栏杆笼不合规", sourceIndexes: [0] },
        { clauseId: "9.9.9", clauseSummaryZh: "编造条款", implicationZh: "无出处", sourceIndexes: [7] },
      ], confidence: "MEDIUM", gapsZh: [] }),
    });
    const st = good.standards[0]!;
    ok(st.status === "expanded" && st.clauses.length === 1 && st.clauses[0]!.clauseId === "2.11.2.10", "AM-04: 无效 sourceIndex 的条款被丢弃（接地过滤）", st.clauses.length);
    ok(st.sources.length > 0 && st.sources[0]!.url === "https://mvma.ca/pips", "AM-05: 展开结果携带出处");
  }

  // ── M4 市场基准 ──
  {
    ok((await researchMarketPricing({ productPhrase: null, specHints: [] })).status === "no_product", "AM-06: 无产品短语 → no_product");
    ok((await researchMarketPricing({ productPhrase: "above floor dog kennel", specHints: [], env: ENV_OFF })).status === "unavailable", "AM-07: 无检索 key → unavailable（拒绝拍脑袋区间）");
    const qs = deriveMarketQueries({ productPhrase: "above floor kennel", specHints: ["stainless"] });
    ok(qs.length >= 2 && qs.every((q) => q.includes("above floor kennel")), "AM-08: 检索线覆盖目录价/规格价/加拿大供应商");

    const mp = await researchMarketPricing({
      productPhrase: "above floor kennel",
      specHints: ["84 inch"],
      env: ENV_ON,
      fetchImpl: fakeFetch([{ title: "Midmark catalog", url: "https://x.com/c", content: "UltraBase 3x5 base US$1,053 per unit, run door US$933" }]),
      invoker: inv({ benchmarks: [
        { productName: "UltraBase 3x5", vendor: "Midmark", priceRaw: "US$1,053", currency: "USD", unit: "unit", comparabilityZh: "尺寸相符", sourceIndex: 0 },
        { productName: "编造产品", vendor: null, priceRaw: "US$9,999", currency: "USD", unit: null, comparabilityZh: "片段中无此价", sourceIndex: 0 },
      ], observationsZh: ["北美品牌单套约千美元级"], insufficientZh: null }),
    });
    ok(mp.status === "ran" && mp.benchmarks.length === 1 && mp.benchmarks[0]!.priceRaw === "US$1,053", "AM-09: 片段中不存在的价格数字被丢弃（金额零编造门）", mp.benchmarks);
    ok(mp.fxNoteZh.includes("未做汇率换算"), "AM-10: 原币呈现——绝不自动换汇");

    const dry = await researchMarketPricing({ productPhrase: "kennel", specHints: [], env: ENV_ON, fetchImpl: fakeFetch([]), invoker: inv({}) });
    ok(dry.status === "ran" && !!dry.insufficientZh, "AM-11: 检索空 → insufficient 明说");
  }

  // ── 判断层合成 ──
  {
    const digest: AnalystMemoDigest = {
      project: { nameZh: "犬舍", buyer: "City of Winnipeg", closeDate: "2026-09-11", solicitationNumber: "527-2026" },
      criticalFactsDigest: ["数量：9 套（KNOWN）"], requirementsDigest: { mandatoryCount: 3, totalCount: 10, top: ["MVMA PIPS 合规"] },
      synthesisDigest: [], standardsDigest: [], marketDigest: [], strategyDigest: [], pricingDigest: [], quoteDigest: [],
    };
    const good = await synthesizeAnalystMemo({ digest, invoker: inv({
      execSummaryZh: "小批量纯供货，可投，交付周期是最大风险。",
      goNoGo: [
        { dimensionZh: "合规可行性", rating: "YELLOW", reasonZh: "PIPS 需展开", basedOn: "引用标准" },
        { dimensionZh: "资格经验", rating: "YELLOW", reasonZh: "类似经验待补", basedOn: "强制要求" },
        { dimensionZh: "交付周期", rating: "RED", reasonZh: "20 工作日", basedOn: "关键事实" },
        { dimensionZh: "价格竞争力", rating: "GREEN", reasonZh: "国内定制空间", basedOn: "市场基准" },
      ],
      risks: [{ riskZh: "20 工作日交付", severity: "HIGH", mitigationZh: "投标前锁定厂家预生产", basedOn: "关键事实" }],
      rfiSuggestions: [{ questionZh: "9 英寸指净离地还是可调范围？", questionEn: "Does the 9-inch requirement refer to clearance or adjustable range?", whyZh: "规格歧义" }],
      nextStepsZh: ["发 RFI"], dataGapsZh: ["无历史授标数据"],
    }) });
    ok(good.memo !== null && good.memo.goNoGo.length === 4 && good.errorCode === null, "AM-12: 判断层合成 schema 通过（分维评级+依据）");
    const bad = await synthesizeAnalystMemo({ digest, invoker: inv({ execSummaryZh: "x", goNoGo: [] }) });
    ok(bad.memo === null && bad.errorCode !== null, "AM-13: goNoGo 少于 4 维 → 结构化失败（不产半吊子备忘录）");

    // ── HTML ──
    const html = buildAnalystMemoHtml({
      header: { projectName: "犬舍<script>", clientOrganization: "Winnipeg", solicitationNumber: "527-2026", closeDate: "2026-09-11", orgName: null, generatedAt: "2026-08-26" },
      criticalFacts: [{ labelZh: "数量", status: "KNOWN", text: "9 套" }],
      requirements: [{ groupZh: "技术", items: [{ zh: "PIPS 合规", mandatory: true }] }],
      requirementsTruncated: false,
      standards: null, market: null, vendorBenchmarkZh: [], pricingScenarioZh: [], quoteSnapshotZh: [], strategyPointsZh: ["要点A（依据：pricing）"],
      llm: good.memo, llmErrorCode: null,
    });
    ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "AM-14: HTML 转义（标题注入被 esc）");
    ok(["投标分析师备忘录", "AI_INFERRED", "GO / NO-GO", "🔴", "建议向采购方澄清"].every((t) => html.includes(t)), "AM-15: 备忘录核心区块齐全（徽标/矩阵/RFI）");
  }

  // ── 注册守卫 ──
  {
    const root = join(__dirname, "../../../..");
    const gen = readFileSync(join(root, "src/lib/projects/generate/generate-docs.ts"), "utf-8");
    const menu = readFileSync(join(root, "src/components/project-generate/project-generate-menu.tsx"), "utf-8");
    const orch = readFileSync(join(root, "src/lib/tender-intel/orchestrate.ts"), "utf-8");
    const brief = readFileSync(join(root, "src/lib/bid-workflow/china-supplier-brief.ts"), "utf-8");
    ok((PROJECT_PDF_DOC_TYPES as readonly string[]).includes("analyst_memo") && gen.includes('analyst_memo: "投标分析师备忘录"') && menu.includes('docType: "analyst_memo"'), "AM-16a: analyst_memo 三处注册齐（路由白名单/标题/生成菜单）");
    ok(orch.includes("referencedStandards } : {}") && orch.includes("marketPricing } : {}") && orch.includes("standardsResearched"), "AM-16b: 编排层落库 M3/M4 + 状态字段");
    ok(brief.includes("9b) Compliance evidence") && brief.includes("BSCI / SMETA"), "AM-16c: 供应商简报含劳工/来源取证清单");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
