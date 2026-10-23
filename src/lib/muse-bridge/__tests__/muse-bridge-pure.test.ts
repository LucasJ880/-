/**
 * Muse Bridge Phase 0 — 纯逻辑契约测试（零 DB）
 * 运行：npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts
 */

import assert from "node:assert/strict";
import {
  MUSE_BRIDGE_CONTRACT_VERSION,
  MUSE_INTENTS,
  MUSE_PHASE0_INTENTS,
  containsOutboundSensitive,
  museCommandResponseSchema,
  parseMuseCommand,
} from "../contract";
import { enabledMuseIntents, isMuseBridgeEnabled, isMuseOrgAllowed } from "../flags";
import { readMuseBindings, resolveBindingPure, withMuseBinding } from "../binding-pure";
import {
  formatApprovalOutcome,
  formatProjectLine,
  formatStatusMessage,
  gateIntent,
  notEnabledResponse,
  sanitizeOutbound,
  sortStatusRows,
  type StatusProjectRow,
} from "../router-pure";
import { buildMuseEvent } from "../events-pure";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const base = {
  contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
  requestId: "req-0001-abcdef",
  orgId: "org_1",
  museUserRef: "muse:evan",
};

console.log("muse-bridge contract");

ok("合法 status 命令可解析", parseMuseCommand({ ...base, command: { intent: "status" } }).ok);
ok("合法 ask 命令可解析", parseMuseCommand({ ...base, command: { intent: "ask", projectId: "p1", question: " 最大风险? " } }).ok);
ok("未知意图整包拒绝", !parseMuseCommand({ ...base, command: { intent: "send_email", to: "x" } }).ok);
ok("版本不符拒绝", !parseMuseCommand({ ...base, contractVersion: "muse-bridge/v2", command: { intent: "status" } }).ok);
ok("requestId 过短拒绝", !parseMuseCommand({ ...base, requestId: "abc", command: { intent: "status" } }).ok);
ok("ask 缺 question 拒绝", !parseMuseCommand({ ...base, command: { intent: "ask", projectId: "p1" } }).ok);
{
  const r = parseMuseCommand({ ...base, command: { intent: "status", extraField: 1 }, foo: "bar" });
  ok("多余字段被 strip（不泄漏到路由）", r.ok && !("foo" in r.value) && !("extraField" in r.value.command));
}
ok("意图集包含 12 个意图（P1-8 加 next_step / set_preference / preferences）", MUSE_INTENTS.length === 12);
ok("Phase 0 意图 = status/ask/approve/reject + next_step/set_preference/preferences", JSON.stringify(MUSE_PHASE0_INTENTS) === JSON.stringify(["status", "ask", "approve", "reject", "next_step", "set_preference", "preferences"]));
ok("出站敏感词检测：毛利", containsOutboundSensitive("本单毛利 35%"));
ok("出站敏感词检测：winningBidPrice", containsOutboundSensitive("winningBidPrice=1000"));
ok("出站敏感词检测：普通文本不误伤", !containsOutboundSensitive("截标还有 3 天"));

console.log("muse-bridge flags");

ok("默认关闭", !isMuseBridgeEnabled({}));
ok("MUSE_BRIDGE_ENABLED=1 开启", isMuseBridgeEnabled({ MUSE_BRIDGE_ENABLED: "1" }));
ok("意图白名单为空 → Phase 0 七个", enabledMuseIntents({}).size === 7 && enabledMuseIntents({}).has("approve") && enabledMuseIntents({}).has("next_step"));
{
  const s = enabledMuseIntents({ MUSE_BRIDGE_INTENTS: "status,rfq,bogus" });
  ok("意图白名单显式配置 → 只认配置的合法意图", s.size === 2 && s.has("rfq") && !s.has("approve"));
}
ok("org 允许名单为空 → 任意 org", isMuseOrgAllowed("org_x", {}));
ok("org 允许名单命中", isMuseOrgAllowed("org_1", { MUSE_BRIDGE_ORG_ALLOWLIST: "org_1,org_2" }));
ok("org 允许名单未命中 → 拒绝", !isMuseOrgAllowed("org_9", { MUSE_BRIDGE_ORG_ALLOWLIST: "org_1" }));

console.log("muse-bridge binding");

{
  const settings = withMuseBinding({ tenderProfile: { entityName: "X" } }, "muse:evan", { userId: "u1", boundAt: "2026-10-22", boundBy: "admin" });
  ok("写绑定不破坏其它 settings 键", (settings as { tenderProfile?: { entityName?: string } }).tenderProfile?.entityName === "X");
  ok("读绑定", readMuseBindings(settings)["muse:evan"]?.userId === "u1");
  const removed = withMuseBinding(settings, "muse:evan", null);
  ok("解绑后为空", Object.keys(readMuseBindings(removed)).length === 0);
  ok("坏数据当空表", Object.keys(readMuseBindings({ museBridge: { bindings: { a: 1, b: { userId: "" } } } })).length === 0);

  const bindings = readMuseBindings(settings);
  const r1 = resolveBindingPure({ bindings, museUserRef: "muse:evan", orgId: "org_1", members: [{ userId: "u1", status: "active", orgRole: "org_member", userRole: "user" }] });
  ok("绑定 + active 成员 → 身份", r1.ok && r1.identity.userId === "u1" && r1.identity.orgRole === "org_member");
  const r2 = resolveBindingPure({ bindings, museUserRef: "muse:unknown", orgId: "org_1", members: [] });
  ok("未绑定 → USER_NOT_BOUND", !r2.ok && r2.errorCode === "USER_NOT_BOUND");
  const r3 = resolveBindingPure({ bindings, museUserRef: "muse:evan", orgId: "org_1", members: [{ userId: "u1", status: "inactive", orgRole: "org_member", userRole: null }] });
  ok("绑定但成员非 active → ORG_MEMBERSHIP_REQUIRED", !r3.ok && r3.errorCode === "ORG_MEMBERSHIP_REQUIRED");
}

console.log("muse-bridge router-pure");

{
  const gated = gateIntent("req-0001-abcdef", { intent: "rfq", projectId: "p1" }, new Set(["status"]));
  ok("未启用意图被门拦下", gated !== null && gated.errorCode === "INTENT_NOT_ENABLED" && gated.availableInPhase === 1);
  ok("已启用意图放行", gateIntent("req-0001-abcdef", { intent: "status" }, new Set(["status"])) === null);
  ok("notEnabled 响应符合契约", museCommandResponseSchema.safeParse(notEnabledResponse("req-0001-abcdef", "follow_tender")).success);
}
ok("脱敏：命中敏感词整段替换", sanitizeOutbound("毛利 30%").startsWith("（该内容包含内部财务信息"));
ok("脱敏：超长截断到 1200", sanitizeOutbound("a".repeat(2000)).length === 1200);

const now = new Date("2026-10-22T12:00:00Z");
const row = (over: Partial<StatusProjectRow>): StatusProjectRow => ({
  id: "p",
  name: "P",
  createdAt: "2026-10-01T00:00:00Z",
  tenderStatus: "pursuing",
  publicDate: null,
  questionCloseDate: null,
  closeDate: "2026-10-30T00:00:00Z",
  dueDate: null,
  distributedAt: "2026-10-02T00:00:00Z",
  interpretedAt: "2026-10-03T00:00:00Z",
  supplierInquiredAt: null,
  supplierQuotedAt: null,
  submittedAt: null,
  awardDate: null,
  intakeStatus: "dispatched",
  analysisStatus: "REVIEW_REQUIRED",
  pendingApprovals: 0,
  ...over,
});
{
  const line = formatProjectLine(row({ name: "Halifax 媒体监测" }), now);
  ok("项目行含名称/阶段/倒计时/分析状态", line.includes("Halifax 媒体监测") && line.includes("解读") && line.includes("截标还有 8 天") && line.includes("待人工审阅"));
  const line2 = formatProjectLine(row({ pendingApprovals: 2, closeDate: "2026-10-20T00:00:00Z" }), now);
  ok("已过截标 + 待批数", line2.includes("已过截标 2 天") && line2.includes("2 条待你批"));
  const sorted = sortStatusRows([row({ id: "a", closeDate: "2026-10-25T00:00:00Z" }), row({ id: "b", pendingApprovals: 1, closeDate: "2026-11-25T00:00:00Z" }), row({ id: "c", closeDate: "2026-10-23T00:00:00Z" })], now);
  ok("排序：有待批优先，其次截标最近", sorted.map((r) => r.id).join(",") === "b,c,a");
  const empty = formatStatusMessage([], now);
  ok("无项目 → 诚实提示", empty.message.includes("没有在跟的投标项目") && empty.suggestedActions.length === 0);
  const many = formatStatusMessage(Array.from({ length: 10 }, (_, i) => row({ id: `p${i}`, name: `标${i}` })), now);
  ok("10 个项目 → 理由列前 3 个、结论注明其余 7 个、下一步 = 第一个标的 next_step", many.message.includes("另 7 个见列表") && many.advisory.reasons.length === 3 && many.suggestedActions[0].command.intent === "next_step");
  ok("status 响应符合契约", museCommandResponseSchema.safeParse({ contractVersion: MUSE_BRIDGE_CONTRACT_VERSION, requestId: "r", ok: true, message: many.message, suggestedActions: many.suggestedActions }).success);
}
{
  const a = formatApprovalOutcome("req-0001-abcdef", "approve", { ok: true, status: "executed" });
  ok("批准成功 → 已批准 + 下一步看状态", a.ok && a.message.startsWith("已批准") && a.suggestedActions[0]?.command.intent === "status" && a.message.includes("下一步：看看还有什么要批"));
  const d = formatApprovalOutcome("req-0001-abcdef", "approve", { ok: true, duplicate: true });
  ok("重复批准 → 标注未重复执行", d.message.includes("未重复执行"));
  const f = formatApprovalOutcome("req-0001-abcdef", "reject", { ok: false, error: "无权操作该草稿" });
  ok("审批失败 → APPROVAL_FAILED + 原因", !f.ok && f.errorCode === "APPROVAL_FAILED" && f.message.includes("无权操作"));
}

console.log("muse-bridge events-pure");

{
  const e = buildMuseEvent({ eventId: "approval.requested:act_1", type: "approval.requested", orgId: "org_1", userId: "u1", projectId: "p1", projectName: "P", summary: "待批：发送询价邮件", approval: { approvalId: "act_1", kind: "pending_action" }, action: { label: "批准", command: { intent: "approve", approvalId: "act_1" } } });
  ok("审批事件信封合法", e !== null && e.contractVersion === MUSE_BRIDGE_CONTRACT_VERSION && e.approval?.approvalId === "act_1");
  const bad = buildMuseEvent({ eventId: "x", type: "approval.requested", orgId: "org_1", userId: "u1", summary: "s" });
  ok("eventId 过短 → 拒绝", bad === null);
  const leak = buildMuseEvent({ eventId: "analysis.ready:run_1", type: "analysis.ready", orgId: "org_1", userId: "u1", summary: "本标毛利 40%，建议投" });
  ok("事件摘要自动脱敏", leak !== null && leak.summary.startsWith("（该内容包含内部财务信息"));
}

console.log(`\nmuse-bridge-pure: ${passed} passed`);
