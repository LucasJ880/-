/**
 * FLOW-H4a 投标提交记录 — 纯逻辑测试 + 接线断言
 * 运行：npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts
 * 真实数据库里的行为另见 submission-record-db.isolated.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TenderStage } from "@/lib/tender/types";
import { NEXT_STEP_ANCHORS } from "@/lib/tender-next-step/targets";
import { decideWebNextStep, type WebNextStepInput } from "@/lib/tender-next-step/web-next-step";
import {
  AFTER_SUBMISSION_STATUSES, FUTURE_TOLERANCE_MS, RECEIPT_REF_MAX, SUBMISSION_AUDIT_ACTION, SUBMISSION_CHANNELS, SUBMISSION_CHANNEL_ZH, SUBMISSION_NOTE_MAX,
  classifySubmission, confirmTextZh, fromDatetimeLocal, openButtonZh, parseStoredRecord, parseSubmissionInput, statusLineZh, toDatetimeLocal, toStoredRecord,
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
  ok("提交方式只认这五种", SUBMISSION_CHANNELS.join() === "portal,email,hand_delivery,mail,other" && SUBMISSION_CHANNELS.every((c) => parse({ ...good, channel: c }).ok && SUBMISSION_CHANNEL_ZH[c].length > 0) && ["fax", "", undefined, "PORTAL", 1].every((c) => errorsOf({ ...good, channel: c }).some((e) => e.includes("提交方式"))));
  const moneyNotes = ["报了 $128,000", "总价 12.8 万元", "毛利 23", "降 5%", "CAD 128000", "¥900", "利润率不错", "估值过高", "128000 元"];
  ok("备注里出现金额、百分比、利润：不保存，并说明原因（不是悄悄替换）", moneyNotes.every((n) => errorsOf({ ...good, note: n }).some((e) => e.startsWith("备注里不要写金额"))), moneyNotes.filter((n) => parse({ ...good, note: n }).ok));
  ok("回执编号里出现金额同样不保存", errorsOf({ ...good, receiptRef: "$128,000" }).some((e) => e.startsWith("回执编号里不要写金额")));
  ok("普通的编号与文字不会被误当成金额", ["CONF-2026-004512", "TB#88213/A", "MERX 0001234567", "REF 2026 11 08"].every((x) => parse({ ...good, receiptRef: x }).ok) && ["门户提交，确认页已存档", "由同事代交，前台签收", "第 2 次上传后成功"].every((x) => parse({ ...good, note: x }).ok));
  ok("长度：回执编号最多 120 字、备注最多 500 字", parse({ ...good, receiptRef: "A".repeat(RECEIPT_REF_MAX) }).ok && errorsOf({ ...good, receiptRef: "A".repeat(RECEIPT_REF_MAX + 1) }).length === 1 && parse({ ...good, note: "字".repeat(SUBMISSION_NOTE_MAX) }).ok && errorsOf({ ...good, note: "字".repeat(SUBMISSION_NOTE_MAX + 1) }).length === 1);
  ok("回执编号不许换行与控制字符；备注可以换行、不许控制字符", errorsOf({ ...good, receiptRef: "ABC\n123" }).length === 1 && errorsOf({ ...good, receiptRef: "ABC\u0007" }).length === 1 && parse({ ...good, note: "第一行\n第二行" }).ok && errorsOf({ ...good, note: "a\u0000b" }).length === 1);
  ok("回执编号、备注不是文字：不保存", errorsOf({ ...good, receiptRef: 123 }).length === 1 && errorsOf({ ...good, note: { a: 1 } }).length === 1);
  ok("内容不是对象：不保存", [null, undefined, "x", 3, [good]].every((b) => !parse(b).ok));
  ok("几项都不对时每一条原因都说出来", errorsOf({ submittedAt: "x", channel: "fax", receiptRef: "$1", note: "5%" }).length === 4);
  ok("请求里多带的字段（别的组织、项目、金额）被无视，不进结果", (() => { const x = parse({ ...good, orgId: "other", projectId: "p", amount: 1, ourBidPrice: 2 }); return x.ok && Object.keys(x.value).sort().join() === "channel,note,receiptRef,submittedAt"; })());
}

/* ---------- 2. 三种情形 ---------- */
console.log("第一次 / 更正 / 补记");
{
  const stages: TenderStage[] = ["initiation", "distribution", "interpretation", "supplier_inquiry", "supplier_quote", "submission"];
  ok("已有提交时间：不管阶段与状态，都是更正", stages.every((s) => [null, "won", "bid_submitted", "pursuing"].every((t) => classifySubmission({ recordedStage: s, submittedAt: ago(DAY), tenderStatus: t }) === "correction")));
  ok("没有提交时间、还没有结果、阶段在提交之前：第一次", stages.slice(0, 5).every((s) => [null, undefined, "", "new", "pursuing", "supplier_quote", "bid_preparation", "under_review"].every((t) => classifySubmission({ recordedStage: s, submittedAt: null, tenderStatus: t }) === "first")));
  ok("没有提交时间、但已经有投标结果或已标为已提交：补记（不走阶段推进，免得把结果改写成「已提交」）", AFTER_SUBMISSION_STATUSES.join() === "bid_submitted,won,lost,passed,no_bid,cancelled,archived,completed,terminated" && AFTER_SUBMISSION_STATUSES.every((t) => stages.every((s) => classifySubmission({ recordedStage: s, submittedAt: null, tenderStatus: t }) === "backfill")) && classifySubmission({ recordedStage: "distribution", submittedAt: null, tenderStatus: "WON" }) === "backfill");
  ok("没有提交时间、阶段记录已算作项目提交：补记", classifySubmission({ recordedStage: "submission", submittedAt: null, tenderStatus: "bid_preparation" }) === "backfill" && classifySubmission({ recordedStage: "submission", submittedAt: null, tenderStatus: null }) === "backfill");
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
  const at = new Date("2026-11-08T20:20:00.000Z");
  ok("时刻 → 本地时间写法：多伦多（比 UTC 晚 5 小时）是下午 3:20，北京（早 8 小时）是次日 4:20", toDatetimeLocal(at, 300) === "2026-11-08T15:20" && toDatetimeLocal(at, -480) === "2026-11-09T04:20" && toDatetimeLocal(at, 0) === "2026-11-08T20:20");
  ok("本地时间写法 → 时刻：与上面互为逆运算", [300, -480, 0, 210, -330].every((tz) => fromDatetimeLocal(toDatetimeLocal(at, tz), tz) === at.toISOString()));
  ok("空的、不是这种写法的：null", [" ", "", "2026-11-08", "昨天", "2026-13-45T99:99"].every((x) => fromDatetimeLocal(x, 0) === null));
  const view = (o: Partial<SubmissionRecordView>): SubmissionRecordView => ({ submittedAt: null, nextKind: "first", blockedZh: null, canRecord: true, record: null, count: 0, ...o });
  const record = { v: 1 as const, kind: "first" as const, submittedAt: at.toISOString(), channel: "portal" as const, receiptRef: "ABC-123", note: null, recordedAt: at.toISOString(), recordedByName: "张三" };
  ok("没有提交时间：还没有提交记录", statusLineZh(view({})) === "还没有提交记录");
  ok("有提交时间、没有记录（在别处推进阶段写入的）：照实说没有回执记录", statusLineZh(view({ submittedAt: at.toISOString() })).includes("没有回执记录"));
  ok("有记录：方式、回执编号，并写明编号是记录人填的（不说已核实）", statusLineZh(view({ submittedAt: at.toISOString(), record, count: 1 })) === "已提交 · 采购门户 · 回执编号 ABC-123（由记录人填写）" && !/已核实|已验证/.test(statusLineZh(view({ submittedAt: at.toISOString(), record, count: 1 }))));
  ok("没填回执编号、记录过多次：都写出来", statusLineZh(view({ submittedAt: at.toISOString(), record: { ...record, receiptRef: null }, count: 3 })) === "已提交 · 采购门户 · 没有填回执编号 · 共记录 3 次，显示的是最新一次");
  ok("按钮上的字随情形变", openButtonZh("first") === "记录已提交" && openButtonZh("backfill") === "补记提交时间" && openButtonZh("correction") === "更正");
  ok("确认框：第一次写明会标为已提交、会通知成员、不能撤销；补记写明不改投标结果；更正写明之前的记录不会被删", confirmTextZh("first").includes("标为「已提交」") && confirmTextZh("first").includes("成员会收到通知") && confirmTextZh("first").includes("不能撤销") && confirmTextZh("backfill").includes("不改投标结果") && confirmTextZh("correction").includes("不会被删除"));
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

  ok("接口：读取要项目读权限，记录要项目写权限", getBody.includes("requireProjectReadAccess(request, projectId)") && !getBody.includes("requireProjectWriteAccess") && postBody.includes("requireProjectWriteAccess(request, projectId)") && !postBody.includes("requireProjectReadAccess"));
  ok("接口：开关关闭、没有组织、不是招投标项目 → 404（读与写同一句判断）；组织取自项目记录", (route.match(/if \(!orgId \|\| !isSubmissionRecordEnabledForOrg\(orgId\) \|\| project\.workDomain !== "tender"\) return notEnabled\(\);/g) ?? []).length === 2 && (route.match(/const orgId = project\.orgId;/g) ?? []).length === 2 && !/body\.orgId|searchParams/.test(code(route)));
  ok("接口：先校验、校验不过就返回 400，之后才写", postBody.indexOf("parseSubmissionInput(body, new Date())") > 0 && postBody.indexOf("parseSubmissionInput(body, new Date())") < postBody.indexOf("{ status: 400 }") && postBody.indexOf("{ status: 400 }") < postBody.indexOf("recordSubmission({"));
  ok("写入：第一次走既有的阶段推进——时间用人填的、不建新阶段的任务、标明是人确认过的", /advanceProjectStage\(\{\s*projectId, targetStage: "submission", reason: "在项目页上记录提交", source: "manual", actor, humanConfirmed: true,\s*occurredAt: value\.submittedAt, skipStageTasks: true,\s*\}\)/.test(service));
  ok("写入：更正与补记在一个事务里——先锁项目行、重读、只改提交时间、追加记录；不动招投标状态", (() => { const tx = service.slice(service.indexOf("return db.$transaction(")); const lock = tx.indexOf('FROM "Project" WHERE id = ${projectId} FOR NO KEY UPDATE'); const reread = tx.indexOf("tx.project.findFirst"); const upd = tx.indexOf("tx.project.update({ where: { id: projectId }, data: { submittedAt: value.submittedAt } })"); const audit = tx.indexOf("writeAuditLog(tx,"); return lock > 0 && lock < reread && reread < upd && upd < audit && !/data: \{[^}]*tenderStatus/.test(tx) && (tx.match(/tx\.project\.update\(/g) ?? []).length === 1; })());
  ok("写入：记录是追加的审计行；这个模块不删、不改任何审计行", service.includes("action: SUBMISSION_AUDIT_ACTION") && !/auditLog\.(update|updateMany|delete|deleteMany|upsert)\(/.test(service) && (service.match(/writeAuditLog\(/g) ?? []).length === 2);
  ok("读取与写入都按项目与组织两个条件找项目", (service.match(/where: \{ id: (input\.)?projectId, orgId(: input\.orgId)? \}/g) ?? []).length === 3, service.match(/where: \{ id: [^}]+\}/g));
  ok("这个模块不发邮件、不发请求、不调模型、不碰门户", !/fetch\(|sendMail|gmail|nodemailer|createCompletion|openai|anthropic|puppeteer|playwright/i.test(code(service) + code(route) + code(contract)));
  ok("校验与判定是纯的：不访问数据库", !/@\/lib\/db|prisma/i.test(code(contract)));
  ok("阶段推进：两个新参数不传时与原来相同（时间是现在、照旧处理新阶段的任务）", transition.includes("const now = occurredAt ?? new Date();") && transition.includes("onStageAdvancedTasks(projectId, currentStage, targetStage, actor.id, { skipCreate: !!skipStageTasks })") && tasks.includes("opts: { skipCreate?: boolean } = {},") && /if \(opts\.skipCreate\) return;\s*const templates = STAGE_TASK_TEMPLATES\[toStage\];/.test(tasks) && tasks.indexOf("if (opts.skipCreate) return;") > tasks.indexOf('status: "done",'));
  ok("阶段推进：只有阶段时间还是空的才写（同时点两次，后到的那个一行也改不到、整个事务作废）", /where: \{ id: projectId, \[timestampField\]: null \},\s*data,/.test(transition) && transition.includes("if (claimed.count === 0) throw new StageAlreadyWritten();") && transition.includes("if (e instanceof StageAlreadyWritten) return alreadyWritten;"));
  ok("「提交」页签挂上了提交记录，记录成功后重新载入项目；接口可用时换掉那句过时的提示", tab.includes("<SubmissionRecordCard projectId={projectId} onAvailable={setRecordAvailable} onRecorded={onReload} />") && tab.includes("提交时间与回执在下面的「提交记录」里记") && tab.includes("提交/开标日期在工作台「项目进度 · 关键日期」维护"));
  ok("卡片：接口不可用时什么都不渲染；没有写权限或不能记录时没有按钮；保存前先校验、再确认", card.includes("if (!view) return null;") && card.includes("{view.canRecord && kind && step === \"closed\" ? (") && card.includes("const checked = parseSubmissionInput(") && card.indexOf("if (!checked.ok) {") < card.indexOf('setStep("confirm");') && card.includes("{confirmTextZh(kind)}") && card.includes("id={NEXT_STEP_ANCHORS.submissionRecord}"));
  ok("卡片只在点了「确认保存」之后才发写请求", (card.match(/method: "POST"/g) ?? []).length === 1 && card.indexOf('method: "POST"') > card.indexOf("const save = async () => {") && (card.match(/onClick=\{\(\) => void save\(\)\}/g) ?? []).length === 1 && card.includes('data-testid="submission-record-save"'));
  ok("「下一步」取数时读这个开关（按项目的组织）", nextService.includes("submissionRecordEnabled: isSubmissionRecordEnabledForOrg(orgId),"));
}

console.log(`\n✓ submission-record: ${passed} 项断言全部通过`);
