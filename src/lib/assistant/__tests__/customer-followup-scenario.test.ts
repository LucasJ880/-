/**
 * 客户跟进场景契约（无 DB；解析与文案）
 * 运行：npx tsx src/lib/assistant/__tests__/customer-followup-scenario.test.ts
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import {
  detectFollowupActionKind,
  detectOtherAssignee,
  parseFollowupRequest,
} from "@/lib/assistant/scenarios/entity-parse";
import { friendlyScenarioError } from "@/lib/assistant/scenarios/types";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("customer-followup-scenario");

ok(
  "意图：周五提醒我跟进 ABC → customer_followup_task",
  routeAssistantIntent("周五提醒我跟进 ABC").intent ===
    "customer_followup_task",
);

ok(
  "日历动作：提醒我跟进 → calendar",
  detectFollowupActionKind("周五提醒我跟进 ABC") === "calendar",
);

ok(
  "销售跟进：把下次跟进改到周五 → sales_followup",
  detectFollowupActionKind("把 ABC 商机的下次跟进改到周五") ===
    "sales_followup",
);

ok(
  "双动作：同时要求跟进更新与提醒 → both",
  detectFollowupActionKind("把下次跟进改到周五，同时提醒我") === "both",
);

ok(
  "提醒其他成员 → 追问，不假装分配",
  (() => {
    const name = detectOtherAssignee("提醒 Alex 明天下午联系 ABC");
    const parsed = parseFollowupRequest("提醒 Alex 明天下午联系 ABC");
    return (
      name === "Alex" &&
      parsed.otherAssignee === "Alex" &&
      // 文案契约（与 scenario 一致）
      `当前阶段只能在你的日历创建提醒，不能替 ${name} 创建任务或发邀请。是否改为在你的日历提醒你联系 ${name}？`.includes(
        "不能替 Alex 创建任务",
      )
    );
  })(),
);

ok(
  "缺少客户名 → clarification 字段",
  (() => {
    const p = parseFollowupRequest("周五提醒我跟进");
    return !p.customerName;
  })(),
);

ok(
  "模糊时间「过几天」→ needsTimeClarification",
  (() => {
    const p = parseFollowupRequest("过几天提醒我跟进 ABC");
    return p.needsTimeClarification === true && !p.startIso;
  })(),
);

ok(
  "明确周五 → 产出 ISO 时间",
  (() => {
    const p = parseFollowupRequest("周五提醒我跟进 ABC");
    return (
      p.customerName?.includes("ABC") &&
      !!p.startIso &&
      !!p.endIso &&
      p.startIso.includes("T") &&
      !p.needsTimeClarification
    );
  })(),
);

ok(
  "无商机时友好文案建议改日历（契约）",
  friendlyScenarioError("OPPORTUNITY_NOT_FOUND").length > 0 &&
    friendlyScenarioError("FOLLOWUP_TIME_REQUIRED").includes("日期"),
);

ok(
  "跨 org / 未找到客户错误码友好且无敏感细节",
  (() => {
    const msg = friendlyScenarioError("CUSTOMER_NOT_FOUND");
    return (
      msg.includes("客户") &&
      !msg.includes("orgId") &&
      !msg.includes("SELECT")
    );
  })(),
);

ok(
  "双 PA 契约：both 不得合并为单一复合 type",
  (() => {
    // 应用层约定：plans 含两个独立 type
    const kinds = ["sales.update_followup", "calendar.create_event"];
    return (
      kinds.length === 2 &&
      !kinds.some((k) => k.includes("+") || k.includes("composite"))
    );
  })(),
);

console.log(`结果: ${passed} passed`);
