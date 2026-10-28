/**
 * Muse Bridge 跟进（TASKFLOW S3）纯逻辑测试
 *
 * npx tsx src/lib/muse-bridge/__tests__/followup-pure.test.ts
 */

import assert from "node:assert/strict";
import { MUSE_BRIDGE_CONTRACT_VERSION, MUSE_PHASE0_INTENTS, parseMuseCommand } from "../contract";
import { buildMuseEvent } from "../events-pure";
import { enabledMuseIntents } from "../flags";
import {
  collaborationTrail,
  followupAssignedEventInput,
  followupUpdatedEventInput,
  followupsView,
  planFollowupUpdate,
  planReminders,
  reminderEventId,
  resolveFollowupAssignee,
  type FollowupRecord,
  type ReminderFollowup,
} from "../followup-pure";
import { followupSuggestion, inquiryRepliedEventInput } from "../inquiry-pure";
import { gateIntent } from "../router-pure";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const HOUR = 3_600_000;
const now = new Date("2026-10-28T12:00:00.000Z");
const later = (h: number) => new Date(now.getTime() + h * HOUR);
const base = { contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId: "req-s3-0001", orgId: "org_1", museUserRef: "muse:mgr" };

console.log("contract");
ok("create_followup 合法", parseMuseCommand({ ...base, command: { intent: "create_followup", opportunityId: "o1", title: "周五电话", dueAt: later(24).toISOString() } }).ok);
ok("create_followup 缺期限拒绝", !parseMuseCommand({ ...base, command: { intent: "create_followup", opportunityId: "o1", title: "周五电话" } }).ok);
ok("update_followup 不能改回 open", !parseMuseCommand({ ...base, command: { intent: "update_followup", followupId: "f1", status: "open" } }).ok);
ok("update_followup 不能标 auto_resolved", !parseMuseCommand({ ...base, command: { intent: "update_followup", followupId: "f1", status: "auto_resolved" } }).ok);
ok("两个意图默认不开放", !MUSE_PHASE0_INTENTS.includes("create_followup") && !MUSE_PHASE0_INTENTS.includes("update_followup"));
{
  const r = gateIntent("req-s3-gate", { intent: "create_followup", opportunityId: "o1", title: "x", dueAt: later(1).toISOString() }, enabledMuseIntents({} as NodeJS.ProcessEnv));
  ok("未开放时诚实拒绝并说明属于 Sales Pilot", !!r && r.errorCode === "INTENT_NOT_ENABLED" && r.message.includes("Sales Pilot（Phase S）"));
}

console.log("assignee");
{
  const own = { kind: "own" as const, orgId: "org_1", userId: "u_a" };
  const org = { kind: "org" as const, orgId: "org_1" };
  const a = resolveFollowupAssignee({ scope: own, callerId: "u_a", opportunityAssigneeId: "u_a" });
  ok("销售给自己负责的商机建：负责人是自己", a.ok && a.assigneeId === "u_a");
  const b = resolveFollowupAssignee({ scope: own, callerId: "u_a", opportunityAssigneeId: "u_b" });
  ok("销售给别人负责的商机建：越权", !b.ok && b.errorCode === "PERMISSION_DENIED");
  const c = resolveFollowupAssignee({ scope: own, callerId: "u_a", opportunityAssigneeId: "u_a", requested: "u_b" });
  ok("销售指定别人当负责人：越权", !c.ok && c.errorCode === "PERMISSION_DENIED");
  const d = resolveFollowupAssignee({ scope: org, callerId: "u_m", opportunityAssigneeId: "u_a" });
  ok("管理者缺省给商机负责人", d.ok && d.assigneeId === "u_a");
  const e = resolveFollowupAssignee({ scope: org, callerId: "u_m", opportunityAssigneeId: "u_a", requested: "u_b" });
  ok("管理者可指定负责人", e.ok && e.assigneeId === "u_b");
  const f = resolveFollowupAssignee({ scope: org, callerId: "u_m", opportunityAssigneeId: null });
  ok("商机无负责人且未指定：未分配", !f.ok && f.errorCode === "OPPORTUNITY_UNASSIGNED");
}

console.log("status transitions");
{
  const noEvidence = planFollowupUpdate({ current: "in_progress", next: "completed" });
  ok("完成必须有证据", !noEvidence.ok && noEvidence.errorCode === "VALIDATION_FAILED");
  const blankEvidence = planFollowupUpdate({ current: "open", next: "completed", evidence: "  \n " });
  ok("空白证据等于没有", !blankEvidence.ok);
  const noReason = planFollowupUpdate({ current: "open", next: "dismissed" });
  ok("搁置必须有原因", !noReason.ok && noReason.errorCode === "VALIDATION_FAILED");
  const done = planFollowupUpdate({ current: "open", next: "completed", evidence: "已电话确认样板周三到" });
  ok("带证据可完成", done.ok && done.changed && done.evidence === "已电话确认样板周三到");
  const reopen = planFollowupUpdate({ current: "completed", next: "in_progress" });
  ok("已结束不能再动", !reopen.ok && reopen.errorCode === "FOLLOWUP_CLOSED");
  const auto = planFollowupUpdate({ current: "auto_resolved", next: "completed", evidence: "x" });
  ok("自动收口的也算结束", !auto.ok && auto.errorCode === "FOLLOWUP_CLOSED");
  const same = planFollowupUpdate({ current: "in_progress", next: "in_progress" });
  ok("同状态不算变化（不发事件）", same.ok && !same.changed);
}

console.log("events");
{
  const facts = { orgId: "org_1", followupId: "f1", opportunityId: "o1", opportunityTitle: "Lobby roller shades", title: "周五电话确认样板", dueAt: later(48) };
  const assigned = buildMuseEvent(followupAssignedEventInput({ ...facts, assigneeUserId: "u_a", creatorName: "Morgan" }));
  ok("followup.assigned 发给负责人，带开始跟进的动作", !!assigned && assigned.userId === "u_a" && assigned.followupId === "f1" && assigned.action?.command.intent === "update_followup");
  const updated = buildMuseEvent(followupUpdatedEventInput({ ...facts, creatorUserId: "u_m", updaterName: "Avery", status: "completed", note: "客户确认周三收样" }));
  ok("followup.updated 发给创建人，摘要含状态与证据", !!updated && updated.userId === "u_m" && updated.summary.includes("已完成") && updated.summary.includes("周三收样"));
  ok("followup.updated 按状态去重", updated?.eventId === "followup.updated:f1:completed");
}

console.log("reminders");
{
  const f = (id: string, dueAt: Date, creatorId = "u_m"): ReminderFollowup => ({
    orgId: "org_1", followupId: id, opportunityId: "o1", opportunityTitle: "Lobby roller shades", title: "电话确认", dueAt, assigneeId: "u_a", creatorId,
  });
  const plan = planReminders({
    now,
    followups: [f("soon", later(3)), f("late", later(-5)), f("far", later(30)), f("self", later(-1), "u_a")],
    inquiries: [{ orgId: "org_1", inquiryId: "q1", opportunityId: "o1", opportunityTitle: "Lobby", dueAt: later(-2), assigneeId: "u_a", creatorId: "u_m" }],
  });
  const of = (type: string, id: string) => plan.filter((e) => e.type === type && (e.followupId ?? e.inquiryId) === id);
  ok("24 小时内到期：负责人一条 followup.due", of("followup.due", "soon").length === 1 && of("followup.due", "soon")[0].userId === "u_a");
  ok("逾期：负责人与创建人各一条", JSON.stringify(of("followup.overdue", "late").map((e) => e.userId).sort()) === JSON.stringify(["u_a", "u_m"]));
  ok("负责人就是创建人：只发一条", of("followup.overdue", "self").length === 1);
  ok("超过 24 小时才到期：不提醒", plan.every((e) => e.followupId !== "far"));
  ok("询问逾期：发起人与收件人各一条", of("inquiry.overdue", "q1").length === 2);
  ok("幂等键含期限与收件人", of("followup.overdue", "late").every((e) => e.eventId === reminderEventId("followup.overdue", "late", later(-5), e.userId)));
  ok("改期限得到新的幂等键", reminderEventId("followup.overdue", "late", later(-5), "u_a") !== reminderEventId("followup.overdue", "late", later(-6), "u_a"));
  ok("所有提醒都是合法事件", plan.every((e) => buildMuseEvent(e) !== null));
}

console.log("reply suggestion");
{
  const s = followupSuggestion({ opportunityId: "o1", opportunityTitle: "Lobby", inquiryId: "q1", nextStep: "周五电话", nextStepDueAt: later(30).toISOString(), now });
  ok("回复给了期限：沿用", s.command.dueAt === later(30).toISOString() && s.command.fromInquiryId === "q1");
  const past = followupSuggestion({ opportunityId: "o1", opportunityTitle: "Lobby", inquiryId: "q1", nextStep: "周五电话", nextStepDueAt: later(-1).toISOString(), now });
  ok("期限已过或缺省：72 小时后", past.command.dueAt === later(72).toISOString());
  const leaky = followupSuggestion({ opportunityId: "o1", opportunityTitle: "Lobby", inquiryId: "q1", nextStep: "毛利压到 20%", nextStepDueAt: null, now });
  ok("下一步含敏感词：标题换成通用的", !leaky.command.title.includes("毛利") && leaky.command.title.includes("Lobby"));
  const replied = buildMuseEvent(inquiryRepliedEventInput({
    orgId: "org_1", askerUserId: "u_m", inquiryId: "q1", opportunityId: "o1", opportunityTitle: "Lobby", replierName: "Avery", nextStep: "周五电话", nextStepDueAt: later(30).toISOString(), now,
  }));
  ok("inquiry.replied 的建议动作是 create_followup", replied?.action?.command.intent === "create_followup");
  ok("建议动作本身是合法命令", parseMuseCommand({ ...base, command: replied?.action?.command }).ok);
}

console.log("views");
{
  const rec = (id: string, status: string, dueAt: Date | null, extra: Partial<FollowupRecord> = {}): FollowupRecord => ({
    id, title: id, status, dueAt, createdAt: later(-100), completedAt: null, dismissedAt: null, resolutionNote: null, dismissedReason: null,
    assignedTo: { id: "u_a", name: "Avery" }, createdBy: { id: "u_m", name: "Morgan" }, inputContext: { workflowId: "wf_1" }, ...extra,
  });
  const view = followupsView([
    rec("closed", "completed", later(-50), { completedAt: later(-10), resolutionNote: "已确认" }),
    rec("later", "open", later(10)),
    rec("overdue", "in_progress", later(-1)),
    rec("dropped", "dismissed", later(-60), { dismissedAt: later(-20), dismissedReason: "客户延期", resolutionNote: "不该出现" }),
  ], now);
  ok("未结束在前且按期限", view.map((v) => v.followupId).join(",") === "overdue,later,closed,dropped");
  ok("逾期标记只给未结束的", view[0].overdue && !view[1].overdue && !view[2].overdue);
  ok("证据只在完成时出现，原因只在搁置时出现", view[2].evidence === "已确认" && view[3].evidence === null && view[3].reason === "客户延期");
  ok("带出 workflowId", view.every((v) => v.workflowId === "wf_1"));
}

console.log("collaboration trail");
{
  const trail = collaborationTrail(
    [{
      id: "q1", createdAt: later(-10), creator: { id: "u_m", name: "Morgan" },
      createdDetail: { workflowId: "wf_1", questions: ["客户怎么说？", "下一步？"] },
      reply: { at: later(-8), by: { id: "u_a", name: "Avery" }, detail: { nextStep: "周五电话", channel: "muse" } },
    }],
    [{
      id: "f1", title: "周五电话", status: "completed", dueAt: later(-2), createdAt: later(-7), completedAt: later(-3), dismissedAt: null,
      resolutionNote: "客户确认周三收样", dismissedReason: null, assignedTo: { id: "u_a", name: "Avery" }, createdBy: { id: "u_m", name: "Morgan" }, inputContext: { workflowId: "wf_1" },
    }],
  );
  ok("时间线按时间正序：问 → 答 → 建跟进 → 完成", trail.map((t) => t.kind).join(",") === "inquiry.asked,inquiry.replied,followup.created,followup.completed");
  ok("回复标注渠道", trail[1].text.includes("经助理"));
  ok("完成项带证据与同一 workflowId", trail[3].text === "客户确认周三收样" && trail.every((t) => t.workflowId === "wf_1"));
}

console.log(`\nfollowup-pure: ${passed} passed`);
