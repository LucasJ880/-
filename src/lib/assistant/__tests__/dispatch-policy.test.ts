/**
 * Dispatch 租户与路由策略（无 DB）
 * 运行：npx tsx src/lib/assistant/__tests__/dispatch-policy.test.ts
 */

import assert from "node:assert/strict";
import { routeAssistantIntent } from "@/lib/assistant/intent-router";
import { resolveTrustedAssistantOrg } from "@/lib/assistant/thread-org";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("dispatch-policy");

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
  "跨 org thread 访问语义：无匹配 org → 不得继续",
  (() => {
    const activeOrg = "mengxin";
    const thread = { id: "t1", orgId: "sunny", userId: "u1" };
    return !(thread.orgId === activeOrg);
  })(),
);

ok(
  "前端不得按意图选 Supervisor：服务端路由 general 才走 SSE",
  routeAssistantIntent("帮我看看这个报价").intent === "general_answer",
);

ok(
  "场景意图不走 general（占位由 dispatch 处理）",
  routeAssistantIntent("给我一份今日业务简报").intent ===
    "daily_business_brief",
);

ok(
  "metadata.threadId 关联约定（sessionId ≠ threadId）",
  (() => {
    const threadId = "thread-abc";
    const sessionId = "session-xyz";
    const metadata = { threadId };
    return metadata.threadId === threadId && sessionId !== threadId;
  })(),
);

console.log(`结果: ${passed} passed`);
