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
import { ExportBar, LINE_TABLE_HEADERS, LineQuoteEditor, LineTotals, PRESET_EXPLAIN_ZH, QUOTE_STEP_TEXT, QuoteListPanel, QuoteStep, frozenNoteZh } from "../quote-step";

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
    { id: "q1", name: "合成逐行报价", quoteNumber: "Q-2026-0001-P1", version: 2, status: "draft", quoteType: "SUPPLY_ONLY", currency: "CAD", entryMode: "LINE", sellingPrice: 8092.08, updatedAt: "2026-11-23T00:00:00.000Z", isOurBid: false, proModeHref: "/projects/p1/quote-engine/q1" },
    { id: "q2", name: null, quoteNumber: "Q-2026-0002-P1", version: 1, status: "approved", quoteType: "PROJECT_SUPPLY_INSTALL", currency: "USD", entryMode: null, sellingPrice: 120000, updatedAt: "2026-11-22T00:00:00.000Z", isOurBid: true, proModeHref: "/projects/p1/quote-engine/q2" },
  ],
  scheduleLineCount: 3,
  export: { available: false, reasonZh: "我方报价不是逐行报价做的，不能按价格表导出" },
};

function lineView(over: Partial<LineModeView> = {}): LineModeView {
  return {
    quote: { id: "q1", name: "合成逐行报价", quoteNumber: "Q-2026-0001-P1", quoteType: "SUPPLY_ONLY", version: 2, status: "draft", currency: "CAD", updatedAt: "2026-11-23T00:00:00.000Z", frozen: false },
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
      warnings: [{ code: "NO_CONTINGENCY", messageZh: "没有预备金（用来兜下错单、漏单的钱，和上面的现金备用金不是一回事）；需要的话在专业模式里加" }],
    },
    inquiryQuotes: [{ inquiryItemId: "ii1", supplierId: "s1", supplierName: "合成供应商甲", roundNumber: 1, repliedAt: null, unitPrice: 30, totalPrice: null, currency: "CNY" }, { inquiryItemId: "ii2", supplierId: "s2", supplierName: "合成供应商乙", roundNumber: 1, repliedAt: null, unitPrice: null, totalPrice: 9000, currency: "CNY" }, { inquiryItemId: "ii3", supplierId: "s3", supplierName: "合成供应商丙", roundNumber: 2, repliedAt: null, unitPrice: 12, totalPrice: null, currency: "RMB" }],
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
  ok(!ro.includes(QUOTE_STEP_TEXT.createTitle) && ro.includes(QUOTE_STEP_TEXT.noEditList) && QUOTE_STEP_TEXT.noEditList.includes("请找项目负责人"), "没有编辑权限：没有「新建报价」，写明为什么、找谁");
  ok(!html.includes(QUOTE_STEP_TEXT.noEditList), "有编辑权限：没有那句说明");
  ok(html.includes("120,000.00 美元"), "列表按报价自己的币种写金额（专业模式里的美元报价写美元）");
  const src = read("src/components/bid-page-v2/quote-step.tsx");
  ok(src.includes(QUOTE_STEP_TEXT.askHow) && src.includes("QUOTE_STEP_TEXT.lineOption") && src.includes("BUSINESS_TYPES.map") && src.includes("QUOTE_STEP_TEXT.proModeOnly"), "新建两问：怎么交价（逐行）与业务类型（三种），另两种写明在专业模式里做");
  // BIDPAGE-4：请求体的做法来自两问里选的那一项（逐行 / 只报总价），被断言的行为不变
  ok(/entryMode: how, businessType/.test(src) && /data\.entryMode === "LINE" \|\| data\.entryMode === "LUMP_SUM"/.test(src) && /router\.push\(String\(data\.proModeHref\)\)/.test(src), "建好：逐行报价与总价报价在页内打开；另两种转到专业模式");
}

console.log("\n━━━ 1b. 只报总价（BIDPAGE-4） ━━━");
{
  const withLump: QuoteListView = { ...LIST, quotes: [...LIST.quotes, { id: "q3", name: "合成总价报价", quoteNumber: "Q-2026-0003-P1", version: 1, status: "draft", quoteType: "SUPPLY_ONLY", currency: "CAD", entryMode: "LUMP_SUM", sellingPrice: 1200000, updatedAt: "2026-11-23T00:00:00.000Z", isOurBid: false, proModeHref: "/projects/p1/quote-engine/q3" }] };
  const html = render(<QuoteListPanel view={withLump} onOpen={noop} onCreate={noop} creating={false} createError={null} />);
  const rows = html.split('data-testid="quote-step-row"');
  const lumpRow = rows.find((r) => r.includes("合成总价报价")) ?? "";
  ok(lumpRow.includes(QUOTE_STEP_TEXT.lumpMode) && lumpRow.includes(">打开<") && lumpRow.includes("/projects/p1/quote-engine/q3") && lumpRow.includes(QUOTE_STEP_TEXT.openLineInProMode), "列表里总价报价写「只报总价」、能在页内打开、另有「用专业模式打开」");
  ok(html.includes("逐行报价") && html.includes(QUOTE_STEP_TEXT.proMode) && html.includes("1,200,000.00 加元"), "三份都列出做法（逐行报价 / 只报总价 / 专业模式）与报价合计");
  const src = read("src/components/bid-page-v2/quote-step.tsx");
  ok(src.includes("QUOTE_STEP_TEXT.lumpOption") && /checked=\{how === "LUMP_SUM"\}/.test(src) && /how === "LUMP_SUM" && business === "STANDING_OFFER"/.test(src) && QUOTE_STEP_TEXT.lumpStandingOffer.includes("在专业模式里做"), "新建两问：「这个标怎么交价？」有逐行报价与只报总价；只报总价 + 长期供货协议写明在专业模式里做");
  ok(/\$\{entryMode === "LUMP_SUM" \? "lump" : "line"\}/.test(src), "打开总价报价调 …/lump，逐行报价调 …/line");
  const lv = render(<LineQuoteEditor projectId="p1" view={lineView({ others: [{ id: "o1", description: "加拿大境内运费", category: "FREIGHT", amount: 400, included: true }, { id: "o2", description: "海运费", category: "FREIGHT", amount: 6000, included: true, fromLump: true }, { id: "o3", description: "安装", category: "LABOUR", amount: 2000, included: true, fromLump: true }] })} onSaved={noop} onClose={noop} />);
  ok(lv.includes("另有 1 条其它成本行（在专业模式里加的）") && lv.includes(`${QUOTE_STEP_TEXT.fromLump}：海运费（6,000.00 加元）、安装（2,000.00 加元）`), "逐行表：从只报总价转来的项写明来历，不说成专业模式里加的", lv.slice(lv.indexOf("其它成本行") - 20, lv.indexOf("其它成本行") + 300));
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
  ok(html.includes("逐行合计 8,091.80 加元 比报价合计 8,092.08 加元 少 0.28 加元") && html.includes("每行单价四舍五入到分再乘数量") && html.includes("最多差 0.60 加元") && html.includes("系统记的我方报价是报价合计；导出给招标方的价格表用逐行合计"), "差额说明：差多少、为什么、上限、系统记哪个、导出用哪个");
  ok(html.includes("36.78 加元") && html.includes("3,678.00 加元") && html.includes("220.69 加元") && html.includes("26.33 加元"), "每行的到手单位成本、我方单价、行合计");
  ok(html.includes("来自询价回复：合成供应商甲") && html.includes("只报了总价 9,000.00 人民币，请手填单价"), "点选的询价回复写出供应商；只报总价的回复不能点选并写明");
  ok(html.includes("按件（× 10）") && html.includes("每单位 10 件"), "有包装数的行可选按件报价");
  ok(html.includes("选证据类别（必选）") || html.includes(">估计<"), "手填的行有证据类别选择");
  ok(html.includes("100 → 103.09") && html.includes(PRESET_EXPLAIN_ZH.commission) && html.includes(PRESET_EXPLAIN_ZH.financing), "预置旁边写真实算法（管理费 100 → 103.09；提成计入成本）");
  ok(html.includes("汇率：1 人民币（CNY） =") && html.includes("海运费") && html.includes("报关费") && html.includes("关税率") && html.includes("国内运费（中国境内）") && html.includes("目标毛利率（按售价）"), "共用参数：汇率、海运费、报关费、关税率、国内运费；目标毛利率");
  ok(html.includes("没有预备金"), "引擎的警告照列（中文）");
  ok(html.includes(QUOTE_STEP_TEXT.formula) && QUOTE_STEP_TEXT.formula.startsWith("报价 = 不含销售提成的成本 ÷（1 − 目标毛利率）") && QUOTE_STEP_TEXT.formula.includes("分母再减去这些比例") && !html.includes("报价 = 成本 ÷"), "定价公式写真实算法（不含销售提成的成本；专业模式里按售价算的费用也写明）");
  ok(html.includes(QUOTE_STEP_TEXT.marginColNote) && html.includes(QUOTE_STEP_TEXT.sharedNote) && html.includes(QUOTE_STEP_TEXT.landedDefine), "表下写明行毛利率的口径；共用参数写明算进报价合计；预置写明到手成本是什么");
  ok(/\/>销售提成<\/label>/.test(html) && !/\/>提成<\/label>/.test(html), "叫「销售提成」（附录 A），不叫「提成」");
  ok(html.includes("Box（盒）") && html.includes("人民币（CNY）"), "单位下拉附中文（Box（盒）），币种下拉写中文名带代码");
  ok(!html.includes("只影响「到手单位成本」那一列的显示"), "不再写「只影响到手单位成本那一列」（运费等会抬高每行我方单价）");
  const noCommission = render(<LineTotals view={lineView({ state: { ...lineView().state, presets: { ...lineView().state.presets, commission: { ratePct: 30, included: false } } } })} dirty={false} />);
  ok(!noCommission.includes(QUOTE_STEP_TEXT.marginNote) && html.includes(QUOTE_STEP_TEXT.marginNote), "关掉销售提成时不写「所以比目标毛利率低」（这时两者相等）");
  const noTarget = render(<LineTotals view={lineView({ state: { ...lineView().state, targetMarginPct: null } })} dirty={false} />);
  ok(noTarget.includes(QUOTE_STEP_TEXT.targetEmpty) && !html.includes(QUOTE_STEP_TEXT.targetEmpty), "目标毛利率空着：写明按 0% 算");
  ok(/border-border\/60 bg-card-bg\/60 text-muted"[^>]*>没有预备金/.test(html), "没有预备金是常态：写成灰色说明，不当警告");
  ok(html.includes(QUOTE_STEP_TEXT.landedNote), "表下写明到手单位成本是怎么分到的");
  ok(html.includes("币种「RMB」用不了，请手填"), "询价回复的币种不在报价币种里：不能点选，写明原因");
  ok(html.includes("（人民币，请与回复核对单位与币种）"), "点选的回复提示核对单位与币种（币种写中文）");
  ok(html.includes("合成逐行报价 · 第 2 版"), "编辑器标题用报价名");
  ok(html.includes('data-testid="line-editor-pro-mode"') === false && html.includes(">更多<"), "「更多」菜单收着（点开才有专业模式）");
  ok(read("src/components/bid-page-v2/quote-step.tsx").includes('data-testid="line-editor-pro-mode"'), "「更多」里有专业模式入口");

  const others = render(<LineQuoteEditor projectId="p1" view={lineView({ others: [{ id: "x", description: "加拿大境内运费", category: "FREIGHT", amount: 400, included: true }] })} onSaved={noop} onClose={noop} />);
  ok(others.includes("另有 1 条其它成本行") && others.includes("加拿大境内运费（400.00 加元）") && others.includes("标了金额的已算进上面的报价合计和成本合计") && !others.includes("已算进四个数"), "其它成本行：写明几条、标了金额的已算进报价合计和成本合计");
  const frozen = render(<LineQuoteEditor projectId="p1" view={lineView({ quote: { ...lineView().quote, status: "approved", frozen: true } })} onSaved={noop} onClose={noop} />);
  ok(frozen.includes(frozenNoteZh("approved")) && frozenNoteZh("approved").startsWith("这份报价「已批准」，内容锁定") && !frozen.includes('data-testid="line-save"') && /aria-label="第 1 行品名"[^>]*disabled=""|disabled=""[^>]*aria-label="第 1 行品名"/.test(frozen), "已定的报价：写明锁定、输入框不可改、没有保存按钮");
  const noEdit = render(<LineQuoteEditor projectId="p1" view={lineView({ capabilities: { canEdit: false, canApprove: false } })} onSaved={noop} onClose={noop} />);
  ok(noEdit.includes(QUOTE_STEP_TEXT.readOnly) && QUOTE_STEP_TEXT.readOnly.includes("请找项目负责人") && !noEdit.includes('data-testid="line-save"'), "没有编辑权限：只看不改，写明找谁");
  const pastedOnly = render(<LineQuoteEditor projectId="p1" view={lineView({ state: { ...lineView().state, fx: {}, shared: { ...lineView().state.shared, domesticFreight: { amount: null, currency: "CAD" } }, rows: [{ ...lineView().state.rows[0], currency: "CNY", unitPrice: null }] } })} onSaved={noop} onClose={noop} />);
  ok(pastedOnly.includes('aria-label="CNY 汇率"'), "粘贴 / 加行带进来的人民币行还没登记汇率：照样出人民币汇率格（浏览器抽检发现）");
  const err = render(<LineTotals view={lineView({ computed: { ok: false, errorsZh: ["有外币的行还没填汇率：先在共用参数里填汇率"] } })} dirty={false} />);
  ok(err.includes("还算不出报价") && err.includes("先在共用参数里填汇率") && !err.includes("报价合计"), "引擎算不出：写原因，不显示四个数");
  const dirty = render(<LineTotals view={lineView()} dirty />);
  ok(dirty.includes(QUOTE_STEP_TEXT.dirty) && QUOTE_STEP_TEXT.dirty.startsWith("有修改还没保存"), "有修改还没保存：标明数字是上次保存时的");
  const empty = render(<LineQuoteEditor projectId="p1" view={lineView({ state: { ...lineView().state, rows: [] }, seed: { scheduleLineCount: 0, prefill: { state: "ready", messageZh: "从招标分析带入了 3 行", text: "1\t合成\t2\tEach" } } })} onSaved={noop} onClose={noop} />);
  ok(empty.includes("还没有行：粘贴价格表、从招标分析带入，或加一行") && empty.includes("加一行") && empty.includes("从招标分析带入了 3 行") && empty.includes("从招标分析带入到粘贴框"), "表空：粘贴、招标分析带入、加一行三个入口");
}

console.log("\n━━━ 3. 导出 ━━━");
{
  const off = render(<ExportBar projectId="p1" availability={{ available: false, reasonZh: "报价定为我方报价后才能导出" }} />);
  ok(off.includes(QUOTE_STEP_TEXT.exportButton) && off.includes("disabled") && off.includes("报价定为我方报价后才能导出") && off.includes('id="bid-page-export"'), "没定：按钮灰着并写原因");
  const on = render(<ExportBar projectId="p1" availability={{ available: true, quoteId: "q1", version: 2 }} />);
  ok(on.includes('href="/api/projects/p1/bid-page/quotes/q1/export"') && on.includes("download"), "已定且是逐行报价：链到导出接口");
  ok(on.includes(QUOTE_STEP_TEXT.exportNote) && off.includes(QUOTE_STEP_TEXT.exportNote), "导出处写明导出的是逐行表里的行、交出去前与招标方价格表核对");
}

console.log("\n━━━ 4. 容器与源码 ━━━");
{
  const html = render(<QuoteStep projectId="p1" />);
  ok(html.includes("正在加载报价"), "容器首次渲染：加载中（取数在浏览器里做）");
  const src = read("src/components/bid-page-v2/quote-step.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(/apiFetch\(base, \{ cache: "no-store" \}\)/.test(src) && /status === 404\) return setList\(\{ kind: "disabled" \}\)/.test(src), "列表接口 404（报价功能或新页面没开）→「报价功能未开通」");
  ok(/method: "PUT"/.test(src) && /baseUpdatedAt: view\.quote\.updatedAt, state/.test(src), "保存带读取时的修改时间与整个状态");
  ok(!/computeQuote|allocateFromEngine/.test(src), "组件里不算数（四个数与每行的数都由服务端用报价引擎算好）");
  ok(!/bg-primary|text-white|bg-white/.test(src) && /bg-accent px-4 py-1\.5 text-sm text-\[color:var\(--on-accent\)\]/.test(src), "按钮用项目主色（浏览器抽检发现按钮几乎看不见）");
  // BIDPAGE-4 把点选与数字输入框挪到 quote-ui.tsx（两个编辑器共用），这两条改读那个文件，被断言的写法不变
  const ui = read("src/components/bid-page-v2/quote-ui.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(ui.includes("回复里没有金额，请手填单价") && /if \(await onCreate\(how, business, name\)\) \{\s*setShowForm\(false\);/.test(src), "回复里一个金额都没有时照实说；新建成功后收起表单");
  ok(/value=\{text\}/.test(ui) && /parseNumInput\(raw\)/.test(ui) && !/value=\{value \?\? ""\}/.test(ui + src), "数字输入框留着人打的字、能读成数才往上报（不把「12.」改写成「12」）");
  ok(/disabled=\{saving \|\| !dirty \|\| invalid\.size > 0\}/.test(src) && src.includes("改好才能保存"), "有格子填的不是数字：不让保存，写明哪几格");
  ok(/draftToPrompt\(window\.localStorage\.getItem\(costDraftPromptedKey\(projectId\)\), window\.localStorage\.getItem\(costDraftStorageKey\(projectId\)\), parseCostDraft, savedRowCount\)/.test(src), "旧草稿提示的判定用纯函数（quote-line.test 里测），表里有行才提示");
  ok(/setPaste\(remainingPasteText\(paste, parsed\.issues\.map\(\(x\) => x\.row\)\)\)/.test(src) && !/setPaste\(""\)/.test(src), "粘贴框导入后只去掉已导入的行（没导入的留着改）");
  ok((src.match(/supplierId: null, supplierName: null/g) ?? []).length >= 4, "改价、改币种、改口径、取消点选时，供应商名字和 id 一起清掉");
  ok(src.includes("QUOTE_STEP_TEXT.conflictHint") && QUOTE_STEP_TEXT.conflictHint.includes("修改还在框里"), "保存冲突：写明这次的修改还在框里、怎么看最新内容");
  const page = read("src/components/bid-page-v2/bid-page-v2.tsx");
  ok(/<div id="bid-quote-area" className="scroll-mt-4">\s*<QuoteStep projectId=\{projectId\} \/>/.test(page), "② 里的报价区挂在 #bid-quote-area 里（项目页「下一步」卡照常跳得过来）");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
