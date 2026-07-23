/**
 * 运行：npx tsx src/lib/assistant/__tests__/intent-router.test.ts
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("intent-router");

ok(
  "普通闲聊 → general_answer",
  routeAssistantIntent("今天天气怎么样").intent === "general_answer",
);

ok(
  "今日简报 → daily_business_brief",
  routeAssistantIntent("给我一份今日简报").intent === "daily_business_brief",
);

ok(
  "客户跟进 → customer_followup_task",
  routeAssistantIntent("帮我安排跟进这个客户").intent ===
    "customer_followup_task",
);

ok(
  "创建邮件草稿 → gmail_email_draft",
  routeAssistantIntent("帮我创建邮件草稿").intent === "gmail_email_draft",
);

ok(
  "帮我发送邮件 → gmail_email_draft（非 unsupported）",
  (() => {
    const r = routeAssistantIntent("帮我发送邮件");
    return (
      r.intent === "gmail_email_draft" &&
      r.requestedDirectExecution === true &&
      r.reason === "email_send_converted_to_draft"
    );
  })(),
);

ok(
  "把这封邮件发送给 Rudy → gmail_email_draft",
  (() => {
    const r = routeAssistantIntent("把这封邮件发送给 Rudy");
    return r.intent === "gmail_email_draft" && r.requestedDirectExecution === true;
  })(),
);

ok(
  "立即发出这封 Gmail → gmail_email_draft",
  (() => {
    const r = routeAssistantIntent("立即发出这封 Gmail");
    return r.intent === "gmail_email_draft" && r.requestedDirectExecution === true;
  })(),
);

ok(
  "帮我回复客户 → gmail_email_draft",
  (() => {
    const r = routeAssistantIntent("帮我回复客户");
    return r.intent === "gmail_email_draft" && r.requestedDirectExecution === true;
  })(),
);

ok(
  "自动下单 → unsupported_action",
  routeAssistantIntent("自动下单").intent === "unsupported_action",
);

ok(
  "批量删除客户 → unsupported_action",
  routeAssistantIntent("批量删除客户").intent === "unsupported_action",
);

ok(
  "清空数据 → unsupported_action",
  routeAssistantIntent("清空数据").intent === "unsupported_action",
);

ok(
  "不确定不误伤：含跟进字但无动作 → general",
  routeAssistantIntent("跟进情况如何了？").intent === "general_answer",
);

ok(
  "空消息 → general",
  routeAssistantIntent("   ").intent === "general_answer",
);

console.log(`结果: ${passed} passed`);
