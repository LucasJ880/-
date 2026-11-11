/**
 * W-1 询价 Web 入口 — 纯逻辑测试（入口状态 / 错误文案 / 状态行 / 耗时 / 预览白名单）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { partitionSuppliers } from "../round-pure";
import {
  approvalStatusNote,
  assembleEntryPreview,
  autoIngestNote,
  decideRfqEntryState,
  elapsedLabel,
  friendlyExecutionError,
  monthDay,
  orderEntrySuppliers,
  rfqErrorToUserMessage,
  roundStatusLine,
  CHASE_FAILED_HINT,
  chaseBadge,
  chaseErrorText,
  chaseOutcomeFromMessage,
  chasePanelCopy,
  chaseStillNeeded,
  itemStatusLabel,
  initialExpandedRound,
  previewEmailsFromPayload,
  RFQ_ROUND_ANCHOR_PREFIX,
  roundIdFromHash,
  type RfqEntryFacts,
} from "../web-entry-pure";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const TZ = "America/Toronto";
const base: RfqEntryFacts = {
  projectId: "p1",
  lock: { locked: false },
  confirmedRequirementCount: 12,
  readySupplierCount: 3,
  buildError: null,
  sender: { ok: true },
  hasReadScope: true,
  mailboxEmail: "lucas@sunnyshutter.ca",
  fromEmail: "project@sunnyshutter.ca",
  replyBy: "2026-11-13",
  timeZone: TZ,
};
const pendingLock: RfqEntryFacts["lock"] = { locked: true, reason: "pending_approval", inquiryId: "inq2", roundNumber: 2, at: "2026-11-04T15:00:00Z", days: 3 };
const recentLock: RfqEntryFacts["lock"] = { locked: true, reason: "recently_sent", inquiryId: "inq2", roundNumber: 2, at: "2026-11-04T15:00:00Z", days: 3 };
const noWord = (s: string) => !/[A-Z_]{6,}/.test(s) && !/errorCode|undefined|null/.test(s);

console.log("W-1 入口状态：可发");
{
  const s = decideRfqEntryState(base);
  ok("可发 → enabled 且无原因", s.enabled && s.reason === null && s.action === null);
  ok("可发说明 = 发件地址 · 已确认要求条数 · 回复截止", s.message === "将从 project@sunnyshutter.ca 发出 · 已确认要求 12 条 · 回复截止 11-13");
  ok("权限齐全时没有提醒", s.warnings.length === 0);
  const noReply = decideRfqEntryState({ ...base, replyBy: null });
  ok("没有截标日 → 说明里写「回复截止：请尽快」", noReply.message.endsWith("回复截止：请尽快"));
  const onlyCompose = decideRfqEntryState({ ...base, hasReadScope: false });
  ok("只缺读信权限 → 仍可发", onlyCompose.enabled);
  ok("只缺读信权限 → 提醒「回信不会自动进表」", onlyCompose.warnings.some((w) => w.includes("回信不会自动进表")));
}

console.log("W-1 入口状态：七种不可发原因与优先级");
{
  const s1 = decideRfqEntryState({ ...base, lock: pendingLock, sender: { ok: false, errorCode: "SENDER_NOT_CONNECTED" } });
  ok("待批发送卡优先于授权邮箱未连接", !s1.enabled && s1.reason === "pending_approval");
  ok("待批发送卡 → 出路指向该轮（页内锚点）", s1.action?.href === "#rfq-round-inq2" && s1.action.label === "去批准");
  ok("待批发送卡说明含轮次号", s1.message.includes("第 2 轮"));

  const s2 = decideRfqEntryState({ ...base, lock: recentLock, confirmedRequirementCount: 0 });
  ok("轮次锁优先于没有已确认要求", s2.reason === "recently_sent");
  ok("轮次锁说明含发起日期（组织时区）与锁定天数", s2.message === "第 2 轮（11-04 发起）已发出，3 天内不开新轮。");
  ok("轮次锁出路 = 查看第 2 轮", s2.action?.label === "查看第 2 轮" && s2.action.href === "#rfq-round-inq2");

  const s3 = decideRfqEntryState({ ...base, confirmedRequirementCount: 0, buildError: "NO_CONFIRMED_REQUIREMENTS", sender: { ok: false, errorCode: "SENDER_NOT_CONNECTED" } });
  ok("没有已确认要求优先于授权邮箱", s3.reason === "no_confirmed_requirements");
  ok("没有已确认要求 → 出路去需求 tab", s3.action?.href === "/projects/p1?tab=requirements");
  const s3b = decideRfqEntryState({ ...base, confirmedRequirementCount: 0 });
  ok("已确认要求为 0（即使预构建没报错）也不可发", s3b.reason === "no_confirmed_requirements");

  const s4 = decideRfqEntryState({ ...base, buildError: "SENSITIVE_LEAK", sender: { ok: false, errorCode: "SENDER_NO_COMPOSE_SCOPE" } });
  ok("敏感内容拦截优先于授权缺发信权限", s4.reason === "sensitive_leak");
  ok("敏感内容说明写明整单不发", s4.message.includes("整单不发") && s4.action?.href === "/projects/p1?tab=requirements");

  const s5 = decideRfqEntryState({ ...base, sender: { ok: false, errorCode: "SENDER_NOT_CONNECTED" } });
  ok("授权邮箱未连接 → 说明含该邮箱、出路去邮箱设置", s5.reason === "sender_not_connected" && s5.message.includes("lucas@sunnyshutter.ca") && s5.action?.href === "/settings/email");
  const s6 = decideRfqEntryState({ ...base, sender: { ok: false, errorCode: "SENDER_NO_COMPOSE_SCOPE" } });
  ok("缺发信权限 → sender_no_compose_scope", s6.reason === "sender_no_compose_scope" && s6.message.includes("发信权限"));
  ok("未连接时不重复提醒读信权限", s5.warnings.length === 0);
  const s7 = decideRfqEntryState({ ...base, readySupplierCount: 0 });
  ok("一家能发的供应商都没有 → no_ready_suppliers，出路去供应商页", s7.reason === "no_ready_suppliers" && s7.action?.href === "/suppliers");
  const s7b = decideRfqEntryState({ ...base, readySupplierCount: 0, sender: { ok: false, errorCode: "SENDER_NOT_CONNECTED" } });
  ok("授权邮箱问题优先于没有可发供应商", s7b.reason === "sender_not_connected");

  for (const s of [s1, s2, s3, s4, s5, s6, s7]) ok(`不可发说明不含错误码 / 英文枢纽词（${s.reason}）`, noWord(s.message));
}

console.log("W-1 错误码 → 人话 + 出路");
{
  const now = new Date("2026-11-06T23:10:00Z");
  const ctx = { projectId: "p1", now, timeZone: TZ };
  const locked = rfqErrorToUserMessage("ROUND_LOCKED", ctx);
  ok("ROUND_LOCKED → 说明 + 查看询价轮次", locked.message.includes("暂时不开新轮") && locked.action?.href === "#rfq-rounds");
  ok("NO_SUPPLIERS → 还没选供应商、无出路", rfqErrorToUserMessage("NO_SUPPLIERS", ctx).message === "还没选供应商。" && rfqErrorToUserMessage("NO_SUPPLIERS", ctx).action === null);
  const notReady = rfqErrorToUserMessage("SUPPLIERS_NOT_READY", { ...ctx, blockedSuppliers: [{ id: "s9", name: "甲厂", reason: "no_email" }, { id: "s8", name: "乙厂", reason: "inactive" }] });
  ok("SUPPLIERS_NOT_READY → 列出名字与原因", notReady.message === "这些供应商还发不了：甲厂（没有邮箱）、乙厂（已停用）。");
  ok("SUPPLIERS_NOT_READY → 出路去第一家补邮箱", notReady.action?.href === "/suppliers/s9" && notReady.action.label === "补邮箱");
  ok("NO_CONFIRMED_REQUIREMENTS → 去需求 tab", rfqErrorToUserMessage("NO_CONFIRMED_REQUIREMENTS", ctx).action?.href === "/projects/p1?tab=requirements");
  ok("SENSITIVE_LEAK → 整单不发", rfqErrorToUserMessage("SENSITIVE_LEAK", ctx).message.includes("整单不发"));
  ok("PROJECT_NOT_FOUND → 返回项目列表", rfqErrorToUserMessage("PROJECT_NOT_FOUND", ctx).action?.href === "/projects");
  const draft = rfqErrorToUserMessage("DRAFT_FAILED", ctx);
  ok("DRAFT_FAILED → 请重试 + 组织时区的时间", draft.message.includes("请重试") && draft.message.includes("11-06 18:10"));
  const free = rfqErrorToUserMessage("FREE_TEXT_SENSITIVE", { ...ctx, field: "补充说明" });
  ok("自己填的内容含内部词 → 指明是哪一栏、不把人引去需求 tab", free.message.startsWith("你填的补充说明里") && free.action === null);
  for (const code of ["ROUND_LOCKED", "NO_SUPPLIERS", "SUPPLIERS_NOT_READY", "NO_CONFIRMED_REQUIREMENTS", "SENSITIVE_LEAK", "PROJECT_NOT_FOUND", "DRAFT_FAILED", "FREE_TEXT_SENSITIVE"] as const) {
    ok(`${code} 的说明不含错误码`, noWord(rfqErrorToUserMessage(code, ctx).message));
  }
}

console.log("W-1 轮次状态行");
{
  const items = (...st: string[]) => st.map((status) => ({ status }));
  ok("3 家已发出、1 家已报价、2 家等回复", roundStatusLine(items("quoted", "sent", "sent"), "2026-11-13", TZ) === "已发出 3 家 · 已报价 1 · 等回复 2（截止 11-13）");
  ok("没有截止日时不写截止", roundStatusLine(items("sent"), null, TZ) === "已发出 1 家 · 等回复 1");
  ok("已回复未报价 / 已拒绝 / 未响应分别计数", roundStatusLine(items("replied", "declined", "no_response", "sent"), null, TZ) === "已发出 4 家 · 已回复 1 · 已拒绝 1 · 未响应 1 · 等回复 1");
  ok("全部有结果", roundStatusLine(items("quoted", "declined"), "2026-11-13", TZ) === "已发出 2 家 · 已报价 1 · 已拒绝 1 · 全部有结果");
  ok("一家都没发出", roundStatusLine(items("pending", "pending"), null, TZ) === "还没发出");
  ok("截止日为完整时间戳时按组织时区取月日", roundStatusLine(items("sent"), "2026-11-14T02:00:00Z", TZ) === "已发出 1 家 · 等回复 1（截止 11-13）");
  ok("截止日是按日期存的 UTC 零点（询价引擎写法）→ 不跨日", roundStatusLine(items("sent"), "2026-11-13T00:00:00.000Z", TZ) === "已发出 1 家 · 等回复 1（截止 11-13）");
  ok("非法时区不抛、按 UTC", roundStatusLine(items("sent"), "2026-11-14T02:00:00Z", "Not/AZone") === "已发出 1 家 · 等回复 1（截止 11-14）");
}

console.log("W-1 monthDay");
{
  ok("Date 对象是 UTC 零点（按日期存）→ 取字面月日", monthDay(new Date("2026-11-13T00:00:00.000Z"), TZ) === "11-13");
  ok("真实时间戳按组织时区", monthDay(new Date("2026-11-14T02:00:00Z"), TZ) === "11-13");
  ok("非法值 → null", monthDay("not a date", TZ) === null);
}

console.log("W-1 审批卡状态说明与执行失败文案");
{
  ok("待批 → 无额外说明", approvalStatusNote("PENDING") === null);
  ok("已批准未执行完 → 正在发出", approvalStatusNote("APPROVED")?.includes("正在发出") === true);
  ok("已过期 → 说明会自动作废、之后可重新发起", (approvalStatusNote("EXPIRED") ?? "").includes("已过期") && (approvalStatusNote("EXPIRED") ?? "").includes("重新"));
  ok("执行失败 → 卡已失效、重新发起", (approvalStatusNote("EXECUTION_FAILED") ?? "").includes("已失效"));
  const g = friendlyExecutionError("已发出 0/3；失败：A厂（invalid_grant）");
  ok("Gmail 授权类英文错误 → 中文说明 + 重新连接", g.includes("Gmail 授权") && !g.includes("invalid_grant"));
  ok("其它失败原文保留并加前缀", friendlyExecutionError("询价内容与审批时不一致，拒绝执行") === "没有发出去：询价内容与审批时不一致，拒绝执行");
  ok("部分成功的结果原样保留", friendlyExecutionError("已发出 2/3：A厂、B厂；失败：C厂（收件地址无效）") === "已发出 2/3：A厂、B厂；失败：C厂（收件地址无效）");
  const sender = friendlyExecutionError("授权邮箱 lucas@sunnyshutter.ca 未连接：请用该邮箱登录青砚 → 设置 → 连接 Gmail，再审批发送。");
  ok("发件授权失败 → 不再叫人「再审批发送」（卡已作废）", sender.startsWith("没有发出去：授权邮箱") && !sender.includes("再审批"));
  ok("部分成功里的英文授权错误只替换括号内", friendlyExecutionError("已发出 1/2：A厂；失败：B厂（invalid_grant: Token has been expired）") === "已发出 1/2：A厂；失败：B厂（Gmail 授权失效）");
}

console.log("W-1 自动进表说明");
{
  const a = autoIngestNote({ hasReadScope: true, chaseAfterDays: 3 });
  ok("有读信权限 → 10 分钟检查 + N 天自动起草催单", a.message === "回信每 10 分钟自动检查并进表；3 天没回会自动起草催单给你批。" && a.action === null);
  const b = autoIngestNote({ hasReadScope: false, chaseAfterDays: 5 });
  ok("缺读信权限 → 说明不会自动进表并给重新授权出路", b.message.includes("回信不会自动进表") && b.action?.href === "/settings/email");
}

console.log("W-1 从发起到发出耗时");
{
  ok("252 秒 → 4 分 12 秒", elapsedLabel("2026-11-06T10:00:00Z", "2026-11-06T10:04:12Z") === "从发起到发出：4 分 12 秒");
  ok("< 1 分钟 → 秒", elapsedLabel("2026-11-06T10:00:00Z", "2026-11-06T10:00:42Z") === "从发起到发出：42 秒");
  ok("整分钟不写 0 秒", elapsedLabel("2026-11-06T10:00:00Z", "2026-11-06T10:05:00Z") === "从发起到发出：5 分");
  ok("≥ 1 小时 → 小时 + 分", elapsedLabel("2026-11-06T10:00:00Z", "2026-11-06T12:07:30Z") === "从发起到发出：2 小时 7 分");
  ok("≥ 1 天 → 天 + 小时", elapsedLabel("2026-11-04T10:00:00Z", "2026-11-06T13:00:00Z") === "从发起到发出：2 天 3 小时");
  ok("缺时间或倒序 → null", elapsedLabel(null, "2026-11-06T10:00:00Z") === null && elapsedLabel("2026-11-06T10:00:00Z", "2026-11-06T09:00:00Z") === null && elapsedLabel("bad", "2026-11-06T10:00:00Z") === null);
}

console.log("W-1 供应商排序");
{
  const list = orderEntrySuppliers(
    [
      { id: "a", name: "C厂", contactEmail: "c@x.com", status: "active" },
      { id: "b", name: "A厂", contactEmail: null, status: "active" },
      { id: "c", name: "B厂", contactEmail: "b@x.com", status: "active" },
      { id: "d", name: "D厂", contactEmail: "d@x.com", status: "inactive" },
    ],
    ["d", "a"],
  );
  ok("常用供应商按偏好顺序排最前", list[0].id === "d" && list[1].id === "a" && list[0].isDefault && list[1].isDefault);
  ok("其余可发的在前、按名称", list[2].id === "c" && list[3].id === "b");
  ok("停用 / 没邮箱标原因且不可选", list[0].ready === false && list[0].blockedReason === "inactive" && list[3].blockedReason === "no_email" && list[2].ready && list[2].blockedReason === null);
  ok("邮箱格式不合法视为没邮箱", orderEntrySuppliers([{ id: "x", name: "X", contactEmail: "not-an-email", status: "active" }], [])[0].blockedReason === "no_email");
  // 与送审时的 round-pure.partitionSuppliers 逐条一致（入口说「可选」= 送审时一定 ready）
  const table = [
    { id: "1", name: "a", contactEmail: "sales@x.com", status: "active" },
    { id: "2", name: "b", contactEmail: "sales@x.com ", status: "active" },
    { id: "3", name: "c", contactEmail: " sales@x.com", status: "active" },
    { id: "4", name: "d", contactEmail: "", status: "active" },
    { id: "5", name: "e", contactEmail: null, status: "active" },
    { id: "6", name: "f", contactEmail: "a@b", status: "active" },
    { id: "7", name: "g", contactEmail: "ok@y.ca", status: "inactive" },
  ];
  const { ready } = partitionSuppliers(table);
  const readyIds = new Set(ready.map((r) => r.id));
  const entryReady = new Set(orderEntrySuppliers(table, []).filter((r) => r.ready).map((r) => r.id));
  ok("入口可选集合 = partitionSuppliers 的 ready 集合", [...readyIds].sort().join() === [...entryReady].sort().join());
}

console.log("W-1 预览白名单（不含敏感商务数字）");
{
  const wide = {
    fromName: "Qyan-Sunny Purchasing",
    fromEmail: "project@sunnyshutter.ca",
    replyBy: "2026-11-13",
    confirmedRequirementCount: 12,
    excludedCount: 3,
    estimatedValue: 250000,
    ourBidPrice: 199000,
    winningBidPrice: 201000,
    margin: 0.22,
    project: { estimatedValue: 250000 },
  };
  const preview = assembleEntryPreview(wide);
  const json = JSON.stringify(preview);
  ok("只保留五个白名单字段", Object.keys(preview).sort().join(",") === "confirmedRequirementCount,excludedCount,fromEmail,fromName,replyBy");
  ok("不含估值 / 我方报价 / 中标价 / 毛利", !/estimatedValue|ourBidPrice|winningBidPrice|margin|250000|199000/.test(json));
}

console.log("T-1 从链接直达询价轮次");
{
  ok("锚点前缀与跳转地址一致", RFQ_ROUND_ANCHOR_PREFIX === "#rfq-round-");
  ok("合法 id → 轮次 id", roundIdFromHash("#rfq-round-cmh1x2y3z0001abcd") === "cmh1x2y3z0001abcd");
  ok("空 / undefined → null", roundIdFromHash("") === null && roundIdFromHash(undefined) === null && roundIdFromHash(null) === null);
  ok("只有前缀没有 id → null", roundIdFromHash("#rfq-round-") === null);
  ok("错前缀 → null", roundIdFromHash("#rfq-rounds") === null && roundIdFromHash("#project-suppliers") === null && roundIdFromHash("rfq-round-abc") === null);
  ok("含多余字符 → null", roundIdFromHash("#rfq-round-abc?x=1") === null && roundIdFromHash("#rfq-round-a/b") === null && roundIdFromHash("#rfq-round-<script>") === null);
  ok("过长 → null", roundIdFromHash(`#rfq-round-${"a".repeat(65)}`) === null);
  const ids = ["r1", "r2", "r3"];
  ok("锚点轮次优先于默认展开（待批轮）", initialExpandedRound({ hashRoundId: "r1", roundIds: ids, currentRoundId: "r2", latestRoundId: "r3" }) === "r1");
  ok("锚点轮次优先于最新一轮", initialExpandedRound({ hashRoundId: "r1", roundIds: ids, currentRoundId: null, latestRoundId: "r3" }) === "r1");
  ok("锚点轮次不属于该项目 → 按默认（待批轮）", initialExpandedRound({ hashRoundId: "x9", roundIds: ids, currentRoundId: "r2", latestRoundId: "r3" }) === "r2");
  ok("没有锚点、没有待批 → 最新一轮", initialExpandedRound({ hashRoundId: null, roundIds: ids, currentRoundId: null, latestRoundId: "r3" }) === "r3");
  ok("当前展开的那轮已不在列表 → 最新一轮", initialExpandedRound({ hashRoundId: null, roundIds: ids, currentRoundId: "gone", latestRoundId: "r3" }) === "r3");
  ok("没有轮次 → null", initialExpandedRound({ hashRoundId: "r1", roundIds: [], currentRoundId: null, latestRoundId: null }) === null);
}

console.log("T-1 催单卡原地审批");
{
  const rfqPayload = { inquiryId: "i1", items: [{ supplierName: "甲厂", to: "a@x.example", subject: "询价", body: "正文A" }, { supplierName: "乙厂", to: "b@x.example", subject: "询价", body: "正文B" }, { supplierName: "坏", to: null, body: "x" }] };
  const prev = previewEmailsFromPayload(rfqPayload);
  ok("询价发送卡：读 items[]，缺收件人的不列", prev.length === 2 && prev[0].supplierName === "甲厂" && prev[1].body === "正文B");
  const chasePayload = { inquiryId: "i1", inquiryItemId: "it1", supplierName: "丙厂", to: "c@x.example", kind: "no_reply", chaseIndex: 1, subject: "Re: 询价", body: "您好，想确认一下报价进度", bodyHash: "h" };
  const one = previewEmailsFromPayload(chasePayload);
  ok("催单卡：单封正文", one.length === 1 && one[0].supplierName === "丙厂" && one[0].to === "c@x.example" && one[0].subject === "Re: 询价" && one[0].body.startsWith("您好"));
  ok("催单卡缺正文 → 不列", previewEmailsFromPayload({ ...chasePayload, body: undefined }).length === 0);
  ok("空 / 非对象 payload → 空", previewEmailsFromPayload(null).length === 0 && previewEmailsFromPayload("x").length === 0 && previewEmailsFromPayload({}).length === 0);

  const first = chasePanelCopy({ kind: "no_reply", chaseIndex: 1, supplierName: "丙厂", roundNumber: 2 });
  ok("第 1 次催单的标题", first.heading === "第 2 轮：给丙厂的第 1 次催单等待批准，批准后在原邮件线程里发出");
  ok("第 2 次催单的标题", chasePanelCopy({ kind: "no_reply", chaseIndex: 2, supplierName: "丙厂", roundNumber: 2 }).heading === "第 2 轮：给丙厂的第 2 次催单等待批准，批准后在原邮件线程里发出");
  const ask = chasePanelCopy({ kind: "missing_fields", chaseIndex: 1, supplierName: "甲厂", roundNumber: 2 });
  ok("追问的标题", ask.heading === "第 2 轮：给甲厂的缺字段追问等待批准，批准后在原邮件线程里发出");
  ok("驳回确认：只是这一封，这一轮不受影响", first.rejectConfirm === "确认驳回？只是这一封不发出，这一轮不受影响。" && !/取消/.test(first.rejectConfirm));
  ok("驳回结果：催单 / 追问", first.rejected === "已驳回，给丙厂的这封催单不会发出。" && ask.rejected === "已驳回，给甲厂的这封追问不会发出。");
  ok("驳回备注", first.rejectNote === "项目页驳回催单");
  ok("没有轮次序号 / 供应商名时回落", chasePanelCopy({ kind: "no_reply", chaseIndex: 1, supplierName: " ", roundNumber: null }).heading === "给供应商的第 1 次催单等待批准，批准后在原邮件线程里发出");
  ok("卡片头计数", chaseBadge(2) === "催单待批 2" && chaseBadge(0) === null);
  ok("失败提示：指去审批中心，只在发送失败时才说会重新起草", CHASE_FAILED_HINT.includes("去审批中心看这张卡现在的状态") && CHASE_FAILED_HINT.includes("如果是发送失败") && !CHASE_FAILED_HINT.includes("问供应商要价"));

  // 还用不用催（与 chase-execute 执行时的判定一致）
  ok("催单：还在「已发出」→ 有用", chaseStillNeeded("no_reply", "sent"));
  ok("催单：已回复 / 已报价 / 未响应 → 不用", !chaseStillNeeded("no_reply", "replied") && !chaseStillNeeded("no_reply", "quoted") && !chaseStillNeeded("no_reply", "no_response"));
  ok("追问：已回复 / 已报价 → 有用", chaseStillNeeded("missing_fields", "replied") && chaseStillNeeded("missing_fields", "quoted"));
  ok("追问：已发出 / 已婉拒 → 不用", !chaseStillNeeded("missing_fields", "sent") && !chaseStillNeeded("missing_fields", "declined"));
  ok("状态没查到 → 不用", !chaseStillNeeded("no_reply", "") && !chaseStillNeeded("missing_fields", ""));
  ok("状态中文", itemStatusLabel("replied") === "已回复" && itemStatusLabel("quoted") === "已报价" && itemStatusLabel("weird") === "已处理");

  // 执行器 message 原文（src/lib/tender-rfq/chase-execute.ts）→ 人话
  const sentPlain = chaseOutcomeFromMessage("已给 丙厂 发出第 1 次催单（回复在原询价线程）");
  ok("发出了：第 1 次催单", sentPlain.kind === "sent" && sentPlain.text === "已给丙厂发出第 1 次催单，回复会在原询价线程里自动进表。", sentPlain);
  const sentNoId = chaseOutcomeFromMessage("已给 甲厂 发出缺字段追问（回复在原询价线程；未取到原 Message-ID，仅按 threadId 归线程）");
  ok("发出了：追问，去掉 Message-ID / threadId 说明", sentNoId.kind === "sent" && sentNoId.text === "已给甲厂发出缺字段追问，回复会在原询价线程里自动进表。" && !/Message-ID|threadId/.test(sentNoId.text), sentNoId);
  const replied = chaseOutcomeFromMessage("丙厂 已回复（replied），这封催单没有发出");
  ok("这家已回复：中性、中文状态、不出现 replied", replied.kind === "skipped" && replied.text === "丙厂现在是「已回复」，这封催单没有发出。" && !/replied/.test(replied.text), replied);
  ok("这家已报价：中文状态", chaseOutcomeFromMessage("丙厂 已回复（quoted），这封催单没有发出").text === "丙厂现在是「已报价」，这封催单没有发出。");
  const again = chaseOutcomeFromMessage("第 2 次催单此前已发出，未重复发送");
  ok("此前已发：中性", again.kind === "skipped" && again.text === "第 2 次催单此前已发出，未重复发送");
  ok("已追问过：中性", chaseOutcomeFromMessage("这家已追问过缺字段，未重复发送").kind === "skipped");
  ok("没有 message → 已批准并发出", chaseOutcomeFromMessage(undefined).text === "已批准并发出。");
  ok("失败原因里的英文状态换成中文", chaseErrorText("当前状态「replied」不需要追问") === "当前状态「已回复」不需要追问");
  ok("没有英文状态的失败原因原样", chaseErrorText("发送失败：timeout") === "发送失败：timeout");
}

console.log("RFQ-AUTO-1 入口与接口接线（源码断言）");
{
  const root = resolve(__dirname, "../../../..");
  const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
  const entry = read("src/lib/tender-rfq/web-entry.ts");
  const service = read("src/lib/tender-rfq/service.ts");
  const roundsRoute = read("src/app/api/projects/[id]/tender-rfq/rounds/route.ts");
  const stopRoute = read("src/app/api/projects/[id]/tender-rfq/rounds/[inquiryId]/follow-up/stop/route.ts");
  const muse = read("src/lib/muse-bridge/router.ts");
  ok("开关关闭：入口的 followUp 为 null（界面据此不显示勾选框与状态）", /if \(!isRfqFollowUpPreapprovalEnabledForOrg\(input\.orgId\)\) return null;/.test(entry));
  ok("授权只在「网页发起 + 明确勾选 + 开关打开」三者同时成立时写进载荷", /input\.source === "web" && input\.autoFollowUp === true && isRfqFollowUpPreapprovalEnabledForOrg\(/.test(service));
  ok("建轮次接口：autoFollowUp 是可选布尔，只有明确为 true 才算勾选", /autoFollowUp: z\.boolean\(\)\.optional\(\)/.test(roundsRoute) && /autoFollowUp: body\.autoFollowUp === true,/.test(roundsRoute));
  ok("停止接口：要求项目写权限，且只有 POST", /requireProjectWriteAccess/.test(stopRoute) && /export async function POST/.test(stopRoute) && !/export async function (GET|PUT|PATCH|DELETE)/.test(stopRoute));
  ok("带授权时标题里写明「含自动跟进授权」（只显示标题的界面也看得出）", /\$\{followUpPolicy \? "（含自动跟进授权）" : ""\}/.test(service));
  const chaseService = read("src/lib/tender-rfq/chase-service.ts");
  ok("扫描只排除已取消 / 已完成的轮次（草稿状态的照旧催）", /status: \{ notIn: \["canceled", "completed"\] \}/.test(chaseService) && !/status: "in_progress",\n\s+\.\.\.\(where\.inquiryId/.test(chaseService));
  ok("代批之前核对库里那张卡的内容，且按组织与类型查", /findFirst\(\{ where: \{ id: input\.actionId, orgId: input\.orgId, type: TENDER_SEND_CHASE_TYPE \}/.test(chaseService) && /sameChaseContent\(stored\.payload, input\.expected\)/.test(chaseService));
  ok("Muse 发起路径调用同一个建轮次函数，但不传 autoFollowUp", /prepareRfqRound\(/.test(muse) && !/autoFollowUp/.test(muse));
}

console.log(`\nW-1 web-entry-pure: ${passed} passed`);
