/**
 * BIDPAGE-4 ② 只报总价的总价构成表：开始的 4 行、添加一项、默认填法与基数说明、六个数与算式、成本加成时不写算式、
 * 算不出、货品明细与改回填总数、其它成本行、互转入口、不写浏览器（服务端静态渲染 + 源码断言；无浏览器 / 无 DB）
 * （openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode）
 * 运行：npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { LUMP_ITEM_SPEC, addableKeys, emptyLumpItem, type LumpState, type LumpView } from "@/lib/bid-page-v2/lump-sum/contract";
import { LUMP_TEXT, LUMP_TOTAL_LABELS, LumpSumEditor } from "../lump-sum-editor";
import { QUOTE_STEP_TEXT } from "../quote-step";

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
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const presets = { financing: { ratePct: 8, months: 1, included: true }, admin: { ratePct: 3, included: true }, cashAllowance: { ratePct: 1, included: true }, commission: { ratePct: 30, included: true } };
function freshState(): LumpState {
  return {
    goods: { mode: "total", costLineId: "g1", amount: null, currency: "CAD", inquiryItemId: null, evidenceKind: null, supplierId: null, supplierName: null, notes: null },
    details: [],
    items: [{ ...emptyLumpItem("ocean_freight"), costLineId: "c-ocean" }, { ...emptyLumpItem("duty"), costLineId: "c-duty" }],
    tax: { hstPct: null, gstPct: null, pstPct: null },
    fx: {},
    presets,
    targetMarginPct: null,
  };
}
function viewOf(over: Partial<LumpView> = {}, state: LumpState = freshState()): LumpView {
  return {
    quote: { id: "q1", name: "合成总价报价", quoteNumber: "Q-2026-0009-P1", quoteType: "SUPPLY_ONLY", version: 1, status: "draft", currency: "CAD", updatedAt: "2026-11-23T00:00:00.000Z", frozen: false, pricingMethod: "MARGIN_ON_REVENUE" },
    capabilities: { canEdit: true, canApprove: true },
    state,
    notices: [],
    others: [],
    computed: { ok: true, totals: { estimatedCost: 0, sellingPrice: 0, salesTax: 0, totalWithTax: 0, grossProfit: 0, grossMarginPct: 0 }, formula: { baseCost: 0, marginPct: 0, revenuePct: 0, commission: null, sellingPrice: 0, salesTax: 0, totalWithTax: 0 }, amountById: {}, goodsAmount: 0, warnings: [] },
    inquiryQuotes: [],
    proModeHref: "/projects/p1/quote-engine/q1",
    convertToLine: { available: false, reasonZh: "货品是一个总数，先展开成明细再转成逐行报价" },
    ...over,
  };
}

console.log("━━━ 1. 开始的 4 行与添加一项 ━━━");
{
  const html = render(<LumpSumEditor projectId="p1" view={viewOf()} onSaved={noop} onClose={noop} />);
  ok(html.includes('data-testid="lump-row-goods"') && count(html, /data-testid="lump-row"/g) === 2 && html.includes(">海运费<") && html.includes(">关税<") && html.includes('data-testid="lump-row-tax"'), "刚新建：构成表只有货品、海运费、关税、销售税 4 行");
  ok(!html.includes('data-testid="lump-details"') && count(html, /没填，不计入/g) === 2, "没有预置的空行；没填的两项写着「没填，不计入」");
  ok(LUMP_TEXT.tableHeaders.every((h) => html.includes(`>${h}<`)), "表头：项目 | 金额或比例 | 备注");
  const opts = [...html.matchAll(/<option value="([a-z_]+)">([^<]+)<\/option>/g)].filter((m) => (Object.keys(LUMP_ITEM_SPEC) as string[]).includes(m[1])).map((m) => m[2]);
  ok(opts.join("、") === "国内运费、报关费、加拿大境内运费、包装、安装、测量、深化图、设备 / 场地、保函、保险、清洁、差旅、项目管理、售后预留、下错单 / 漏单预备金、其它", "「添加一项」：16 项，顺序同任务书", opts);
  const withInstall = addableKeys([...freshState().items, emptyLumpItem("installation")]);
  ok(!withInstall.includes("installation") && withInstall.includes("other") && addableKeys([emptyLumpItem("duty")])[0] === "ocean_freight", "加上安装后清单里没有安装、仍有其它；删掉的海运费排到最前面再出现");
  ok(html.includes("预置（每个项目可改、可关）") && html.includes("资金使用") && html.includes("管理费") && html.includes("现金备用金") && html.includes("销售提成"), "预置区：四条预置");
}

console.log("\n━━━ 2. 默认填法与基数说明 ━━━");
{
  const s = { ...freshState(), items: [...freshState().items, emptyLumpItem("contingency"), emptyLumpItem("bond"), emptyLumpItem("installation")] };
  ok(emptyLumpItem("contingency").kind === "percent" && emptyLumpItem("bond").kind === "percent" && emptyLumpItem("installation").kind === "amount", "预备金、保函默认是比例，安装是金额");
  const html = render(<LumpSumEditor projectId="p1" view={viewOf({}, s)} onSaved={noop} onClose={noop} />);
  ok(html.includes("不含按比例算的关税") && html.includes("按税前报价的比例（会进定价的分母）") && html.includes('aria-label="安装金额"'), "比例一格旁写明基数含什么（预备金按直接成本、不含按比例算的关税；保函按税前报价）", null);
}

console.log("\n━━━ 3. 六个数与算式（验收 3） ━━━");
{
  const s: LumpState = { ...freshState(), goods: { ...freshState().goods, amount: 800000, evidenceKind: "ESTIMATE" }, items: [{ ...freshState().items[0], amount: 60000 }, { ...freshState().items[1], amount: 40000 }], tax: { hstPct: 7, gstPct: null, pstPct: null }, targetMarginPct: 25, presets: { financing: { ...presets.financing, included: false }, admin: { ...presets.admin, included: false }, cashAllowance: { ...presets.cashAllowance, included: false }, commission: { ...presets.commission, included: false } } };
  const v = viewOf({ computed: { ok: true, totals: { estimatedCost: 900000, sellingPrice: 1200000, salesTax: 84000, totalWithTax: 1284000, grossProfit: 300000, grossMarginPct: 25 }, formula: { baseCost: 900000, marginPct: 25, revenuePct: 0, commission: null, sellingPrice: 1200000, salesTax: 84000, totalWithTax: 1284000 }, amountById: { "c-ocean": 60000, "c-duty": 40000 }, goodsAmount: 800000, warnings: [] } }, s);
  const html = render(<LumpSumEditor projectId="p1" view={v} onSaved={noop} onClose={noop} />);
  ok(LUMP_TOTAL_LABELS.every((l) => html.includes(l)) && ["900,000.00 加元", "1,200,000.00 加元", "84,000.00 加元", "1,284,000.00 加元", "300,000.00 加元", "25.0%"].every((x) => html.includes(x)), "显示成本合计 900,000.00、税前报价 1,200,000.00、销售税 84,000.00、含税总价 1,284,000.00、利润 300,000.00、毛利率 25%");
  ok(html.includes("税前报价 1,200,000.00 = 900,000.00 ÷（1 − 25%）") && html.includes("含税总价 1,284,000.00 = 1,200,000.00 + 销售税 84,000.00"), "算式写真实算法与这份报价的数");
  ok(!html.includes("成本合计 ÷"), "不写「成本合计 ÷（1 − 毛利率）」");
  ok(html.includes("= 60,000.00 加元") && html.includes("= 40,000.00 加元"), "每项旁写引擎算出的金额");
  const markup = render(<LumpSumEditor projectId="p1" view={viewOf({ quote: { ...v.quote, pricingMethod: "MARKUP_ON_COST" }, computed: { ...(v.computed as Extract<LumpView["computed"], { ok: true }>), formula: null } }, s)} onSaved={noop} onClose={noop} />);
  ok(!markup.includes('data-testid="lump-formula"') && markup.includes("请先填目标毛利率"), "定价方式改成成本加成：没有算式，写着要先填目标毛利率");
  const err = render(<LumpSumEditor projectId="p1" view={viewOf({ computed: { ok: false, errorsZh: ["有外币的项还没填汇率：在汇率里填上（1 原币 = 多少加元）"] } }, { ...s, items: [{ ...s.items[0], amount: 8000, currency: "USD" }], fx: { USD: { rate: null, source: null } } })} onSaved={noop} onClose={noop} />);
  ok(err.includes("还算不出报价") && err.includes("汇率") && !err.includes("1,200,000.00") && err.includes("美元（USD）"), "海运费 8,000 美元没填汇率：不显示结果，写着要填美元汇率、有美元汇率格");
  const empty = render(<LumpSumEditor projectId="p1" view={viewOf()} onSaved={noop} onClose={noop} />);
  ok(empty.includes(LUMP_TEXT.targetEmpty), "目标毛利率空着：写明按 0% 算");
}

console.log("\n━━━ 4. 货品明细、其它成本行、锁定 ━━━");
{
  const s: LumpState = { ...freshState(), goods: { ...freshState().goods, mode: "detail", amount: 999 }, details: [{ costLineId: "d1", description: "合成卷帘 A", quantity: 5, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 100, currency: "CAD", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" }, { costLineId: "d2", description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10, basis: "PER_PIECE", unitPrice: 3, currency: "CAD", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" }] };
  const v = viewOf({ computed: { ok: true, totals: { estimatedCost: 1100, sellingPrice: 1375, salesTax: 0, totalWithTax: 1375, grossProfit: 275, grossMarginPct: 20 }, formula: null, amountById: { d1: 500, d2: 600 }, goodsAmount: 1100, warnings: [] }, others: [{ id: "o1", description: "合成仓储费", category: "WAREHOUSING", amount: 300, included: true, fromLump: false, reasonZh: null }, { id: "o2", description: "海运费", category: "FREIGHT", amount: 8000, included: true, fromLump: true, reasonZh: "在专业模式里改了算法，这里不再管它（照样计入）" }], convertToLine: { available: true } }, s);
  const html = render(<LumpSumEditor projectId="p1" view={v} onSaved={noop} onClose={noop} />);
  ok(html.includes('data-testid="lump-details"') && count(html, /data-testid="lump-detail-row"/g) === 2 && html.includes("明细合计 1,100.00 加元") && html.includes(LUMP_TEXT.collapse) && html.includes("按件（× 10）"), "展开成明细：明细两行（按件那行带口径）、明细合计、「改回填一个总数」");
  ok(html.includes("另有 2 条其它成本行") && html.includes("合成仓储费（300.00 加元）——在专业模式里加的") && html.includes("在专业模式里改了算法，这里不再管它（照样计入）"), "其它成本行：列出金额与来历（专业模式加的 / 改了算法的）");
  const src = read("src/components/bid-page-v2/lump-sum-editor.tsx");
  ok(/window\.confirm\(`会删掉 \$\{state\.details\.length\} 条明细，确定？`\)/.test(src) && /details: \[\] \}\)\)/.test(src), "改回填总数：先问「会删掉 N 条明细，确定？」，确定后明细清空（总数留着）");
  const frozen = render(<LumpSumEditor projectId="p1" view={viewOf({ quote: { ...v.quote, status: "approved", frozen: true } }, s)} onSaved={noop} onClose={noop} />);
  ok(frozen.includes("这份报价「已批准」，内容锁定") && !frozen.includes('data-testid="lump-save"') && !frozen.includes('data-testid="lump-add"'), "已批准：写明锁定，没有保存与添加一项");
  const ro = render(<LumpSumEditor projectId="p1" view={viewOf({ capabilities: { canEdit: false, canApprove: false } })} onSaved={noop} onClose={noop} />);
  ok(ro.includes(LUMP_TEXT.readOnly) && !ro.includes('data-testid="lump-save"'), "没有编辑权限：只能看");
}

console.log("\n━━━ 5. 互转入口与源码 ━━━");
{
  const src = read("src/components/bid-page-v2/lump-sum-editor.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
  const ui = read("src/components/bid-page-v2/quote-ui.tsx");
  const step = read("src/components/bid-page-v2/quote-step.tsx");
  ok(/disabled=\{!view\.convertToLine\.available \|\| dirty \|\| converting\}/.test(src) && /view\.convertToLine\.reasonZh/.test(src) && /window\.confirm\(LUMP_TEXT\.toLineConfirm\)/.test(src) && /to: "LINE", baseUpdatedAt: view\.quote\.updatedAt/.test(src), "总价表「更多 → 转成逐行报价」：货品是总数时不可用并写原因、有没保存的修改不可用；先确认再转");
  ok(LUMP_TEXT.toLineConfirm.includes("合计不变") && LUMP_TEXT.toLineConfirm.includes("能再转回") && QUOTE_STEP_TEXT.toLumpConfirm.includes("合计不变") && QUOTE_STEP_TEXT.toLumpConfirm.includes("能再转回"), "两边的确认都写明转换后会变什么、合计不变、能再转回来");
  ok(/window\.confirm\(QUOTE_STEP_TEXT\.toLumpConfirm\)/.test(step) && /to: "LUMP_SUM", baseUpdatedAt: view\.quote\.updatedAt/.test(step) && /disabled=\{dirty \|\| converting\}/.test(step) && /onConverted\(view\.quote\.id, "LUMP_SUM"\)/.test(step), "逐行报价「更多 → 转成只报总价」：有没保存的修改不可用，先确认再转，转好后打开总价表");
  ok(/onConverted\(view\.quote\.id, "LINE"\)/.test(src) && /void openQuote\(quoteId, entryMode\)/.test(step), "转换成功后直接打开转换后的表");
  ok(/method: "PUT"/.test(src) && /baseUpdatedAt: view\.quote\.updatedAt, state/.test(src) && /\$\{base\}\/lump/.test(src), "保存带读取时的修改时间与整个状态，存到 …/lump");
  ok(!/computeQuote|computeTax|sellingPriceFromCost/.test(src), "组件里不算数（六个数与算式都由服务端用报价引擎算好）");
  ok(!/localStorage|sessionStorage|indexedDB/.test(src) && !/localStorage|sessionStorage|indexedDB/.test(ui), "总价表组件与共用小件都不读写浏览器存储");
  ok(/disabled=\{saving \|\| !dirty \|\| invalid\.size > 0\}/.test(src) && src.includes("改好才能保存"), "有格子填的不是数字：不让保存");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
