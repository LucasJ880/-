/**
 * BIDPAGE-1「标书与报价」页改版：开关关 = 零变化、入口分流、新页面的分区与「下一步」（服务端静态渲染 + 源码断言；无浏览器 / 无 DB）
 * （openspec change bid-page-v2-shell，spec tender/bid-page「开关关着时页面与改版前一致」「三步分区」「更多里的版本历史」
 *   「页内位置照常可达」「下一步的按钮只导航」）
 * 运行：npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { BidTab } from "@/components/project-detail/tabs/bid-tab";
import { ProjectInquirySection } from "@/components/inquiry/project-inquiry-section";
import { BidQuoteArea } from "@/components/quote-engine/bid-quote-area";
import { TenderOurBidCard } from "@/components/quote-engine/tender-our-bid";
import { ProjectSupplierLinks } from "@/components/bid-workflow/project-supplier-links";
import { TenderSourcingEntry } from "@/components/supplier-intel/tender-sourcing-entry";
import { decideBidPageNextStep, type BidPageFacts, type BidPageView } from "@/lib/bid-page-v2/next-step";
import { BidTabEntry } from "../bid-tab-entry";
import { BidPageV2, MoreMenu, NextStepBanner, QUOTE_AMOUNTS_HIDDEN_ZH, SOURCING_AMOUNTS_HIDDEN_ZH, StepSection, initialOpenSection, tabHref } from "../bid-page-v2";
import { parseSummaryResponse, sectionForAnchor } from "../entry-mode";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// 既有组件里有 useRouter / usePathname / useSearchParams：给它们一个最小的路由上下文（不会被调用）
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
function render(el: React.ReactElement): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/projects/p1">
        <SearchParamsContext.Provider value={new URLSearchParams("tab=bid") as never}>{el}</SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
}

const NOW = new Date("2026-11-22T12:00:00Z");
function facts(o: Partial<BidPageFacts> = {}): BidPageFacts {
  return {
    now: NOW,
    analysisStatus: "APPROVED",
    supplierCount: 3,
    pendingRfqApprovals: 0,
    inquiry: { askedCount: 2, respondedCount: 1, quotedCount: 1, repliedNoQuoteCount: 0, waitingSince: null },
    quote: { available: true, bid: { status: "NONE", version: null, amount: null }, openDraft: null, approvedUnselected: 0 },
    documents: { canGenerate: true, generatedKinds: 0 },
    canViewAmounts: false,
    ...o,
  };
}

console.log("BIDPAGE-1 新页面与入口");

// —— 1. 开关关 = 零变化（规格场景「开关关」） ——
{
  const combos: Array<{ projectId: string; orgId: string | null; canManage: boolean }> = [
    { projectId: "p1", orgId: "o1", canManage: true },
    { projectId: "p2", orgId: "o1", canManage: false },
    { projectId: "p3", orgId: null, canManage: true },
  ];
  for (const c of combos) {
    const legacy = render(<BidTab {...c} />);
    const entry = render(<BidTabEntry {...c} />);
    ok(legacy === entry && legacy.length > 1000, `开关关（没有记过已开启）：入口的渲染与改版前页面逐字节相同（${JSON.stringify(c)}）`, { legacy: legacy.length, entry: entry.length });
  }
  const legacy = render(<BidTab projectId="p1" orgId="o1" canManage />);
  ok(legacy.includes("data-testid=\"open-version-history\"") && !legacy.includes("bid-page-v2"), "（对照）改版前页面有顶部的版本历史按钮，没有新页面的标记");

  const entrySrc = stripComments(read("src/components/bid-page-v2/bid-tab-entry.tsx"));
  ok(/\n  return <BidTab \{\.\.\.props\} \/>;\n\}/.test(entrySrc) && (entrySrc.match(/<BidTab\b/g) ?? []).length === 1, "入口的改版前分支原样渲染 <BidTab {...props} />：同一组件、同样的属性、不加包裹元素、不加 key（停在旧页面时不会重新挂载）");
  ok((entrySrc.match(/<BidPageV2\b/g) ?? []).length === 1 && /if \(view\) return <BidPageV2 \{\.\.\.props\} view=\{view\} \/>;/.test(entrySrc), "只有拿到「已开启」的 view 才渲染新页面");
  ok(/useState<BidPageView \| null>\(null\)/.test(entrySrc) && /setView\(parsed\.ok \? parsed\.view : null\)/.test(entrySrc), "第一次渲染没有 view（= 改版前页面）；接口没说已开启就回到没有 view");
  ok(!/sessionStorage|localStorage/.test(entrySrc) && !/sessionStorage|localStorage/.test(stripComments(read("src/components/bid-page-v2/entry-mode.ts"))), "入口不在浏览器里记「开过」（开过再关时第一次渲染仍是改版前页面）");
  ok(!/apiJson|apiFetch/.test(entrySrc), "入口不用 apiJson（401 时不跳登录、没有副作用）");
  ok(/fetch\(`\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/bid-page-summary`/.test(entrySrc) && !/method:\s*["'](POST|PUT|PATCH|DELETE)/.test(entrySrc), "入口只发一个 GET 汇总请求");

  const page = stripComments(read("src/app/(main)/projects/[id]/page.tsx"));
  ok(page.includes('import { BidTabEntry } from "@/components/bid-page-v2/bid-tab-entry";') && !/import \{ BidTab \}/.test(page), "项目页引入入口组件、不再直接引入 BidTab");
  ok((page.match(/<BidTabEntry projectId=\{id\} orgId=\{project\.orgId\} canManage=\{canManage\} \/>/g) ?? []).length === 1 && !/<BidTab\b/.test(page), "项目页「标书与报价」页签渲染入口组件，属性与原来给 BidTab 的相同");
  ok(/activeTab === "bid" && \(\s*<BidTabEntry /.test(page), "入口组件挂在 activeTab === \"bid\" 的位置");
}

// —— 2. 入口分流判定（规格场景「汇总接口说没开、报错或请求失败」「开关开着」） ——
{
  const good = { enabled: true, view: decideBidPageNextStep(facts()) };
  ok(parseSummaryResponse(200, good).ok, "200 + enabled === true + 形状对 → 新页面");
  const bad: Array<[string, number, unknown]> = [
    ["404", 404, { error: "新版标书与报价页未启用" }],
    ["500", 500, { error: "x" }],
    ["401", 401, { error: "未登录" }],
    ["200 但 enabled 是 false", 200, { ...good, enabled: false }],
    ["200 但 enabled 是字符串", 200, { ...good, enabled: "true" }],
    ["200 但没有 view", 200, { enabled: true }],
    ["200 但 view 缺分区", 200, { enabled: true, view: { ...good.view, sections: { sourcing: { statusZh: "x" } } } }],
    ["200 但 expanded 不认识", 200, { enabled: true, view: { ...good.view, expanded: "x" } }],
    ["200 但不是 JSON 对象", 200, null],
    ["200 但是字符串", 200, "enabled"],
  ];
  for (const [name, status, body] of bad) ok(!parseSummaryResponse(status, body).ok, `${name} → 改版前页面`);

  ok(!parseSummaryResponse(200, { enabled: true, view: { ...good.view, viewer: undefined } }).ok, "200 但 view 缺 viewer → 改版前页面");
}

// —— 3. 新页面：分区、状态、只展开一个（规格场景「分区与状态」） ——
{
  const view: BidPageView = decideBidPageNextStep(facts({ canViewAmounts: true }));
  ok(view.rule === "start_quote" && view.expanded === "quote", "（夹具）下一步指向 ②", view);
  const html = render(<BidPageV2 projectId="p1" orgId="o1" canManage view={view} />);
  const iS = html.indexOf("① 找供应商、询价"), iQ = html.indexOf("② 定报价"), iD = html.indexOf("③ 出文件"), iN = html.indexOf("data-testid=\"bid-page-next-step\"");
  ok(iN >= 0 && iN < iS && iS < iQ && iQ < iD, "从上到下：下一步 → ① → ② → ③", { iN, iS, iQ, iD });
  ok(html.includes(">2 家已询价，1 家已回<"), "① 的状态是「2 家已询价，1 家已回」");
  const openOf = (h: string, sec: string) => new RegExp(`data-testid="bid-page-section-${sec}" data-open="1"`).test(h);
  ok(openOf(html, "quote") && !openOf(html, "sourcing") && !openOf(html, "documents"), "只有 ② 展开");
  const bodyHidden = (id: string) => new RegExp(`<div id="${id}-body" hidden=""`).test(html);
  ok(!bodyHidden("bid-page-quote") && bodyHidden("bid-page-sourcing") && bodyHidden("bid-page-documents"), "收起的分区内容仍在页面上、只加 hidden");
  ok(html.includes("开始做报价") && html.includes("去「定报价」") && html.includes("已有 1 家报价"), "下一步横条：结论、按钮、原因");
  ok(!html.includes("国内供应商简报"), "新页面不显示国内供应商简报面板");
  const pageSrc = stripComments(read("src/components/bid-page-v2/bid-page-v2.tsx"));
  ok(!/china-supplier-brief|ChinaSupplierBriefPanel/.test(pageSrc), "新页面不引入国内供应商简报面板");
  ok(["TenderSourcingEntry", "ProjectInquirySection", "ProjectSupplierLinks", "BidWorkspacePanel", "TenderOurBidCard", "BidQuoteArea", "ProjectGenerateMenu", "VersionHistoryDrawer"].every((c) => new RegExp(`<${c}\\b`).test(pageSrc)), "三个分区挂既有组件，版本历史用同一个抽屉");

  const toReq = decideBidPageNextStep(facts({ analysisStatus: "REVIEW_REQUIRED", inquiry: { askedCount: 0, respondedCount: 0, quotedCount: 0, repliedNoQuoteCount: 0, waitingSince: null } }));
  const reqHtml = render(<BidPageV2 projectId="p1" orgId="o1" canManage view={toReq} />);
  ok(toReq.rule === "requirements_unapproved" && openOf(reqHtml, "sourcing") && reqHtml.includes("去「招标要求」"), "下一步指向招标要求时展开 ①", toReq.rule);
  const also = decideBidPageNextStep(facts({ analysisStatus: "REVIEW_REQUIRED" }));
  ok(render(<BidPageV2 projectId="p1" orgId="o1" canManage view={also} />).includes("另外：招标要求还没批准"), "已经往下走了、招标要求还没批准：横条顺带一句");
  const entryProps = stripComments(read("src/components/bid-page-v2/bid-page-v2.tsx"));
  ok(/view: BidPageView \};/.test(entryProps), "新页面一定带着汇总结果渲染（没有「读取中」的新页面）");
}

// —— 3b. 带金额的既有组件只给看得到金额的人挂（规格场景「看不到金额的人在新页面上看不到带金额的旧组件」） ——
{
  // 我方报价卡与投标工作区第一次渲染是空的（等接口回来才有内容），只能用源码断言（见本节最后）
  ok(render(<TenderOurBidCard projectId="p1" />) === "", "（对照）我方报价卡第一次渲染是空的");
  const legacyPieces: Array<[string, string]> = [
    ["询价区", render(<ProjectInquirySection projectId="p1" orgId="o1" canManage />)],
    ["报价区", render(<BidQuoteArea projectId="p1" />)],
  ];
  ok(legacyPieces.every(([, h]) => h.length > 40), "（对照）询价区、报价区各自渲染出内容", legacyPieces.map(([n, h]) => [n, h.length]));
  const shown = render(<BidPageV2 projectId="p1" orgId="o1" canManage view={decideBidPageNextStep(facts({ canViewAmounts: true }))} />);
  const hidden = render(<BidPageV2 projectId="p1" orgId="o1" canManage view={decideBidPageNextStep(facts({ canViewAmounts: false }))} />);
  for (const [name, h] of legacyPieces) {
    ok(shown.includes(h), `看得到金额：新页面挂着${name}`);
    ok(!hidden.includes(h), `看不到金额：新页面不挂${name}`);
  }
  ok(hidden.includes(SOURCING_AMOUNTS_HIDDEN_ZH) && hidden.includes(QUOTE_AMOUNTS_HIDDEN_ZH) && !shown.includes(SOURCING_AMOUNTS_HIDDEN_ZH) && !shown.includes(QUOTE_AMOUNTS_HIDDEN_ZH), "看不到金额：① ② 各一句说明（为什么看不到、找谁）；看得到金额时没有这两句");
  ok(hidden.includes("id=\"bid-quote-area\"") && shown.includes("id=\"bid-quote-area\""), "两种人都有投标价区块的位置（项目页「下一步」卡跳得过来）");
  const sup = render(<ProjectSupplierLinks projectId="p1" orgId="o1" />);
  const src = render(<TenderSourcingEntry projectId="p1" />);
  ok(hidden.includes(sup) && hidden.includes(src), "不带金额的寻源入口与供应商关联卡两种人都挂");
  const pageSrc = stripComments(read("src/components/bid-page-v2/bid-page-v2.tsx"));
  ok(/showAmounts \? <ProjectInquirySection /.test(pageSrc) && /quote: showAmounts \? \(/.test(pageSrc) && /const showAmounts = view\.viewer\.canViewAmounts;/.test(pageSrc), "挂不挂只看汇总接口给的 viewer.canViewAmounts");
  const qStart = pageSrc.indexOf("quote: showAmounts ? (");
  const qElse = pageSrc.indexOf(") : (", qStart);
  const qEnd = pageSrc.indexOf("documents:", qElse);
  const yes = pageSrc.slice(qStart, qElse), no = pageSrc.slice(qElse, qEnd);
  ok(/<TenderOurBidCard\b/.test(yes) && /<BidWorkspacePanel\b/.test(yes) && /<BidQuoteArea\b/.test(yes), "② 看得到金额的一支：投标工作区、我方报价卡、报价区");
  ok(!/<TenderOurBidCard\b|<BidWorkspacePanel\b|<BidQuoteArea\b/.test(no) && /QUOTE_AMOUNTS_HIDDEN_ZH/.test(no) && /id="bid-quote-area"/.test(no), "② 看不到金额的一支：只有说明和位置，没有这三个组件", no);
  ok((pageSrc.match(/<TenderOurBidCard\b/g) ?? []).length === 1 && (pageSrc.match(/<BidWorkspacePanel\b/g) ?? []).length === 1 && (pageSrc.match(/<BidQuoteArea\b/g) ?? []).length === 1 && (pageSrc.match(/<ProjectInquirySection\b/g) ?? []).length === 1, "这几个组件在新页面里各只出现一次（没有别处绕过金额门）");
  ok(QUOTE_AMOUNTS_HIDDEN_ZH.length < 80 && /找/.test(QUOTE_AMOUNTS_HIDDEN_ZH) && /找/.test(SOURCING_AMOUNTS_HIDDEN_ZH) && !/[A-Za-z]{3,}/.test(QUOTE_AMOUNTS_HIDDEN_ZH + SOURCING_AMOUNTS_HIDDEN_ZH), "说明是中文、写了找谁");
}

// —— 4. 「更多」里的版本历史（规格场景「版本历史在更多里」） ——
{
  const html = render(<BidPageV2 projectId="p1" orgId="o1" canManage view={decideBidPageNextStep(facts())} />);
  ok(html.includes("data-testid=\"bid-page-more\"") && html.includes(">更多<"), "右上角有「更多」");
  ok(!html.includes("data-testid=\"open-version-history\""), "顶部没有单独的「版本历史」按钮（菜单收起时也不在页面上）");
  const menu = renderToStaticMarkup(<MoreMenu onOpenVersions={() => undefined} initialOpen />);
  ok(menu.includes("role=\"menu\"") && menu.includes("data-testid=\"open-version-history\"") && menu.includes("版本历史"), "「更多」打开后有「版本历史」");
}

// —— 5. 页内位置照常可达（规格场景「从项目页下一步卡跳到投标价」） ——
{
  ok(sectionForAnchor("#bid-quote-area") === "quote" && sectionForAnchor("#bid-workspace") === "quote", "#bid-quote-area / #bid-workspace → ②");
  ok(sectionForAnchor("#rfq-section") === "sourcing" && sectionForAnchor("#rfq-round-abc123") === "sourcing", "#rfq-section / #rfq-round-… → ①");
  ok(sectionForAnchor("#bid-page-documents") === "documents" && sectionForAnchor("#bid-page-quote") === "quote", "分区自己的位置");
  ok(sectionForAnchor("") === null && sectionForAnchor(null) === null && sectionForAnchor("#project-discussion") === null && sectionForAnchor("#%E0%A4%A") === null, "空的、不认识的、写坏了的 #位置 → 不展开");
  ok(sectionForAnchor("#rfq-round-%E4%B8%80") === "sourcing", "编码过的 #位置照样认");
  const html = render(<BidPageV2 projectId="p1" orgId="o1" canManage view={decideBidPageNextStep(facts({ analysisStatus: null }))} />);
  ok(html.includes("id=\"bid-quote-area\""), "投标价区块的位置在页面上（② 收起时也在）");
  const pageSrc = stripComments(read("src/components/bid-page-v2/bid-page-v2.tsx"));
  ok(/window\.addEventListener\("hashchange", expandForHash\)/.test(pageSrc) && /sectionForAnchor\(hash\)/.test(pageSrc), "挂载时与 hashchange 时按 #位置 展开分区");
  ok(/scrollIntoView\(\{ behavior: "auto", block: "start" \}\)/.test(pageSrc.slice(pageSrc.indexOf("const expandForHash"), pageSrc.indexOf("expandForHash();"))), "按 #位置 展开后自己滚过去一次（不只靠项目页 1.6 秒的重滚）");
  const toSourcing = decideBidPageNextStep(facts({ supplierCount: 0, inquiry: { askedCount: 0, respondedCount: 0, quotedCount: 0, repliedNoQuoteCount: 0, waitingSince: null } }));
  ok(toSourcing.expanded === "sourcing" && initialOpenSection("#bid-quote-area", toSourcing) === "quote", "#位置 优先：下一步指向 ①、地址带 #bid-quote-area → 展开 ②");
  ok(initialOpenSection("", toSourcing) === "sourcing" && initialOpenSection("#project-discussion", toSourcing) === "sourcing", "没有 #位置（或不认识）→ 展开下一步指向的那个");
  ok(/useEffect\(\(\) => \{\s*if \(userTouched\.current \|\| sectionForAnchor\(window\.location\.hash\)\) return;/.test(pageSrc), "汇总刷新后跟着「下一步」展开：人自己开合过、或地址里有 #位置 时不动");
}

// —— 6. 「下一步」的按钮只导航（规格场景「点按钮」） ——
{
  const pageSrc = stripComments(read("src/components/bid-page-v2/bid-page-v2.tsx"));
  const goBody = pageSrc.slice(pageSrc.indexOf("const go = useCallback("), pageSrc.indexOf("[router],", pageSrc.indexOf("const go = useCallback(")));
  ok(goBody.length > 50 && /setOpen\(/.test(goBody) && /scrollIntoView/.test(goBody) && /router\.replace\(tabHref\(window\.location\.href, target\.tab\), \{ scroll: false \}\)/.test(goBody), "按钮处理：展开分区 + 滚动，或用 router.replace 换地址里的 ?tab=（与项目页切页签同一做法）", goBody.slice(0, 400));
  ok(!/history\.(replaceState|pushState)/.test(goBody), "不用原生 history 切页签（这个版本的 Next 不同步 useSearchParams，浏览器实测）");
  ok(!/fetch\(|apiJson|apiFetch|method:|POST|approve|send|save|router\.push/i.test(goBody), "按钮处理里没有任何请求、批准、发送、保存，也不 push 新的历史记录", goBody);
  ok(!/fetch\(|apiJson|apiFetch/.test(pageSrc), "新页面本身不发任何请求（取数只在入口的 GET 与既有组件里）");
  ok(tabHref("https://x.test/projects/p1?tab=bid&from=list&activity=a1#bid-quote-area", "requirements") === "/projects/p1?tab=requirements&from=list", "切到「招标要求」：换掉 tab、保留其它参数、去掉动态深链与 #位置");

  let clicked: unknown = null;
  const banner = renderToStaticMarkup(<NextStepBanner view={decideBidPageNextStep(facts())} onGo={(t) => (clicked = t)} />);
  ok(banner.includes("data-testid=\"bid-page-next-step-action\"") && clicked === null, "横条渲染时不触发导航");
}

// —— 7. 分区组件 ——
{
  const html = renderToStaticMarkup(<StepSection section="documents" statusZh="已生成 2 种文件" open={false} onToggle={() => undefined}><p>内容</p></StepSection>);
  ok(html.includes("③ 出文件") && html.includes("已生成 2 种文件") && html.includes("aria-expanded=\"false\"") && /hidden=""/.test(html) && html.includes("<p>内容</p>"), "收起：标题 + 状态，aria-expanded=false，内容在但 hidden");
  const opened = renderToStaticMarkup(<StepSection section="documents" statusZh={null} open onToggle={() => undefined}><p>内容</p></StepSection>);
  ok(opened.includes("aria-expanded=\"true\"") && !/hidden=""/.test(opened) && opened.includes("正在读取…"), "展开：没有 hidden；没状态时写「正在读取…」");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
