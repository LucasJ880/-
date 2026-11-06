/**
 * W-1 询价 Web 入口 — 纯逻辑测试（入口状态 / 错误文案 / 状态行 / 耗时 / 预览白名单）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/web-entry-pure.test.ts
 */
import assert from "node:assert/strict";
import {
  assembleEntryPreview,
  autoIngestNote,
  decideRfqEntryState,
  elapsedLabel,
  orderEntrySuppliers,
  rfqErrorToUserMessage,
  roundStatusLine,
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

console.log("W-1 入口状态：六种不可发原因与优先级");
{
  const s1 = decideRfqEntryState({ ...base, lock: pendingLock, sender: { ok: false, errorCode: "SENDER_NOT_CONNECTED" } });
  ok("待批发送卡优先于授权邮箱未连接", !s1.enabled && s1.reason === "pending_approval");
  ok("待批发送卡 → 出路指向该轮（页内锚点）", s1.action?.href === "#rfq-round-inq2" && s1.action.label === "去批准");
  ok("待批发送卡说明含轮次号", s1.message.includes("第 2 轮"));

  const s2 = decideRfqEntryState({ ...base, lock: recentLock, confirmedRequirementCount: 0 });
  ok("轮次锁优先于没有已确认要求", s2.reason === "recently_sent");
  ok("轮次锁说明含日期（组织时区）与锁定天数", s2.message === "第 2 轮 11-04 刚发出，3 天内不开新轮。");
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

  for (const s of [s1, s2, s3, s4, s5, s6]) ok(`不可发说明不含错误码 / 英文枢纽词（${s.reason}）`, noWord(s.message));
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
  for (const code of ["ROUND_LOCKED", "NO_SUPPLIERS", "SUPPLIERS_NOT_READY", "NO_CONFIRMED_REQUIREMENTS", "SENSITIVE_LEAK", "PROJECT_NOT_FOUND", "DRAFT_FAILED"] as const) {
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

console.log(`\nW-1 web-entry-pure: ${passed} passed`);
