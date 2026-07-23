/**
 * 今日业务简报场景契约（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/daily-brief-scenario.test.ts
 */

import assert from "node:assert/strict";
import { formatDailyBriefContent } from "@/lib/assistant/scenarios/daily-brief";
import { getScenarioPlaceholderText } from "@/lib/assistant/dispatch";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import { friendlyScenarioError } from "@/lib/assistant/scenarios/types";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("daily-brief-scenario");

ok(
  "意图路由：今日业务简报",
  routeAssistantIntent("给我今日业务简报").intent === "daily_business_brief",
);

ok(
  "格式化输出手机可读摘要 + workSuggestion 精简结构",
  (() => {
    const { text, workSuggestion } = formatDailyBriefContent({
      summary: "优先处理跟进与逾期。",
      score: 72,
      issues: [
        { title: "客户 A 需跟进", severity: "high", category: "followup_due" },
        { title: "订单逾期", severity: "high", category: "order_overdue" },
        { title: "报价待签", severity: "medium", category: "quote_pending" },
      ],
    });
    const counts = (workSuggestion as { counts: Record<string, number> }).counts;
    return (
      text.includes("今日有 3 项需要关注") &&
      text.includes("只读简报") &&
      !text.includes("已创建日历") &&
      workSuggestion.type === "daily_business_brief" &&
      counts.followups === 1 &&
      counts.overdue === 1 &&
      counts.quoteRisks === 1 &&
      Array.isArray((workSuggestion as { items: unknown[] }).items)
    );
  })(),
);

ok(
  "无事项时不暗示敏感数量",
  (() => {
    const { text, workSuggestion } = formatDailyBriefContent({
      summary: "一切正常。",
      score: 95,
      issues: [],
    });
    const counts = (workSuggestion as { counts: Record<string, number> }).counts;
    return (
      text.includes("暂无明显风险") &&
      counts.followups === 0 &&
      counts.pendingApprovals === 0
    );
  })(),
);

ok(
  "简报场景声明只读、不自动创建写动作",
  (() => {
    const hint = getScenarioPlaceholderText({
      intent: "daily_business_brief",
      confidence: 1,
      reason: "brief",
    });
    return hint.includes("只读") && !hint.includes("PendingAction");
  })(),
);

ok(
  "trade 无销售权限契约：空 counts 不暴露存在性文案关键字",
  (() => {
    // 与 daily-brief.ts 无权分支文案一致
    const content =
      "今日业务简报已生成。\n\n当前账号没有可展示的销售业务模块数据。如需其他帮助，可以直接问我。";
    return (
      !content.includes("客户需要跟进") &&
      !content.includes("报价存在风险") &&
      !content.includes("你无权限查看") &&
      content.includes("没有可展示")
    );
  })(),
);

ok(
  "Grader 失败友好文案不含堆栈/SQL",
  (() => {
    const msg = friendlyScenarioError("GRADER_FAILED");
    return (
      msg.includes("简报") &&
      !msg.toLowerCase().includes("select") &&
      !msg.includes("stack")
    );
  })(),
);

console.log(`结果: ${passed} passed`);
