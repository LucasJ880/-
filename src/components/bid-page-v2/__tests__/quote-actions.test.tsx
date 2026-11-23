/**
 * BIDPAGE-6 ② 的主按钮、确认、我方报价一行（服务端静态渲染 + 源码断言；无浏览器 / 无 DB）
 * （openspec change quote-one-step-confirm，spec tender/quote-one-step-confirm、tender/bid-page 的修改）
 * 点击后的确认框、请求与刷新另在浏览器里抽检（docs/acceptance/bidpage-6/）。
 * 运行：npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { OurBidLine } from "@/lib/bid-page-v2/quote-confirm/contract";
import { OurBidLineView, QuoteActionBar, otherOurBidOf, type QuoteActionBarProps } from "../quote-actions";

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
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const render = (el: React.ReactElement) => renderToStaticMarkup(<AppRouterContext.Provider value={router}>{el}</AppRouterContext.Provider>);
const noop = () => undefined;

console.log("BIDPAGE-6 主按钮、确认、我方报价一行——渲染");

const decided = (over: Partial<Extract<OurBidLine, { status: "AUTHORITATIVE" }>> = {}): OurBidLine => ({ status: "AUTHORITATIVE", quoteId: "q-other", name: "合成逐行报价 A", version: 1, quoteStatus: "approved", sellingPrice: 1100000, currency: "CAD", decidedBy: "张三", decidedAt: "2026-11-23T15:05:00.000Z", entryMode: "LINE", ...over });
const props = (over: Partial<QuoteActionBarProps> = {}): QuoteActionBarProps => ({
  projectId: "p1",
  quote: { id: "q1", status: "draft", version: 2, updatedAt: "2026-11-23T00:00:00.000Z", currency: "CAD" },
  capabilities: { canEdit: true, canApprove: true },
  ourBid: { status: "NONE", approvedCount: 0 },
  label: "报价合计",
  sellingPrice: 1200000,
  dirty: false,
  hasUnpriced: false,
  onDone: noop,
  ...over,
});
const bar = (over: Partial<QuoteActionBarProps> = {}) => render(<QuoteActionBar {...props(over)} />);
const btn = (h: string, k: string) => h.includes(`data-testid="quote-action-${k}"`);
const disabled = (h: string, k: string) => new RegExp(`<button[^>]*disabled=""[^>]*data-testid="quote-action-${k}"`).test(h);

// —— 1. 按钮矩阵（spec「主按钮按状态与权限」） ——
{
  const approver = { canEdit: true, canApprove: true }, editor = { canEdit: true, canApprove: false }, none = { canEdit: false, canApprove: false };
  const d = (c: typeof approver) => bar({ capabilities: c });
  ok(btn(d(approver), "confirm") && d(approver).includes(">定为我方报价<") && !btn(d(approver), "submit"), "草稿 · 有批准权限：「定为我方报价」");
  ok(btn(d(editor), "submit") && d(editor).includes(">提交给负责人<") && !btn(d(editor), "confirm"), "草稿 · 只有编辑权限：「提交给负责人」");
  ok(!/data-testid="quote-action-(confirm|submit|approve|return)"/.test(d(none)), "草稿 · 都没有：不显示按钮");
  const rv = (c: typeof approver) => bar({ capabilities: c, quote: { ...props().quote, status: "review" } });
  ok(btn(rv(approver), "approve") && btn(rv(approver), "return") && rv(approver).includes(">批准并定为我方报价<") && rv(approver).includes(">退回<"), "待批准 · 有批准权限：「批准并定为我方报价」与「退回」");
  ok(!btn(rv(editor), "approve") && rv(editor).includes("已提交，等负责人批准") && rv(editor).includes("等批准期间还能改，改完记得保存；负责人看到的是最后保存的内容"), "待批准 · 只有编辑权限：「已提交，等负责人批准」，写明期间还能改、负责人看到的是最后保存的");
  ok(rv(approver).includes("提交以后还能改；你打开以后如果有人又保存过，批准时会提示你重新打开看最新内容") && !rv(approver).includes("负责人看到的是最后保存的内容"), "待批准 · 有批准权限：对负责人说「你」，不用第三人称");
  ok(rv(none).includes("已提交，等负责人批准"), "待批准 · 都没有：同一句");
  const ap = (c: typeof approver, ourBid: OurBidLine) => bar({ capabilities: c, quote: { ...props().quote, status: "approved" }, ourBid });
  const mine = decided({ quoteId: "q1", version: 2 });
  ok(ap(approver, mine).includes("已定为我方报价") && !btn(ap(approver, mine), "confirm") && btn(ap(approver, mine), "revise") && ap(none, mine).includes("已定为我方报价") && !btn(ap(none, mine), "revise"), "已批准是我方报价：写「已定为我方报价」；有编辑权限的才有「另起新版」");
  ok(btn(ap(approver, decided()), "confirm") && ap(editor, decided()).includes("已批准，还没定为我方报价") && !btn(ap(editor, decided()), "confirm"), "已批准不是我方报价：有批准权限给「定为我方报价」，只有编辑权限的写「已批准，还没定为我方报价」");
  const aw = bar({ ourBid: decided({ quoteStatus: "awarded" }) });
  ok(!btn(aw, "confirm") && aw.includes("现在的我方报价第 1 版已中标，这里不能把我方报价换成别的报价；确实要换，请在专业模式里做"), "现在的我方报价已中标：不给「定为我方报价」，写说明");
  for (const s of ["awarded", "superseded", "cancelled"]) {
    const h = bar({ quote: { ...props().quote, status: s } });
    ok(!/data-testid="quote-action-(confirm|submit|approve|return|revise)"/.test(h), `${s}：只写状态，没有按钮`);
  }
  ok(!/提交、批准在专业模式里做/.test(d(approver) + d(editor) + rv(approver)), "任何一种里都没有「提交、批准在专业模式里做」");
}

// —— 2. 不可点（spec「主按钮不可点的情况」） ——
{
  const dirty = bar({ dirty: true });
  ok(disabled(dirty, "confirm") && dirty.includes("有修改还没保存：先保存或放弃修改"), "有修改还没保存：不可点，写明原因");
  const inv = bar({ sellingPrice: null, capabilities: { canEdit: true, canApprove: false } });
  ok(disabled(inv, "submit") && inv.includes("报价算不出：先按下面「还算不出报价」那条提示改好"), "引擎算不出：提交也不可点");
  const un = bar({ hasUnpriced: true, quote: { ...props().quote, status: "review" } });
  ok(disabled(un, "approve") && !disabled(un, "return") && un.includes("有的行还没填供应商报价（或某项比例空着），填完才能批准并定为我方报价"), "有没填数的行：批准不可点、退回照样可点；原因里写的是这个人手上的按钮");
  ok(bar({ hasUnpriced: true, capabilities: { canEdit: true, canApprove: false } }).includes("填完才能提交给负责人"), "只有编辑权限的人：原因写「填完才能提交给负责人」");
  ok(!disabled(bar(), "confirm") && !bar().includes("data-testid=\"quote-action-block\""), "都没有：可点、没有原因");
}

// —— 3. 确认只在点了「确定」后发请求（spec「定之前确认一次」） ——
{
  const src = stripComments(read("src/components/bid-page-v2/quote-actions.tsx"));
  const onClick = src.slice(src.indexOf("const onClick = (b: QuoteActionButton) => {"), src.indexOf("const canRevise"));
  ok(/if \(b === "confirm" \|\| b === "approve"\) return setMode\("confirm"\);/.test(onClick) && /if \(b === "return"\) return setMode\("return"\);/.test(onClick) && !/run\("confirm"/.test(onClick), "点「定为我方报价」「批准并定为」只打开确认，不发请求；退回先写原因");
  ok(/disabled=\{busy \|\| !!block\} onClick=\{\(\) => void confirm\(\)\} data-testid="quote-action-confirm-ok"/.test(src) && /onClick=\{\(\) => setMode\("idle"\)\} data-testid="quote-action-confirm-cancel"/.test(src) && /data-testid="quote-action-confirm-block"/.test(src), "确认框里点「确定」才发请求，点「取消」只关掉；框打开以后又改了数（没保存）或算不出，「确定」也不可点并写明原因");
  ok(/notice: \{ text: r\.messageZh, tone: notifyNeedsFollowUp\(r\.notify\) \? "warn" : "muted" \}/.test(src) && /warn: "text-xs font-medium text-amber-700"/.test(src), "提交后负责人没收到通知：结果醒目显示（要提交的人自己去说）");
  ok(/confirmedNoteZh\(r\.reselectedFrom \? \(previousName \? \{ name: previousName, version: r\.reselectedFrom\.version \} : previousPending \? \{ superseded: true/.test(src) && /notice: note2 \? \{ text: note2, tone: "muted" \} : null/.test(src), "定好以后：改选了写原来那份还在（或已被新版替代），没改选不再多说一句");
  ok(/revisionPending: pendingOther/.test(src) && /ourBid\?\.status === "QUOTE_REVISION_PENDING" && ourBid\.quoteId !== quote\.id && ourBid\.pending\?\.id !== quote\.id/.test(src), "我方报价正在另起新版、这一份不是那份新版：确认框写明定了以后换成这一份");
  const dirtyReview = bar({ dirty: true, quote: { ...props().quote, status: "review" } });
  ok(disabled(dirtyReview, "return") && disabled(dirtyReview, "approve") && dirtyReview.includes("有修改还没保存"), "有没保存的修改时退回也不可点（退回后编辑器换新视图，没保存的修改会丢）");
  const withNotice = bar({ notice: { text: "已提交，已通知负责人 张三", tone: "muted" } });
  ok(withNotice.includes('data-testid="quote-action-message"') && withNotice.includes("已提交，已通知负责人 张三"), "上一次操作的提示由外面传回来显示（编辑器随新视图重挂后不丢）");
  ok(/run\("confirm", \{ baseUpdatedAt: quote\.updatedAt, expectedSellingPrice: props\.sellingPrice \}/.test(src) && /run\("submit", \{ baseUpdatedAt: quote\.updatedAt \}/.test(src) && /run\("return", \{ baseUpdatedAt: quote\.updatedAt, note:/.test(src), "请求带读取时的修改时间；一次定价另带页面上的报价合计");
  ok(/confirmPromptZh\(\{ label: props\.label, amount: props\.sellingPrice/.test(src) && /alreadyApproved: quote\.status === "approved"/.test(src) && /current: other && !other\.awarded \? \{ name: other\.name/.test(src), "确认框的字由同一个函数写（报价合计 / 税前报价、已批准的写本来锁着、要改选时写现在那份的名称）");
  ok(/isOurBid \? REVISE_TEXT\.promptOurBid : REVISE_TEXT\.promptOther/.test(src) && /isOurBid=\{isOurBid\}/.test(src), "另起新版的说明分我方报价 / 不是我方报价两种写（我方报价的写明新版定之前没有我方报价、不能导出）");
  ok(!/localStorage|sessionStorage|\/award|建项目预算/.test(src), "不写浏览器存储、没有中标动作");
  const o = otherOurBidOf(decided(), "q1");
  ok(o?.version === 1 && o.name === "合成逐行报价 A" && o.amount === 1100000 && !o.awarded && otherOurBidOf(decided({ quoteId: "q1" }), "q1") === null && otherOurBidOf({ status: "NONE", approvedCount: 0 }, "q1") === null, "要改选时取现在的我方报价的版本与金额；就是这一份或还没有时不写");
}

// —— 4. 我方报价一行（spec「我方报价一行」） ——
{
  const h = render(<OurBidLineView projectId="p1" line={decided({ quoteId: "q2", version: 2, sellingPrice: 1284000 })} canEdit onRevised={noop} />);
  ok(h.includes("我方报价：「合成逐行报价 A」第 2 版，1,284,000.00 加元，张三 2026-11-23 10:05 定的") && h.includes('data-testid="our-bid-line-revise"') && h.includes(">另起新版<"), "已定：一行写名称、版本、金额、谁、何时定的，旁边是「另起新版」", h);
  ok(!render(<OurBidLineView projectId="p1" line={decided()} canEdit={false} onRevised={noop} />).includes("our-bid-line-revise") && !render(<OurBidLineView projectId="p1" line={decided({ quoteStatus: "awarded" })} canEdit onRevised={noop} />).includes("our-bid-line-revise") && !render(<OurBidLineView projectId="p1" line={decided({ entryMode: null })} canEdit onRevised={noop} />).includes("our-bid-line-revise"), "没有编辑权限、已中标、专业模式做的我方报价：没有「另起新版」");
  ok(render(<OurBidLineView projectId="p1" line={{ status: "QUOTE_REVISION_PENDING", quoteId: "q1", version: 1, pending: { id: "q2", version: 2, status: "review" } }} canEdit onRevised={noop} />).includes("我方报价第 1 版已另起新版，新版第 2 版现在「待批准」，新版定为我方报价后才算数"), "新版待定");
  ok(render(<OurBidLineView projectId="p1" line={{ status: "NONE", approvedCount: 1 }} canEdit onRevised={noop} />).includes("还没有我方报价：已批准 1 份，打开要用的那一份点「定为我方报价」"), "还没有");
  ok(!/[A-Za-z]{4,}/.test(h.replace(/<[^>]+>/g, "").replace("合成逐行报价 A", "")), "这一行没有英文界面词");
}

// —— 5. 接进两个编辑器与 ②（spec「主按钮按状态与权限」「我方报价一行」、tender/bid-page「新页面上刷新汇总」「页内位置照常可达」） ——
{
  const step = stripComments(read("src/components/bid-page-v2/quote-step.tsx"));
  const lump = stripComments(read("src/components/bid-page-v2/lump-sum-editor.tsx"));
  ok(/<QuoteActionBar[\s\S]{0,300}label="报价合计"[\s\S]{0,200}sellingPrice=\{view\.computed\.ok \? view\.computed\.totals\.sellingPrice : null\}/.test(step) && /<QuoteActionBar[\s\S]{0,300}label="税前报价"[\s\S]{0,200}sellingPrice=\{view\.computed\.ok \? view\.computed\.totals\.sellingPrice : null\}/.test(lump), "逐行编辑器用「报价合计」、总价编辑器用「税前报价」，数都是引擎的税前报价");
  ok(/dirty=\{dirty\}/.test(step) && /dirty=\{dirty\}/.test(lump) && /w\.code === "LINE_UNPRICED"/.test(step) && /w\.code === "LINE_UNPRICED"/.test(lump), "两个编辑器都把没保存与未定价传给主按钮");
  ok(/<OurBidLineView projectId=\{projectId\} line=\{list\.view\.ourBid\}/.test(step) && step.indexOf("<OurBidLineView") < step.indexOf("<QuoteListPanel"), "② 最上面是我方报价一行（在报价列表之前）");
  ok(/quoteIdFromHash\(window\.location\.hash\)/.test(step) && /window\.addEventListener\("hashchange", openFromHash\)/.test(step) && /if \(!q\?\.entryMode\) return;/.test(step), "地址带 #bid-quote-{id} 时打开那份报价（专业模式的报价不在页内打开）");
  ok(/onBidChanged\(\);/.test(step) && /void loadList\(\);\s*void openQuote\(done\.quoteId, entryMode\);/.test(step), "操作成功后刷新列表、重新打开这份报价、让页签刷新汇总");
  ok(/setActionNotice\(done\.notice \? \{ quoteId: done\.quoteId, \.\.\.done\.notice \} : null\)/.test(step) && (step.match(/actionNotice=\{actionNotice\?\.quoteId === open\.view\.quote\.id \? actionNotice : null\}/g) ?? []).length === 2 && /onOpen=\{\(q\) => \{ setActionNotice\(null\);/.test(step) && /notice=\{actionNotice\}/.test(lump), "操作成功后的提示留在 ② 一级、只给同一份报价看；从列表换开别的报价时清掉");
  ok(/<QuoteActionBar\s+key=\{view\.quote\.id\}/.test(step) && /<QuoteActionBar\s+key=\{view\.quote\.id\}/.test(lump), "换开另一份报价时主按钮区重新挂上（确认框、退回原因、上一份的提示不带到这一份）");
  const page = stripComments(read("src/components/bid-page-v2/bid-page-v2.tsx"));
  ok(/const onBidChanged = useCallback\(\(\) => \{\s*userTouched\.current = true;\s*onRefresh\?\.\(\);/.test(page) && /<QuoteStep projectId=\{projectId\} onBidChanged=\{onBidChanged\} \/>/.test(page), "在 ② 里做过操作算自己开合过：刷新后「下一步」换了指向也不把 ② 收起");
  ok(/frozenNoteZh\(view\.quote\.status, view\.capabilities\.canEdit\)/.test(step) && /frozenZh\(view\.quote\.status, view\.capabilities\.canEdit\)/.test(lump), "锁定说明按看的人有没有编辑权限写");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
