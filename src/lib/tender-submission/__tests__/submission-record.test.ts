/**
 * FLOW-H4a 投标提交记录 — 纯逻辑测试 + 接线断言
 * 运行：npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts
 * 真实数据库里的行为另见 submission-record-db.isolated.test.ts
 */
// 时区定成多伦多：本地时间与时刻的换算要在一个有夏令时的时区里核对（必须在用到任何日期之前设好）
process.env.TZ = "America/Toronto";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TenderStage } from "@/lib/tender/types";
import { NEXT_STEP_ANCHORS } from "@/lib/tender-next-step/targets";
import { decideWebNextStep, type WebNextStepInput } from "@/lib/tender-next-step/web-next-step";
import {
  AFTER_SUBMISSION_STATUSES, FUTURE_TOLERANCE_MS, NO_SUBMISSION_STATUS_ZH, RECEIPT_REF_MAX, SUBMISSION_AUDIT_ACTION, SUBMISSION_CHANNELS, SUBMISSION_CHANNEL_ZH, SUBMISSION_NOTE_MAX,
  blockedReasonZh, classifySubmission, confirmTextZh, fromDatetimeLocal, openButtonZh, parseStoredRecord, parseSubmissionInput, statusLineZh, submittedAtToSend, toDatetimeLocal, toStoredRecord,
  type SubmissionRecordView,
} from "../contract";
import { isSubmissionRecordEnabledForOrgWithEnv } from "../flags";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const HOUR = 3_600_000, DAY = 24 * HOUR;
const NOW = new Date();
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const good = { submittedAt: ago(20 * HOUR).toISOString(), channel: "portal", receiptRef: "ABC-123", note: "门户提交，已下载确认页" };
const parse = (o: unknown) => parseSubmissionInput(o, NOW);
const errorsOf = (o: unknown) => { const r = parse(o); return r.ok ? [] : r.errors; };

/* ---------- 1. 输入校验 ---------- */
console.log("输入校验");
{
  const r = parse(good);
  ok("四项齐全：通过，时间是一个时刻，文字去掉首尾空白", r.ok && r.value.submittedAt.toISOString() === good.submittedAt && r.value.channel === "portal" && r.value.receiptRef === "ABC-123" && r.value.note === "门户提交，已下载确认页");
  const blank = parse({ submittedAt: good.submittedAt, channel: "email", receiptRef: "   ", note: "" });
  ok("回执编号与备注可以不填：空白与空串都记成没有", blank.ok && blank.value.receiptRef === null && blank.value.note === null && (() => { const x = parse({ submittedAt: good.submittedAt, channel: "email" }); return x.ok && x.value.receiptRef === null && x.value.note === null; })());
  const padded = parse({ ...good, receiptRef: "  ABC-9  " });
  ok("回执编号两边的空白去掉", padded.ok && padded.value.receiptRef === "ABC-9");
  ok("时间可以是过去（一年前也行）", parse({ ...good, submittedAt: ago(365 * DAY).toISOString() }).ok);
  ok("时间晚于现在：不保存，说明这里记的是已经交完的标", errorsOf({ ...good, submittedAt: new Date(NOW.getTime() + DAY).toISOString() }).some((e) => e.includes("不能晚于现在")) && errorsOf({ ...good, submittedAt: new Date(NOW.getTime() + FUTURE_TOLERANCE_MS + 60_000).toISOString() }).length === 1);
  ok("允许 5 分钟的时钟误差：比现在晚 4 分钟的通过", parse({ ...good, submittedAt: new Date(NOW.getTime() + FUTURE_TOLERANCE_MS - 60_000).toISOString() }).ok);
  ok("年份明显填错（早于 10 年前）：不保存", errorsOf({ ...good, submittedAt: "2006-11-08T15:20:00.000Z" }).some((e) => e.includes("请核对年份")));
  ok("没填时间、不是时刻、不是文字：不保存", [undefined, "", "   ", "昨天下午", 20261108, null].every((v) => errorsOf({ ...good, submittedAt: v }).length === 1));
  const day = ago(3 * DAY).toISOString().slice(0, 10);
  ok("只收带时区的 ISO 时刻：只有日期、斜杠写法、只有年份、不带时区的本地时间、一个数字都不收（它们会被按服务器的时区去猜）", [day, `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`, day.slice(0, 4), `${day}T10:00`, `${day}T10:00:00`, "0", "1", "Nov 8"].every((v) => errorsOf({ ...good, submittedAt: v }).some((e) => e.includes("不是有效的时刻"))), [day, `${day}T10:00`].filter((v) => parse({ ...good, submittedAt: v }).ok));
  ok("带时区偏移的写法与 Z 结尾的都收，指的是同一个时刻", (() => { const a = parse({ ...good, submittedAt: `${day}T10:00:00-05:00` }), b = parse({ ...good, submittedAt: `${day}T15:00:00.000Z` }), c = parse({ ...good, submittedAt: `${day}T15:00Z` }); return a.ok && b.ok && c.ok && a.value.submittedAt.getTime() === b.value.submittedAt.getTime() && b.value.submittedAt.getTime() === c.value.submittedAt.getTime(); })());
  ok("提交方式只认这五种", SUBMISSION_CHANNELS.join() === "portal,email,hand_delivery,mail,other" && SUBMISSION_CHANNELS.every((c) => parse({ ...good, channel: c }).ok && SUBMISSION_CHANNEL_ZH[c].length > 0) && ["fax", "", undefined, "PORTAL", 1].every((c) => errorsOf({ ...good, channel: c }).some((e) => e.includes("提交方式"))));
  const moneyNotes = ["报了 $128,000", "总价 12.8 万元", "毛利 23", "降 5%", "CAD 128000", "¥900", "利润率不错", "估值过高", "128000 元"];
  ok("备注里出现金额、百分比、利润：不保存，并说明原因（不是悄悄替换）", moneyNotes.every((n) => errorsOf({ ...good, note: n }).some((e) => e.startsWith("备注里不要写金额"))), moneyNotes.filter((n) => parse({ ...good, note: n }).ok));
  ok("回执编号是门户给的标识，不按金额拦：带货币代码、百分号的编号都能保存", ["CONF-2026-004512", "TB#88213/A", "MERX 0001234567", "REF 2026 11 08", "CAD-2026-00123", "REF%2FABC1%2F", "Wichita USD 259", "EUR-LEX 123"].every((x) => { const r2 = parse({ ...good, receiptRef: x }); return r2.ok && r2.value.receiptRef === x; }));
  ok("普通的备注不会被误当成金额", ["门户提交，确认页已存档", "由同事代交，前台签收", "第 2 次上传后成功"].every((x) => parse({ ...good, note: x }).ok));
  ok("长度：回执编号最多 120 字、备注最多 500 字", parse({ ...good, receiptRef: "A".repeat(RECEIPT_REF_MAX) }).ok && errorsOf({ ...good, receiptRef: "A".repeat(RECEIPT_REF_MAX + 1) }).length === 1 && parse({ ...good, note: "字".repeat(SUBMISSION_NOTE_MAX) }).ok && errorsOf({ ...good, note: "字".repeat(SUBMISSION_NOTE_MAX + 1) }).length === 1);
  ok("回执编号不许换行、制表符与控制字符；备注可以换行、不许控制字符", errorsOf({ ...good, receiptRef: "ABC\n123" }).length === 1 && errorsOf({ ...good, receiptRef: "ABC\t123" }).length === 1 && errorsOf({ ...good, receiptRef: "ABC\u0007" }).length === 1 && parse({ ...good, note: "第一行\n第二行" }).ok && errorsOf({ ...good, note: "a\u0000b" }).length === 1);
  ok("改变文字方向的不可见字符、行分隔符：不保存（它们会让显示的内容与存的不一样）", ["ABC\u202e321", "ABC\u2028DEF", "A\u2066B"].every((x) => errorsOf({ ...good, receiptRef: x }).length === 1 && errorsOf({ ...good, note: x }).length === 1));
  ok("回执编号、备注不是文字：不保存", errorsOf({ ...good, receiptRef: 123 }).length === 1 && errorsOf({ ...good, note: { a: 1 } }).length === 1);
  ok("内容不是对象：不保存", [null, undefined, "x", 3, [good]].every((b) => !parse(b).ok));
  ok("几项都不对时每一条原因都说出来", errorsOf({ submittedAt: "x", channel: "fax", receiptRef: "A\nB", note: "5%" }).length === 4);
  ok("请求里多带的字段（别的组织、项目、金额）被无视，不进结果", (() => { const x = parse({ ...good, orgId: "other", projectId: "p", amount: 1, ourBidPrice: 2 }); return x.ok && Object.keys(x.value).sort().join() === "channel,note,receiptRef,submittedAt"; })());
}

/* ---------- 2. 三种情形 ---------- */
console.log("第一次 / 更正 / 补记");
{
  const stages: TenderStage[] = ["initiation", "distribution", "interpretation", "supplier_inquiry", "supplier_quote", "submission"];
  ok("已有提交时间：不管阶段与状态，都是更正", stages.every((s) => [null, "won", "bid_submitted", "pursuing"].every((t) => classifySubmission({ recordedStage: s, submittedAt: ago(DAY), tenderStatus: t }) === "correction")));
  ok("没有提交时间、还没有结果、阶段在提交之前：第一次", stages.slice(0, 5).every((s) => [null, undefined, "", "new", "pursuing", "supplier_quote", "bid_preparation", "under_review"].every((t) => classifySubmission({ recordedStage: s, submittedAt: null, tenderStatus: t }) === "first")));
  ok("没有提交时间、但已经有投标结果或已标为已提交：补记（不走阶段推进，免得把结果改写成「已提交」）", AFTER_SUBMISSION_STATUSES.join() === "bid_submitted,won,lost,archived,completed,terminated" && AFTER_SUBMISSION_STATUSES.every((t) => stages.every((s) => classifySubmission({ recordedStage: s, submittedAt: null, tenderStatus: t }) === "backfill")) && classifySubmission({ recordedStage: "distribution", submittedAt: null, tenderStatus: "WON" }) === "backfill");
  ok("没有提交时间、阶段记录已算作项目提交：补记", classifySubmission({ recordedStage: "submission", submittedAt: null, tenderStatus: "bid_preparation" }) === "backfill" && classifySubmission({ recordedStage: "submission", submittedAt: null, tenderStatus: null }) === "backfill");
}

console.log("什么时候不能记录");
{
  const b = (o: Partial<Parameters<typeof blockedReasonZh>[0]>) => blockedReasonZh({ status: "active", tenderStatus: null, submittedAt: null, ...o });
  ok("进行中的项目：能记录", b({}) === null && b({ tenderStatus: "won" }) === null && b({ tenderStatus: "lost" }) === null && b({ tenderStatus: "pursuing" }) === null);
  ok("项目已放弃、已归档：不能记录，各有说明", String(b({ status: "abandoned" })).includes("已放弃") && String(b({ status: "archived" })).includes("已归档") && String(b({ status: "abandoned", submittedAt: ago(DAY) })).includes("已放弃"));
  ok("投标结果是不投标、已放弃投标、已取消，且没有提交时间：没有提交可记，写出是哪一种结果", Object.keys(NO_SUBMISSION_STATUS_ZH).sort().join() === "cancelled,no_bid,passed" && Object.entries(NO_SUBMISSION_STATUS_ZH).every(([k, zh]) => String(b({ tenderStatus: k })).includes(`「${zh}」`) && String(b({ tenderStatus: k.toUpperCase() })).includes(zh)));
  ok("同样的结果但已有提交时间（交了之后招标取消）：仍可更正", ["no_bid", "passed", "cancelled"].every((k) => b({ tenderStatus: k, submittedAt: ago(DAY) }) === null));
}

/* ---------- 3. 存与读 ---------- */
console.log("记录的形状");
{
  const v = parse(good);
  assert.ok(v.ok);
  const stored = toStoredRecord(v.value, "first");
  ok("存下来的是这六项，没有金额字段", Object.keys(stored).sort().join() === "channel,kind,note,receiptRef,submittedAt,v" && stored.v === 1 && stored.kind === "first" && stored.submittedAt === good.submittedAt);
  ok("存成文字再读回来，内容相同（审计行里存的是 JSON 文字）", JSON.stringify(parseStoredRecord(JSON.stringify(stored))) === JSON.stringify(stored) && JSON.stringify(parseStoredRecord(stored)) === JSON.stringify(stored));
  ok("读不懂的内容当作没有记录，不猜：空、不是 JSON、版本不对、缺时间、时间不是时刻、方式不认识、情形不认识", [null, undefined, "", "not json", "[]", JSON.stringify({ ...stored, v: 2 }), JSON.stringify({ ...stored, submittedAt: undefined }), JSON.stringify({ ...stored, submittedAt: "昨天" }), JSON.stringify({ ...stored, channel: "fax" }), JSON.stringify({ ...stored, kind: "undo" })].every((x) => parseStoredRecord(x) === null));
  ok("读回来时多出来的字段被丢掉（比如别处合并进来的追踪信息）", Object.keys(parseStoredRecord(JSON.stringify({ ...stored, _runtimeCorrelation: { traceId: "t" }, ourBidPrice: 1 })) ?? {}).sort().join() === "channel,kind,note,receiptRef,submittedAt,v");
  ok("审计动作名", SUBMISSION_AUDIT_ACTION === "tender.submission.record");
}

/* ---------- 4. 页面用的小工具 ---------- */
console.log("页面用的文字与时间换算");
{
  // 多伦多：2026-11-01 凌晨从夏令时（UTC-4）换回标准时间（UTC-5）
  ok("（前提）测试运行在多伦多时区", new Date("2026-07-01T12:00:00Z").getTimezoneOffset() === 240 && new Date("2026-12-01T12:00:00Z").getTimezoneOffset() === 300);
  ok("本地时间 → 时刻：用的是填的那一天的偏移——10 月 30 日 14:00 是 18:00Z，11 月 8 日 14:00 是 19:00Z（不是拿今天的偏移去算所有日子）", fromDatetimeLocal("2026-10-30T14:00") === "2026-10-30T18:00:00.000Z" && fromDatetimeLocal("2026-11-08T14:00") === "2026-11-08T19:00:00.000Z" && fromDatetimeLocal("2026-07-04T09:30") === "2026-07-04T13:30:00.000Z");
  ok("时刻 → 本地时间写法：同样按那一天的偏移", toDatetimeLocal(new Date("2026-10-30T18:00:00.000Z")) === "2026-10-30T14:00" && toDatetimeLocal(new Date("2026-11-08T19:00:00.000Z")) === "2026-11-08T14:00" && toDatetimeLocal(new Date("2026-11-09T03:20:00.000Z")) === "2026-11-08T22:20");
  ok("两个方向互为逆运算（夏令时两侧各取几天）", ["2026-03-07T23:59", "2026-03-09T08:00", "2026-06-15T12:00", "2026-10-31T23:30", "2026-11-01T09:00", "2026-11-12T00:00"].every((x) => toDatetimeLocal(new Date(fromDatetimeLocal(x)!)) === x));
  ok("空的、不是这种写法的：null", [" ", "", "2026-11-08", "昨天", "2026-13-45T99:99"].every((x) => fromDatetimeLocal(x) === null));
  const exact = "2026-11-08T19:03:27.512Z";
  ok("更正时没动过时间那一栏：原样发回已有的时刻（秒与毫秒都在）；动过：用栏里的值；第一次记录：用栏里的值", submittedAtToSend({ fieldValue: toDatetimeLocal(new Date(exact)), touched: false, existing: exact }) === exact && submittedAtToSend({ fieldValue: "2026-11-08T14:10", touched: true, existing: exact }) === "2026-11-08T19:10:00.000Z" && submittedAtToSend({ fieldValue: "2026-11-08T14:10", touched: false, existing: null }) === "2026-11-08T19:10:00.000Z" && submittedAtToSend({ fieldValue: "", touched: true, existing: exact }) === null);
  const at = new Date("2026-11-08T20:20:00.000Z");
  const view = (o: Partial<SubmissionRecordView>): SubmissionRecordView => ({ submittedAt: null, nextKind: "first", blockedZh: null, canRecord: true, syncsToSource: false, record: null, count: 0, ...o });
  const record = { v: 1 as const, kind: "first" as const, submittedAt: at.toISOString(), channel: "portal" as const, receiptRef: "ABC-123", note: null, recordedAt: at.toISOString(), recordedByName: "张三" };
  ok("没有提交时间：还没有提交记录", statusLineZh(view({})) === "还没有提交记录");
  ok("有提交时间、没有记录（在别处推进阶段写入的）：照实说没有回执记录", statusLineZh(view({ submittedAt: at.toISOString() })).includes("没有回执记录"));
  ok("有记录：方式、回执编号，并写明编号是记录人填的（不说已核实）", statusLineZh(view({ submittedAt: at.toISOString(), record, count: 1 })) === "已提交 · 采购门户 · 回执编号 ABC-123（由记录人填写）" && !/已核实|已验证/.test(statusLineZh(view({ submittedAt: at.toISOString(), record, count: 1 }))));
  ok("没填回执编号、记录过多次：都写出来", statusLineZh(view({ submittedAt: at.toISOString(), record: { ...record, receiptRef: null }, count: 3 })) === "已提交 · 采购门户 · 没有填回执编号 · 共记录 3 次，显示的是最新一次");
  ok("按钮上的字随情形变", openButtonZh("first") === "记录已提交" && openButtonZh("backfill") === "补记提交时间" && openButtonZh("correction") === "更正");
  ok("确认框：第一次写明会标为已提交、会通知成员、不能撤销；补记写明不改投标结果；更正写明之前的记录不会被删", confirmTextZh("first").includes("标为「已提交」") && confirmTextZh("first").includes("成员会收到通知") && confirmTextZh("first").includes("不能撤销") && confirmTextZh("backfill").includes("不改投标结果") && confirmTextZh("correction").includes("不会被删除"));
  ok("项目来自外部来源系统时，第一次记录的确认框多说一句会把状态同步回去；别的情形不说", confirmTextZh("first", { syncsToSource: true }).includes("同步回这个项目的来源系统") && !confirmTextZh("first").includes("来源系统") && !confirmTextZh("first", { syncsToSource: false }).includes("来源系统") && !confirmTextZh("correction", { syncsToSource: true }).includes("来源系统") && !confirmTextZh("backfill", { syncsToSource: true }).includes("来源系统"));
}

/* ---------- 5. 开关 ---------- */
console.log("开关");
{
  const on = (env: Record<string, string | undefined>, org: string | null = "org1") => isSubmissionRecordEnabledForOrgWithEnv(org, env as NodeJS.ProcessEnv);
  ok("默认关；1 / true / on / yes 算开；别的值算关", !on({}) && ["1", "true", "on", "yes", " TRUE "].every((v) => on({ TENDER_SUBMISSION_RECORD_ENABLED: v })) && ["0", "false", "off", "", "2"].every((v) => !on({ TENDER_SUBMISSION_RECORD_ENABLED: v })));
  ok("没有组织：关", !on({ TENDER_SUBMISSION_RECORD_ENABLED: "1" }, null));
  ok("名单：不填 = 所有组织；填了只认名单里的", on({ TENDER_SUBMISSION_RECORD_ENABLED: "1", TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST: "" }) && on({ TENDER_SUBMISSION_RECORD_ENABLED: "1", TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST: "a, org1 ,b" }) && !on({ TENDER_SUBMISSION_RECORD_ENABLED: "1", TENDER_SUBMISSION_RECORD_ORG_ALLOWLIST: "a,b" }));
  ok("与「下一步」的开关互不影响：只开那一个，这个仍是关的", !on({ TENDER_WEB_NEXT_STEP_ENABLED: "1" }));
}

/* ---------- 6. 「下一步」卡片 ---------- */
console.log("「下一步」卡片指到哪里");
{
  const base: WebNextStepInput = {
    now: NOW, projectId: "p1", projectName: "示例标", closedLabelZh: null, won: false, closeDate: ago(3 * DAY), submittedAt: null,
    documentCount: 2, parsingActive: false, analysisStatus: "APPROVED", latestAnalysisFailed: false, unknownCriticalFacts: 0, mandatoryNonCompliant: 0, pendingRequirementCount: 0, confirmedRequirementCount: 3,
    pendingApprovals: [], latestRound: null, hasProjectQuote: true, hasUsableAnalysis: true, anySent: true, anyQuoted: true, recordedStage: "supplier_quote", stageFrozen: false,
    chaseAfterDays: 3, canManage: true, workspace: null, rfqEntry: null,
  };
  const off = decideWebNextStep(base);
  ok("提交记录没开（不传）：截标已过时与原来逐字相同——去看关键日期", off.rule === "past_closing" && off.action?.labelZh === "去看关键日期" && JSON.stringify(off.action.target) === JSON.stringify({ kind: "tab", tab: "workbench", anchor: "project-key-dates" }) && off.reasonsZh.join("|") === "如果截标时间改过（比如补遗延期）：到工作台的关键日期里更新|如果已经在门户提交了：系统里还没有提交时间" && off.also.length === 0 && JSON.stringify(decideWebNextStep({ ...base, submissionRecordEnabled: false })) === JSON.stringify(off));
  const on = decideWebNextStep({ ...base, submissionRecordEnabled: true });
  ok("提交记录开着：截标已过时去「提交」页签的提交记录；关键日期放在顺带要办的事里", on.rule === "past_closing" && on.headlineZh === off.headlineZh && on.action?.labelZh === "去记录提交" && JSON.stringify(on.action.target) === JSON.stringify({ kind: "tab", tab: "submission", anchor: "submission-record" }) && on.reasonsZh[0].includes("记下实际提交的时间与回执") && on.also.length === 1 && on.also[0].target.kind === "tab" && JSON.stringify(on.also[0].target) === JSON.stringify(off.action.target) && NEXT_STEP_ANCHORS.submissionRecord === "submission-record");
  ok("只读成员：同一个位置，并说明这一步要负责人来做", (() => { const v = decideWebNextStep({ ...base, submissionRecordEnabled: true, canManage: false }); return JSON.stringify(v.action?.target) === JSON.stringify(on.action?.target) && v.reasonsZh.some((r) => r.includes("没有修改权限")); })());
  const prepOff = decideWebNextStep({ ...base, closeDate: new Date(NOW.getTime() + 20 * DAY) });
  const prepOn = decideWebNextStep({ ...base, closeDate: new Date(NOW.getTime() + 20 * DAY), submissionRecordEnabled: true });
  ok("准备提交：开着时多一句「交完之后在同一页记下」；没开时与原来相同", prepOff.rule === "prepare_submission" && prepOff.reasonsZh.join("|") === "到「提交」页核对提交材料与截标时间" && prepOn.reasonsZh.length === 2 && prepOn.reasonsZh[1].includes("记下实际提交的时间与回执") && JSON.stringify(prepOn.action) === JSON.stringify(prepOff.action));
  ok("已有提交时间：开不开都是「已提交，等开标结果」", [true, false].every((e) => decideWebNextStep({ ...base, submittedAt: ago(DAY), submissionRecordEnabled: e }).rule === "submitted"));
  ok("卡片里没有金额", !/[$¥￥]|\d\s*%/.test(JSON.stringify([on, off, prepOn])));
}

/* ---------- 7. 接线（源码断言） ---------- */
console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/projects/[id]/submission-record/route.ts");
  const service = read("src/lib/tender-submission/service.ts");
  const contract = read("src/lib/tender-submission/contract.ts");
  const transition = read("src/lib/tender/stage-transition.ts");
  const tasks = read("src/lib/tender/stage-tasks.ts");
  const tab = read("src/components/project-detail/tabs/submission-tab.tsx");
  const card = read("src/components/tender/submission-record-card.tsx");
  const nextService = read("src/lib/tender-next-step/service.ts");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const [getBody, postBody] = (() => { const i = route.indexOf("export async function GET"), j = route.indexOf("export async function POST"); return [route.slice(i, j), route.slice(j)]; })();

  ok("接口：读取要项目读权限，记录要项目写权限", getBody.includes("requireProjectReadAccess(request, projectId)") && !code(getBody).includes("requireProjectWriteAccess") && postBody.includes("requireProjectWriteAccess(request, projectId)") && !code(postBody).includes("requireProjectReadAccess"));
  ok("接口：「能不能记录」与写接口的判断逐条相同——超级管理员不看分发；其余人项目须已分发，且是负责人、组织管理员或项目管理员", /const canRecord =\s*isSuperAdmin\(user\.role\) \|\|\s*\(project\.intakeStatus === "dispatched" &&\s*\(project\.ownerId === user\.id \|\|\s*\(!!orgRole && hasOrgRole\(orgRole, "org_admin"\)\) \|\|\s*\(!!projectRole && hasProjectRole\(projectRole, "project_admin"\)\)\)\);/.test(getBody) && postBody.includes("loadSubmissionRecordView({ projectId, orgId, canRecord: true })"));
  ok("接口：开关关闭、没有组织、不是招投标项目 → 404（读与写同一句判断）；组织取自项目记录", (route.match(/if \(!orgId \|\| !isSubmissionRecordEnabledForOrg\(orgId\) \|\| project\.workDomain !== "tender"\) return notEnabled\(\);/g) ?? []).length === 2 && (route.match(/const orgId = project\.orgId;/g) ?? []).length === 2 && !/body\.orgId|searchParams/.test(code(route)));
  ok("接口：先校验、校验不过就返回 400，之后才写", postBody.indexOf("parseSubmissionInput(body, new Date())") > 0 && postBody.indexOf("parseSubmissionInput(body, new Date())") < postBody.indexOf("{ status: 400 }") && postBody.indexOf("{ status: 400 }") < postBody.indexOf("recordSubmission({"));
  ok("写入：第一次走既有的阶段推进——时间用人填的、不建新阶段的任务、标明是人确认过的", /advanceProjectStage\(\{\s*projectId, targetStage: "submission", reason: "在项目页上记录提交", source: "manual", actor, humanConfirmed: true,\s*occurredAt: value\.submittedAt, skipStageTasks: true,/.test(service));
  ok("写入：第一次记录带着读到的项目状态与招投标状态去推进——这期间别人记了投标结果或放弃了项目，就不推进", code(service).includes("expected: { status: project.status, tenderStatus: project.tenderStatus },") && /where: \{ id: projectId, \[timestampField\]: null, \.\.\.\(expected \? \{ status: expected\.status, tenderStatus: expected\.tenderStatus \} : \{\}\) \},/.test(transition));
  ok("读取：显示的那条记录是「最新的、记的就是项目上这个提交时间」的那一条", service.includes("const latest = submittedIso ? recent.find((r) => parseStoredRecord(r.afterData)?.submittedAt === submittedIso) : undefined;") && /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\], take: RECENT_RECORDS/.test(service));
  ok("写入：事务里重读之后再判一次「能不能记录」与「是哪种情形」（读与写之间项目可能刚变）", (() => { const tx = service.slice(service.indexOf("return db.$transaction(")); return tx.indexOf("const blockedNow = blockedReasonZh(fresh);") > tx.indexOf("tx.project.findFirst") && tx.includes("if (blockedNow) return { ok: false, status: 409, error: blockedNow };") && tx.includes('if (kind === "first") return { ok: false, status: 409,') && tx.indexOf('if (kind === "first")') < tx.indexOf("tx.project.update("); })());
  ok("写入：阶段推进不放行时（比如不允许的阶段变化）原样返回它的理由，不往下走、不留记录", /if \(!advanced\.success\) return \{ ok: false, status: 409, error: advanced\.reason \};\s*if \(advanced\.decision !== "no_op"\) \{/.test(service));
  ok("写入：更正与补记在一个事务里——先锁项目行、重读、只改提交时间、追加记录；不动招投标状态", (() => { const tx = service.slice(service.indexOf("return db.$transaction(")); const lock = tx.indexOf('FROM "Project" WHERE id = ${projectId} FOR NO KEY UPDATE'); const reread = tx.indexOf("tx.project.findFirst"); const upd = tx.indexOf("tx.project.update({ where: { id: projectId }, data: { submittedAt: value.submittedAt } })"); const audit = tx.indexOf("writeAuditLog(tx,"); return lock > 0 && lock < reread && reread < upd && upd < audit && !/data: \{[^}]*tenderStatus/.test(tx) && (tx.match(/tx\.project\.update\(/g) ?? []).length === 1; })());
  ok("写入：记录是追加的审计行；这个模块不删、不改任何审计行", service.includes("action: SUBMISSION_AUDIT_ACTION") && !/auditLog\.(update|updateMany|delete|deleteMany|upsert)\(/.test(service) && (service.match(/writeAuditLog\(/g) ?? []).length === 2);
  ok("读取与写入都按项目与组织两个条件找项目；记录也按组织与项目两个条件读", (service.match(/where: \{ id: (input\.)?projectId, orgId(: input\.orgId)? \}/g) ?? []).length === 3 && service.includes("const where = { orgId: input.orgId, projectId: input.projectId, action: SUBMISSION_AUDIT_ACTION, targetType: SUBMISSION_AUDIT_TARGET, targetId: input.projectId };"), service.match(/where: \{ id: [^}]+\}/g));
  ok("这个模块自己不发邮件、不发请求、不调模型、不碰门户（第一次记录经阶段推进会触发它既有的来源系统回调——那不在这三个文件里，见设计 D1）", !/fetch\(|sendMail|gmail|nodemailer|createCompletion|openai|anthropic|puppeteer|playwright/i.test(code(service) + code(route) + code(contract)) && transition.includes("notifyProjectStatusChange({"));
  ok("校验与判定是纯的：不访问数据库", !/@\/lib\/db|prisma/i.test(code(contract)));
  ok("阶段推进：两个新参数不传时与原来相同（时间是现在、照旧处理新阶段的任务）", transition.includes("const now = occurredAt ?? new Date();") && transition.includes("onStageAdvancedTasks(projectId, currentStage, targetStage, actor.id, { skipCreate: !!skipStageTasks })") && tasks.includes("opts: { skipCreate?: boolean } = {},") && /if \(opts\.skipCreate\) return;\s*const templates = STAGE_TASK_TEMPLATES\[toStage\];/.test(tasks) && tasks.indexOf("if (opts.skipCreate) return;") > tasks.indexOf('status: "done",'));
  ok("阶段推进：只有阶段时间还是空的才写（同时点两次，后到的那个一行也改不到、整个事务作废）", /where: \{ id: projectId, \[timestampField\]: null, [^}]*\} : \{\}\) \},\s*data,/.test(transition) && transition.includes("if (claimed.count === 0) throw new StageAlreadyWritten();") && transition.includes("if (e instanceof StageAlreadyWritten) return alreadyWritten;"));
  ok("「提交」页签挂上了提交记录，记录成功后重新载入项目；接口可用时换掉那句过时的提示", tab.includes("<SubmissionRecordCard projectId={projectId} onAvailable={setRecordAvailable} onRecorded={onReload} />") && /\{recordAvailable\s*\? "提交时间与回执在下面的「提交记录」里记；[^"]*"\s*: "提交\/开标日期在工作台「项目进度 · 关键日期」维护；[^"]*"\}/.test(tab) && tab.includes("const [recordAvailable, setRecordAvailable] = useState(false);") && tab.includes('project.submittedAt ? (recordAvailable ? toDatetimeLocal(new Date(project.submittedAt)).slice(0, 10) : project.submittedAt.slice(0, 10)) : "尚未提交"'));
  ok("卡片：接口不可用时什么都不渲染；没有写权限或不能记录时没有按钮；保存前先校验、再确认", card.includes("if (!view) return null;") && card.includes("{view.canRecord && kind && step === \"closed\" ? (") && card.includes("const checked = parseSubmissionInput(") && card.indexOf("if (!checked.ok) {") > 0 && /if \(!checked\.ok\) \{\s*setError\(checked\.errors\.join\("；"\)\);\s*return;\s*\}/.test(card) && card.indexOf("if (!checked.ok) {") < card.indexOf('setStep("confirm");') && card.includes("{confirmTextZh(kind, { syncsToSource: view.syncsToSource })}") && card.includes("id={NEXT_STEP_ANCHORS.submissionRecord}"));
  const toConfirmBody = card.slice(card.indexOf("const toConfirm = () => {"), card.indexOf("const save = async () => {"));
  ok("卡片只在点了「确认保存」之后才发写请求：写请求只在 save 里；save 只挂在确认那个按钮上；「保存」按钮只是进确认那一步", (card.match(/method: "POST"/g) ?? []).length === 1 && card.indexOf('method: "POST"') > card.indexOf("const save = async () => {") && (card.match(/\bsave\(\)/g) ?? []).length === 1 && /<button type="button" onClick=\{\(\) => void save\(\)\} disabled=\{saving\} data-testid="submission-record-save"/.test(card) && toConfirmBody.length > 50 && !/save\(|apiFetch/.test(toConfirmBody) && /<button type="button" onClick=\{toConfirm\}[^>]*data-testid="submission-record-next"/.test(card));
  ok("卡片：接口可用才告诉上层「可用」（不是恒为真）；时间用按日期换算的工具；没动过时间时原样发回已有的时刻", card.includes("onAvailable?.(!!data?.view);") && card.includes("onAvailable?.(false);") && !/onAvailable\?\.\(true\)/.test(card) && !/getTimezoneOffset/.test(card) && card.includes("submittedAtToSend({ fieldValue: when, touched: whenTouched, existing: view.submittedAt })") && card.includes("setWhenTouched(true);") && card.includes('setNote(view.record?.note ?? "");') && card.includes("confirmTextZh(kind, { syncsToSource: view.syncsToSource })"));
  ok("「下一步」取数时读这个开关（按项目的组织）", nextService.includes("submissionRecordEnabled: isSubmissionRecordEnabledForOrg(orgId),"));
}

console.log(`\n✓ submission-record: ${passed} 项断言全部通过`);
