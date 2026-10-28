/**
 * Muse Bridge 跨助理询问与回复（TASKFLOW S2）— 纯逻辑测试（零 DB）
 * 运行：npx tsx src/lib/muse-bridge/__tests__/inquiry-pure.test.ts
 */

import assert from "node:assert/strict";
import { MUSE_BRIDGE_CONTRACT_VERSION, MUSE_PHASE0_INTENTS, parseMuseCommand } from "../contract";
import { buildMuseEvent } from "../events-pure";
import { enabledMuseIntents } from "../flags";
import { gateIntent } from "../router-pure";
import { buildOpportunityStatus, type SalesOppRow } from "../sales-pure";
import {
  INQUIRY_CREATED_ACTION,
  INQUIRY_REPLIED_ACTION,
  defaultInquiryQuestions,
  employeeConfirmationsView,
  inquiryReceivedEventInput,
  inquiryRepliedEventInput,
  normalizeQuestions,
  normalizeReply,
  openInquiriesView,
  parseDetail,
  replyCommentText,
  type InquiryRecord,
} from "../inquiry-pure";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-28T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const base = { contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId: "req-s2-0001", orgId: "org_1", museUserRef: "muse:mgr" };

console.log("contract");
ok("ask_colleague 合法", parseMuseCommand({ ...base, command: { intent: "ask_colleague", opportunityId: "o1", questions: ["进展如何？"] } }).ok);
ok("ask_colleague 至少 1 个问题", !parseMuseCommand({ ...base, command: { intent: "ask_colleague", opportunityId: "o1", questions: [] } }).ok);
ok("ask_colleague 最多 5 个问题", !parseMuseCommand({ ...base, command: { intent: "ask_colleague", opportunityId: "o1", questions: ["1", "2", "3", "4", "5", "6"] } }).ok);
{
  const r = parseMuseCommand({ ...base, command: { intent: "ask_colleague", opportunityId: "o1", questions: ["a"], assigneeUserId: "u_x", to: "u_y" } });
  ok("请求不能指定收件人：多余字段被丢弃", r.ok && !("assigneeUserId" in r.value.command) && !("to" in r.value.command));
}
ok("reply_inquiry 合法", parseMuseCommand({ ...base, command: { intent: "reply_inquiry", inquiryId: "t1", nextStep: "周五发修订报价", needs: ["quote_revision"] } }).ok);
ok("reply_inquiry 缺下一步拒绝", !parseMuseCommand({ ...base, command: { intent: "reply_inquiry", inquiryId: "t1" } }).ok);
ok("reply_inquiry 未知支持类型拒绝", !parseMuseCommand({ ...base, command: { intent: "reply_inquiry", inquiryId: "t1", nextStep: "x", needs: ["money"] } }).ok);
ok("两个意图默认不开放", !MUSE_PHASE0_INTENTS.includes("ask_colleague") && !MUSE_PHASE0_INTENTS.includes("reply_inquiry"));
{
  const r = gateIntent("req-s2-gate", { intent: "ask_colleague", opportunityId: "o1", questions: ["a"] }, enabledMuseIntents({} as NodeJS.ProcessEnv));
  ok("未开放时诚实拒绝并说明属于 Sales Pilot", !!r && r.errorCode === "INTENT_NOT_ENABLED" && r.message.includes("Sales Pilot（Phase S）"));
}

console.log("questions and replies");
ok("问题去空去重保序", JSON.stringify(normalizeQuestions([" 进展？ ", "", "进展？", "下一步？"])) === JSON.stringify(["进展？", "下一步？"]));
{
  const all = defaultInquiryQuestions({ customerWaiting: true, followupOverdue: true, actionsOverdue: false, stale: true });
  ok("默认问题最多 3 条", all.length === 3);
  ok("客户在等回复时先问怎么回", all[0].includes("客户最近来信"));
  const none = defaultInquiryQuestions(null);
  ok("没有信号时只问下一步", none.length === 1 && none[0].startsWith("下一步"));
}
{
  const reply = normalizeReply({ nextStep: " 周五发修订报价 ", customerFeedback: "  ", needs: ["sample", "sample", "meeting"], nextStepDueAt: "2026-10-31T00:00:00.000Z" });
  ok("回复规整：空反馈为 null、支持去重", reply.customerFeedback === null && JSON.stringify(reply.needs) === JSON.stringify(["sample", "meeting"]));
  const text = replyCommentText(reply);
  ok("评论文本含下一步与期限", text.startsWith("下一步：周五发修订报价（2026-10-31 前）"));
  ok("评论文本把支持需求翻成中文", text.includes("需要支持：样板、会议"));
}
ok("活动记录解析：坏 JSON 与错类型都当作没有", parseDetail("{bad", INQUIRY_CREATED_ACTION) === null && parseDetail(JSON.stringify({ kind: "x" }), INQUIRY_CREATED_ACTION) === null);

console.log("events");
{
  const received = buildMuseEvent(inquiryReceivedEventInput({
    orgId: "org_1", assigneeUserId: "u_rep", inquiryId: "t1", opportunityId: "o1", opportunityTitle: "Lobby roller shades",
    askerName: "Morgan", questionCount: 2, dueAt: new Date("2026-10-29T12:00:00Z"),
  }));
  ok("inquiry.received 信封合法，带 inquiryId 与 opportunityId", !!received && received.type === "inquiry.received" && received.inquiryId === "t1" && received.opportunityId === "o1");
  ok("事件 ID 按询问固定（重复发出会被 sourceKey 去重）", received?.eventId === "inquiry.received:t1");
  const replied = buildMuseEvent(inquiryRepliedEventInput({
    orgId: "org_1", askerUserId: "u_mgr", inquiryId: "t1", opportunityId: "o1", opportunityTitle: "Lobby roller shades",
    replierName: "Avery", nextStep: "周五发修订报价",
  }));
  ok("inquiry.replied 发给发起人，摘要含下一步", !!replied && replied.userId === "u_mgr" && replied.summary.includes("周五发修订报价"));
  const leaky = buildMuseEvent(inquiryRepliedEventInput({
    orgId: "org_1", askerUserId: "u_mgr", inquiryId: "t2", opportunityId: "o1", opportunityTitle: "x", replierName: "Avery", nextStep: "毛利压到 20%",
  }));
  ok("事件摘要命中敏感词整段脱敏", !!leaky && !leaky.summary.includes("毛利"));
}

console.log("status views");
{
  const replyDetail = { kind: INQUIRY_REPLIED_ACTION, channel: "web" as const, ...normalizeReply({ nextStep: "周五发修订报价" }) };
  const records: InquiryRecord[] = [
    { id: "t_open", status: "waiting_internal", dueDate: hoursAgo(1), createdAt: hoursAgo(30), creator: { id: "u_mgr", name: "Morgan" }, assignee: { id: "u_rep", name: "Avery" },
      createdDetail: { kind: INQUIRY_CREATED_ACTION, workflowId: "wf", requestId: "r", opportunityId: "o1", recordVersion: "v", questions: ["Q1"], note: null }, reply: null },
    { id: "t_done", status: "done", dueDate: hoursAgo(-2), createdAt: hoursAgo(5), creator: { id: "u_mgr", name: "Morgan" }, assignee: { id: "u_rep", name: "Avery" },
      createdDetail: null, reply: { at: hoursAgo(2), by: { id: "u_rep", name: "Avery" }, detail: replyDetail } },
    { id: "t_cancelled", status: "cancelled", dueDate: null, createdAt: hoursAgo(50), creator: { id: "u_mgr", name: "Morgan" }, assignee: null, createdDetail: null, reply: null },
  ];
  const confirmations = employeeConfirmationsView(records);
  ok("员工确认只含已回复的，带渠道与下一步", confirmations.length === 1 && confirmations[0].channel === "web" && confirmations[0].nextStep === "周五发修订报价");
  const open = openInquiriesView(records, NOW);
  ok("未结束询问不含已取消的，并标出逾期", open.length === 1 && open[0].inquiryId === "t_open" && open[0].overdue);

  const row: SalesOppRow = {
    id: "o1", title: "Lobby roller shades", stage: "quoted", priority: "warm", estimatedValue: null,
    createdAt: hoursAgo(400), updatedAt: hoursAgo(10), stageChangedAt: null, lastInteractionAt: hoursAgo(20),
    lastCustomerReplyAt: null, lastOutboundAt: null, nextFollowupAt: null, nextActionType: null, nextActionReason: null,
    customer: { id: "c1", name: "Northwind" }, assignee: { id: "u_rep", name: "Avery" }, openActionCount: 0, overdueActionCount: 0,
  };
  const common = { row, interactions: [], actions: [], nextActionLabel: null, followups: [], staleAfterDays: 21, now: NOW };
  const withOpen = buildOpportunityStatus({ ...common, scope: { kind: "org", orgId: "org_1" }, inquiries: records });
  ok("已有未结束询问时不再建议发起新询问", withOpen.advisory.nextStep === null);
  const fresh = buildOpportunityStatus({ ...common, scope: { kind: "org", orgId: "org_1" }, inquiries: [] });
  ok("管理者、无未结束询问 → 下一步是问负责人", fresh.advisory.nextStep?.command.intent === "ask_colleague");
  const own = buildOpportunityStatus({ ...common, scope: { kind: "own", orgId: "org_1", userId: "u_rep" }, inquiries: [] });
  ok("销售角色没有发起询问的下一步", own.advisory.nextStep === null);
  const data = withOpen.data as { employeeConfirmations: unknown[]; openInquiries: unknown[] };
  ok("状态视图同时给出员工确认与未结束询问", data.employeeConfirmations.length === 1 && data.openInquiries.length === 1);
}

console.log(`\nmuse-bridge inquiry-pure: ${passed} passed`);
