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
import { rfqRoundAnchor } from "@/lib/tender-rfq/web-entry-pure";
import { isWebNextStepEnabledForOrgWithEnv } from "../flags";
import { APPROVAL_CENTER_HREF, NEXT_STEP_ANCHORS, nextStepHref, rfqRoundAnchorId, sameTarget, withoutMoney, type WebNextStepRule, type WebNextStepTarget, type WebNextStepView } from "../targets";
import { NEEDS_WRITE, RFQ_ENTRY_RULES, decideWebNextStep, type WebNextStepInput } from "../web-next-step";

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
/** 默认：分析已批准（5 条要求已确认）、有文件、20 天后截标、没有询价、没有投标价、有写权限、工作区未开启 */
const mk = (o: Partial<WebNextStepInput> = {}): WebNextStepInput => ({
  now: NOW, projectId: "p1", projectName: "示例标", closedLabelZh: null, won: false, closeDate: ahead(20), submittedAt: null,
  documentCount: 3, parsingActive: false, analysisStatus: "APPROVED", latestAnalysisFailed: false, unknownCriticalFacts: 0, mandatoryNonCompliant: 0,
  pendingRequirementCount: 0, confirmedRequirementCount: 5,
  pendingApprovals: [], latestRound: null, hasProjectQuote: false, hasUsableAnalysis: true, anySent: false, anyQuoted: false, chaseAfterDays: 3, canManage: true, workspace: null, rfqEntry: null, ...o,
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
  r = v({ analysisStatus: null, latestRound: round([item("a", "quoted"), item("b", "quoted")]) });
  ok("没有分析但询价已经在走（老项目、或有人直接手工做了）：跟着实际进度说（报价齐了），分析的事放在顺带要办的事里——不卡在「去分析」上", r.rule === "quotes_ready" && r.also[0].textZh === "招标文件还没分析" && sameTarget(r.also[0].target, ANALYSIS), r);
  ok("没有分析但已经定了价：同样不卡在分析上", v({ analysisStatus: "FAILED", hasProjectQuote: true }).rule === "prepare_submission" && v({ analysisStatus: "FAILED", hasProjectQuote: true }).also[0].textZh === "招标文件上次分析失败了");
  ok("最近一次重新分析失败、现在用的是之前那一份：主结论照之前那份走，顺带提示", (() => { const x = v({ latestAnalysisFailed: true }); return x.rule === "no_rfq" && x.also.some((a) => a.textZh === "最近一次重新分析失败了，现在用的是之前那一份"); })());

  // 查表缺的一步：分析完、等确认与批准
  const review = mk({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 7, confirmedRequirementCount: 0 });
  r = decideWebNextStep(review);
  ok("（前提）查表对「等待审核、关键事实齐全、没有询价」的回答是「还没问过供应商」", tableOf(review).rule === "no_rfq");
  ok("网页改为：等你确认要求并批准；位置是招标分析；不是去询价", r.rule === "requirements_review" && r.headlineZh === "分析完了，等你确认要求并批准" && sameTarget(r.action!.target, ANALYSIS) && r.action!.labelZh === "去确认并批准", r);
  ok("一条都没确认：写明还有几条待确认（批准后不能再确认），以及至少确认一条才能问供应商要价", r.reasonsZh[0] === "还有 7 条要求待确认：批准后不能再确认，没确认的不会进询价单" && r.reasonsZh[1] === "至少确认一条，才能从页面上问供应商要价" && r.also.length === 0, r);
  r = v({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 4, confirmedRequirementCount: 3 });
  ok("已经确认了 3 条、还有 4 条：不说「批准之后才能询价」（页面上的询价入口看的是已确认的要求，不是批准）；顺带提示可以先去询价", r.reasonsZh[1] === "已确认的 3 条已经可以用来问供应商要价" && !JSON.stringify(r).includes("批准之后才能") && r.also.some((a) => a.textZh === "已确认的要求可以先拿去问供应商要价" && sameTarget(a.target, TAB("bid", "rfq-section"))), r);
  r = v({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 0, confirmedRequirementCount: 6 });
  ok("要求都处理过了、只差批准：标题与原因换一种说法", r.headlineZh === "要求都处理过了，还差「批准分析」" && r.reasonsZh[0] === "批准之后这份分析才算定下来", r);
  ok("等待审核时已经有人手工建了轮次并发出：主结论跟着询价走，分析没批准放在顺带要办的事里", (() => { const x = v({ analysisStatus: "REVIEW_REQUIRED", pendingRequirementCount: 2, latestRound: round([item("a", "quoted"), item("b", "quoted")]) }); return x.rule === "quotes_ready" && x.also.some((a) => a.textZh === "招标分析还没批准（2 条要求待确认）" && sameTarget(a.target, ANALYSIS)); })());
  ok("分析已批准时，顺带要办的事里没有「分析还没批准」", !JSON.stringify(v({ latestRound: round([item("a", "quoted"), item("b", "quoted")]) }).also).includes("还没批准") && !JSON.stringify(v({}).also).includes("还没批准"));
  ok("等待审核、轮次里只有还没发出的草稿：仍然是等批准分析", v({ analysisStatus: "REVIEW_REQUIRED", latestRound: round([item("a", "pending")]) }).rule === "requirements_review");
  r = v({ confirmedRequirementCount: 0 });
  ok("分析已批准、却没有一条已确认的要求：照实说询价入口用不了、批准后不能再确认，给两条出路（重新分析 / 手工建一轮）；不说「去问供应商要价」", r.rule === "no_confirmed_requirements" && r.headlineZh === "分析已批准，但没有已确认的要求" && sameTarget(r.action!.target, ANALYSIS) && r.reasonsZh[1].includes("手工建一轮") && r.also.some((a) => sameTarget(a.target, TAB("bid", "rfq-section"))), r);

  // 询价入口
  r = v({});
  ok("还没询价、入口的状态还没取：只说去供应商询价，能不能直接发那里会写明——不替入口打包票", r.rule === "no_rfq" && r.action!.labelZh === "去供应商询价" && sameTarget(r.action!.target, TAB("bid", "rfq-section")) && r.reasonsZh[0] === "到供应商询价：能直接发就点「问供应商要价」；不能发时那里会写明原因", r);
  r = v({ rfqEntry: { enabled: true, messageZh: "" } });
  ok("入口能用：说明点「问供应商要价」，发出前要你批准", r.reasonsZh[0] === "点「问供应商要价」：按已确认的要求起草，发出前要你批准" && r.reasonsZh.length === 1);
  r = v({ rfqEntry: { enabled: false, messageZh: "还没有连接发信邮箱。" } });
  ok("入口不能用（比如没连发信邮箱）：把入口自己给的原因写出来，并提示可以手工建一轮", r.rule === "no_rfq" && r.reasonsZh[0] === "「问供应商要价」现在还不能用：还没有连接发信邮箱。" && r.reasonsZh[1] === "那里也可以手工建一轮", r);
  ok("入口给的原因里如果带金额：整段换掉", v({ rfqEntry: { enabled: false, messageZh: "报价 $12,000 已超预算" } }).reasonsZh[0] === "「问供应商要价」现在还不能用：原因写在供应商询价那里");
  ok("哪些规则需要去读入口的状态：还没询价、一轮没拿到报价", [...RFQ_ENTRY_RULES].sort().join() === "no_quotes,no_rfq");

  // 查表说「没有待办」的几种
  r = v({ latestRound: round([item("a", "sent"), item("b", "quoted"), item("c", "pending")]) });
  ok("已发出、有人还没到该催的时候：等回复，写明问了几家、几家已报、还等几家", r.rule === "waiting_replies" && r.headlineZh === "已问 2 家，1 家已报价，还在等 1 家" && r.reasonsZh[0] === "满 3 天没回，这里会提示" && sameTarget(r.action!.target, ROUND), r);
  r = v({ latestRound: round([item("a", "sent", { sentAt: ago(20), chasedAt: [ago(12), ago(6)] })]) });
  ok("等的那一家已经催过两次：不说「满 N 天会提示」，说再没有回复会被标成未响应", r.rule === "waiting_replies" && r.reasonsZh[0] === "都已经催过两次；再没有回复会被标成未响应", r);
  r = v({ latestRound: round([item("a", "replied"), item("b", "replied"), item("c", "sent")]) });
  ok("两家已回复、报价还没录入：先去录入（不说成「没有拿到报价」，也不只说在等）", r.rule === "replies_to_record" && r.headlineZh === "2 家已回复，报价还没录入" && sameTarget(r.action!.target, ROUND), r);
  ok("一家回复、一家谢绝：同样是去录入", v({ latestRound: round([item("a", "replied"), item("b", "declined")]) }).rule === "replies_to_record");
  r = v({ latestRound: round([item("a", "quoted"), item("b", "declined")]) });
  ok("只有 1 家报价、别家都有了结果：给选项（选定或再问），不是指令", r.rule === "single_quote" && r.reasonsZh[0].includes("选定这一家，或再问几家") && sameTarget(r.action!.target, ROUND), r);
  r = v({ latestRound: round([item("a", "declined"), item("b", "no_response")]) });
  ok("一轮没有拿到报价（都谢绝或未响应）：去供应商询价；入口状态没取时不承诺能再发", r.rule === "no_quotes" && r.action!.labelZh === "去供应商询价" && sameTarget(r.action!.target, TAB("bid", "rfq-section")) && r.reasonsZh[0] === "问过的供应商都没有报价或已谢绝", r);
  r = v({ latestRound: round([item("a", "declined")]), rfqEntry: { enabled: false, messageZh: "这一轮发出还不到 3 天，暂时不开新一轮。" } });
  ok("一轮没拿到报价、而入口因为「3 天内不开新轮」锁着：把这个原因写出来，不说「再问一轮」", r.rule === "no_quotes" && r.reasonsZh[1] === "「问供应商要价」现在还不能用：这一轮发出还不到 3 天，暂时不开新一轮。" && !JSON.stringify(r).includes("再问一轮"), r);
  r = v({ latestRound: round([item("a", "weird_status"), item("b", "declined")]) });
  ok("认不出的状态：不猜（不说成没有拿到报价），带人去看这一轮", r.rule === "idle" && r.headlineZh === "询价这一轮需要你看一下" && sameTarget(r.action!.target, ROUND), r);
  r = v({ hasProjectQuote: true, latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) });
  ok("供应商定了、投标价也有了：准备提交，位置是「提交」页签（工作区未开启）", r.rule === "prepare_submission" && sameTarget(r.action!.target, TAB("submission")) && r.reasonsZh.length === 1, r);
  ok("没有询价、直接定了价：不再催着去询价，准备提交", v({ hasProjectQuote: true }).rule === "prepare_submission");
  ok("有投标价但报价齐了还没选定：仍然先去比价（查表的顺序）", v({ hasProjectQuote: true, latestRound: round([item("a", "quoted"), item("b", "quoted")]) }).rule === "quotes_ready");
  r = v({ latestRound: round([item("a", "quoted", { isSelected: true })]), hasProjectQuote: false });
  ok("选定了唯一的一家、还没定价：去定投标价，位置是投标价", r.rule === "price_pending" && sameTarget(r.action!.target, TAB("bid", "bid-quote-area")));
  r = v({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "sent", { sentAt: ago(9) })]) });
  ok("（前提）查表：已经选定了一家、另一家很久没回 → 它说的是「1 家没回」", tableOf(mk({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "sent", { sentAt: ago(9) })]) })).rule === "no_reply");
  ok("网页：已经选定了，没回的那家不再挡路——下一步是定投标价，原因里带一句另有 1 家没回", r.rule === "price_pending" && r.reasonsZh.some((x) => x === "另有 1 家没回"), r);
  r = v({ hasProjectQuote: true, latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "sent", { sentAt: ago(9) })]) });
  ok("选定了、也定了价、另一家没回：准备提交", r.rule === "prepare_submission" && r.reasonsZh.some((x) => x === "另有 1 家没回"), r);

  // 查表之前
  r = v({ submittedAt: ago(1), pendingApprovals: [card("a1")], latestRound: null });
  ok("已提交：结论是已提交、等结果；不再建议询价；还有审批没处理的在顺带要办的事里提一句", r.rule === "submitted" && r.headlineZh === "已提交，等开标结果" && sameTarget(r.action!.target, TAB("submission")) && r.urgencyZh === null && r.also.length === 1 && r.also[0].textZh === "还有 1 条审批等你处理" && r.also[0].target.kind === "href", r);
  r = v({ closeDate: ago(1.5), pendingApprovals: [card("a1"), card("a2")] });
  ok("截标日期过了一天以上、没有提交时间：照实说；位置是工作台的关键日期（那里才能改）；不建议询价；待批的不丢", r.rule === "past_closing" && r.headlineZh === "截标日期已过，没有提交记录" && r.reasonsZh.length === 2 && r.reasonsZh[0].includes("补遗延期") && sameTarget(r.action!.target, TAB("workbench", "project-key-dates")) && r.also[0].textZh === "还有 2 条审批等你处理" && !JSON.stringify(r.reasonsZh).includes("供应商"), r);
  r = v({ closeDate: ago(0.4) });
  ok("截标时间刚过、还在一天之内（手工填的截标时间只有日期，存成当天中午）：不下「已过」的结论，照常给下一步，并提醒", r.rule === "no_rfq" && r.urgencyZh === "截标时间到了或刚过，还没有提交记录", r);
  r = v({ closedLabelZh: "未中标", closeDate: ago(30) });
  ok("项目已结束：只说已结束，没有要去的位置", r.rule === "closed" && r.headlineZh === "这个标已结束（未中标）" && r.action === null && r.reasonsZh.length === 0);
  r = v({ won: true, closeDate: ago(30) });
  ok("已中标：说已中标、后面是交接与履约（不说成「已结束」）", r.rule === "won" && r.headlineZh === "这个标已中标" && r.action === null && r.reasonsZh[0].includes("交接"));
}

/* ---------- 3. 截标提醒不盖住下一步 ---------- */
console.log("截标提醒与下一步并存");
{
  const soon = mk({ closeDate: ahead(2) });
  ok("（前提）查表带着截标时间时，两天后截标会排在「还没询价」前面、只说截标", decideNextStep({ projectId: "p1", projectName: "示例标", now: NOW, closeDate: ahead(2), submittedAt: null, analysisStatus: "APPROVED", unknownCriticalFacts: 0, mandatoryNonCompliant: 0, pendingApprovals: [], latestRound: null, hasProjectQuote: false, prefs: { defaultSupplierIds: [], chaseAfterDays: 3 } }).rule === "deadline_soon");
  let r = decideWebNextStep(soon);
  ok("网页：两天后截标、还没询价 → 同时有提醒「2 天后截标，还没提交」与下一步「还没问过供应商」", r.urgencyZh === "2 天后截标，还没提交" && r.rule === "no_rfq" && r.headlineZh === "还没问过供应商" && !!r.action, r);
  r = decideWebNextStep(mk({ closeDate: ahead(0.2), pendingApprovals: [card("a1")] }));
  ok("不到一天后截标、又有卡等批：提醒与「有 1 条等你批」并存；不说钟点（手工填的截标时间只有日期）", r.urgencyZh === "不到 1 天后截标，还没提交" && r.rule === "pending_approval", r);
  ok("25 小时后截标：说「1 天多」（查表按天向上取整会说成「2 天后」）；整两天半说「2 天多」；三天整说「3 天」；三天多一点不提醒", decideWebNextStep(mk({ closeDate: new Date(NOW.getTime() + 25 * 3_600_000) })).urgencyZh === "1 天多后截标，还没提交" && decideWebNextStep(mk({ closeDate: ahead(2.5) })).urgencyZh === "2 天多后截标，还没提交" && decideWebNextStep(mk({ closeDate: ahead(3) })).urgencyZh === "3 天后截标，还没提交" && decideWebNextStep(mk({ closeDate: ahead(3.1) })).urgencyZh === null);
  ok("四天后截标：没有提醒；截标时间照样给出", (() => { const x = decideWebNextStep(mk({ closeDate: ahead(4) })); return x.urgencyZh === null && x.closesAt === ahead(4).toISOString(); })());
  r = decideWebNextStep(mk({ closeDate: null }));
  ok("没有填截标时间：没有提醒，在顺带要办的事里提示，位置是工作台的关键日期", r.urgencyZh === null && r.closesAt === null && r.also.some((a) => a.textZh === "还没填截标时间" && sameTarget(a.target, TAB("workbench", "project-key-dates"))));
}

/* ---------- 4. 催单的口径 ---------- */
console.log("催单：天数由调用方按扫描的口径给；回复截止过了不提示催；不承诺系统会做什么");
{
  const sent3 = [item("a", "sent", { sentAt: ago(3.5) }), item("b", "sent", { sentAt: ago(3.5), hasThread: false }), item("c", "quoted")];
  let r = decideWebNextStep(mk({ latestRound: round(sent3), chaseAfterDays: 3 }));
  ok("等了 3 天半、天数是 3：有 2 家没回；写明哪几家、1 家没有邮件线程要手工联系；位置是这一轮", r.rule === "no_reply" && r.headlineZh === "2 家没回" && r.reasonsZh.length === 3 && r.reasonsZh[0].includes("Supplier a") && r.reasonsZh[1].includes("1 家没有邮件线程") && r.reasonsZh[2] === "到这一轮看每一家的状态；有催单等批时也在那里" && sameTarget(r.action!.target, ROUND), r);
  ok("不承诺「系统会起草催单」「系统不会再催」（那取决于邮箱、授权、有没有被驳回过的催单，这里不知道）", !/会给|会起草|不会再催|定时检查会/.test(JSON.stringify(r)) && !/会给|会起草|不会再催/.test(JSON.stringify(decideWebNextStep(mk({ latestRound: round([item("a", "sent", { sentAt: ago(10) })], ago(2)) })))));
  ok("网页上没有起草催单的按钮：卡片的按钮只是「去看这一轮」，没有「催」", r.action!.labelZh === "去看这一轮" && !/催 \d+ 家/.test(JSON.stringify(r.action)));
  r = decideWebNextStep(mk({ latestRound: round(sent3), chaseAfterDays: 5 }));
  ok("同样的状态、天数是 5：还不到该催的时候，结论是在等回复（并写明满 5 天会提示）", r.rule === "waiting_replies" && r.reasonsZh[0] === "满 5 天没回，这里会提示", r);

  const longAgo = [item("a", "sent", { sentAt: ago(10) }), item("b", "sent", { sentAt: ago(10) })];
  r = decideWebNextStep(mk({ latestRound: round(longAgo, ago(2)) }));
  ok("回复截止日已过一天以上：不提示催，结论是截止已过、2 家没回，位置是这一轮", r.rule === "reply_deadline_passed" && r.headlineZh === "回复截止已过，2 家没回" && sameTarget(r.action!.target, ROUND), r);
  ok("回复截止日是今天（还没过完）：照常提示没回", decideWebNextStep(mk({ latestRound: round(longAgo, new Date("2026-11-11T00:00:00Z")) })).rule === "no_reply");
  ok("没有填回复截止：照常提示没回", decideWebNextStep(mk({ latestRound: round(longAgo, null) })).rule === "no_reply");
  r = decideWebNextStep(mk({ latestRound: round([...longAgo, item("c", "quoted"), item("d", "quoted")], ago(2)) }));
  ok("截止已过、但已有 2 家报价：下一步是比价，原因里带一句截止已过、2 家没回", r.rule === "quotes_ready" && r.reasonsZh.some((x) => x === "回复截止已过，2 家没回") && r.action!.labelZh === "去比价并选定", r);
  r = decideWebNextStep(mk({ latestRound: round([...longAgo, item("c", "quoted", { isSelected: true })], ago(2)) }));
  ok("截止已过、已选定一家、还没定价：下一步是定投标价", r.rule === "price_pending" && r.reasonsZh.some((x) => x.includes("回复截止已过")));
  // 定时催单已经不看的：轮次已结束、或发出超过它的时间窗
  r = decideWebNextStep(mk({ latestRound: round([item("a", "sent", { sentAt: ago(10), outOfScan: true }), item("b", "quoted"), item("c", "quoted")]) }));
  ok("轮次已标为完成（或发出超过扫描的时间窗）而还有一家「已发出」：不说「没回、该催了」，跟着报价走", r.rule === "quotes_ready", r);
  r = decideWebNextStep(mk({ latestRound: round([item("a", "sent", { sentAt: ago(100), outOfScan: true })]) }));
  ok("只有这一家、已经出了扫描的范围：不说在等回复，说这一轮没有拿到报价", r.rule === "no_quotes", r);
}

/* ---------- 5. 等批准的动作 ---------- */
console.log("等批准的动作指到哪里");
{
  let r = decideWebNextStep(mk({ pendingApprovals: [card("late", { createdAt: ago(1), inquiryId: "inqB" }), card("early", { createdAt: ago(3), inquiryId: "inqA", title: "第 1 轮询价（3 家）" })] }));
  ok("两条待批：写明条数与最早一条的标题；位置是最早那条所在的那一轮", r.rule === "pending_approval" && r.headlineZh === "有 2 条等你批" && r.reasonsZh[0] === "最早一条：第 1 轮询价（3 家）" && sameTarget(r.action!.target, TAB("bid", "rfq-round-inqA")), r);
  ok("原因写明批准之前不会发出任何东西；按钮是去看并决定，不是「批准」", r.reasonsZh[1].includes("批准之前不会发出任何东西") && r.action!.labelZh === "去看这一条并决定" && !/^批准/.test(r.action!.labelZh));
  r = decideWebNextStep(mk({ pendingApprovals: [card("c1", { type: "tender.send_chase", inquiryId: "inq9" })] }));
  ok("催单的卡：同样指到它所在的那一轮", sameTarget(r.action!.target, TAB("bid", "rfq-round-inq9")));
  r = decideWebNextStep(mk({ pendingApprovals: [card("c2", { type: "tender.send_chase", inquiryId: "inq9", stale: true, title: "催单：Alpha Mills" })] }));
  ok("催单针对的那一家已经回复或报价了（那一轮里不会列出这张卡）：位置改为审批中心，并说明可以驳回", r.action!.target.kind === "href" && r.reasonsZh[1].includes("已经用不上了") && r.reasonsZh[1].includes("驳回") && r.action!.labelZh === "去审批中心", r);
  r = decideWebNextStep(mk({ pendingApprovals: [card("x1", { type: "sales.send_quote", inquiryId: null })] }));
  ok("别的类型的审批：位置是审批中心", r.action!.target.kind === "href" && (r.action!.target as { href: string }).href === APPROVAL_CENTER_HREF && r.action!.labelZh === "去审批中心");
  r = decideWebNextStep(mk({ pendingApprovals: [card("x3", { type: "sales.send_quote", inquiryId: "inq1" })] }));
  ok("别的类型的审批即使带着一个轮次号，也去审批中心（那一轮里没有它的批准按钮）", r.action!.target.kind === "href");
  r = decideWebNextStep(mk({ pendingApprovals: [card("x2", { inquiryId: null })] }));
  ok("询价的卡但读不到是哪一轮：位置是审批中心（不猜）", r.action!.target.kind === "href");
  r = decideWebNextStep(mk({ pendingApprovals: [card("m1", { title: "改投标价为 $123,456.00（毛利 23%）", type: "bid.change_price", inquiryId: null })] }));
  ok("审批的标题里带着金额与毛利：整段不显示（这个接口不出任何金额）", r.reasonsZh[0] === "最早一条：（标题里有金额，这里不显示）" && !/123|23%|毛利/.test(JSON.stringify(r)), r);
  ok("去金额的规则：货币符号、货币代码、百分比、「元」「毛利」「估值」都算；普通文字原样", ["$5", "CAD 300", "5%", "300 元", "毛利不够", "估值偏高", "3 万元", "￥88"].every((t) => withoutMoney(t, "X") === "X") && ["第 1 轮询价（3 家）", "催单：Alpha Mills", "第 3 行尺寸不符"].every((t) => withoutMoney(t, "X") === t));
}

/* ---------- 6. 位置与网址 ---------- */
console.log("位置");
{
  const places: Array<[string, WebNextStepInput, WebNextStepTarget]> = [
    ["没传文件 → 文件抽屉", mk({ analysisStatus: null, documentCount: 0 }), { kind: "files" }],
    ["分析完等批准 → 「招标要求」的招标分析", mk({ analysisStatus: "REVIEW_REQUIRED" }), ANALYSIS],
    ["还没询价 → 「标书与报价」的供应商询价", mk(), TAB("bid", "rfq-section")],
    ["报价齐了 → 那一轮询价", mk({ latestRound: round([item("a", "quoted"), item("b", "quoted")]) }), ROUND],
    ["定了供应商没定价 → 「标书与报价」的投标价", mk({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) }), TAB("bid", "bid-quote-area")],
  ];
  for (const [name, input, want] of places) ok(name, sameTarget(decideWebNextStep(input).action!.target, want), decideWebNextStep(input).action);

  ok("位置换成网址：页签带页内位置、文件抽屉用页面认得的别名、审批中心原样", nextStepHref("p1", ANALYSIS) === "/projects/p1?tab=requirements#tender-analysis" && nextStepHref("p1", TAB("submission")) === "/projects/p1?tab=submission" && nextStepHref("p1", { kind: "files" }) === "/projects/p1?tab=files" && nextStepHref("p1", { kind: "href", href: APPROVAL_CENTER_HREF }) === "/capabilities/approvals" && nextStepHref("a/b", TAB("bid", "x y")) === "/projects/a%2Fb?tab=bid#x%20y");
  ok("页面认得这些页签与别名（?tab=files 会打开文件抽屉）", (["workbench", "requirements", "bid", "submission"] as const).every((t) => (TENDER_DETAIL_TAB_KEYS as readonly string[]).includes(t)) && resolveTenderDetailTab("files")?.openFiles === true);
  ok("某一轮的页内位置与询价区块自己用的是同一个写法", `#${rfqRoundAnchorId("abc")}` === rfqRoundAnchor("abc"));
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const inquiry = read("src/components/inquiry/project-inquiry-section.tsx");
  const wbTab = read("src/components/project-detail/tabs/workbench-tab.tsx");
  ok("页面上确实有这几个位置：招标分析、某一轮询价、投标价、投标工作区、关键日期", read("src/components/tender-analysis/analysis-panel.tsx").includes(`id="${NEXT_STEP_ANCHORS.analysis}"`) && inquiry.includes("rfq-round-") && read("src/components/project-detail/tabs/bid-tab.tsx").includes(`<div id="${NEXT_STEP_ANCHORS.bidQuote}"`) && read("src/components/tender/bid-workspace-panel.tsx").includes(`id="${NEXT_STEP_ANCHORS.bidWorkspace}"`) && wbTab.includes(`<div id="${NEXT_STEP_ANCHORS.keyDates}"`));
  // 「供应商询价」的位置必须在整块的根上：放在轮次列表上的话，还没有任何轮次时它不存在，点了哪儿也去不了
  const rootAt = inquiry.indexOf(`<div id="${NEXT_STEP_ANCHORS.rfqSection}"`);
  const mainReturn = inquiry.lastIndexOf("  return (", rootAt);
  ok("「供应商询价」的位置在这一整块的根元素上（紧跟着组件的 return），不在「有轮次才渲染」的列表上", rootAt > 0 && mainReturn > 0 && /^  return \(\s*(?:\/\/[^\n]*\s*)?<div id="rfq-section"/.test(inquiry.slice(mainReturn, rootAt + 30)) && inquiry.indexOf("rounds.length > 0") > rootAt, { rootAt, mainReturn });
  ok("会用到的位置都在上面核对过的那一组里（不指向别的、没人保证存在的 id）", (() => { const known = new Set<string>(Object.values(NEXT_STEP_ANCHORS)); const all = [mk(), mk({ analysisStatus: "REVIEW_REQUIRED" }), mk({ closeDate: null }), mk({ closeDate: ago(3) }), mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: [{ code: "DIMENSION_UNKNOWN", messageZh: "x" }] } }), mk({ workspace: { hasPriceSchedule: false, blockers: [] } }), mk({ latestRound: round([item("a", "declined")]) }), mk({ confirmedRequirementCount: 0 })].map(decideWebNextStep); return all.flatMap((x) => [x.action?.target, ...x.also.map((a) => a.target)]).every((t) => !t || t.kind !== "tab" || t.anchor === null || known.has(t.anchor) || t.anchor.startsWith("rfq-round-")); })());
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
  // 每一条规则都核对一遍：需要写权限的才加这句话
  const byRule: Array<[WebNextStepRule, Partial<WebNextStepInput>]> = [
    ["no_documents", { analysisStatus: null, documentCount: 0 }], ["analysis_failed", { analysisStatus: "FAILED" }], ["no_analysis", { analysisStatus: null }],
    ["unknown_facts", { analysisStatus: "REVIEW_REQUIRED", unknownCriticalFacts: 1 }], ["mandatory_gap", { mandatoryNonCompliant: 1 }], ["requirements_review", { analysisStatus: "REVIEW_REQUIRED" }],
    ["no_confirmed_requirements", { confirmedRequirementCount: 0 }], ["no_rfq", {}], ["reply_deadline_passed", { latestRound: round([item("a", "sent", { sentAt: ago(10) })], ago(2)) }],
    ["replies_to_record", { latestRound: round([item("a", "replied")]) }], ["single_quote", { latestRound: round([item("a", "quoted")]) }], ["no_quotes", { latestRound: round([item("a", "declined")]) }],
    ["quotes_ready", { latestRound: round([item("a", "quoted"), item("b", "quoted")]) }], ["price_pending", { latestRound: round([item("a", "quoted", { isSelected: true })]) }], ["prepare_submission", { hasProjectQuote: true }],
    ["past_closing", { closeDate: ago(2) }],
    ["pending_approval", { pendingApprovals: [card("a1")] }], ["parsing", { analysisStatus: null, parsingActive: true }], ["analysis_running", { analysisStatus: "ANALYZING" }],
    ["no_reply", { latestRound: round([item("a", "sent", { sentAt: ago(9) })]) }], ["waiting_replies", { latestRound: round([item("a", "sent")]) }], ["submitted", { submittedAt: ago(1) }],
    ["closed", { closedLabelZh: "未中标" }], ["won", { won: true }], ["idle", { latestRound: round([item("a", "weird")]) }],
  ];
  const wrong = byRule.filter(([rule, o]) => { const x = decideWebNextStep(mk({ ...o, canManage: false })); return x.rule !== rule || JSON.stringify(x.reasonsZh).includes("没有修改权限") !== NEEDS_WRITE.has(rule); }).map(([rule, o]) => `${rule} → ${decideWebNextStep(mk({ ...o, canManage: false })).rule}`);
  ok(`全部 ${byRule.length} 条规则逐条核对：需要写权限的 ${NEEDS_WRITE.size} 条才加权限说明，其余不加`, wrong.length === 0 && byRule.length === 25 && NEEDS_WRITE.size === 16, wrong);
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
    { code: "CLOSING_TIME_INVALID", messageZh: "截标时间不可用" },
  ];
  let r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers } }));
  ok("已有投标价、工作区开启、有阻断项：列出该列的 3 个里的前两条与总数，位置是投标工作区", r.rule === "prepare_submission" && r.headlineZh === "投标价已有，提交前还有阻断项" && r.reasonsZh[0].startsWith("投标工作区还有 3 个阻断项") && r.reasonsZh[1] === "第 3 行尺寸不符" && r.reasonsZh[2] === "第 5 行认证不全" && sameTarget(r.action!.target, TAB("bid", "bid-workspace")), r);
  ok("成本类的阻断项不列（服务端看不到成本输入），并照实说明；截标时间的问题也不在这里列（卡片另有提示）", !JSON.stringify(r).includes("成本还没核算") && !JSON.stringify(r).includes("成本不全") && !JSON.stringify(r).includes("截标时间不可用") && r.reasonsZh[0].includes("成本核算只存在你的浏览器里，这里看不到"));
  r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: blockers.filter((b) => b.code.startsWith("COST")) } }));
  ok("只剩成本类的阻断项：不说「有阻断项」，位置是「提交」页签，仍说明成本这里看不到", r.headlineZh === "投标价已有，准备提交" && sameTarget(r.action!.target, TAB("submission")) && r.reasonsZh[0].includes("这里看不到"), r);
  r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: false, blockers: [{ code: "SCHEDULE_INVALID", messageZh: "价格表没有任何行项" }, { code: "COST_MISSING", messageZh: "还没有成本核算" }] } }));
  ok("工作区开了但从没用过（没有价格表）：不说「提交前还有阻断项」——照常准备提交，价格表的事放在顺带要办的事里", r.headlineZh === "投标价已有，准备提交" && sameTarget(r.action!.target, TAB("submission")) && !JSON.stringify(r.reasonsZh).includes("阻断") && r.also.some((a) => a.textZh === "价格表还没录，可以从招标分析带入"), r);
  r = decideWebNextStep(mk({ workspace: { hasPriceSchedule: false, blockers } }));
  ok("分析已批准、价格表还没录：顺带提示可以从招标分析带入，位置是投标工作区；主结论不变", r.rule === "no_rfq" && r.also.some((a) => a.textZh === "价格表还没录，可以从招标分析带入" && sameTarget(a.target, TAB("bid", "bid-workspace"))), r);
  ok("还没分析时不提价格表", !decideWebNextStep(mk({ analysisStatus: null, workspace: { hasPriceSchedule: false, blockers: [] } })).also.some((a) => a.textZh.includes("价格表")));
  r = decideWebNextStep(mk({ hasProjectQuote: true, workspace: null }));
  ok("工作区未开启：不出现阻断项与价格表提示", !JSON.stringify(r).includes("阻断") && !JSON.stringify(r).includes("价格表") && !JSON.stringify(decideWebNextStep(mk({ workspace: null }))).includes("价格表"));
  ok("阻断项的说明里如果带金额：整段换掉", decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: [{ code: "X", messageZh: "第 1 行单价 $9.87 偏低" }] } })).reasonsZh[1] === "（内容请到投标工作区看）");
  r = decideWebNextStep(mk({ analysisStatus: "REVIEW_REQUIRED", closeDate: null, latestRound: round([item("a", "quoted"), item("b", "quoted")]), workspace: { hasPriceSchedule: false, blockers: [] } }));
  ok("顺带要办的事最多三条", r.also.length === 3 && r.also.map((a) => a.textZh).join("|") === "招标分析还没批准|价格表还没录，可以从招标分析带入|还没填截标时间", r.also);
  ok("顺带要办的事每一条都指向它自己的位置（不都指到主按钮那里）", sameTarget(r.also[0].target, ANALYSIS) && sameTarget(r.also[1].target, TAB("bid", "bid-workspace")) && sameTarget(r.also[2].target, TAB("workbench", "project-key-dates")) && !r.also.some((a) => sameTarget(a.target, r.action!.target)));
}

/* ---------- 9. 结果的形状 ---------- */
console.log("结果里有什么、没有什么");
{
  const all: WebNextStepView[] = [
    decideWebNextStep(mk()),
    decideWebNextStep(mk({ pendingApprovals: [card("a1")] })),
    decideWebNextStep(mk({ hasProjectQuote: true, workspace: { hasPriceSchedule: true, blockers: [{ code: "DIMENSION_MISMATCH", messageZh: "第 3 行尺寸不符" }] } })),
    decideWebNextStep(mk({ latestRound: round([item("a", "quoted", { isSelected: true }), item("b", "quoted")]) })),
    decideWebNextStep(mk({ analysisStatus: null, documentCount: 0 })),
    decideWebNextStep(mk({ latestRound: round([item("a", "declined")]) })),
    decideWebNextStep(mk({ closeDate: ago(3) })),
    decideWebNextStep(mk({ confirmedRequirementCount: 0 })),
  ];
  ok("只有这八个字段；没有价格、毛利、估值之类的字段", all.every((x) => Object.keys(x).sort().join() === "action,actualStage,also,closesAt,headlineZh,reasonsZh,rule,urgencyZh"));
  ok("原因不超过三条，顺带要办的事不超过三条", all.every((x) => x.reasonsZh.length <= 3 && x.also.length <= 3));
  ok("文字里没有金额（货币符号、「元」、百分号）", all.every((x) => !/[$¥€£%]|\d\s*元|CAD|USD/.test(JSON.stringify([x.headlineZh, x.reasonsZh, x.also, x.action?.labelZh]))));
  ok("按钮的文字都是「去…」「看…」「上传…」这类导航的说法，没有「批准」「发送」「提交投标」「催」", all.every((x) => !x.action || (/^(去|看|上传)/.test(x.action.labelZh) && !/^(批准|发送|提交投标|催)/.test(x.action.labelZh))));
}

/* ---------- 10. 开关 ---------- */
console.log("开关");
{
  const on = (env: Record<string, string>, org: string | null = "org1") => isWebNextStepEnabledForOrgWithEnv(org, env as NodeJS.ProcessEnv);
  ok("默认关；只有明确的真值才开", !on({}) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "0" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "false" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "" }) && on({ TENDER_WEB_NEXT_STEP_ENABLED: "1" }) && on({ TENDER_WEB_NEXT_STEP_ENABLED: "true" }));
  ok("白名单为空 = 所有组织；不为空 = 只有名单里的；没有组织 = 关", on({ TENDER_WEB_NEXT_STEP_ENABLED: "1", TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST: "" }) && on({ TENDER_WEB_NEXT_STEP_ENABLED: "1", TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST: "orgX, org1" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "1", TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST: "orgX" }) && !on({ TENDER_WEB_NEXT_STEP_ENABLED: "1" }, null));
}

/* ---------- 11. 决策摘要与右侧面板跟随 ---------- */
console.log("决策摘要与右侧的项目上下文跟着「下一步」说");
{
  const base = deriveProjectCommandState({ status: "active", stage: "supplier_inquiry", orgBound: true, documentCount: 3, closeDate: "2026-12-01", riskLevel: null, riskLabel: null, isOverdue: false, completedTasks: 0, totalTasks: 2, pendingCount: 0, hasIntelligence: false, analysisPhase: "approved", parsingActive: false });
  const view = decideWebNextStep(mk());
  const merged = applyNextStepToCommand(base, view);
  ok("（前提）没有「下一步」时，决策摘要自己给了一个按钮（跟进供应商报价）", base.nextAction?.label === "跟进供应商报价");
  ok("工作台上的决策摘要：显示同一条结论，不再有另一个按钮（按钮在它上方的卡片上）", merged.nextAction === null && merged.recommendation.title === "还没问过供应商" && merged.recommendation.body === view.reasonsZh[0]);
  ok("摘要的其它内容（阶段、风险、缺失项）不变", merged.stageLabel === base.stageLabel && merged.risks === base.risks && merged.missingItems === base.missingItems && merged.statusLabel === base.statusLabel);
  ok("原始的摘要对象没有被改动", base.nextAction?.label === "跟进供应商报价");
  const panel = applyNextStepToCommand(base, view, { keepButton: true });
  ok("右侧的项目上下文（每个页签都看得到，而卡片只在工作台）：保留按钮，去同一个页签", panel.nextAction?.label === "去供应商询价" && panel.nextAction.target === "bid" && panel.recommendation.title === "还没问过供应商");
  ok("去文件抽屉的：按钮开文件抽屉；去审批中心的（站外页面）：面板上不放按钮；没有位置的：没有按钮", applyNextStepToCommand(base, decideWebNextStep(mk({ analysisStatus: null, documentCount: 0 })), { keepButton: true }).nextAction?.target === "files" && applyNextStepToCommand(base, decideWebNextStep(mk({ pendingApprovals: [card("x", { type: "other", inquiryId: null })] })), { keepButton: true }).nextAction === null && applyNextStepToCommand(base, decideWebNextStep(mk({ analysisStatus: null, parsingActive: true })), { keepButton: true }).nextAction === null);
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

  ok("判断调用 Muse 的同一个查表函数；要不要提醒截标也由它决定（这里没有自己的「三天」）", /import \{ decideNextStep, [^}]*\} from "@\/lib\/muse-bridge\/next-step";/.test(pure) && (pure.match(/decideNextStep\(/g) ?? []).length >= 4 && !/DEADLINE_WARN|WARN_DAYS|<= 3\b|3 \* DAY/.test(pure) && pure.includes('deadline.rule === "deadline_soon"'));
  ok("Muse 的查表文件没有引用网页这边的任何东西（没有反向依赖）", !/tender-next-step/.test(muse));
  ok("判断与位置两个文件是纯的：不访问数据库、不发请求、不调模型", [pure, targets].every((src) => !/@\/lib\/db|prisma|fetch\(|openai|anthropic|createCompletion/i.test(src)) && !/^import /m.test(targets));
  ok("接口：只有 GET；项目读权限；开关关闭、没有组织、不是招投标项目 → 404；组织取自项目记录", /export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route) && route.includes("requireProjectReadAccess(request, projectId)") && route.includes('if (!orgId || !isWebNextStepEnabledForOrg(orgId) || project.workDomain !== "tender")') && route.includes("status: 404") && route.includes("const orgId = project.orgId;"));
  ok("接口：有没有写权限的判断与写接口的条件相同（负责人 / 组织管理员 / 项目管理员 / 超级管理员）", route.includes("isSuperAdmin(user.role) ||") && route.includes("project.ownerId === user.id ||") && route.includes('(!!orgRole && hasOrgRole(orgRole, "org_admin")) ||') && route.includes('(!!projectRole && hasProjectRole(projectRole, "project_admin"));'));
  ok("接口：只认项目上的截标时间，不拿内部的到期日顶替", route.includes("closeDate: project.closeDate ?? null,") && !/dueDate/.test(route.replace(/\/\/[^\n]*/g, "")) && !/dueDate/.test(service.replace(/dueDate: true|round\.dueDate/g, "")));
  ok("取数：只读，没有任何写库、建审批、发信、写审计的调用", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$transaction)\(/.test(service) && !/requestApproval|writeAuditLog|logAudit|sendMail|sendEmail|markItemNoResponse/.test(service));
  ok("取数：分析按项目与组织；轮次按项目与组织、不算已取消的；待批用「待我确认」的同一组条件再加项目、待批、未过期", (service.match(/where: \{ projectId, orgId(?:, status: \{ in: USABLE_RUN \})? \}/g) ?? []).length === 2 && service.includes('where: { projectId, project: { orgId }, status: { not: "canceled" } },') && service.includes("loadPendingMineWhere(input.userId, orgId)") && service.includes('where: { AND: [pendingWhere, { projectId, status: "pending", expiresAt: { gt: now } }] },'));
  ok("取数：等待天数用催单扫描自己的函数（授权里定格的 > 项目负责人的偏好 > 组织设置）；扫描的时间窗也用它自己的常量", service.includes('import { OPEN_ITEM_WINDOW_DAYS, loadFollowUpRoundState, roundPolicyInEffect } from "@/lib/tender-rfq/chase-service";') && service.includes("roundPolicy ? roundPolicy.chaseAfterDays : resolveChaseAfterDays(readUserPrefs(orgSettingsJson, project.ownerId).chaseAfterDays, orgSettingsJson)") && service.includes("OPEN_ITEM_WINDOW_DAYS * DAY"));
  ok("取数：投标工作区只在该组织开启时才算，用它读取接口的同一组函数", service.includes("isBidWorkspaceEnabledForOrg(orgId)") && service.includes("buildWorkspaceView(stored, ctx)"));
  ok("取数：询价入口现在能不能用，问的是页面上那个入口自己的读取函数；只在要指向它时才问", service.includes("if (!RFQ_ENTRY_RULES.has(view.rule)) return view;") && service.includes("await loadRfqWebEntry({ projectId: input.project.id, orgId: input.project.orgId, userId: input.userId, now })"));

  // 卡片只指路
  ok("卡片不请求任何接口、不带任何执行动作：没有 fetch / apiFetch / apiJson，没有 method", !/fetch\(|apiFetch|apiJson|method\s*:/.test(cardSrc));
  ok("卡片上的每个链接只做一件事：调用页面给的导航函数（带修饰键时让浏览器按网址走）", (cardSrc.match(/onClick=\{open\(/g) ?? []).length === 2 && (cardSrc.match(/onClick=/g) ?? []).length === 2 && /e\.preventDefault\(\);\s*onOpen\(target\);/.test(cardSrc) && (cardSrc.match(/href=\{nextStepHref\(projectId, /g) ?? []).length === 2);
  ok("主按钮去主结论的位置；「另外」的每一条去它自己的位置", cardSrc.includes("href={nextStepHref(projectId, view.action.target)}") && cardSrc.includes("onClick={open(view.action.target)}") && cardSrc.includes("<a href={nextStepHref(projectId, a.target)} onClick={open(a.target)}"));
  ok("截标时间只显示到日（手工填的只有日期，显示钟点会是假的）", cardSrc.includes('toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })') && !/hour:|minute:/.test(cardSrc));
  ok("卡片的测试标记齐全", ["next-step-card", "next-step-headline", "next-step-reasons", "next-step-action", "next-step-urgency", "next-step-closing", "next-step-also"].every((id) => cardSrc.includes(`data-testid="${id}"`)) && cardSrc.includes("data-rule={view.rule}"));

  ok("页面文件仍然默认导出页面组件（改这个文件时曾经把它误删，类型检查发现不了）", /^export default function ProjectDetailPage\(\) \{/m.test(page) && page.includes("<ProjectDetailContent />") && /^function ProjectDetailContent\(\) \{/m.test(page));
  const navStart = page.indexOf("const openNextStepTarget = useCallback(");
  const nav = page.slice(navStart, page.indexOf("const openProjectArea = useCallback("));
  ok("（前提）取到了页面上导航的那段代码", navStart > 0 && nav.includes("scrollToProjectAnchor(target.anchor)"));
  ok("页面的导航只做四件事：开文件抽屉、跳转、切页签、滚动；不请求任何接口、不点任何按钮", !/fetch\(|apiFetch|apiJson|\.click\(\)|method\s*:|dispatchEvent\(new (?!HashChangeEvent)/.test(nav) && nav.includes("setFilesOpen(true)") && nav.includes("router.push(target.href)") && nav.includes("setActiveTab(target.tab)"));
  ok("切页签不往历史里加一条（与页面自己的页签切换一样用 replace）；地址栏保留其它参数、去掉动态深链", nav.includes("router.replace(url, { scroll: false });") && !/router\.push\(url/.test(nav) && nav.includes("const next = new URLSearchParams(searchParams.toString());") && nav.includes('next.set("tab", target.tab);') && nav.includes('next.delete("activity");'));
  ok("询价区块已经在页面上时，靠一次 hashchange 让它展开对应的那一轮", nav.includes('window.setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 60);') && read("src/components/inquiry/project-inquiry-section.tsx").includes('window.addEventListener("hashchange", onHashChange)'));
  const scrollStart = page.indexOf("function scrollToProjectAnchor(");
  const scrollFn = page.slice(scrollStart, page.indexOf("\nfunction ", scrollStart + 10));
  ok("滚动到页内位置的函数只滚动（不点、不改任何东西）；找不到会停；人自己滚动或按键就停", scrollFn.includes("scrollIntoView") && scrollFn.includes("tries >= 40") && scrollFn.includes('window.addEventListener("wheel", stop') && scrollFn.includes('window.addEventListener("keydown", stop)') && !/\.click\(|fetch\(|innerHTML|\.value\s*=/.test(scrollFn));
  ok("人自己切页签时，还在进行的滚动作废", /\(tab: TenderDetailTab\) => \{\s*\/\/[^\n]*\n\s*cancelAnchorScroll\.current\?\.\(\);/.test(page));
  const loadStart = page.indexOf("const loadNextStep = useCallback(");
  const loader = page.slice(loadStart, page.indexOf("// 项目数据每次重新载入"));
  ok("页面取数是一个不带 method 的读取；只对招投标项目取；404 之后不再请求；取不到就不显示卡片", loadStart > 0 && loader.includes("await apiFetch(`/api/projects/${id}/next-step`)") && !/method\s*:/.test(loader) && loader.includes("if (res.status === 404) nextStepOff.current = true;") && loader.includes("if (!id || !nextStepWanted || nextStepOff.current) return;") && page.includes("const nextStepWanted = !!project && isTenderProject(project);") && loader.includes("setNextStep(null)"));
  ok("项目数据重新载入（包括在工作台上改了关键日期、推进了阶段）、分析状态变化、从别的页签回到工作台、审批变化时重新取", page.includes("}, [project, analysisRunStatus, loadNextStep]);") && page.includes('const cameBack = activeTab === "workbench" && lastTabForNextStep.current !== "workbench";') && page.includes('window.addEventListener("pending-actions-changed", refresh);'));
  ok("卡片只在招投标项目、且接口给了结果时渲染；放在工作台页签最上面", tabSrc.includes("{tenderish && nextStep && onOpenNextStep ? (") && tabSrc.indexOf("<NextStepCard") > 0 && tabSrc.indexOf("<NextStepCard") < tabSrc.indexOf("<ProjectCommandOverview"));
  ok("页面把同一个结果交给两处：工作台的决策摘要（不留按钮）与右侧的项目上下文（留按钮）；没有结果时两处都照旧", page.includes("(showNextStep ? applyNextStepToCommand(baseCommand, showNextStep, { keepButton: true }) : baseCommand)") && page.includes("(showNextStep ? applyNextStepToCommand(baseCommand, showNextStep) : baseCommand)") && page.includes("command={workbenchCommand}") && page.includes("nextStep={showNextStep}") && page.includes("onOpenNextStep={openNextStepTarget}") && page.includes("const showNextStep = nextStepWanted ? nextStep : null;"));
}

console.log(`\n✓ web-next-step: ${passed} 项断言全部通过`);
