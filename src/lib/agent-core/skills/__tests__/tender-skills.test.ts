/**
 * 投标数字员工技能 — 决策与废标约束
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/tender-skills.test.ts
 */

import { TENDER_ENTERPRISE_SKILLS } from "../tender-seed";

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

const bySlug = Object.fromEntries(TENDER_ENTERPRISE_SKILLS.map((s) => [s.slug, s]));

expect(TENDER_ENTERPRISE_SKILLS.length === 3, "招投标技能 3 条");

const bid = bySlug["tender-bid-no-bid"];
expect(bid.outputFormat === "json", "去留判断 JSON");
expect(
  ["advance", "conditional", "wait_info", "abandon"].every((d) =>
    bid.systemPrompt.includes(d),
  ),
  "去留 decision 枚举完整",
);
expect(
  bid.systemPrompt.includes("不得自动修改项目") ||
    bid.systemPrompt.includes("人工确认"),
  "不得自动改 tenderStatus",
);

const matrix = bySlug["tender-mandatory-compliance-matrix"];
expect(matrix.systemPrompt.includes("不得把 rated 标成 mandatory"), "禁止评分项误判强制");
expect(matrix.systemPrompt.includes("sourceReference"), "必须保留来源引用");

const dq = bySlug["tender-disqualification-check"];
expect(dq.systemPrompt.includes("unverified"), "未核实不得默认通过");
expect(
  ["Addendum", "Bond", "签字", "盖章"].every((k) => dq.systemPrompt.includes(k)),
  "废标检查覆盖关键类别",
);
expect(
  ["ready", "ready_with_conditions", "not_ready"].every((s) =>
    dq.systemPrompt.includes(s),
  ),
  "submissionStatus 枚举完整",
);

// Fixture：可投 / 放弃 / Bond 缺口 / Addendum / 强制认证
const advanceCase = {
  estimatedValue: "CAD 180000",
  estimatedCost: "CAD 140000",
  mandatoryRequirements: "WSIB 有效；安全手册齐全",
  expectedDecision: "advance",
};
const abandonCase = {
  mandatoryRequirements: "必须持有 CSA 认证且我方无此认证",
  expectedDecision: "abandon",
};
const bondGap = {
  insuranceAndBonding: "要求 Bid Bond 10%，当前未确认额度",
  expectedDecision: "conditional",
};
const addendumUnsigned = {
  knownGaps: "Addendum #2 未签收",
  expectedSubmission: "not_ready",
};
const certMissing = {
  knownGaps: "强制 UL 认证缺失",
  expectedSubmission: "not_ready",
};

expect(advanceCase.expectedDecision === "advance", "可投 Fixture");
expect(abandonCase.expectedDecision === "abandon", "应放弃 Fixture");
expect(bondGap.expectedDecision === "conditional", "Bond 缺口 Fixture");
expect(addendumUnsigned.expectedSubmission === "not_ready", "Addendum 未签收 Fixture");
expect(certMissing.expectedSubmission === "not_ready", "强制认证缺失 Fixture");

console.log(`\n${failed === 0 ? "✅" : "❌"} tender-skills: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
