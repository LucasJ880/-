/**
 * BIDPAGE-3 ② 定报价的新区块：报价列表与专业模式入口、新建两问、逐行表 7 列、四个数与差额说明、预置说明、
 * 询价回复点选、看不改的状态、导出可用 / 不可用（服务端静态渲染 + 源码断言；无浏览器 / 无 DB）
 * （openspec change quote-line-mode-persist，spec tender/quote-line-mode）
 * 运行：npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { LineModeView, QuoteListView } from "@/lib/bid-page-v2/quote-line/contract";
import { ExportBar, LINE_TABLE_HEADERS, LineQuoteEditor, LineTotals, PRESET_EXPLAIN_ZH, QUOTE_STEP_TEXT, QuoteListPanel, QuoteStep } from "../quote-step";

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
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const render = (el: React.ReactElement) => renderToStaticMarkup(<AppRouterContext.Provider value={router}>{el}</AppRouterContext.Provider>);
const noop = () => undefined;

const LIST: QuoteListView = {
  capabilities: { canEdit: true, canApprove: true },
  quotes: [
    { id: "q1", name: "合成逐行报价", quoteNumber: "Q-2026-0001-P1", version: 2, status: "draft", quoteType: "SUPPLY_ONLY", entryMode: "LINE", sellingPrice: 8092.08, updatedAt: "2026-11-23T00:00:00.000Z", isOurBid: false, proModeHref: "/projects/p1/quote-engine/q1" },
    { id: "q2", name: null, quoteNumber: "Q-2026-0002-P1", version: 1, status: "approved", quoteType: "PROJECT_SUPPLY_INSTALL", entryMode: null, sellingPrice: 120000, updatedAt: "2026-11-22T00:00:00.000Z", isOurBid: true, proModeHref: "/projects/p1/quote-engine/q2" },
  ],
  scheduleLineCount: 3,
  export: { available: false, reasonZh: "我方报价不是逐行报价做的，不能按价格表导出" },
};

function lineView(over: Partial<LineModeView> = {}): LineModeView {
  return {
    quote: { id: "q1", name: "合成逐行报价", quoteNumber: "Q-2026-0001-P1", version: 2, status: "draft", currency: "CAD", updatedAt: "2026-11-23T00:00:00.000Z", frozen: false },
    capabilities: { canEdit: true, canApprove: true },
    state: {
      rows: [
        { costLineId: "c1", description: "合成卷帘 A", quantity: 100, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 50, currency: "CNY", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "schedule" },
        { costLineId: "c2", description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10, basis: "PER_PIECE", unitPrice: 30, currency: "CNY", evidenceKind: null, inquiryItemId: "ii1", supplierId: "s1", supplierName: "合成供应商甲", rowSource: "schedule" },
      ],
      fx: { CNY: { rate: 0.19, source: "合成汇率" } },
      shared: { oceanFreight: { containers: 1, perContainer: 3000, currency: "CAD" }, customs: { amount: 250, currency: "CAD" }, domesticFreight: { amount: 1500, currency: "CNY" }, dutyPct: 8 },
      presets: { financing: { ratePct: 8, months: 1, included: true }, admin: { ratePct: 3, included: true }, cashAllowance: { ratePct: 1, included: true }, commission: { ratePct: 30, included: true } },
      targetMarginPct: 25,
    },
    notices: [],
    others: [],
    computed: {
      ok: true,
      totals: { sellingPrice: 8092.08, estimatedCost: 6675.97, grossProfit: 1416.11, grossMarginPct: 17.5, landedCost: 5792.2 },
      allocation: {
        lines: [
          { lineNo: 1, goodsCad: 950, landedCostCad: 2632.82, landedUnitCostCad: 26.33, unitPrice: 36.78, extended: 3678, marginPct: 17.49 },
          { lineNo: 2, goodsCad: 1140, landedCostCad: 3159.38, landedUnitCostCad: 157.97, unitPrice: 220.69, extended: 4413.8, marginPct: 17.51 },
        ],
        linesTotal: 8091.8,
        diff: -0.28,
        diffBound: 0.6,
      },
      warnings: [{ code: "NO_CONTINGENCY", messageZh: "没有预备金（需要的话在专业模式里加）" }],
    },
    inquiryQuotes: [{ inquiryItemId: "ii1", supplierId: "s1", supplierName: "合成供应商甲", roundNumber: 1, repliedAt: null, unitPrice: 30, totalPrice: null, currency: "CNY" }, { inquiryItemId: "ii2", supplierId: "s2", supplierName: "合成供应商乙", roundNumber: 1, repliedAt: null, unitPrice: null, totalPrice: 9000, currency: "CNY" }],
    seed: null,
    proModeHref: "/projects/p1/quote-engine/q1",
    ...over,
  };
}

console.log("\n━━━ 1. 报价列表与专业模式入口 ━━━");
{
  const html = render(<QuoteListPanel view={LIST} onOpen={noop} onCreate={noop} creating={false} createError={null} />);
  ok(html.includes("合成逐行报价") && html.includes("逐行报价") && html.includes(QUOTE_STEP_TEXT.proMode), "列表：逐行报价与专业模式报价都列出做法");
  ok(html.includes('href="/projects/p1/quote-engine/q1"') && html.includes('href="/projects/p1/quote-engine/q2"') && html.includes(QUOTE_STEP_TEXT.openInProMode), "两份报价都有指向 /projects/{id}/quote-engine/{quoteId} 的入口；专业模式报价写「在专业模式里打开」");
  ok(html.includes("8,092.08 加元") && html.includes("我方报价") && html.includes("第 2 版 · 草稿") && html.includes("已批准"), "报价合计、版本、状态、我方报价标记");
  ok(html.includes(QUOTE_STEP_TEXT.createTitle), "有编辑权限：有「新建报价」");
  const ro = render(<QuoteListPanel view={{ ...LIST, capabilities: { canEdit: false, canApprove: false } }} onOpen={noop} onCreate={noop} creating={false} createError={null} />);
  ok(!ro.includes(QUOTE_STEP_TEXT.createTitle), "没有编辑权限：没有「新建报价」");
  const src = read("src/components/bid-page-v2/quote-step.tsx");
  ok(src.includes(QUOTE_STEP_TEXT.askHow) && src.includes("QUOTE_STEP_TEXT.lineOption") && src.includes("BUSINESS_TYPES.map") && src.includes("QUOTE_STEP_TEXT.proModeOnly"), "新建两问：怎么交价（逐行）与业务类型（三种），另两种写明在专业模式里做");
  ok(/entryMode: "LINE", businessType/.test(src) && /router\.push\(String\(data\.proModeHref\)\)/.test(src), "建好：逐行报价在页内打开；另两种转到专业模式");
}

console.log("\n━━━ 2. 逐行报价 ━━━");
{
  const html = render(<LineQuoteEditor projectId="p1" view={lineView()} onSaved={noop} onClose={noop} />);
  const table = html.slice(html.indexOf('data-testid="line-table"'));
  const headers = LINE_TABLE_HEADERS.map((h) => table.indexOf(`>${h}<`));
  ok(headers.every((i, k) => i > 0 && (k === 0 || i > headers[k - 1])), "表头依次是 7 列：品名、数量、供应商报价（原币）、到手单位成本（加元）、我方单价、行合计、毛利率", headers);
  ok(html.includes('value="合成卷帘 A"') && html.includes('value="合成配件 B"') && (html.match(/data-testid="line-row"/g) ?? []).length === 2, "两行照状态显示");
  ok(html.includes("8,092.08 加元") && html.includes("6,675.97 加元") && html.includes("1,416.11 加元") && html.includes("17.5%"), "顶部四个数：报价合计、成本合计、利润、毛利率");
  ok(html.includes(QUOTE_STEP_TEXT.marginNote), "写明毛利率已扣提成、比目标低");
  ok(html.includes("逐行合计 8,091.80 加元 比报价合计 8,092.08 加元 少 0.28 加元") && html.includes("每行单价取到分后乘数量造成") && html.includes("导出给招标方的是逐行合计"), "差额说明：差多少、为什么、导出用哪个");
  ok(html.includes("36.78 加元") && html.includes("3,678.00 加元") && html.includes("220.69 加元") && html.includes("26.33 加元"), "每行的到手单位成本、我方单价、行合计");
  ok(html.includes("来自询价回复：合成供应商甲") && html.includes("只报了总价 9,000.00 人民币，请手填单价"), "点选的询价回复写出供应商；只报总价的回复不能点选并写明");
  ok(html.includes("按件（× 10）") && html.includes("每单位 10 件"), "有包装数的行可选按件报价");
  ok(html.includes("选证据类别（必选）") || html.includes(">估计<"), "手填的行有证据类别选择");
  ok(html.includes("100 → 103.09") && html.includes(PRESET_EXPLAIN_ZH.commission) && html.includes(PRESET_EXPLAIN_ZH.financing), "预置旁边写真实算法（管理费 100 → 103.09；提成计入成本）");
  ok(html.includes("汇率：1 CNY =") && html.includes("海运费") && html.includes("报关费") && html.includes("关税率") && html.includes("国内运费（中国境内）") && html.includes("目标毛利率（按售价）"), "共用参数：汇率、海运费、报关费、关税率、国内运费；目标毛利率");
  ok(html.includes("没有预备金"), "引擎的警告照列（中文）");
  ok(html.includes('data-testid="line-editor-pro-mode"') === false && html.includes(">更多<"), "「更多」菜单收着（点开才有专业模式）");
  ok(read("src/components/bid-page-v2/quote-step.tsx").includes('data-testid="line-editor-pro-mode"'), "「更多」里有专业模式入口");

  const others = render(<LineQuoteEditor projectId="p1" view={lineView({ others: [{ id: "x", description: "加拿大境内运费", category: "FREIGHT", amount: 400, included: true }] })} onSaved={noop} onClose={noop} />);
  ok(others.includes("另有 1 条其它成本行") && others.includes("加拿大境内运费（400.00 加元）"), "其它成本行：写明几条、已算进四个数");
  const frozen = render(<LineQuoteEditor projectId="p1" view={lineView({ quote: { ...lineView().quote, status: "approved", frozen: true } })} onSaved={noop} onClose={noop} />);
  ok(frozen.includes(QUOTE_STEP_TEXT.frozen) && !frozen.includes('data-testid="line-save"') && /aria-label="第 1 行品名"[^>]*disabled=""|disabled=""[^>]*aria-label="第 1 行品名"/.test(frozen), "已定的报价：写明锁定、输入框不可改、没有保存按钮");
  const noEdit = render(<LineQuoteEditor projectId="p1" view={lineView({ capabilities: { canEdit: false, canApprove: false } })} onSaved={noop} onClose={noop} />);
  ok(noEdit.includes(QUOTE_STEP_TEXT.readOnly) && !noEdit.includes('data-testid="line-save"'), "没有编辑权限：只看不改");
  const err = render(<LineTotals view={lineView({ computed: { ok: false, errorsZh: ["有外币的行还没填汇率：先在共用参数里填汇率"] } })} dirty={false} />);
  ok(err.includes("还算不出报价") && err.includes("先在共用参数里填汇率") && !err.includes("报价合计"), "引擎算不出：写原因，不显示四个数");
  const dirty = render(<LineTotals view={lineView()} dirty />);
  ok(dirty.includes(QUOTE_STEP_TEXT.dirty), "有没保存的修改：标明数字是上次保存时的");
  const empty = render(<LineQuoteEditor projectId="p1" view={lineView({ state: { ...lineView().state, rows: [] }, seed: { scheduleLineCount: 0, prefill: { state: "ready", messageZh: "从招标分析带入了 3 行", text: "1\t合成\t2\tEach" } } })} onSaved={noop} onClose={noop} />);
  ok(empty.includes("还没有行：粘贴价格表、从招标分析带入，或加一行") && empty.includes("加一行") && empty.includes("从招标分析带入了 3 行") && empty.includes("从招标分析带入到粘贴框"), "表空：粘贴、招标分析带入、加一行三个入口");
}

console.log("\n━━━ 3. 导出 ━━━");
{
  const off = render(<ExportBar projectId="p1" availability={{ available: false, reasonZh: "报价定为我方报价后才能导出" }} />);
  ok(off.includes(QUOTE_STEP_TEXT.exportButton) && off.includes("disabled") && off.includes("报价定为我方报价后才能导出") && off.includes('id="bid-page-export"'), "没定：按钮灰着并写原因");
  const on = render(<ExportBar projectId="p1" availability={{ available: true, quoteId: "q1", version: 2 }} />);
  ok(on.includes('href="/api/projects/p1/bid-page/quotes/q1/export"') && on.includes("download"), "已定且是逐行报价：链到导出接口");
}

console.log("\n━━━ 4. 容器与源码 ━━━");
{
  const html = render(<QuoteStep projectId="p1" />);
  ok(html.includes("正在加载报价"), "容器首次渲染：加载中（取数在浏览器里做）");
  const src = read("src/components/bid-page-v2/quote-step.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/apiFetch\(base, \{ cache: "no-store" \}\)/.test(src) && /status === 404\) return setList\(\{ kind: "disabled" \}\)/.test(src), "列表接口 404（报价功能或新页面没开）→「报价功能未开通」");
  ok(/method: "PUT"/.test(src) && /baseUpdatedAt: view\.quote\.updatedAt, state/.test(src), "保存带读取时的修改时间与整个状态");
  ok(!/computeQuote|allocateFromEngine/.test(src), "组件里不算数（四个数与每行的数都由服务端用报价引擎算好）");
  const page = read("src/components/bid-page-v2/bid-page-v2.tsx");
  ok(/<div id="bid-quote-area" className="scroll-mt-4">\s*<QuoteStep projectId=\{projectId\} \/>/.test(page), "② 里的报价区挂在 #bid-quote-area 里（项目页「下一步」卡照常跳得过来）");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
