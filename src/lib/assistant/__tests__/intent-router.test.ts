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
  "邮件草稿 → gmail_email_draft",
  routeAssistantIntent("帮我写一封 Gmail 邮件草稿").intent ===
    "gmail_email_draft",
);

ok(
  "直接发邮件 → unsupported_action",
  routeAssistantIntent("请直接发送这封邮件").intent === "unsupported_action",
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
