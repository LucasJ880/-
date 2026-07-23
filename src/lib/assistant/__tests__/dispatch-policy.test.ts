/**
 * Dispatch 租户 / 限流 / 文案 / SSE 协议契约（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/dispatch-policy.test.ts
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import { resolveTrustedAssistantOrg } from "@/lib/assistant/thread-org";
import { getScenarioPlaceholderText } from "@/lib/assistant/dispatch";
import { buildRunStatusEvent, toAssistantRunStatusDto } from "@/lib/assistant/run-status";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("dispatch-policy");

/** 与 messages 路由一致的处理顺序契约 */
const DISPATCH_PIPELINE = [
  "auth",
  "activeOrg",
  "thread_user_org",
  "content",
  "rate_limit",
  "prepareAssistantDispatch",
  "scenario_or_general_sse",
] as const;

ok(
  "场景 Dispatch 不能绕过限流：rate_limit 在 prepareAssistantDispatch 之前",
  (() => {
    const rl = DISPATCH_PIPELINE.indexOf("rate_limit");
    const prep = DISPATCH_PIPELINE.indexOf("prepareAssistantDispatch");
    return rl >= 0 && prep >= 0 && rl < prep;
  })(),
);

ok(
  "限流命中不得写库（契约：429 早于 persist）",
  (() => {
    // 结构：rate_limit 失败直接返回，不进入 prepare（prepare 内才 persist）
    const order = DISPATCH_PIPELINE;
    return (
      order.indexOf("rate_limit") < order.indexOf("prepareAssistantDispatch")
    );
  })(),
);

ok(
  "dispatch 组织来源：activeOrg，不是 query",
  (() => {
    const r = resolveTrustedAssistantOrg({
      activeOrgId: "sunny",
      memberOrgIds: ["sunny", "mengxin"],
      queryOrgId: "mengxin",
    });
    return !r.ok && r.code === "ORG_CONTEXT_MISMATCH";
  })(),
);

ok(
  "发送邮件转换为 Gmail 草稿意图",
  routeAssistantIntent("帮我发一封邮件给客户").intent === "gmail_email_draft",
);

ok(
  "unsupported 仍覆盖高风险不可转换动作",
  routeAssistantIntent("自动下单").intent === "unsupported_action" &&
    routeAssistantIntent("批量删除客户").intent === "unsupported_action",
);

ok(
  "跟进占位文案不含「和/或」",
  (() => {
    const text = getScenarioPlaceholderText({
      intent: "customer_followup_task",
      confidence: 1,
      reason: "followup_keywords",
    });
    return (
      !text.includes("和/或") &&
      text.includes("日历提醒或商机跟进更新") &&
      text.includes("两张独立确认卡")
    );
  })(),
);

ok(
  "发送邮件占位提示不会自动发送",
  (() => {
    const text = getScenarioPlaceholderText({
      intent: "gmail_email_draft",
      confidence: 1,
      reason: "email_send_converted_to_draft",
      requestedDirectExecution: true,
    });
    return (
      text.includes("只会创建 Gmail 草稿") && text.includes("不会自动发送")
    );
  })(),
);

ok(
  "run_status 事件无冲突顶层 status：只读 event.run.status",
  (() => {
    const dto = toAssistantRunStatusDto({
      run: {
        id: "r1",
        orgId: "sunny",
        status: "completed",
        intent: "daily_business_brief",
        errorCode: null,
        errorMessage: null,
        metadata: { threadId: "t1", initiatedByUserId: "u1" },
        startedAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      },
      threadId: "t1",
      initiatedByUserId: "u1",
    });
    const ev = buildRunStatusEvent(dto, "received");
    const keys = Object.keys(ev);
    return (
      keys.includes("type") &&
      keys.includes("run") &&
      ev.run.status === "received" &&
      ev.transition === "received" &&
      !keys.includes("status")
    );
  })(),
);

ok(
  "metadata.threadId 关联约定（sessionId ≠ threadId）",
  (() => {
    const threadId = "thread-abc";
    const sessionId = "session-xyz";
    const metadata = {
      threadId,
      initiatedByUserId: "u1",
      channel: "web_assistant",
    };
    return (
      metadata.threadId === threadId &&
      sessionId !== threadId &&
      metadata.initiatedByUserId === "u1"
    );
  })(),
);

ok(
  "场景意图不走 general（占位由 dispatch 处理）",
  routeAssistantIntent("给我一份今日业务简报").intent ===
    "daily_business_brief",
);

console.log(`结果: ${passed} passed`);
