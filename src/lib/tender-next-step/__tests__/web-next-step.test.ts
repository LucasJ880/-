/**
 * FLOW-H1 项目页「下一步」— 纯逻辑测试（每一种状态的结论、原因、位置；与 Muse 查表对照）+ 接线断言
 * 运行：npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideNextStep, type NextStepRule, type NextStepSnapshot } from "@/lib/muse-bridge/next-step";
import { applyNextStepToCommand, deriveProjectCommandState } from "@/components/project-detail/project-context-panel";
import { TENDER_DETAIL_TAB_KEYS, resolveTenderDetailTab } from "@/lib/tender/detail-tabs";
import { RFQ_ROUNDS_ANCHOR, rfqRoundAnchor } from "@/lib/tender-rfq/web-entry-pure";
import { isWebNextStepEnabledForOrgWithEnv } from "../flags";
import { APPROVAL_CENTER_HREF, NEXT_STEP_ANCHORS, nextStepHref, rfqRoundAnchorId, sameTarget, type WebNextStepTarget, type WebNextStepView } from "../targets";
import { decideWebNextStep, type WebNextStepInput } from "../web-next-step";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-11-11T15:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);
type Item = NonNullable<WebNextStepInput["latestRound"]>["items"][number];
const item = (id: string, status: string, o: Partial<Item> = {}): Item => ({ itemId: id, supplierName: `Supplier ${id}`, status, sentAt: status === "pending" ? null : ago(1), isSelected: false, hasThread: true, chasedAt: [], ...o });
const round = (items: Item[], replyBy: Date | null = null): WebNextStepInput["latestRound"] => ({ inquiryId: "inq1", replyBy, items });
/** 默认：分析已批准、有文件、20 天后截标、没有询价、没有投标价、有写权限、工作区未开启 */
const mk = (o: Partial<WebNextStepInput> = {}): WebNextStepInput => ({
  now: NOW, projectId: "p1", projectName: "示例标", closedLabelZh: null, closeDate: ahead(20), submittedAt: null,
  documentCount: 3, parsingActive: false, analysisStatus: "APPROVED", unknownCriticalFacts: 0, mandatoryNonCompliant: 0, pendingRequirementCount: 0,
  pendingApprovals: [], latestRound: null, hasProjectQuote: false, chaseAfterDays: 3, canManage: true, workspace: null, ...o,
});
/** 同一个状态交给 Muse 的查表（不带截标时间——网页把截标单独算） */
const tableOf = (i: WebNextStepInput) => {
  const s: NextStepSnapshot = {
    projectId: i.projectId, projectName: i.projectName, now: i.now, closeDate: null, submittedAt: i.submittedAt, analysisStatus: i.analysisStatus,
    unknownCriticalFacts: i.unknownCriticalFacts, mandatoryNonCompliant: i.mandatoryNonCompliant,
    pendingApprovals: i.pendingApprovals.map(({ id, title, createdAt }) => ({ id, title, createdAt })),
    latestRound: i.latestRound ? { inquiryId: i.latestRound.inquiryId, items: i.latestRound.items } : null,
    hasProjectQuote: i.hasProjectQuote, prefs: { defaultSupplierIds: [], chaseAfterDays: i.chaseAfterDays },
  };
  return decideNextStep(s);
};
const TAB = (tab: "workbench" | "requirements" | "bid" | "submission", anchor: string | null = null): WebNextStepTarget => ({ kind: "tab", tab, anchor });
const ANALYSIS = TAB("requirements", "tender-analysis");
const ROUND = TAB("bid", "rfq-round-inq1");
const card = (id: string, o: Partial<WebNextStepInput["pendingApprovals"][number]> = {}) => ({ id, title: `审批 ${id}`, createdAt: ago(1), type: "tender.send_rfq", inquiryId: "inq1", ...o });

/* ---------- 1. 与 Muse 的查表是同一张 ---------- */
console.log("共用的八种状态：与 Muse 的查表一致");
{
  const shared: Array<[NextStepRule, WebNextStepInput]> = [
    ["pending_approval", mk({ pendingApprovals: [card("a1")] })],
    ["analysis_running", mk({ analysisStatus: "ANALYZING" })],
    ["unknown_facts", mk({ analysisStatus: "REVIEW_REQUIRED", unknownCriticalFacts: 2 })],
    ["mandatory_gap", mk({ mandatoryNonCompliant: 1 })],
    ["no_rfq", mk()],
    ["no_reply", mk({ latestRound: round([item("a", "sent", { sentAt: ago(5) }), item("b", "quoted")]) })],
    ["quotes_ready", mk({ latestRound: round([item("a", "quoted"), item("b", "quoted")]) })],
    ["price_pending", mk({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) })],
  ];
  for (const [rule, input] of shared) {
    const table = tableOf(input);
    const web = decideWebNextStep(input);
    ok(`${rule}：网页的规则与查表相同，结论文字取自查表（「${table.advisory.conclusion}」）`, table.rule === rule && web.rule === rule && web.headlineZh === table.advisory.conclusion, { table: table.rule, web });
  }
  ok("确定性：同样的状态两次结果相同", JSON.stringify(decideWebNextStep(mk({ latestRound: round([item("a", "sent", { sentAt: ago(5) })]) }))) === JSON.stringify(decideWebNextStep(mk({ latestRound: round([item("a", "sent", { sentAt: ago(5) })]) }))));
}

/* ---------- 2. 网页补充的状态 ---------- */
console.log("查表没有覆盖的状态");
{
  const v = (o: Partial<WebNextStepInput>) => decideWebNextStep(mk(o));
  let r = v({ analysisStatus: null, documentCount: 0 });
  ok("没有文件：结论是还没上传，位置是文件抽屉", r.rule === "no_documents" && r.headlineZh === "还没上传招标文件" && sameTarget(r.action!.target, { kind: "files" }) && r.action!.labelZh === "上传招标文件", r);
  r = v({ analysisStatus: null, parsingActive: true });
  ok("文件在解析：照实说正在解析，没有要去的位置", r.rule === "parsing" && r.action === null);
  r = v({ analysisStatus: "FAILED" });
  ok("分析失败：去「招标要求」的招标分析重新发起", r.rule === "analysis_failed" && sameTarget(r.action!.target, ANALYSIS));
  r = v({ analysisStatus: null });
  ok("有文件、没分析：结论取自查表（招标文件还没分析），说明已上传几个文件，去招标分析", r.rule === "no_analysis" && r.headlineZh === "招标文件还没分析" && r.reasonsZh[0].includes("已上传 3 个文件") && sameTarget(r.action!.target, ANALYSIS), r);
  r = v({ analysisStatus: "ANALYZING" });
  ok("分析进行中：位置是招标分析（看进度）", r.rule === "analysis_running" && r.action!.labelZh === "看分析进度" && sameTarget(r.action!.target, ANALYSIS));

  // 查表缺的一步：分析完、等确认与批准
  const review = mk({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 7 });
  r = decideWebNextStep(review);
  ok("（前提）查表对「等待审核、关键事实齐全、没有询价」的回答是「还没问过供应商」", tableOf(review).rule === "no_rfq");
  ok("网页改为：等你确认要求并批准；位置是招标分析；不是去询价", r.rule === "requirements_review" && r.headlineZh === "分析完了，等你确认要求并批准" && sameTarget(r.action!.target, ANALYSIS) && r.action!.labelZh === "去确认并批准" && r.action!.labelZh !== "去问供应商要价", r);
  ok("原因写明还有几条待确认、批准之后才能询价", r.reasonsZh[0] === "还有 7 条要求待确认" && r.reasonsZh[1].includes("批准之后才能"));
  ok("要求都处理过了、只差批准：原因换一种说法", v({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 0 }).reasonsZh[0] === "要求都处理过了，还差「批准分析」");
  ok("等待审核时已经有人手工建了轮次并发出：主结论跟着询价走，分析没批准放在顺带要办的事里", (() => { const x = v({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 2, latestRound: round([item("a", "quoted"), item("b", "quoted")]) }); return x.rule === "quotes_ready" && x.also.some((a) => a.textZh === "招标分析还没批准（2 条要求待确认）" && sameTarget(a.target, ANALYSIS)); })());
  ok("等待审核、轮次里只有还没发出的草稿：仍然是等批准分析", v({ analysisStatus: "REVIEW_REQUIRED", latestRound: round([item("a", "pending")]) }).rule === "requirements_review");

  // 查表说「没有待办」的几种
  r = v({ latestRound: round([item("a", "sent"), item("b", "quoted"), item("c", "pending")]) });
  ok("已发出、有人还没到该催的时候：等回复，写明问了几家、几家已报、还等几家", r.rule === "waiting_replies" && r.headlineZh === "已问 2 家，1 家已报价，还在等 1 家" && r.reasonsZh[0] === "满 3 天没回，这里会提示" && sameTarget(r.action!.target, ROUND), r);
  r = v({ latestRound: round([item("a", "quoted"), item("b", "declined")]) });
  ok("只有 1 家报价、别家都有了结果：给选项（选定或再问），不是指令", r.rule === "single_quote" && r.reasonsZh[0].includes("选定这一家，或再问几家") && sameTarget(r.action!.target, ROUND), r);
  r = v({ latestRound: round([item("a", "declined"), item("b", "no_response")]) });
  ok("一轮没有拿到报价：再问一轮，位置是询价轮次", r.rule === "no_quotes" && sameTarget(r.action!.target, TAB("bid", "rfq-rounds")));
  r = v({ hasProjectQuote: true, latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) });
  ok("供应商定了、投标价也有了：准备提交，位置是「提交」页签（工作区未开启）", r.rule === "prepare_submission" && sameTarget(r.action!.target, TAB("submission")) && r.reasonsZh.length === 1, r);
  r = v({ hasProjectQuote: true });
  ok("没有询价、直接定了价：不再催着去询价，准备提交", r.rule === "prepare_submission");
  ok("有投标价但报价齐了还没选定：仍然先去比价（查表的顺序）", v({ hasProjectQuote: true, latestRound: round([item("a", "quoted"), item("b", "quoted")]) }).rule === "quotes_ready");
  r = v({ latestRound: round([item("a", "quoted", { isSelected: true })]), hasProjectQuote: false });
  ok("选定了唯一的一家、还没定价：去定投标价，位置是投标价", r.rule === "price_pending" && sameTarget(r.action!.target, TAB("bid", "bid-quote-area")));

  // 查表之前
  r = v({ submittedAt: ago(1), pendingApprovals: [card("a1")], latestRound: null });
  ok("已提交：结论是已提交、等结果；不再建议询价或批卡", r.rule === "submitted" && r.headlineZh === "已提交，等开标结果" && sameTarget(r.action!.target, TAB("submission")) && r.urgencyZh === null && r.also.length === 0, r);
  r = v({ closeDate: ago(0.5) });
  ok("截标已过、没有提交时间：照实说，位置是「提交」页签；不建议询价", r.rule === "past_closing" && r.headlineZh === "截标时间已过，没有提交记录" && r.reasonsZh.length === 2 && sameTarget(r.action!.target, TAB("submission")) && !JSON.stringify(r).includes("供应商"), r);
  r = v({ closedLabelZh: "未中标", closeDate: ago(30) });
  ok("项目已结束：只说已结束，没有要去的位置", r.rule === "closed" && r.headlineZh === "这个标已结束（未中标）" && r.action === null && r.reasonsZh.length === 0);
  ok("没有任何待办的兜底", (() => { const x = v({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]), hasProjectQuote: false }); return x.rule === "price_pending"; })() && v({ latestRound: round([item("a", "pending")]), analysisStatus: "APPROVED" }).rule === "no_rfq");
}

/* ---------- 3. 截标提醒不盖住下一步 ---------- */
console.log("截标提醒与下一步并存");
{
  const soon = mk({ closeDate: ahead(2) });
  ok("（前提）查表带着截标时间时，两天后截标会排在「还没询价」前面、只说截标", decideNextStep({ projectId: "p1", projectName: "示例标", now: NOW, closeDate: ahead(2), submittedAt: null, analysisStatus: "APPROVED", unknownCriticalFacts: 0, mandatoryNonCompliant: 0, pendingApprovals: [], latestRound: null, hasProjectQuote: false, prefs: { defaultSupplierIds: [], chaseAfterDays: 3 } }).rule === "deadline_soon");
  let r = decideWebNextStep(soon);
  ok("网页：两天后截标、还没询价 → 同时有提醒「2 天后截标，还没提交」与下一步「还没问过供应商」", r.urgencyZh === "2 天后截标，还没提交" && r.rule === "no_rfq" && r.headlineZh === "还没问过供应商" && !!r.action, r);
  r = decideWebNextStep(mk({ closeDate: ahead(0.2), pendingApprovals: [card("a1")] }));
  ok("约 5 小时后截标、又有卡等批：提醒与「有 1 条等你批」并存；不足一天按小时说（查表会说成「1 天后」）", r.urgencyZh === "约 5 小时后截标，还没提交" && r.rule === "pending_approval", r);
  ok("不到一小时：照实说；刚好满一天起用查表的原话", decideWebNextStep(mk({ closeDate: new Date(NOW.getTime() + 20 * 60_000) })).urgencyZh === "不到 1 小时后截标，还没提交" && decideWebNextStep(mk({ closeDate: ahead(1) })).urgencyZh === "1 天后截标，还没提交" && decideWebNextStep(mk({ closeDate: ahead(3) })).urgencyZh === "3 天后截标，还没提交" && decideWebNextStep(mk({ closeDate: ahead(3.1) })).urgencyZh === null);
  ok("四天后截标：没有提醒；截标时间照样给出（由页面按本地时区显示）", (() => { const x = decideWebNextStep(mk({ closeDate: ahead(4) })); return x.urgencyZh === null && x.closesAt === ahead(4).toISOString(); })());
  r = decideWebNextStep(mk({ closeDate: null }));
  ok("没有填截标时间：没有提醒，在顺带要办的事里提示", r.urgencyZh === null && r.closesAt === null && r.also.some((a) => a.textZh === "还没填截标时间" && sameTarget(a.target, TAB("workbench"))));
}

/* ---------- 4. 催单的口径 ---------- */
console.log("催单：天数由调用方按扫描的口径给；回复截止过了不提示催");
{
  const sent3 = [item("a", "sent", { sentAt: ago(3.5) }), item("b", "sent", { sentAt: ago(3.5), hasThread: false }), item("c", "quoted")];
  let r = decideWebNextStep(mk({ latestRound: round(sent3), chaseAfterDays: 3 }));
  ok("等了 3 天半、天数是 3：有 2 家没回；原因里写明哪几家、1 家没有邮件线程要手工联系、1 家会由定时检查起草催单", r.rule === "no_reply" && r.headlineZh === "2 家没回" && r.reasonsZh.length === 3 && r.reasonsZh[0].includes("Supplier a") && r.reasonsZh[1].includes("1 家没有邮件线程") && r.reasonsZh[2] === "定时检查会给其中 1 家起草催单，起草好了会在这里等你批" && sameTarget(r.action!.target, ROUND), r);
  ok("网页上没有起草催单的按钮：卡片的按钮只是「去看这一轮」，没有「催」", r.action!.labelZh === "去看这一轮" && !/催 \d+ 家/.test(JSON.stringify(r.action)));
  r = decideWebNextStep(mk({ latestRound: round(sent3), chaseAfterDays: 5 }));
  ok("同样的状态、天数是 5：还不到该催的时候，结论是在等回复（并写明满 5 天会提示）", r.rule === "waiting_replies" && r.reasonsZh[0] === "满 5 天没回，这里会提示", r);

  const longAgo = [item("a", "sent", { sentAt: ago(10) }), item("b", "sent", { sentAt: ago(10) })];
  r = decideWebNextStep(mk({ latestRound: round(longAgo, ago(2)) }));
  ok("回复截止日已过一天以上：不提示催，结论是截止已过、2 家没回，位置是这一轮", r.rule === "reply_deadline_passed" && r.headlineZh === "回复截止已过，2 家没回" && r.reasonsZh[0] === "系统不会再催这一轮" && !JSON.stringify(r.reasonsZh).includes("起草催单") && sameTarget(r.action!.target, ROUND), r);
  ok("回复截止日是今天（还没过完）：照常提示没回", decideWebNextStep(mk({ latestRound: round(longAgo, new Date("2026-11-11T00:00:00Z")) })).rule === "no_reply");
  ok("没有填回复截止：照常提示没回", decideWebNextStep(mk({ latestRound: round(longAgo, null) })).rule === "no_reply");
  r = decideWebNextStep(mk({ latestRound: round([...longAgo, item("c", "quoted"), item("d", "quoted")], ago(2)) }));
  ok("截止已过、但已有 2 家报价：下一步是比价，原因里带一句截止已过、2 家没回", r.rule === "quotes_ready" && r.reasonsZh.some((x) => x === "回复截止已过，2 家没回（系统不会再催）") && r.action!.labelZh === "去比价并选定", r);
  r = decideWebNextStep(mk({ latestRound: round([...longAgo, item("c", "quoted", { isSelected: true })], ago(2)) }));
  ok("截止已过、已选定一家、还没定价：下一步是定投标价", r.rule === "price_pending" && r.reasonsZh.some((x) => x.includes("回复截止已过")));
  ok("已经催满两次的不再提示催（与扫描相同的上限，来自查表）", decideWebNextStep(mk({ latestRound: round([item("a", "sent", { sentAt: ago(20), chasedAt: [ago(12), ago(6)] })]) })).rule === "waiting_replies");
}

/* ---------- 5. 等批准的动作 ---------- */
console.log("等批准的动作指到哪里");
{
  let r = decideWebNextStep(mk({ pendingApprovals: [card("late", { createdAt: ago(1), inquiryId: "inqB" }), card("early", { createdAt: ago(3), inquiryId: "inqA", title: "第 1 轮询价（3 家）" })] }));
  ok("两条待批：写明条数与最早一条的标题；位置是最早那条所在的那一轮", r.rule === "pending_approval" && r.headlineZh === "有 2 条等你批" && r.reasonsZh[0] === "最早一条：第 1 轮询价（3 家）" && sameTarget(r.action!.target, TAB("bid", "rfq-round-inqA")), r);
  ok("原因写明批准之前不会发出任何东西；按钮是去看并决定，不是「批准」", r.reasonsZh[1].includes("批准之前不会发出任何东西") && r.action!.labelZh === "去看这一条并决定" && !/^批准/.test(r.action!.labelZh));
  r = decideWebNextStep(mk({ pendingApprovals: [card("c1", { type: "tender.send_chase", inquiryId: "inq9" })] }));
  ok("催单的卡：同样指到它所在的那一轮", sameTarget(r.action!.target, TAB("bid", "rfq-round-inq9")));
  r = decideWebNextStep(mk({ pendingApprovals: [card("x1", { type: "sales.send_quote", inquiryId: null })] }));
  ok("别的类型的审批：位置是审批中心", r.action!.target.kind === "href" && (r.action!.target as { href: string }).href === APPROVAL_CENTER_HREF && r.action!.labelZh === "去审批中心");
  r = decideWebNextStep(mk({ pendingApprovals: [card("x3", { type: "sales.send_quote", inquiryId: "inq1" })] }));
  ok("别的类型的审批即使带着一个轮次号，也去审批中心（那一轮里没有它的批准按钮）", r.action!.target.kind === "href");
  r = decideWebNextStep(mk({ pendingApprovals: [card("x2", { inquiryId: null })] }));
  ok("询价的卡但读不到是哪一轮：位置是审批中心（不猜）", r.action!.target.kind === "href");
}

/* ---------- 6. 位置与网址 ---------- */
console.log("位置");
{
  const places: Array<[string, WebNextStepInput, WebNextStepTarget]> = [
    ["没传文件 → 文件抽屉", mk({ analysisStatus: null, documentCount: 0 }), { kind: "files" }],
    ["分析完等批准 → 「招标要求」的招标分析", mk({ analysisStatus: "REVIEW_REQUIRED" }), ANALYSIS],
    ["还没询价 → 「标书与报价」的询价轮次", mk(), TAB("bid", "rfq-rounds")],
    ["报价齐了 → 那一轮询价", mk({ latestRound: round([item("a", "quoted"), item("b", "quoted")]) }), ROUND],
    ["定了供应商没定价 → 「标书与报价」的投标价", mk({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) }), TAB("bid", "bid-quote-area")],
  ];
  for (const [name, input, want] of places) ok(name, sameTarget(decideWebNextStep(input).action!.target, want), decideWebNextStep(input).action);

  ok("位置换成网址：页签带页内位置、文件抽屉用页面认得的别名、审批中心原样", nextStepHref("p1", ANALYSIS) === "/projects/p1?tab=requirements#tender-analysis" && nextStepHref("p1", TAB("submission")) === "/projects/p1?tab=submission" && nextStepHref("p1", { kind: "files" }) === "/projects/p1?tab=files" && nextStepHref("p1", { kind: "href", href: APPROVAL_CENTER_HREF }) === "/capabilities/approvals" && nextStepHref("a/b", TAB("bid", "x y")) === "/projects/a%2Fb?tab=bid#x%20y");
  ok("页面认得这些页签与别名（?tab=files 会打开文件抽屉）", (["workbench", "requirements", "bid", "submission"] as const).every((t) => (TENDER_DETAIL_TAB_KEYS as readonly string[]).includes(t)) && resolveTenderDetailTab("files")?.openFiles === true);
  ok("询价的两个页内位置与询价区块自己用的是同一个写法", `#${NEXT_STEP_ANCHORS.rfqRounds}` === RFQ_ROUNDS_ANCHOR && `#${rfqRoundAnchorId("abc")}` === rfqRoundAnchor("abc"));
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  ok("页面上确实有这几个位置：招标分析、询价轮次、某一轮、投标价、投标工作区", read("src/components/tender-analysis/analysis-panel.tsx").includes('id="tender-analysis"') && read("src/components/inquiry/project-inquiry-section.tsx").includes('id="rfq-rounds"') && read("src/components/inquiry/project-inquiry-section.tsx").includes("rfq-round-") && read("src/components/project-detail/tabs/bid-tab.tsx").includes('<div id="bid-quote-area"') && read("src/components/tender/bid-workspace-panel.tsx").includes('id="bid-workspace"'));
}

/* ---------- 7. 只读成员 ---------- */
console.log("没有写权限的人");
{
  let r = decideWebNextStep(mk({ canManage: false }));
  ok("这一步需要写权限：说明要由项目负责人来做", r.rule === "no_rfq" && r.reasonsZh[r.reasonsZh.length - 1] === "你在这个项目里没有修改权限，这一步要项目负责人来做", r);
  r = decideWebNextStep(mk({ canManage: false, latestRound: round([item("a", "sent", { sentAt: ago(9) }), item("b", "sent", { sentAt: ago(9), hasThread: false })]) }));
  ok("不需要写权限的状态（等回复、没回、正在分析）不加这一句", !JSON.stringify(r).includes("没有修改权限") && !JSON.stringify(decideWebNextStep(mk({ canManage: false, analysisStatus: "ANALYZING" }))).includes("没有修改权限"));
  r = decideWebNextStep(mk({ canManage: false, hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: [{ code: "DIMENSION_MISMATCH", messageZh: "第 3 行尺寸不符" }, { code: "CERTIFICATION_BLOCKED", messageZh: "第 5 行认证不全" }] } }));
  ok("原因最多三条：满了的时候最后一条换成权限说明", r.reasonsZh.length === 3 && r.reasonsZh[2].includes("没有修改权限"), r);
}

/* ---------- 8. 投标工作区 ---------- */
console.log("投标工作区的阻断项与价格表");
{
  const blockers = [
    { code: "COST_MISSING", messageZh: "成本还没核算" },
    { code: "DIMENSION_MISMATCH", messageZh: "第 3 行尺寸不符" },
    { code: "CERTIFICATION_BLOCKED", messageZh: "第 5 行认证不全" },
    { code: "STALE_AFTER_ADDENDUM", messageZh: "第 2 行补遗之后需要复核" },
    { code: "COST_INCOMPLETE", messageZh: "第 1 行成本不全" },
  ];
  let r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers } }));
  ok("已有投标价、工作区开启、有阻断项：列出非成本的 3 个里的前两条与总数，位置是投标工作区", r.rule === "prepare_submission" && r.headlineZh === "投标价已有，提交前还有阻断项" && r.reasonsZh[0].startsWith("投标工作区还有 3 个阻断项") && r.reasonsZh[1] === "第 3 行尺寸不符" && r.reasonsZh[2] === "第 5 行认证不全" && sameTarget(r.action!.target, TAB("bid", "bid-workspace")), r);
  ok("成本类的阻断项不列（服务端看不到成本输入），并照实说明", !JSON.stringify(r).includes("成本还没核算") && !JSON.stringify(r).includes("成本不全") && r.reasonsZh[0].includes("成本核算只存在你的浏览器里，这里看不到"));
  r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: blockers.filter((b) => b.code.startsWith("COST")) } }));
  ok("只剩成本类的阻断项：不说「有阻断项」，位置是「提交」页签，仍说明成本这里看不到", r.headlineZh === "投标价已有，准备提交" && sameTarget(r.action!.target, TAB("submission")) && r.reasonsZh[0].includes("这里看不到"), r);
  r = decideWebNextStep(mk({ workspace: { hasPriceSchedule: false, blockers } }));
  ok("分析已批准、价格表还没录：顺带提示可以从招标分析带入，位置是投标工作区；主结论不变", r.rule === "no_rfq" && r.also.some((a) => a.textZh === "价格表还没录，可以从招标分析带入" && sameTarget(a.target, TAB("bid", "bid-workspace"))), r);
  ok("还没分析时不提价格表", !decideWebNextStep(mk({ analysisStatus: null, workspace: { hasPriceSchedule: false, blockers: [] } })).also.some((a) => a.textZh.includes("价格表")));
  r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: null }));
  ok("工作区未开启：不出现阻断项与价格表提示", !JSON.stringify(r).includes("阻断") && !JSON.stringify(r).includes("价格表") && !JSON.stringify(decideWebNextStep(mk({ workspace: null }))).includes("价格表"));
  r = decideWebNextStep(mk({ analysisStatus: "REVIEW_REQUIRED", closeDate: null, latestRound: round([item("a", "quoted"), item("b", "quoted")]), workspace: { hasPriceSchedule: false, blockers: [] } }));
  ok("顺带要办的事最多三条", r.also.length === 3 && r.also.map((a) => a.textZh).join("|") === "招标分析还没批准|价格表还没录，可以从招标分析带入|还没填截标时间", r.also);
}

/* ---------- 9. 结果的形状 ---------- */
console.log("结果里有什么、没有什么");
{
  const all: WebNextStepView[] = [
    decideWebNextStep(mk()),
    decideWebNextStep(mk({ pendingApprovals: [card("a1")] })),
    decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: [{ code: "DIMENSION_MISMATCH", messageZh: "第 3 行尺寸不符" }] } })),
    decideWebNextStep(mk({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) })),
  ];
  ok("只有这七个字段；没有价格、毛利、估值之类的字段", all.every((x) => Object.keys(x).sort().join() === "action,also,closesAt,headlineZh,reasonsZh,rule,urgencyZh"));
  ok("原因不超过三条，顺带要办的事不超过三条", all.every((x) => x.reasonsZh.length <= 3 && x.also.length <= 3));
  ok("文字里没有金额（货币符号、「元」、百分号）", all.every((x) => !/[$¥€£%]|\d\s*元|CAD|USD/.test(JSON.stringify([x.headlineZh, x.reasonsZh, x.also, x.action?.labelZh]))));
  ok("按钮的文字都是「去…」「看…」「上传…」「再问…」这类导航的说法，没有「批准」「发送」「提交投标」", all.concat([decideWebNextStep(mk({ analysisStatus: null, documentCount: 0 })), decideWebNextStep(mk({ latestRound: round([item("a", "declined")]) }))]).every((x) => !x.action || (/^(去|看|上传|再问)/.test(x.action.labelZh) && !/^(批准|发送|提交投标|催)/.test(x.action.labelZh))));
}

/* ---------- 10. 开关 ---------- */
console.log("开关");
{
  const on = (env: Record<string, string>, org: string | null = "org1") => isWebNextStepEnabledForOrgWithEnv(org, env as NodeJS.ProcessEnv);
  ok("默认关；只有明确的真值才开", !on({}) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "0" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "false" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "" }) && on({ TENDER_WEB_NEXT_STEP_ENABLED: "1" }) && on({ TENDER_WEB_NEXT_STEP_ENABLED: "true" }));
  ok("白名单为空 = 所有组织；不为空 = 只有名单里的；没有组织 = 关", on({ TENDER_WEB_NEXT_STEP_ENABLED: "1", TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST: "" }) && on({ TENDER_WEB_NEXT_STEP_ENABLED: "1", TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST: "orgX, org1" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "1", TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST: "orgX" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "1" }, null));
}

/* ---------- 11. 决策摘要跟随 ---------- */
console.log("决策摘要跟着「下一步」说");
{
  const base = deriveProjectCommandState({ status: "active", stage: "supplier_inquiry", orgBound: true, documentCount: 3, closeDate: "2026-12-01", riskLevel: null, riskLabel: null, isOverdue: false, completedTasks: 0, totalTasks: 2, pendingCount: 0, hasIntelligence: false, analysisPhase: "approved", parsingActive: false });
  const view = decideWebNextStep(mk());
  const merged = applyNextStepToCommand(base, view);
  ok("（前提）没有「下一步」时，决策摘要自己给了一个按钮（跟进供应商报价）", base.nextAction?.label === "跟进供应商报价");
  ok("有了之后：摘要显示同一条结论，不再有另一个按钮", merged.nextAction === null && merged.recommendation.title === "还没问过供应商" && merged.recommendation.body === view.reasonsZh[0]);
  ok("摘要的其它内容（阶段、风险、缺失项）不变", merged.stageLabel === base.stageLabel && merged.risks === base.risks && merged.missingItems === base.missingItems && merged.statusLabel === base.statusLabel);
  ok("原始的摘要对象没有被改动", base.nextAction?.label === "跟进供应商报价");
}

/* ---------- 12. 接线（源码断言） ---------- */
console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const pure = read("src/lib/tender-next-step/web-next-step.ts");
  const targets = read("src/lib/tender-next-step/targets.ts");
  const service = read("src/lib/tender-next-step/service.ts");
  const route = read("src/app/api/projects/[id]/next-step/route.ts");
  const cardSrc = read("src/components/project-detail/next-step-card.tsx");
  const page = read("src/app/(main)/projects/[id]/page.tsx");
  const tabSrc = read("src/components/project-detail/tabs/workbench-tab.tsx");
  const muse = read("src/lib/muse-bridge/next-step.ts");

  ok("判断调用 Muse 的同一个查表函数，不另写阈值（没有自己的天数常量、不重新实现「没回」的判断）", /import \{ decideNextStep, [^}]*\} from "@\/lib\/muse-bridge\/next-step";/.test(pure) && (pure.match(/decideNextStep\(/g) ?? []).length >= 3 && !/86_?400_?000|DEADLINE_WARN|DAY\b\s*=|WARN_DAYS|<= 3\b/.test(pure) && !/chasedAt\?*\.length|lastContact/.test(pure));
  ok("Muse 的查表文件没有引用网页这边的任何东西（没有反向依赖）", !/tender-next-step/.test(muse));
  ok("判断与位置两个文件是纯的：不访问数据库、不发请求、不调模型", [pure, targets].every((src) => !/@\/lib\/db|prisma|fetch\(|openai|anthropic|createCompletion/i.test(src)) && !/^import /m.test(targets));
  ok("接口：只有 GET；项目读权限；开关关闭、没有组织、不是招投标项目 → 404；组织取自项目记录", /export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route) && route.includes("requireProjectReadAccess(request, projectId)") && route.includes('if (!orgId || !isWebNextStepEnabledForOrg(orgId) || project.workDomain !== "tender")') && route.includes("status: 404") && route.includes("const orgId = project.orgId;"));
  ok("取数：只读，没有任何写库、建审批、发信、写审计的调用", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$transaction)\(/.test(service) && !/requestApproval|writeAuditLog|logAudit|sendMail|sendEmail|markItemNoResponse/.test(service));
  ok("取数：分析按项目与组织；最新一轮按项目与组织、不算已取消的；待批用「待我确认」的同一组条件再加项目、待批、未过期", service.includes("where: { projectId, orgId },") && service.includes('where: { projectId, project: { orgId }, status: { not: "canceled" } },') && service.includes("loadPendingMineWhere(input.userId, orgId)") && service.includes('where: { AND: [pendingWhere, { projectId, status: "pending", expiresAt: { gt: now } }] },'));
  ok("取数：等待天数用催单扫描自己的函数（授权里定格的 > 项目负责人的偏好 > 组织设置）", service.includes('import { loadFollowUpRoundState, roundPolicyInEffect } from "@/lib/tender-rfq/chase-service";') && service.includes("roundPolicy ? roundPolicy.chaseAfterDays : resolveChaseAfterDays(readUserPrefs(orgSettingsJson, project.ownerId).chaseAfterDays, orgSettingsJson)"));
  ok("取数：投标工作区只在该组织开启时才算，用它读取接口的同一组函数", service.includes("isBidWorkspaceEnabledForOrg(orgId)") && service.includes("buildWorkspaceView(stored, ctx)"));

  // 卡片只指路
  ok("卡片不请求任何接口、不带任何执行动作：没有 fetch / apiFetch / apiJson，没有 method", !/fetch\(|apiFetch|apiJson|method\s*:/.test(cardSrc));
  ok("卡片上的每个链接只做一件事：调用页面给的导航函数（带修饰键时让浏览器按网址走）", (cardSrc.match(/onClick=\{open\(/g) ?? []).length === 2 && (cardSrc.match(/onClick=/g) ?? []).length === 2 && /e\.preventDefault\(\);\s*onOpen\(target\);/.test(cardSrc) && (cardSrc.match(/href=\{nextStepHref\(projectId, /g) ?? []).length === 2);
  ok("卡片的测试标记齐全", ["next-step-card", "next-step-headline", "next-step-reasons", "next-step-action", "next-step-urgency", "next-step-closing", "next-step-also"].every((id) => cardSrc.includes(`data-testid="${id}"`)) && cardSrc.includes("data-rule={view.rule}"));

  const navStart = page.indexOf("const openNextStepTarget = useCallback(");
  const nav = page.slice(navStart, page.indexOf("const openProjectArea = useCallback("));
  ok("（前提）取到了页面上导航的那段代码", navStart > 0 && nav.includes("scrollToProjectAnchor(target.anchor)"));
  ok("页面的导航只做四件事：开文件抽屉、跳转、切页签、滚动；不请求任何接口、不点任何按钮", !/fetch\(|apiFetch|apiJson|\.click\(\)|method\s*:|dispatchEvent\(new (?!HashChangeEvent)/.test(nav) && nav.includes("setFilesOpen(true)") && nav.includes("router.push(target.href)") && nav.includes("setActiveTab(target.tab)"));
  const scrollFn = page.slice(page.indexOf("function scrollToProjectAnchor("), page.indexOf("function ", page.indexOf("function scrollToProjectAnchor(") + 10));
  ok("滚动到页内位置的函数只滚动（不点、不改任何东西），找不到会停", scrollFn.includes("scrollIntoView") && scrollFn.includes("tries >= 40") && !/\.click\(|fetch\(|innerHTML|\.value\s*=/.test(scrollFn));
  const loadStart = page.indexOf("const loadNextStep = useCallback(");
  const loader = page.slice(loadStart, page.indexOf("// 打开工作台、回到工作台、分析状态变了：重新取"));
  ok("页面取数是一个不带 method 的读取；404 之后不再请求；取不到就不显示卡片", loadStart > 0 && loader.includes("await apiFetch(`/api/projects/${id}/next-step`)") && !/method\s*:/.test(loader) && loader.includes("if (res.status === 404) nextStepOff.current = true;") && loader.includes("if (!id || nextStepOff.current) return;") && loader.includes("setNextStep(null)"));
  ok("审批变化、项目更新、回到工作台、分析状态变化时重新取", page.includes('window.addEventListener("pending-actions-changed", refresh);') && page.includes('window.addEventListener("qingyan:project-updated", onProject);') && page.includes('if (activeTab === "workbench") void loadNextStep();') && page.includes("[activeTab, analysisRunStatus, loadNextStep]"));
  ok("卡片只在招投标项目、且接口给了结果时渲染；放在工作台页签最上面", tabSrc.includes("{tenderish && nextStep && onOpenNextStep ? (") && tabSrc.indexOf("<NextStepCard") > 0 && tabSrc.indexOf("<NextStepCard") < tabSrc.indexOf("<ProjectCommandOverview"));
  ok("页面把同一个结果交给决策摘要（有结果时跟随，没有时照旧）", page.includes("(nextStep ? applyNextStepToCommand(baseCommand, nextStep) : baseCommand)") && page.includes("nextStep={nextStep}") && page.includes("onOpenNextStep={openNextStepTarget}"));
}

console.log(`\n✓ web-next-step: ${passed} 项断言全部通过`);
