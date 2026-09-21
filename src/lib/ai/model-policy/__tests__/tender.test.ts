/**
 * Tender QUALITY_FIRST 契约。运行：npx tsx src/lib/ai/model-policy/__tests__/tender.test.ts
 */
import { OPENAI_BUILTIN, OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import { EXTRACT_SYSTEM_PROMPT } from "@/lib/tender-understanding/prompts";
import { extractionOutputSchema } from "@/lib/tender-understanding/contract";
import {
  GPT6_PHASE1_WORKFLOWS,
  QUALITY_FIRST_ROLES,
  ROLE_ENV_KEYS,
  isGpt6AstraEnabledWithEnv,
  isGpt6WorkflowEnabledWithEnv,
  resolveModelPolicy,
  resolveReasoningPolicy,
  resolveTenderModelPolicy,
  isTenderCostDowngradeReason,
  isTenderFallbackAllowed,
  decideTenderRecovery,
  ANALYZED_WITH_FALLBACK_MODEL,
  TENDER_FALLBACK_MODEL,
  TENDER_PRIMARY_WHEN_ENABLED,
  TENDER_WORKFLOW,
  createPinnedTenderInvoker,
} from "../index";

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

expect(ROLE_ENV_KEYS.tender === "OPENAI_MODEL_TENDER", "OPENAI_MODEL_TENDER 独立于 RESEARCHER");
expect(QUALITY_FIRST_ROLES.includes("tender"), "tender 是 QUALITY_FIRST");
expect(
  (GPT6_PHASE1_WORKFLOWS as readonly string[]).includes("tender"),
  "Phase 1 workflow 含 tender",
);
expect(TENDER_PRIMARY_WHEN_ENABLED === OPENAI_GPT6_ASTRA, "Tender primary = gpt-6-astra");
expect(TENDER_FALLBACK_MODEL === OPENAI_BUILTIN.chat, "Tender fallback = Sol");
expect(TENDER_WORKFLOW === "tender", "telemetry workflow = tender");

const killSwitchOff = resolveModelPolicy({
  role: "tender",
  env: { OPENAI_MODEL_TENDER: OPENAI_GPT6_ASTRA },
});
expect(killSwitchOff.upgraded === false, "tender role falls back when kill switch off");
expect(killSwitchOff.model !== OPENAI_GPT6_ASTRA, "flag 关时 tender 不得用 Astra");

const enabledNoPct = {
  ENABLE_GPT6_ASTRA: "1",
};
const tenderOn = resolveTenderModelPolicy({ env: enabledNoPct });
expect(
  tenderOn.model === OPENAI_GPT6_ASTRA && tenderOn.upgraded,
  "tender role resolves Astra when enabled（无需 ROLLOUT_PCT）",
);
expect(tenderOn.skipRolloutPct === true, "tender 跳过百分比灰度");
expect(tenderOn.qualityFirst === true, "tender qualityFirst");
expect(
  tenderOn.fallbackModel === OPENAI_BUILTIN.chat,
  "tender fallback 钉在 Sol",
);

const researcherOff = resolveModelPolicy({
  role: "researcher",
  userId: "u1",
  env: enabledNoPct,
});
expect(
  researcherOff.upgraded === false,
  "generic researcher does not control tender / 无 pct 不升级",
);

const researcherEnv = resolveModelPolicy({
  role: "tender",
  env: {
    ...enabledNoPct,
    OPENAI_MODEL_RESEARCHER: OPENAI_BUILTIN.chat,
  },
});
expect(
  researcherEnv.model === OPENAI_GPT6_ASTRA,
  "OPENAI_MODEL_RESEARCHER 不能改 tender",
);

expect(
  isGpt6WorkflowEnabledWithEnv("tender", {}, enabledNoPct) === true,
  "ENABLE_GPT6_ASTRA=1 时 tender workflow 开",
);
expect(
  isGpt6WorkflowEnabledWithEnv("researcher", { userId: "u1" }, enabledNoPct) ===
    false,
  "researcher 仍受 ROLLOUT_PCT fail-closed",
);
expect(
  isGpt6AstraEnabledWithEnv(
    { orgId: "org-b", modelRole: "tender" },
    {
      ENABLE_GPT6_ASTRA: "1",
      ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-a",
    },
  ) === false,
  "Preview org allowlist 仍拦截 tender",
);

const previewEnv = {
  ENABLE_GPT6_ASTRA: "1",
  OPENAI_MODEL_TENDER: OPENAI_GPT6_ASTRA,
  ENABLE_GPT6_ASTRA_ORG_ALLOWLIST: "org-A",
};
const orgA = resolveTenderModelPolicy({
  orgId: "org-A",
  userId: "u-preview",
  env: previewEnv,
});
expect(
  orgA.model === OPENAI_GPT6_ASTRA && orgA.upgraded,
  "ENABLE_GPT6_ASTRA=1 + ORG_ALLOWLIST=org-A + Tender org-A → gpt-6-astra",
);
const orgB = resolveTenderModelPolicy({
  orgId: "org-B",
  userId: "u-preview",
  env: previewEnv,
});
expect(
  !orgB.upgraded && orgB.model !== OPENAI_GPT6_ASTRA,
  "Tender org-B → baseline",
);
const missingOrg = resolveTenderModelPolicy({
  userId: "u-preview",
  env: previewEnv,
});
expect(
  !missingOrg.upgraded &&
    missingOrg.flagDecision === "org_unavailable" &&
    missingOrg.model !== OPENAI_GPT6_ASTRA,
  "Tender missing org + ORG_ALLOWLIST → baseline / fail-closed",
);

const skillPin = createPinnedTenderInvoker({
  orgId: "org-A",
  userId: "u-skill",
  promptVersion: "tender-analysis-skill@3",
  env: previewEnv,
});
expect(
  skillPin.pin.modelVersion === OPENAI_GPT6_ASTRA &&
    skillPin.snapshot().requestedModel === OPENAI_GPT6_ASTRA,
  "Tender Skill + allowed org → requestedModel = gpt-6-astra",
);

const v2Allowed = createPinnedTenderInvoker({
  orgId: "org-A",
  userId: "u-v2",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(
  v2Allowed.pin.modelVersion === OPENAI_GPT6_ASTRA,
  "Tender V2 + allowed org → pinned model = gpt-6-astra",
);
const v2Denied = createPinnedTenderInvoker({
  orgId: "org-B",
  promptVersion: "tender-understanding-v2-extract@6",
  env: previewEnv,
});
expect(
  v2Denied.pin.modelVersion !== OPENAI_GPT6_ASTRA && !v2Denied.pin.modelVersion.includes("gpt-6-astra"),
  "Tender V2 + disallowed org → never Astra",
);

const noAllowlist = resolveTenderModelPolicy({
  env: { ENABLE_GPT6_ASTRA: "1" },
});
expect(
  noAllowlist.model === OPENAI_GPT6_ASTRA &&
    noAllowlist.flagDecision === "quality_first",
  "No ORG_ALLOWLIST + ENABLE_GPT6_ASTRA=1 → Tender QUALITY_FIRST",
);

const large = resolveTenderModelPolicy({
  env: enabledNoPct,
  retrievedContextChars: 500_000,
});
const small = resolveTenderModelPolicy({
  env: enabledNoPct,
  retrievedContextChars: 100,
});
expect(
  large.model === small.model && large.model === OPENAI_GPT6_ASTRA,
  "tender never cost-downgrades（大输入不换模型）",
);
expect(
  isTenderCostDowngradeReason("estimated token cost") &&
    isTenderCostDowngradeReason("daily budget optimization") &&
    isTenderCostDowngradeReason("large input"),
  "成本理由被识别",
);
expect(
  !isTenderFallbackAllowed(new Error("estimated token cost too high")),
  "成本不得作为 fallback 理由",
);

expect(
  decideTenderRecovery({
    alreadyRetriedPrimary: false,
    err: { status: 429, message: "rate" },
  }) === "retry_same",
  "tender transient error retries bounded（先同模型）",
);
expect(
  decideTenderRecovery({
    alreadyRetriedPrimary: true,
    err: { status: 503, message: "unavailable" },
  }) === "fallback",
  "同模型重试后才 fallback",
);
expect(
  decideTenderRecovery({
    alreadyRetriedPrimary: false,
    err: { status: 400, message: "invalid schema" },
  }) === "fail",
  "tender 400 does not retry",
);
expect(
  !isTenderFallbackAllowed({ status: 401, message: "invalid_api_key" }),
  "auth 失败不 fallback 风暴",
);

expect(
  ANALYZED_WITH_FALLBACK_MODEL === "ANALYZED_WITH_FALLBACK_MODEL",
  "tender fallback is observable（稳定标记）",
);

expect(
  resolveReasoningPolicy({ role: "tender", tenderStage: "triage" }) ===
    "medium",
  "tender triage → medium",
);
expect(
  resolveReasoningPolicy({
    role: "tender",
    tenderStage: "understanding",
    criticality: "high",
  }) === "high",
  "tender understanding → high",
);
expect(
  resolveReasoningPolicy({
    role: "tender",
    tenderStage: "addendum",
  }) === "xhigh",
  "addendum / cross-doc / risk → xhigh",
);
expect(
  resolveReasoningPolicy({ role: "tender", tenderStage: "understanding" }) !==
    "max",
  "tender 默认禁止 max",
);
expect(
  resolveReasoningPolicy({
    role: "tender",
    tenderStage: "adjudication",
    evidenceConflict: true,
    supervisorEscalation: true,
    criticality: "critical",
  }) === "max",
  "max 仅 critical + 证据冲突 + escalation",
);

const emptyOk = extractionOutputSchema.safeParse({
  facts: [],
  requirements: [],
  potentialRisks: [],
  ambiguities: [],
});
expect(emptyOk.success, "tender structured schema remains enforced（空数组合法）");
expect(
  EXTRACT_SYSTEM_PROMPT.includes("If you cannot quote real evidence, DO NOT output the item") &&
    EXTRACT_SYSTEM_PROMPT.includes("Missing information is a legitimate result") &&
    EXTRACT_SYSTEM_PROMPT.includes("UNKNOWN"),
  "tender UNKNOWN discipline remains enforced",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} gpt6-tender: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
