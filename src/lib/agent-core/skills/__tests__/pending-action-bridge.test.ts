/**
 * 技能 → PendingAction 提案收集与白名单
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/pending-action-bridge.test.ts
 */

import {
  collectPendingProposals,
  SKILL_PENDING_ACTION_ALLOWLIST,
} from "../pending-action-bridge";

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

const fixture = {
  priorities: [
    {
      rank: 1,
      targetType: "OPPORTUNITY",
      targetId: "opp_1",
      customerName: "Lucas",
      pendingActionProposal: {
        type: "sales.update_followup",
        title: "跟进 Lucas",
        preview: "下周电话跟进",
        payload: {
          opportunityId: "opp_1",
          nextFollowupAt: "2026-07-25T15:00:00.000Z",
        },
      },
    },
    {
      rank: 2,
      pendingActionProposal: {
        type: "sales_send_quote_email",
        title: "非法直发邮件",
      },
    },
  ],
  pendingActionProposal: {
    type: "grader.internal_note",
    title: "投标备注",
    payload: {
      targetType: "PROJECT",
      targetId: "proj_1",
      note: "建议条件推进",
    },
  },
};

const collected = collectPendingProposals(fixture);
expect(collected.length === 3, "收集到 3 条提案（含非法类型）");
expect(
  collected.some((p) => p.type === "sales.update_followup"),
  "含跟进更新提案",
);
expect(
  collected.some((p) => p.type === "grader.internal_note"),
  "含顶层内部备注提案",
);
expect(
  SKILL_PENDING_ACTION_ALLOWLIST.includes("sales.update_followup"),
  "白名单含 sales.update_followup",
);
expect(
  !(SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(
    "sales_send_quote_email",
  ),
  "白名单不含直接发信",
);
expect(collectPendingProposals(null).length === 0, "空输入无提案");
expect(collectPendingProposals({ summary: "ok" }).length === 0, "无提案字段为空");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} pending-action-bridge: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
