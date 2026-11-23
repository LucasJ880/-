/**
 * BIDPAGE-1「标书与报价」页的「下一步」查表、询价计数、分区状态、金额门与金额写法、开关（纯函数，无 DB / 网络 / 模型）
 * （openspec change bid-page-v2-shell，spec tender/bid-page「下一步是确定性的查表」「下一步指向哪里」「三步分区」
 *   「汇总接口只把金额给有成本与财务查看权的人」「汇总接口对任何人都不出成本」「汇总接口」）
 * 运行：npx tsx src/lib/bid-page-v2/__tests__/next-step.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBidPageV2EnabledForOrgWithEnv } from "../flags";
import { INQUIRY_SCAN_WINDOW_DAYS, countInquiry, type InquiryItemFact } from "../inquiry-count";
import {
  ANALYSIS_UNAPPROVED_ALSO_ZH, BID_PAGE_RULE_TARGET, BID_PAGE_SECTIONS, BID_PAGE_SECTION_TITLES_ZH, NEEDS_FINANCE_ALSO_ZH,
  canViewBidAmounts, decideBidPageNextStep, formatMoneyZh, type BidPageFacts, type BidPageRule,
} from "../next-step";

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

const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

type Over = {
  analysisStatus?: string | null;
  supplierCount?: number;
  pendingRfqApprovals?: number;
  inquiry?: Partial<BidPageFacts["inquiry"]>;
  quote?: { available?: boolean; bid?: Partial<BidPageFacts["quote"]["bid"]>; openDraft?: BidPageFacts["quote"]["openDraft"]; approvedUnselected?: number };
  documents?: Partial<BidPageFacts["documents"]>;
  canViewAmounts?: boolean;
};

function facts(o: Over = {}): BidPageFacts {
  return {
    now: NOW,
    analysisStatus: o.analysisStatus === undefined ? "APPROVED" : o.analysisStatus,
    supplierCount: o.supplierCount ?? 0,
    pendingRfqApprovals: o.pendingRfqApprovals ?? 0,
    inquiry: { askedCount: 0, respondedCount: 0, quotedCount: 0, repliedNoQuoteCount: 0, waitingCount: 0, waitingSince: null, ...(o.inquiry ?? {}) },
    quote: {
      available: o.quote?.available ?? true,
      bid: { status: "NONE", version: null, amount: null, ...(o.quote?.bid ?? {}) },
      openDraft: o.quote?.openDraft ?? null,
      approvedUnselected: o.quote?.approvedUnselected ?? 0,
    },
    documents: { canGenerate: true, generatedKinds: 0, ...(o.documents ?? {}) },
    canViewAmounts: o.canViewAmounts ?? true,
  };
}
const waiting = (askedCount: number, ms: number, extra: Partial<BidPageFacts["inquiry"]> = {}) => ({ askedCount, waitingCount: 1, waitingSince: ago(ms), ...extra });

const DECIDED = { status: "AUTHORITATIVE" as const, version: 3, amount: { value: 12345, currency: "CAD" } };

console.log("BIDPAGE-1 下一步查表");

// —— 每种状态各得一条（规格场景「每种状态各得一条」） ——
{
  const cases: Array<[string, Over, BidPageRule, string, string]> = [
    ["招标分析未批准、还没往下走", { analysisStatus: "REVIEW_REQUIRED", supplierCount: 2 }, "requirements_unapproved", "先去「招标要求」确认要求", "tab"],
    ["已定", { quote: { bid: DECIDED } }, "bid_decided", "导出价格表 / 生成投标文件", "documents"],
    ["有草稿", { quote: { openDraft: { status: "draft", version: 2 } } }, "quote_draft", "检查后定为我方报价", "quote"],
    ["已批准两份、没选", { quote: { approvedUnselected: 2 } }, "quote_draft", "检查后定为我方报价", "quote"],
    ["没有供应商", {}, "no_suppliers", "添加供应商或起草询价", "sourcing"],
    ["有供应商没发询价", { supplierCount: 3 }, "no_rfq_sent", "起草询价", "sourcing"],
    ["有待批询价卡", { supplierCount: 2, pendingRfqApprovals: 1 }, "rfq_pending_approval", "询价已起草，等批准后发出", "sourcing"],
    ["已发没回", { supplierCount: 2, inquiry: waiting(2, 3 * DAY) }, "waiting_replies", "等供应商回复（已等 3 天）", "sourcing"],
    ["一家拒绝、一家还在等", { supplierCount: 2, inquiry: waiting(2, DAY, { respondedCount: 1 }) }, "waiting_replies", "等供应商回复（已等 1 天）", "sourcing"],
    ["上一轮都拒绝、新一轮的发询价卡在等批准", { supplierCount: 3, pendingRfqApprovals: 1, inquiry: { askedCount: 2, respondedCount: 2 } }, "rfq_pending_approval", "询价已起草，等批准后发出", "sourcing"],
    ["回复了没报价、没人在等", { supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 2, repliedNoQuoteCount: 1 } }, "replies_to_record", "看供应商回复，把报价录入", "sourcing"],
    ["有人报价", { supplierCount: 2, inquiry: waiting(2, 2 * DAY, { respondedCount: 1, quotedCount: 1 }) }, "start_quote", "开始做报价", "quote"],
    ["已发的都拒绝", { supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 2 } }, "start_quote", "开始做报价", "quote"],
  ];
  for (const [name, o, rule, headline, where] of cases) {
    const v = decideBidPageNextStep(facts(o));
    const target = v.action.target;
    const actualWhere = target.kind === "tab" ? "tab" : target.section;
    ok(v.rule === rule && v.headlineZh === headline && actualWhere === where, `${name} → ${headline}`, { rule: v.rule, headline: v.headlineZh, where: actualWhere });
  }
}

// —— 「下一步」指向哪里（规格场景「每条规则的去处」） ——
{
  const expected: Record<BidPageRule, string> = {
    requirements_unapproved: "requirements", bid_decided: "documents", quote_draft: "quote", no_suppliers: "sourcing",
    rfq_pending_approval: "sourcing", no_rfq_sent: "sourcing", waiting_replies: "sourcing", replies_to_record: "sourcing", start_quote: "quote",
  };
  ok(JSON.stringify(BID_PAGE_RULE_TARGET) === JSON.stringify(expected), "对应表：招标要求 → 切页签；找供应商那几条 → ①；检查后定 / 开始做报价 → ②；已定 → ③", BID_PAGE_RULE_TARGET);
  const req = decideBidPageNextStep(facts({ analysisStatus: null }));
  ok(req.action.labelZh === "去「招标要求」" && req.action.target.kind === "tab" && req.action.target.tab === "requirements" && req.expanded === "sourcing", "指向招标要求：按钮「去「招标要求」」、切页签、默认展开 ①", req);
  const labels: Array<[Over, string, string]> = [
    [{ supplierCount: 1, inquiry: { askedCount: 1, quotedCount: 1, respondedCount: 1 } }, "去「定报价」", "quote"],
    [{ quote: { bid: DECIDED } }, "去「出文件」", "documents"],
    [{}, "去「找供应商、询价」", "sourcing"],
  ];
  for (const [o, label, expanded] of labels) {
    const v = decideBidPageNextStep(facts(o));
    ok(v.action.labelZh === label && v.expanded === expanded, `${v.rule} → 按钮「${label}」、默认展开 ${expanded}`, v);
  }
}

// —— 招标分析：没往下走才卡住；往下走了只顺带一句 ——
{
  const reasons: Array<[string | null, string]> = [
    [null, "还没有招标分析，先到那里发起分析"], ["ANALYZING", "招标分析还在进行，完成后再确认"], ["RUNNING", "招标分析还在进行，完成后再确认"],
    ["EXTRACTING", "招标分析还在进行，完成后再确认"], ["REVIEW_REQUIRED", "招标分析还没批准"], ["FAILED", "上次招标分析没有完成，需要重新分析"],
  ];
  for (const [status, reason] of reasons) {
    const v = decideBidPageNextStep(facts({ analysisStatus: status, supplierCount: 3 }));
    ok(v.rule === "requirements_unapproved" && v.reasonZh === reason && v.alsoZh === null, `分析状态 ${status ?? "无"}、没往下走 → 原因「${reason}」`, v);
  }
  ok(decideBidPageNextStep(facts({ analysisStatus: "approved" })).rule !== "requirements_unapproved", "分析状态大小写不敏感");
  const sent = decideBidPageNextStep(facts({ analysisStatus: "REVIEW_REQUIRED", supplierCount: 2, inquiry: waiting(2, 2 * DAY) }));
  ok(sent.rule === "waiting_replies" && sent.alsoZh === ANALYSIS_UNAPPROVED_ALSO_ZH && ANALYSIS_UNAPPROVED_ALSO_ZH === "招标分析还没批准", "分析待审、但已经发了询价 → 照实际进度（等供应商回复），顺带一句「招标分析还没批准」", sent);
  const decided = decideBidPageNextStep(facts({ analysisStatus: null, quote: { bid: DECIDED } }));
  ok(decided.rule === "bid_decided" && decided.alsoZh === "招标分析还没批准", "没有分析、但已经定了我方报价 → 导出价格表 / 生成投标文件，顺带一句", decided);
  const draft = decideBidPageNextStep(facts({ analysisStatus: "RUNNING", quote: { openDraft: { status: "draft", version: 1 } } }));
  ok(draft.rule === "quote_draft" && draft.alsoZh === "招标分析还没批准", "正在重新分析、已有草稿 → 检查后定为我方报价，顺带一句", draft);
  ok(decideBidPageNextStep(facts({ analysisStatus: null, quote: { available: false, bid: DECIDED } })).rule === "requirements_unapproved", "报价功能没开时报价不算往下走");
  ok(decideBidPageNextStep(facts({ supplierCount: 3 })).alsoZh === null, "已批准、看得到金额 → 没有顺带一句");
}

// —— 看不到金额的人：要在带金额区块里做的事，顺带说要找谁 ——
{
  const needs: Array<[string, Over]> = [
    ["起草询价", { supplierCount: 3 }], ["等批准后发出", { supplierCount: 2, pendingRfqApprovals: 1 }], ["把报价录入", { supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 2, repliedNoQuoteCount: 1 } }],
    ["开始做报价", { supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 1, quotedCount: 1 } }], ["检查后定", { quote: { openDraft: { status: "draft", version: 1 } } }],
  ];
  for (const [name, o] of needs) {
    ok(decideBidPageNextStep(facts({ ...o, canViewAmounts: false })).alsoZh === NEEDS_FINANCE_ALSO_ZH && decideBidPageNextStep(facts({ ...o, canViewAmounts: true })).alsoZh === null, `${name}：看不到金额 → 顺带「${NEEDS_FINANCE_ALSO_ZH}」；看得到 → 没有`);
  }
  const noNeed: Array<[string, Over]> = [["添加供应商", {}], ["等供应商回复", { supplierCount: 2, inquiry: waiting(2, DAY) }], ["已定", { quote: { bid: DECIDED } }]];
  for (const [name, o] of noNeed) ok(decideBidPageNextStep(facts({ ...o, canViewAmounts: false })).alsoZh === null, `${name}：不需要金额区块 → 没有这句`);
  const both = decideBidPageNextStep(facts({ analysisStatus: "REVIEW_REQUIRED", supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 1, quotedCount: 1 }, canViewAmounts: false }));
  ok(both.alsoZh === "招标分析还没批准；这一步要项目负责人或有财务查看权的同事来做", "两句都要说时用「；」连起来", both.alsoZh);
}

// —— 报价状态优先于找供应商（规格场景「报价状态优先于找供应商」） ——
{
  ok(decideBidPageNextStep(facts({ supplierCount: 0, quote: { bid: DECIDED } })).rule === "bid_decided", "没有供应商、没发询价、但已定 → 导出价格表 / 生成投标文件");
  ok(decideBidPageNextStep(facts({ supplierCount: 0, quote: { openDraft: { status: "draft", version: 1 } } })).rule === "quote_draft", "没有供应商、但有草稿 → 检查后定为我方报价");
  const pending = decideBidPageNextStep(facts({ supplierCount: 0, quote: { bid: { status: "QUOTE_REVISION_PENDING", version: 2, amount: null } } }));
  ok(pending.rule === "quote_draft" && pending.reasonZh === "我方报价的新版还没定", "我方报价有新版待定 → 检查后定为我方报价", pending);
  const unselected = decideBidPageNextStep(facts({ quote: { approvedUnselected: 2 } }));
  ok(unselected.reasonZh === "已批准 2 份，还没选为我方报价" && unselected.sections.quote.statusZh === "已批准 2 份，还没选为我方报价", "已批准两份、没选 → 原因与 ② 的状态都写明", unselected);
  ok(decideBidPageNextStep(facts({ quote: { bid: DECIDED, openDraft: { status: "draft", version: 4 } } })).rule === "bid_decided", "已定、同时有一份新草稿 → 仍是已定");
  ok(decideBidPageNextStep(facts({ quote: { openDraft: { status: "review", version: 2 } } })).reasonZh === "第 2 版待批准", "待批准的草稿原因是「第 2 版待批准」");
  ok(decideBidPageNextStep(facts({ supplierCount: 0, quote: { available: false, bid: DECIDED, openDraft: { status: "draft", version: 1 }, approvedUnselected: 1 } })).rule === "no_suppliers", "报价功能未开通 → 报价状态不参与判断");
}

// —— 等待天数与回复（规格场景「等待天数」） ——
{
  const at = (ms: number) => decideBidPageNextStep(facts({ supplierCount: 1, inquiry: waiting(1, ms) })).headlineZh;
  ok(at(3 * DAY) === "等供应商回复（已等 3 天）", "3 天前发出 → 已等 3 天", at(3 * DAY));
  ok(at(3 * DAY + 23 * 3_600_000) === "等供应商回复（已等 3 天）", "3 天 23 小时 → 仍是已等 3 天（向下取整）");
  ok(at(23 * 3_600_000) === "等供应商回复（发出不到 1 天）", "不到 24 小时 → 发出不到 1 天", at(23 * 3_600_000));
  ok(at(-5 * 60_000) === "等供应商回复（发出不到 1 天）", "发出时间比现在还晚（时钟偏差）→ 不出现负数");
  ok(decideBidPageNextStep(facts({ supplierCount: 1, inquiry: { askedCount: 1, waitingCount: 1, waitingSince: null } })).headlineZh === "等供应商回复", "在等的都没有发出时间（旧数据）→ 只说等供应商回复，不写天数");
  const waitingReplied = decideBidPageNextStep(facts({ supplierCount: 2, inquiry: waiting(2, DAY, { respondedCount: 1, repliedNoQuoteCount: 1 }) }));
  ok(waitingReplied.rule === "waiting_replies" && waitingReplied.reasonZh === "1 家回复了、还没录入报价，其余还在等", "一家回复了没报价、另一家还在等 → 等供应商回复", waitingReplied);
  ok(decideBidPageNextStep(facts({ supplierCount: 2, inquiry: waiting(2, DAY) })).reasonZh === "已问 2 家，还没有报价", "都在等 → 已问 2 家，还没有报价");
  const record = decideBidPageNextStep(facts({ supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 2, repliedNoQuoteCount: 2 } }));
  ok(record.rule === "replies_to_record" && record.reasonZh === "2 家回复了，还没录入报价（先看回复里有没有报价）" && record.expanded === "sourcing", "都回复了、都没报价、没人在等 → 看供应商回复，把报价录入（①）", record);
  ok(decideBidPageNextStep(facts({ supplierCount: 2, inquiry: waiting(2, DAY, { respondedCount: 1, quotedCount: 1 }) })).reasonZh === "已有 1 家报价", "有一家报价了、另一家还在等 → 开始做报价（已有 1 家报价）");
  ok(decideBidPageNextStep(facts({ supplierCount: 2, inquiry: { askedCount: 2, respondedCount: 2 } })).reasonZh === "问过的 2 家都没报价，也可以再问几家", "都拒绝 → 原因写明都没报价、可以再问");
}

// —— 询价计数（纯函数，规格场景「多轮询价按每家最近一次算」） ——
{
  const it = (supplierId: string, status: string, round: number, sentAgoDays: number | null, roundStatus = "in_progress"): InquiryItemFact => ({
    supplierId, status, roundNumber: round, roundStatus, sentAt: sentAgoDays === null ? null : ago(sentAgoDays * DAY),
  });
  const c1 = countInquiry([it("A", "sent", 1, 5), it("B", "declined", 2, 1)], NOW);
  ok(c1.askedCount === 2 && c1.waitingCount === 1 && c1.waitingSince?.getTime() === ago(5 * DAY).getTime() && c1.respondedCount === 1, "第 1 轮 A 在等 5 天、第 2 轮 B 拒绝 → 2 家已询价、1 家在等（等了 5 天）、1 家已回", c1);
  ok(decideBidPageNextStep(facts({ supplierCount: 2, inquiry: c1 })).headlineZh === "等供应商回复（已等 5 天）", "（接上）下一步是等供应商回复（已等 5 天），不是开始做报价");
  const c2 = countInquiry([it("A", "sent", 1, 10), it("B", "sent", 2, 1)], NOW);
  ok(c2.waitingCount === 2 && c2.waitingSince?.getTime() === ago(10 * DAY).getTime(), "第 1 轮等了 10 天、第 2 轮昨天发 → 按最早的算 10 天", c2);
  const c3 = countInquiry([it("A", "declined", 1, 5), it("A", "sent", 2, 2)], NOW);
  ok(c3.askedCount === 1 && c3.respondedCount === 0 && c3.waitingCount === 1, "同一家：第 1 轮拒绝、第 2 轮重发在等 → 算在等、不算已回", c3);
  const c4 = countInquiry([it("A", "replied", 1, 5), it("A", "declined", 2, 2)], NOW);
  ok(c4.repliedNoQuoteCount === 0 && c4.respondedCount === 1, "同一家：第 1 轮回复没报价、第 2 轮拒绝 → 按最近一次（拒绝），不算待录入", c4);
  const c5 = countInquiry([it("A", "quoted", 1, 5), it("A", "sent", 2, 1)], NOW);
  ok(c5.quotedCount === 1 && c5.waitingCount === 1, "同一家：第 1 轮报过价、第 2 轮重发在等 → 已报价 1 家（报价还在），也在等", c5);
  const c6 = countInquiry([it("A", "sent", 1, 40, "completed")], NOW);
  ok(c6.askedCount === 1 && c6.waitingCount === 0, "已结束的轮次里还是「已发出」→ 不算在等", c6);
  const c7 = countInquiry([it("A", "sent", 1, INQUIRY_SCAN_WINDOW_DAYS + 1)], NOW);
  ok(c7.waitingCount === 0, "发出超过 90 天 → 不算在等（与定时催单同一个时间窗）", c7);
  ok(countInquiry([it("A", "sent", 1, INQUIRY_SCAN_WINDOW_DAYS - 1)], NOW).waitingCount === 1, "发出 89 天 → 仍算在等");
  const c8 = countInquiry([it("A", "sent", 1, null)], NOW);
  ok(c8.waitingCount === 1 && c8.waitingSince === null, "「已发出」但没有发出时间（旧数据）→ 仍算在等，不写天数", c8);
  const c9 = countInquiry([it("A", "pending", 3, null), it("B", "pending", 1, null)], NOW);
  ok(c9.askedCount === 0 && c9.waitingCount === 0, "只有未发出的明细 → 不算问过", c9);
  const c10 = countInquiry([it("A", "replied", 1, 3), it("B", "quoted", 1, 3), it("C", "declined", 1, 3), it("D", "no_response", 1, 30)], NOW);
  ok(c10.askedCount === 4 && c10.respondedCount === 3 && c10.quotedCount === 1 && c10.repliedNoQuoteCount === 1 && c10.waitingCount === 0, "回复 / 报价 / 拒绝 / 未响应各一家 → 4 问、3 回、1 报价、1 待录入、0 在等", c10);
  const chase = read("src/lib/tender-rfq/chase-service.ts").match(/export const OPEN_ITEM_WINDOW_DAYS = (\d+);/);
  ok(!!chase && Number(chase[1]) === INQUIRY_SCAN_WINDOW_DAYS, "90 天与定时催单扫描的 OPEN_ITEM_WINDOW_DAYS 相同", chase?.[1]);
}

// —— 三个分区 ——
{
  ok(BID_PAGE_SECTIONS.join() === "sourcing,quote,documents", "三个分区按做事的顺序排");
  ok(BID_PAGE_SECTION_TITLES_ZH.sourcing === "① 找供应商、询价" && BID_PAGE_SECTION_TITLES_ZH.quote === "② 定报价" && BID_PAGE_SECTION_TITLES_ZH.documents === "③ 出文件", "分区标题");
  const st = (o: Over) => decideBidPageNextStep(facts(o)).sections;
  const cases: Array<[string, string, string]> = [
    [st({}).sourcing.statusZh, "还没有供应商", "① 还没有供应商"],
    [st({ supplierCount: 3 }).sourcing.statusZh, "3 家供应商，还没询价", "① 3 家供应商，还没询价"],
    [st({ supplierCount: 3, pendingRfqApprovals: 1 }).sourcing.statusZh, "询价已起草，等批准", "① 询价已起草，等批准"],
    [st({ supplierCount: 3, inquiry: { askedCount: 2, respondedCount: 1 } }).sourcing.statusZh, "2 家已询价，1 家已回", "① 2 家已询价，1 家已回"],
    [st({}).quote.statusZh, "还没有报价", "② 还没有报价"],
    [st({ quote: { openDraft: { status: "draft", version: 2 } } }).quote.statusZh, "草稿（第 2 版），未定", "② 草稿（第 2 版），未定"],
    [st({ quote: { openDraft: { status: "review", version: 2 } } }).quote.statusZh, "待批准（第 2 版），未定", "② 待批准（第 2 版），未定"],
    [st({ quote: { bid: DECIDED }, canViewAmounts: true }).quote.statusZh, "我方报价 12,345.00 加元，已定", "② 看得到金额：我方报价 12,345.00 加元，已定"],
    [st({ quote: { bid: DECIDED }, canViewAmounts: false }).quote.statusZh, "我方报价已定", "② 看不到金额：我方报价已定"],
    [st({ quote: { bid: { status: "QUOTE_REVISION_PENDING", version: 2, amount: null } } }).quote.statusZh, "我方报价有新版待定", "② 我方报价有新版待定"],
    [st({ quote: { approvedUnselected: 1 } }).quote.statusZh, "已批准 1 份，还没选为我方报价", "② 已批准 1 份，还没选为我方报价"],
    [st({ quote: { available: false } }).quote.statusZh, "报价功能未开通", "② 报价功能未开通"],
    [st({ documents: { generatedKinds: 3 } }).documents.statusZh, "已生成 3 种文件", "③ 已生成 3 种文件"],
    [st({}).documents.statusZh, "还没有生成文件", "③ 还没有生成文件"],
    [st({ documents: { canGenerate: false, generatedKinds: 3 } }).documents.statusZh, "生成文件需要项目编辑权限", "③ 没有编辑权限 → 生成文件需要项目编辑权限（不说生成了几种）"],
  ];
  for (const [actual, expected, name] of cases) ok(actual === expected, name, actual);
  const v = decideBidPageNextStep(facts({ quote: { available: false }, documents: { canGenerate: false }, canViewAmounts: true }));
  ok(v.viewer.canViewAmounts === true && v.viewer.quoteAvailable === false && v.viewer.canGenerate === false, "viewer 带上：能否看金额、报价功能开没开、能否生成文件", v.viewer);
}

// —— 金额门与金额只给看得到的人（规格场景「金额门」） ——
{
  ok(canViewBidAmounts({ canViewInternal: true, financeCanReadAll: true }), "能看内部成本 + 有财务查看权 → 看得到");
  ok(!canViewBidAmounts({ canViewInternal: true, financeCanReadAll: false }), "能看内部成本（项目只读 / 测试员 / 操作员 / 项目管理员角色）但没有财务查看权 → 看不到");
  ok(!canViewBidAmounts({ canViewInternal: false, financeCanReadAll: true }), "有财务查看权但不能看报价内部成本 → 看不到");
  ok(decideBidPageNextStep(facts({ quote: { available: false, bid: DECIDED }, canViewAmounts: true })).viewer.canViewAmounts === true, "报价功能没开不影响「看得到金额」（询价区等照挂），只是没有我方报价金额");
  ok(!("amount" in decideBidPageNextStep(facts({ quote: { available: false, bid: DECIDED }, canViewAmounts: true })).quote), "报价功能没开 → 没有我方报价金额");

  const big = { status: "AUTHORITATIVE" as const, version: 1, amount: { value: 1284000.5, currency: "CAD" } };
  const hidden = decideBidPageNextStep(facts({ quote: { bid: big }, canViewAmounts: false, supplierCount: 4, inquiry: { askedCount: 4, respondedCount: 2, quotedCount: 1 } }));
  const json = JSON.stringify(hidden);
  ok(!/1,?284,?000/.test(json) && !json.includes("加元") && !json.includes("CAD"), "看不到金额：整个结果里没有金额与币种", json);
  ok(hidden.quote.decided === true && !("amount" in hidden.quote) && hidden.viewer.canViewAmounts === false, "看不到金额：只有「已定」，没有 amount 字段，viewer 写明看不到", hidden);
  const shown = decideBidPageNextStep(facts({ quote: { bid: big }, canViewAmounts: true }));
  ok(shown.quote.amount?.value === 1284000.5 && shown.quote.amount.currency === "CAD" && shown.viewer.canViewAmounts === true, "看得到金额：amount 带金额与币种", shown);
  ok(shown.sections.quote.statusZh === "我方报价 1,284,000.50 加元，已定", "看得到金额：千分位两位小数", shown.sections.quote.statusZh);
  const draftHidden = decideBidPageNextStep(facts({ quote: { openDraft: { status: "draft", version: 2 }, bid: { status: "NONE", version: null, amount: { value: 999, currency: "CAD" } } }, canViewAmounts: true }));
  ok(!("amount" in draftHidden.quote) && draftHidden.quote.decided === false, "没定的报价不出金额（即使看得到）", draftHidden.quote);
  const nan = decideBidPageNextStep(facts({ quote: { bid: { status: "AUTHORITATIVE", version: 1, amount: { value: Number.NaN, currency: "CAD" } } }, canViewAmounts: true }));
  ok(!("amount" in nan.quote) && nan.sections.quote.statusZh === "我方报价已定", "金额不是有限数 → 不出金额，状态写「我方报价已定」", nan);
  const all: Over[] = [
    { analysisStatus: null }, { quote: { bid: big } }, { quote: { openDraft: { status: "review", version: 9 } } }, { quote: { approvedUnselected: 2 } }, {}, { supplierCount: 5 },
    { supplierCount: 5, pendingRfqApprovals: 2 }, { supplierCount: 5, inquiry: waiting(5, 10 * DAY) },
    { supplierCount: 5, inquiry: { askedCount: 5, respondedCount: 3, repliedNoQuoteCount: 3 } }, { supplierCount: 5, inquiry: { askedCount: 5, respondedCount: 3, quotedCount: 3 } },
    { analysisStatus: "REVIEW_REQUIRED", quote: { bid: big } },
  ];
  const leak = all.map((o) => JSON.stringify(decideBidPageNextStep(facts({ ...o, canViewAmounts: false })))).filter((s) => /\d[\d,]*\.\d{2}|加元|美元|人民币|欧元|英镑|\bCAD\b|\bUSD\b|\bCNY\b|"amount"/.test(s));
  ok(leak.length === 0, "看不到金额：十一种状态的结果里都没有金额写法", leak);
  const keys = new Set<string>();
  const walk = (x: unknown) => { if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { keys.add(k); walk(v); } };
  walk(shown);
  ok(![...keys].some((k) => /cost|margin|profit|supplierPrice|unitPrice|totalPrice|landed/i.test(k)), "看得到金额的人：结果里也没有成本、毛利、供应商报价的字段", [...keys]);
}

// —— 金额写法 ——
{
  ok(formatMoneyZh(12345, "CAD") === "12,345.00 加元", "12,345.00 加元");
  ok(formatMoneyZh(0.005, "CAD") === "0.01 加元", "四舍五入到分");
  ok(formatMoneyZh(999.999, "USD") === "1,000.00 美元", "进位到千分位");
  ok(formatMoneyZh(1234567.891, "cny") === "1,234,567.89 人民币", "币种大小写不敏感");
  ok(formatMoneyZh(10, "EUR") === "10.00 欧元" && formatMoneyZh(10, "GBP") === "10.00 英镑", "欧元 / 英镑");
  ok(formatMoneyZh(10, "AUD") === "10.00 AUD", "认不出的币种原样写代码");
  ok(formatMoneyZh(-1500, "CAD") === "-1,500.00 加元", "负数");
  ok(formatMoneyZh(-0.004, "CAD") === "0.00 加元", "舍入后是 0 的负数不写负号");
  ok([Number.NaN, Infinity, -Infinity, 1e22].every((x) => formatMoneyZh(x, "CAD") === "—") && formatMoneyZh("12" as unknown as number, "CAD") === "—", "不是有限数、大到失真、不是数字 → 「—」");
}

// —— 确定性 ——
{
  const f = facts({ supplierCount: 2, inquiry: waiting(2, 5 * DAY) });
  ok(JSON.stringify(decideBidPageNextStep(f)) === JSON.stringify(decideBidPageNextStep(f)), "同样的状态得出同样的结果");
  for (const file of ["src/lib/bid-page-v2/next-step.ts", "src/lib/bid-page-v2/inquiry-count.ts"]) {
    const src = read(file);
    ok(!/from\s+["'](?!\.\/next-step["'])[^"']+["']/.test(src.replace(/import type[^;]+;/g, "")) && !/createCompletion|fetch\(|prisma/.test(src), `${file} 不引模型、数据库、网络（只有类型引用）`, src.match(/from\s+["'][^"']+["']/g));
  }
}

// —— 开关与汇总接口的检查顺序 ——
{
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  ok(!isBidPageV2EnabledForOrgWithEnv("org1", env({})), "未设 → 关");
  ok(!isBidPageV2EnabledForOrgWithEnv("org1", env({ TENDER_BID_PAGE_V2_ENABLED: "0" })), "0 → 关");
  ok(!isBidPageV2EnabledForOrgWithEnv("org1", env({ TENDER_BID_PAGE_V2_ENABLED: "enabled" })), "认不得的值 → 关");
  ok(["1", "true", "on", "yes", " TRUE "].every((v) => isBidPageV2EnabledForOrgWithEnv("org1", env({ TENDER_BID_PAGE_V2_ENABLED: v }))), "1 / true / on / yes（大小写、空白不敏感）→ 开");
  ok(isBidPageV2EnabledForOrgWithEnv("org1", env({ TENDER_BID_PAGE_V2_ENABLED: "1", TENDER_BID_PAGE_V2_ORG_ALLOWLIST: "" })), "白名单为空 → 所有组织");
  ok(isBidPageV2EnabledForOrgWithEnv("org2", env({ TENDER_BID_PAGE_V2_ENABLED: "1", TENDER_BID_PAGE_V2_ORG_ALLOWLIST: "org1, org2" })), "在白名单里 → 开");
  ok(!isBidPageV2EnabledForOrgWithEnv("org3", env({ TENDER_BID_PAGE_V2_ENABLED: "1", TENDER_BID_PAGE_V2_ORG_ALLOWLIST: "org1,org2" })), "不在白名单里 → 关");
  ok(!isBidPageV2EnabledForOrgWithEnv(null, env({ TENDER_BID_PAGE_V2_ENABLED: "1" })) && !isBidPageV2EnabledForOrgWithEnv("", env({ TENDER_BID_PAGE_V2_ENABLED: "1" })), "没有组织 → 关");
  ok(!isBidPageV2EnabledForOrgWithEnv("org1", env({ TENDER_BID_WORKSPACE_ENABLED: "1", TENDER_WEB_NEXT_STEP_ENABLED: "1" })), "别的开关开着不影响本开关");
  const route = read("src/app/api/projects/[id]/bid-page-summary/route.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const body = route.slice(route.indexOf("export async function GET"));
  ok(/^export async function GET\([^)]*\)[^{]*\{\s*const \{ id: projectId \} = await params;\s*const access = await requireProjectReadAccess\(request, projectId\);\s*if \(access instanceof NextResponse\) return access;/.test(body), "汇总接口第一步不带条件地做项目读权限检查、紧接着检查结果（与 projects/[id] 下其它接口同一写法）");
  const oIdx = body.indexOf("!isBidPageV2EnabledForOrg(orgId)");
  ok(oIdx > 0 && oIdx < body.indexOf("resolveFinancePrivilege(") && oIdx < body.indexOf("loadBidPageView("), "开关 / 白名单 / 招投标项目在取财务权限、读报价与取数之前判");
  ok(/resolveQuoteCapabilities\(access, \{ financeManage: finance\.privileged \}\)/.test(body) && !/requireQuoteAccess/.test(body) && /isQuoteEngineEnabled\(\)/.test(body), "内部成本权限用 resolveQuoteCapabilities（与 requireQuoteAccess 同一个判定，不经报价引擎开关）；报价功能只看引擎开关");
}

console.log(`\n${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
