/**
 * Tender Skill / V2 组织上下文接线 + Preview 可观测字段。
 * 运行：npx tsx src/lib/ai/model-policy/__tests__/tender-org-propagation.test.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import {
  TENDER_WORKFLOW,
  createPinnedTenderInvoker,
  resolveTenderModelPolicy,
  tenderEntitlementLogFields,
} from "../index";
import { createUnifiedRuntimeInvoker } from "@/lib/tender-understanding/llm";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

const previewEnv = {
  ENABLE_GPT6_ASTRA: "1",
  OPENAI_MODEL_TENDER: OPENAI_GPT6_ASTRA,
  ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-A",
};

expect(
  resolveTenderModelPolicy({
    orgId: "org-A",
    userId: "u-skill",
    env: previewEnv,
  }).model === OPENAI_GPT6_ASTRA,
  "Skill 形状：allowed org → gpt-6-astra",
);

const v2 = createPinnedTenderInvoker({
  orgId: "org-A",
  userId: "u-job",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(v2.pin.modelVersion === OPENAI_GPT6_ASTRA, "V2 pinned = gpt-6-astra");
expect(v2.snapshot().orgId === "org-A", "V2 snapshot 含权威 org");
expect(v2.snapshot().flagDecision === "allowlist_hit", "Preview flagDecision=allowlist_hit");
expect(v2.snapshot().fallbackUsed === false, "未调用时 fallbackUsed=false");

const denied = createPinnedTenderInvoker({
  orgId: "org-B",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(
  denied.pin.modelVersion !== OPENAI_GPT6_ASTRA,
  "disallowed org 不得钉 Astra",
);

const background = createPinnedTenderInvoker({
  orgId: "org-A",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(
  background.pin.modelVersion === OPENAI_GPT6_ASTRA,
  "后台无 userId 仍可凭 org 命中 Preview allowlist",
);

const logs = tenderEntitlementLogFields({
  orgId: "org-A",
  requestedModel: OPENAI_GPT6_ASTRA,
  actualModel: OPENAI_GPT6_ASTRA,
  fallbackUsed: false,
  flagDecision: "allowlist_hit",
});
expect(logs.workflow === TENDER_WORKFLOW, "telemetry workflow=tender");
expect(logs.org === "org-A" && logs.organization === "org-A", "telemetry org");
expect(logs.requestedModel === OPENAI_GPT6_ASTRA, "telemetry requestedModel");
expect(logs.actualModel === OPENAI_GPT6_ASTRA, "telemetry actualModel");
expect(logs.fallbackUsed === false, "telemetry fallbackUsed=false");
expect(
  !("userPrompt" in logs) && !("systemPrompt" in logs) && !("content" in logs),
  "telemetry 不含招标原文",
);

const defaultInvoker = createUnifiedRuntimeInvoker({
  orgId: "org-A",
  userId: "u-v2",
});
expect(typeof defaultInvoker === "function", "createUnifiedRuntimeInvoker 接受 orgId/userId");

const root = process.cwd();
const skillSrc = fs.readFileSync(
  path.join(root, "src/lib/agent/skills/tender-analysis.ts"),
  "utf8",
);
expect(skillSrc.includes("resolveTenderOrgForProject"), "Skill 从项目解析权威 org");
expect(skillSrc.includes("orgId: orgId ?? undefined"), "Skill 把权威 org 传入 createTenderCompletion");
expect(skillSrc.includes("createUnifiedRuntimeInvoker"), "Skill 与 V2 共用 invoker");
expect(!/ctx\.input\.orgId/.test(skillSrc), "Skill 不信任 ctx.input.orgId");

const llmSrc = fs.readFileSync(
  path.join(root, "src/lib/tender-understanding/llm.ts"),
  "utf8",
);
expect(
  llmSrc.includes("orgId?: string | null") && llmSrc.includes("createPinnedTenderInvoker"),
  "V2 createUnifiedRuntimeInvoker 把 orgId 传到 pinned invoker",
);

const persistSrc = fs.readFileSync(
  path.join(root, "src/lib/tender-auto-analysis/v2-persist.ts"),
  "utf8",
);
expect(
  persistSrc.includes("resolveTenderOrgForProject") &&
    persistSrc.includes("productionInvokerForRun"),
  "后台 V2 从 project/run 解析 org 再创建 invoker",
);

const pinnedSrc = fs.readFileSync(
  path.join(root, "src/lib/ai/model-policy/tender.ts"),
  "utf8",
);
expect(
  pinnedSrc.includes("orgId: input.orgId") && pinnedSrc.includes("userId: input.userId"),
  "pinned invoker 把 orgId/userId 传入 createTenderCompletion",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} tender-org-propagation: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
void assert;
