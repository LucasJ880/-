/**
 * 营销 PendingAction 提案桥 — 白名单 / 幂等 / 非法类型
 * 运行：npx tsx src/lib/pending-actions/__tests__/marketing-proposal-bridge.test.ts
 */

import {
  collectPendingProposals,
  buildSkillPendingIdempotencyKey,
  buildAgentSkillActionSource,
  SKILL_PENDING_ACTION_ALLOWLIST,
} from "@/lib/agent-core/skills/pending-action-bridge";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

const parsed = {
  contextSummary: { company: "Sunny" },
  pendingActionProposal: {
    type: "marketing.propose_context_update",
    title: "更新产品营销上下文",
    preview: "补充竞品证据",
    payload: {
      context: { company: { name: "Sunny Shutter" } },
      reason: "竞品调研后",
    },
  },
  draftActions: [
    {
      type: "marketing.create_campaign_draft",
      title: "创建活动草稿",
      payload: {
        name: "GTA Commercial",
        objective: "leads",
        primaryConversion: "form",
      },
    },
  ],
};

const proposals = collectPendingProposals(parsed);
expect(proposals.length === 1, "顶层 pendingActionProposal 被收集");
expect(
  proposals[0].type === "marketing.propose_context_update",
  "类型为 propose_context_update",
);

const illegal = collectPendingProposals({
  pendingActionProposal: {
    type: "marketing.send_blast",
    title: "群发",
  },
});
expect(illegal.length === 1, "非法提案仍被收集以便 skip");
expect(
  !(SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(
    "marketing.send_blast",
  ),
  "非法类型不在白名单",
);

const key1 = buildSkillPendingIdempotencyKey(
  "exec_1",
  0,
  "marketing.propose_context_update",
);
const key2 = buildSkillPendingIdempotencyKey(
  "exec_1",
  0,
  "marketing.propose_context_update",
);
const key3 = buildSkillPendingIdempotencyKey(
  "exec_1",
  1,
  "marketing.propose_context_update",
);
expect(key1 === key2, "同一 SkillExecution+index+type 幂等键相同");
expect(key1 !== key3, "不同 proposalIndex 幂等键不同");

const source = buildAgentSkillActionSource({
  orgId: "org_sunny",
  skillId: "skill_1",
  skillSlug: "marketing-product-context",
  skillExecutionId: "exec_1",
  agentRunId: "run_1",
  proposalIndex: 0,
  actionType: "marketing.propose_context_update",
});
expect(source.orgId === "org_sunny", "来源链含 orgId");
expect(source.skillSlug === "marketing-product-context", "来源链含 skillSlug");
expect(source.skillExecutionId === "exec_1", "来源链含 skillExecutionId");
expect(source.agentRunId === "run_1", "来源链含 agentRunId");
expect(source.idempotencyKey === key1, "来源链幂等键一致");

expect(
  SKILL_PENDING_ACTION_ALLOWLIST.includes("grader.email_draft"),
  "允许邮件草稿",
);
expect(
  SKILL_PENDING_ACTION_ALLOWLIST.includes("marketing.create_campaign_draft"),
  "允许活动草稿",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} marketing-proposal-bridge: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
