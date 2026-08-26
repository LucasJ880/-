/**
 * 分析师备忘录 v2 · 单测（AMV2-01..14）：分块/合并/接地/数字回核/受限MD/两跳市场/注册守卫
 * 运行：npx tsx src/lib/tender-analyst-memo/v2/__tests__/memo-v2.test.ts
 * 纯函数 + 假 invoker/假 fetch，零 DB、零真实出站。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { chunkPages, mergeNotes, groundChunkNotes, verifyNumbers, EMPTY_NOTES, type ChunkNotes } from "@/lib/tender-analyst-memo/v2/contract";
import { renderLimitedMd, buildAnalystMemoV2Html } from "@/lib/tender-analyst-memo/v2/render";
import { researchMarketPricingTwoHop } from "@/lib/tender-intel/market-pricing";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };
const inv = (payloads: unknown[]): LlmInvoker => { let i = 0; return async () => ({ content: JSON.stringify(payloads[Math.min(i++, payloads.length - 1)]), model: "fake", elapsedMs: 1 }); };
const fakeFetch = (results: Array<{ title: string; url: string; content: string }>): typeof fetch => (async () => new Response(JSON.stringify({ results }), { status: 200 })) as unknown as typeof fetch;
const ENV_ON = { TAVILY_API_KEY: "tvly-fake" } as unknown as NodeJS.ProcessEnv;

console.log("分析师备忘录 v2 单测");
(async () => {
  {
    const pages = [
      { docTitle: "Tender 527-2026", pageNumber: 1, unitLabel: null, contentText: "A".repeat(9000) },
      { docTitle: "Tender 527-2026", pageNumber: 2, unitLabel: null, contentText: "B".repeat(9000) },
      { docTitle: "Tender 527-2026", pageNumber: 3, unitLabel: null, contentText: "C".repeat(9000) },
      { docTitle: "Form B", pageNumber: 1, unitLabel: "Sheet「Pricing」· 行 1–40", contentText: "D".repeat(100) },
    ];
    const chunks = chunkPages(pages, 22_000);
    ok(chunks.length === 2 && chunks[0]!.text.includes("【《Tender 527-2026》p.1】") && chunks[1]!.text.includes("Sheet「Pricing」"), "AMV2-01: 分块带页锚点，超限自动切块", chunks.length);
    ok(chunks[0]!.meta.pageSpan.includes("p.1") && chunks[0]!.meta.pageSpan.includes("p.2"), "AMV2-02: 块元信息记录页跨度");
    const huge = chunkPages([{ docTitle: "X", pageNumber: 1, unitLabel: null, contentText: "Z".repeat(60_000) }], 22_000);
    ok(huge.length === 1 && huge[0]!.meta.charCount > 22_000, "AMV2-03: 单页超大独立成块（不无限膨胀不丢内容）");
  }
  {
    const a: ChunkNotes = { ...EMPTY_NOTES, specNotes: [{ item: "高度", valueRaw: "84 inch", pageRef: "《T》p.21" }], productPhrases: ["Above Floor Kennel"] };
    const b: ChunkNotes = { ...EMPTY_NOTES, specNotes: [{ item: "高度", valueRaw: "84 inch", pageRef: "《T》p.21" }, { item: "宽度", valueRaw: "36 inch", pageRef: "《T》p.21" }], productPhrases: ["above floor kennel"] };
    const m = mergeNotes(a, b);
    ok(m.specNotes.length === 2 && m.productPhrases.length === 1, "AMV2-04: 笔记合并去重（规格按 item+值、产品短语大小写不敏感）");
    const chunkText = "【《T》p.21】高度不小于 84 inch";
    const g = groundChunkNotes(chunkText, { ...EMPTY_NOTES, specNotes: [{ item: "高度", valueRaw: "84 inch", pageRef: "《T》p.21" }, { item: "编造", valueRaw: "999", pageRef: "《T》p.99" }] });
    ok(g.specNotes.length === 1 && g.specNotes[0]!.item === "高度", "AMV2-05: 锚点接地——编造页码的笔记被丢弃");
  }
  {
    const audit = verifyNumbers("高度 2,134 mm；违约金 $100/日；虚构价 CAD 47,000", "…2134 mm … liquidated damages $100 per day …");
    ok(audit.unverified.length === 1 && audit.unverified[0]!.includes("47000"), "AMV2-06: 正文数字回核——原文不存在的 47,000 被点名", audit);
  }
  {
    const html = renderLimitedMd("### 小标题\n**重点**说明\n- 条目A\n- 条目B\n| 维度 | 评级 |\n| --- | --- |\n| 交付 | 🔴 |\n<script>alert(1)</script>");
    ok(html.includes("<h3") && html.includes("<b>重点</b>") && html.includes("<ul>") && html.includes("<table>") && html.includes("🔴"), "AMV2-07: 标题/粗体/列表/表格全渲染");
    ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "AMV2-08: 未知语法按转义段落输出（XSS 安全）");
  }
  {
    const mp = await researchMarketPricingTwoHop({
      productPhrase: "above floor dog kennel",
      specHints: ["84 inch height", "stainless"],
      env: ENV_ON,
      fetchImpl: fakeFetch([{ title: "Midmark catalog", url: "https://x.com/m", content: "UltraBase 3x5 US$1,053 per base unit" }]),
      invoker: inv([
        { searchTerms: ["Midmark UltraBase kennel", "Shor-Line above floor kennel"] },
        { benchmarks: [
          { productName: "UltraBase 3x5", vendor: "Midmark", priceRaw: "US$1,053", currency: "USD", unit: "unit", comparabilityZh: "尺寸相符", sourceIndex: 0 },
          { productName: "幻觉产品", vendor: null, priceRaw: "US$8,888", currency: "USD", unit: null, comparabilityZh: "片段无此价", sourceIndex: 0 },
        ], observationsZh: ["专业品牌单价千美元级"], insufficientZh: null },
      ]),
    });
    ok(mp.status === "ran" && mp.benchmarks.length === 1 && mp.benchmarks[0]!.priceRaw === "US$1,053", "AMV2-09: 两跳后接地门不变——片段无据的价格被丢弃");
    const noKey = await researchMarketPricingTwoHop({ productPhrase: "kennel", specHints: [], env: {} as NodeJS.ProcessEnv });
    ok(noKey.status === "unavailable", "AMV2-10: 无检索 key 仍 fail-closed");
  }
  {
    const html = buildAnalystMemoV2Html({
      header: { projectName: "犬舍<b>", clientOrganization: "Winnipeg", solicitationNumber: "527-2026", closeDate: "2026-09-11", orgName: null, generatedAt: "2026-08-26" },
      state: {
        version: "tender-analyst-memo/v2", runId: "r", sourceFingerprint: "f", status: "done",
        chunks: [{ index: 0, charCount: 100, pageSpan: "p.1" }], chunksDone: 1,
        notes: EMPTY_NOTES, research: null,
        sectionsPart1: [{ titleZh: "一、执行摘要", bodyMd: "可投，但**交付周期**是硬约束（《Tender》p.6）。" }],
        sectionsPart2: [{ titleZh: "八、GO/NO-GO", bodyMd: "| 维度 | 评级 |\n| --- | --- |\n| 交付 | 🔴 |" }],
        updatedAt: "t",
      },
      criticalFacts: [{ labelZh: "数量", status: "KNOWN", text: "9 套" }],
      numberAudit: { total: 3, unverified: ["47000"] },
    });
    ok(["投标分析师备忘录", "全文深读", "一、执行摘要", "八、GO/NO-GO", "附录 A", "附录 C", "47000"].every((t) => html.includes(t)), "AMV2-11: 叙事节+附录+数字回核警示齐全");
    ok(!html.includes("犬舍<b>") && html.includes("犬舍&lt;b&gt;"), "AMV2-12: 标题转义");
  }
  {
    const root = join(__dirname, "../../../../..");
    const route = readFileSync(join(root, "src/app/api/projects/[id]/generate-pdf/route.ts"), "utf-8");
    const gen = readFileSync(join(root, "src/lib/projects/generate/generate-docs.ts"), "utf-8");
    const menu = readFileSync(join(root, "src/components/project-generate/project-generate-menu.tsx"), "utf-8");
    ok(route.includes("maxDuration = 800") && route.includes("deadlineMs: Date.now() + ROUTE_BUDGET_MS") && route.includes('"inProgress" in doc'), "AMV2-13: 路由三件套——800s 预算/deadline 传入/inProgress 透传");
    ok(gen.includes("runMemoV2Step") && menu.includes("for (let round = 0") && menu.includes("realExt"), "AMV2-14: 生成器走 v2 管线；UI 自动续跑 + 下载后缀跟随真实扩展名");
  }
  {
    const root2 = join(__dirname, "../../../../..");
    const viewRoute = readFileSync(join(root2, "src/app/api/projects/[id]/analyst-memo/route.ts"), "utf-8");
    const card = readFileSync(join(root2, "src/components/project-detail/analyst-memo-card.tsx"), "utf-8");
    const wb = readFileSync(join(root2, "src/components/project-detail/tabs/workbench-tab.tsx"), "utf-8");
    ok(viewRoute.includes("requireProjectReadAccess") && viewRoute.includes("renderLimitedMd") && !viewRoute.includes(".update(") && !viewRoute.includes(".create("), "AMV2-15: 阅读接口只读 + 项目读权限 + 服务端受限渲染（转义链单一）");
    ok(card.includes("dangerouslySetInnerHTML") && card.includes("analyst-memo") && card.includes("setActive") && wb.includes("<AnalystMemoCard"), "AMV2-16: 工作台阅读卡——类目切换 + 只吃自家接口 HTML + 已挂载");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
})();
