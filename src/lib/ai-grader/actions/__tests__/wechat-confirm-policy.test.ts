/**
 * 微信「回数字确认」白名单：枚举全部已知 PendingAction 类型并断言分类。
 * - 已知类型 = PendingActionType 联合类型 = executor 的分发 case（三处必须一致，新增类型会让本测试失败）
 * - 白名单只含内部、低风险类型；所有对外发送 / 改外部可见状态 / 高风险审批的类型都不在内
 * - 未知类型默认排除；微信文案只给白名单动作编号
 * 纯函数，无 DB。运行：npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-policy.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  INQUIRY_REPLY_TYPE,
  WECHAT_CONFIRMABLE_ACTION_TYPES,
  WECHAT_CONFIRM_POLICY,
  isWeChatConfirmableActionType,
  weChatWebOnlyHint,
} from "../wechat-confirm-policy";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";
import { formatGraderResultForWeChat } from "../../format-grader-result-for-wechat";
import { formatPendingActionsForWeChat } from "../format-pending-actions-for-wechat";
import type { AdaptedPendingAction } from "../to-pending-action";
import type { GraderResult } from "../../types";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function unionTypes(): string[] {
  const src = read("src/lib/pending-actions/types.ts");
  const start = src.indexOf("export type PendingActionType =");
  const end = src.indexOf(";", start);
  assert.ok(start >= 0 && end > start, "找到 PendingActionType 定义");
  return [...src.slice(start, end).matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);
}

function executorCases(): string[] {
  const src = read("src/lib/pending-actions/executor.ts");
  const start = src.indexOf("switch (action.type as PendingActionType)");
  assert.ok(start >= 0, "找到 executor 分发 switch");
  const end = src.indexOf("default:", start);
  return [...src.slice(start, end).matchAll(/case "([a-z_]+\.[a-z_]+)":/g)].map((m) => m[1]);
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

console.log("wechat confirm policy");

const KNOWN = sorted(Object.keys(WECHAT_CONFIRM_POLICY));

ok("已知类型三处一致：分类表 = PendingActionType 联合类型 = executor 分发 case", () => {
  assert.deepEqual(KNOWN, sorted(unionTypes()), "分类表与 PendingActionType 不一致：新类型必须在 wechat-confirm-policy.ts 里分类");
  assert.deepEqual(KNOWN, sorted(executorCases()), "分类表与 executor 分发不一致");
  assert.equal(KNOWN.length, 14);
});

const EXPECTED_ALLOWED = sorted([
  "sales.update_followup",
  "sales.update_stage",
  "grader.internal_note",
  "grader.project_task",
  "calendar.create_event",
  "grader.email_draft",
  "marketing.create_campaign_draft",
]);
const EXPECTED_EXTERNAL = sorted([
  "sales.send_inquiry_reply",
  "tender.send_rfq",
  "tender.send_chase",
  "marketing.activate_campaign",
]);
const EXPECTED_REVIEW = sorted([
  "sales.approve_quote_promotion",
  "marketing.approve_research_plan",
  "marketing.propose_context_update",
]);

ok("逐个类型的分类（白名单 / 对外 / 高风险）", () => {
  const by = (p: string) => sorted(KNOWN.filter((t) => WECHAT_CONFIRM_POLICY[t as keyof typeof WECHAT_CONFIRM_POLICY] === p));
  assert.deepEqual(by("wechat_number_ok"), EXPECTED_ALLOWED);
  assert.deepEqual(by("web_only_external"), EXPECTED_EXTERNAL);
  assert.deepEqual(by("web_only_review"), EXPECTED_REVIEW);
  assert.deepEqual(sorted([...EXPECTED_ALLOWED, ...EXPECTED_EXTERNAL, ...EXPECTED_REVIEW]), KNOWN, "每个已知类型恰好一个分类");
});

ok("白名单 = 只含内部低风险类型；任何对外发送 / 高风险类型都不在内", () => {
  assert.deepEqual(sorted(WECHAT_CONFIRMABLE_ACTION_TYPES), EXPECTED_ALLOWED);
  for (const t of [...EXPECTED_EXTERNAL, ...EXPECTED_REVIEW]) {
    assert.equal(isWeChatConfirmableActionType(t), false, `${t} 不能在微信里回数字批准`);
  }
  for (const t of EXPECTED_ALLOWED) assert.equal(isWeChatConfirmableActionType(t), true, t);
});

ok("询盘回复类型与 FDE 常量一致，且被排除", () => {
  assert.equal(INQUIRY_REPLY_TYPE, INQUIRY_REPLY_ACTION_TYPE);
  assert.equal(isWeChatConfirmableActionType(INQUIRY_REPLY_ACTION_TYPE), false);
});

ok("未知 / 新增 / 空类型默认排除", () => {
  for (const t of ["marketing.send_blast", "trade.send_whatsapp", "publish.job", "SALES.UPDATE_STAGE", "", null, undefined]) {
    assert.equal(isWeChatConfirmableActionType(t), false, String(t));
  }
});

ok("提示文案：询盘回复指向今日询盘，其余指向审批中心，都没有则为空", () => {
  assert.equal(weChatWebOnlyHint({ inquiryReplies: 0, others: 0 }), "");
  const a = weChatWebOnlyHint({ inquiryReplies: 2, others: 0 });
  assert.ok(a.includes("2 封询盘回复") && a.includes("今日询盘") && !a.includes("审批中心"));
  const b = weChatWebOnlyHint({ inquiryReplies: 0, others: 3 });
  assert.ok(b.includes("3 个待审批动作") && b.includes("审批中心") && !b.includes("今日询盘"));
  const c = weChatWebOnlyHint({ inquiryReplies: 1, others: 1 });
  assert.ok(c.includes("今日询盘") && c.includes("审批中心"));
});

const adapted = (pendingType: AdaptedPendingAction["pendingType"], title: string, id: string): AdaptedPendingAction => ({
  ok: true,
  actionId: id,
  pendingType,
  title,
  preview: title,
  executable: true,
});

ok("微信体检文案：只给白名单动作编号，编号顺序与批次一致；对外动作只列标题不给编号", () => {
  const result = {
    score: 70,
    riskLevel: "MEDIUM",
    summary: "",
    issues: [{ title: "Maple Home Goods 报价 5 天未跟进" }],
  } as unknown as GraderResult;
  const text = formatGraderResultForWeChat(result, [
    adapted("grader.internal_note", "记一条内部备注", "a1"),
    adapted("tender.send_rfq", "给供应商发询价", "a2"),
    adapted("grader.project_task", "建跟进任务", "a3"),
  ]);
  assert.ok(text.includes("1 = 记一条内部备注"));
  assert.ok(text.includes("2 = 建跟进任务"));
  assert.ok(!/\d = 给供应商发询价/.test(text) && text.includes("· 给供应商发询价"));
  // 当前 Grader 产出的类型都在白名单内：文案与改动前一致
  const same = formatGraderResultForWeChat(result, [
    adapted("grader.email_draft", "生成跟进邮件草稿", "b1"),
    adapted("calendar.create_event", "明早 9 点提醒", "b2"),
  ]);
  assert.ok(same.includes("1 = 生成跟进邮件草稿") && same.includes("2 = 明早 9 点提醒") && !same.includes("网页看完内容"));
});

ok("通用草稿文案同理", () => {
  const text = formatPendingActionsForWeChat([
    adapted("sales.send_inquiry_reply", "回复 Example Textiles 询盘", "c1"),
    adapted("sales.update_followup", "下次跟进改到周五", "c2"),
  ]);
  assert.ok(text.includes("1 = 下次跟进改到周五") && text.includes("· 回复 Example Textiles 询盘"));
  assert.ok(!text.includes("2 ="));
  const onlyExternal = formatPendingActionsForWeChat([adapted("tender.send_chase", "催单", "d1")]);
  assert.ok(!onlyExternal.includes("回复编号") && onlyExternal.includes("· 催单"));
});

console.log(`  ${pass} passed`);
