/**
 * Autopilot A2-P2.0 contracts — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-contract.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  A2P2_DEFAULT_EVALUATION_BUDGET,
  A2P2_DEFAULT_MAX_RECOVERY_CYCLES,
  A2P2_KPI_TARGETS,
  A2P2_PRINCIPLES,
  A2P2_SURFACE,
  A2P2_TASK_CONTRACT_VERSION,
  A2P2_ACTIVATION_BLOCKERS,
  AUTOMATION_LEVELS,
  DEFAULT_READ_SEARCH_RECOVERY_ACTIONS,
  EVALUATION_RECOVERY_ACTION_KINDS,
  EVALUATION_RISK_CLASSES,
  EVALUATOR_MAX_AUTOMATION_LEVEL,
  FORBIDDEN_CONTRACT_FIELD_NAMES,
  FORBIDDEN_EVALUATION_SIDE_EFFECT_ACTIONS,
  FORBIDDEN_JUDGE_EVIDENCE_KINDS,
  assertFiniteBudget,
  assertRecoveryAllowlist,
  defaultEvaluationBudget,
  defaultRecoveryPolicy,
  hasForbiddenContractFields,
  isForbiddenSideEffectAction,
  isJudgeEligibleEvidenceKind,
  isJudgeEligiblePrivacyClass,
  rejectUnknownRecoveryAction,
  sanitizeGoalSummary,
} from "../a2p2-contract";
import {
  A2P2_DOMAIN_TEMPLATES,
  emailDraftForbidsAutoSend,
  resolveTaskContract,
} from "../a2p2-templates";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? detail : "");
  }
}

console.log("autopilot A2-P2.0 contract");

ok(A2P2_SURFACE === "A2_P2_0_AUTONOMOUS_EVAL_CONTRACT", "P2.0 surface id");
ok(A2P2_TASK_CONTRACT_VERSION === "a2p2-task-contract-v1", "TASK_CONTRACT_PROVENANCE version");
ok(A2P2_PRINCIPLES.AUTOMATION_FIRST === true, "AUTOMATION_FIRST = YES");
ok(A2P2_PRINCIPLES.HUMAN_BY_EXCEPTION === true, "HUMAN_BY_EXCEPTION = YES");
ok(
  EVALUATION_RISK_CLASSES.join(",") === "LOW,MEDIUM,HIGH,RESTRICTED",
  "risk classes are closed",
);
ok(
  AUTOMATION_LEVELS.includes("L0_HUMAN_CONTROLLED") &&
    AUTOMATION_LEVELS.includes("L5_RESTRICTED"),
  "automation levels L0–L5",
);
ok(
  EVALUATOR_MAX_AUTOMATION_LEVEL === "L2_AUTO_PREPARE",
  "evaluator recovery stays at analyze/prepare",
);

ok(
  A2P2_DEFAULT_MAX_RECOVERY_CYCLES === 3 &&
    A2P2_DEFAULT_EVALUATION_BUDGET.maxRecoveryCycles === 3,
  "RECOVERY_MAX_CYCLES_DEFAULT = 3",
);
ok(
  A2P2_DEFAULT_EVALUATION_BUDGET.maxJudgeCalls === 2 &&
    A2P2_DEFAULT_EVALUATION_BUDGET.maxExternalSearches === 5 &&
    A2P2_DEFAULT_EVALUATION_BUDGET.maxCostUsd === 0.25,
  "BUDGET_IS_BOUNDED conservative defaults",
);
try {
  assertFiniteBudget({
    maxJudgeCalls: Number.POSITIVE_INFINITY,
    maxRecoveryCycles: 3,
    maxExternalSearches: 5,
    maxCostUsd: 0.25,
  });
  ok(false, "RECOVERY_BUDGET_BOUNDED Infinity rejected");
} catch {
  ok(true, "RECOVERY_BUDGET_BOUNDED Infinity rejected");
}
try {
  defaultEvaluationBudget();
  ok(true, "default budget is finite");
} catch (err) {
  ok(false, "default budget is finite", err);
}

ok(
  FORBIDDEN_EVALUATION_SIDE_EFFECT_ACTIONS.every(
    (action) =>
      isForbiddenSideEffectAction(action) &&
      !(EVALUATION_RECOVERY_ACTION_KINDS as readonly string[]).includes(action),
  ),
  "FORBIDDEN_SIDE_EFFECT_RECOVERY not in allowlist",
);
ok(
  DEFAULT_READ_SEARCH_RECOVERY_ACTIONS.every(
    (action) =>
      (EVALUATION_RECOVERY_ACTION_KINDS as readonly string[]).includes(action),
  ),
  "RECOVERY_ALLOWLIST_ENFORCED",
);
try {
  rejectUnknownRecoveryAction("TELEPORT");
  ok(false, "unknown recovery action rejected");
} catch {
  ok(true, "unknown recovery action rejected");
}
try {
  rejectUnknownRecoveryAction("SEND_EMAIL");
  ok(false, "SEND_EMAIL recovery rejected");
} catch {
  ok(true, "SEND_EMAIL recovery rejected");
}
try {
  assertRecoveryAllowlist(["SUBMIT_BID"]);
  ok(false, "SUBMIT_BID recovery rejected");
} catch {
  ok(true, "SUBMIT_BID recovery rejected");
}

ok(!isJudgeEligiblePrivacyClass("PROHIBITED"), "PROHIBITED_EVIDENCE_FAIL_CLOSED");
ok(isJudgeEligiblePrivacyClass("INTERNAL"), "INTERNAL evidence may be eligible");
ok(
  FORBIDDEN_JUDGE_EVIDENCE_KINDS.every(
    (kind) => !isJudgeEligibleEvidenceKind(kind),
  ),
  "raw prompt/output/email are not Judge evidence kinds",
);

ok(
  sanitizeGoalSummary("  two   lines\nplease  ").length <= 240,
  "goalSummary is sanitized metadata",
);
ok(
  hasForbiddenContractFields({ rawContent: "hello" }),
  "rawContent is a forbidden contract field",
);
ok(
  !hasForbiddenContractFields({ goalSummary: "analyze tender" }),
  "goalSummary is allowed",
);

const tender = A2P2_DOMAIN_TEMPLATES.TENDER_ANALYSIS(new Date().toISOString());
ok(tender.riskClass === "LOW", "tender template is LOW analysis");
ok(
  tender.recoveryPolicy.allowedActions.every(
    (action) => !isForbiddenSideEffectAction(action),
  ),
  "TENDER_ANALYSIS read/search recovery only",
);
ok(
  tender.requirements.some((req) => req.id === "submission_deadline" && req.required),
  "tender deadline is required",
);
ok(
  tender.requirements.some((req) => req.id === "pricing_requirements" && !req.required),
  "tender pricing is not blindly required",
);

const email = A2P2_DOMAIN_TEMPLATES.EMAIL_DRAFT(new Date().toISOString());
ok(email.automationLevel === "L2_AUTO_PREPARE", "EMAIL_DRAFT stays at prepare");
ok(emailDraftForbidsAutoSend(email), "EMAIL_DRAFT_NO_AUTO_SEND");
ok(
  !(email.recoveryPolicy.allowedActions as readonly string[]).includes("SEND_EMAIL"),
  "EMAIL_DRAFT recovery cannot send",
);

const generic = resolveTaskContract({});
ok(generic.taskType === "GENERIC", "unclassified uses GENERIC fallback");
ok(generic.riskClass === "MEDIUM", "GENERIC_FALLBACK_CONSERVATIVE risk");
ok(generic.automationLevel === "L1_AUTO_ANALYZE", "GENERIC automation is L1");
ok(generic.requirements.length === 0, "GENERIC does not fabricate requirements");
ok(
  generic.recoveryPolicy.allowExternalResearch === false,
  "GENERIC has no external research",
);
ok(
  generic.provenance.source === "GENERIC_FALLBACK" &&
    generic.provenance.contractVersion === A2P2_TASK_CONTRACT_VERSION,
  "TASK_CONTRACT_PROVENANCE",
);

const explicit = resolveTaskContract({
  explicitContract: {
    ...generic,
    taskType: "RESEARCH",
    goalSummary: "  classified research  ",
    riskClass: "LOW",
  },
});
ok(
  explicit.taskType === "RESEARCH" &&
    explicit.provenance.source === "EXPLICIT_CONTRACT",
  "explicit typed contract wins",
);

const poisoned = resolveTaskContract({
  explicitContract: {
    ...generic,
    rawContent: "full user prompt",
  } as typeof generic & { rawContent: string },
  domainHint: "RESEARCH",
});
ok(
  poisoned.taskType === "RESEARCH" && poisoned.provenance.source === "DOMAIN_TEMPLATE",
  "poisoned explicit contract is ignored for domain template",
);

const domain = resolveTaskContract({ domainHint: "TENDER_ANALYSIS" });
ok(domain.taskType === "TENDER_ANALYSIS", "known domain template resolves");

ok(
  A2P2_ACTIVATION_BLOCKERS.some((item) => item.id === "A2_P1_PRODUCTION_ORG_SCOPE") &&
    A2P2_ACTIVATION_BLOCKERS.some(
      (item) => item.id === "A2_P1_CALL_BUDGET_OR_RATE_GUARD",
    ),
  "P1 activation blockers remain open",
);
ok(
  A2P2_KPI_TARGETS.AUTO_EVALUATION_RATE_TARGET >= 0.95 &&
    A2P2_KPI_TARGETS.UNBOUNDED_RETRY_TARGET === 0,
  "KPI targets are documented constants only",
);

const root = process.cwd();
const contractSrc = readFileSync(join(root, "src/lib/autopilot/a2p2-contract.ts"), "utf8");
const templatesSrc = readFileSync(join(root, "src/lib/autopilot/a2p2-templates.ts"), "utf8");
const routingSrc = readFileSync(join(root, "src/lib/autopilot/a2p2-routing.ts"), "utf8");
const blob = `${contractSrc}\n${templatesSrc}\n${routingSrc}`;
ok(
  FORBIDDEN_CONTRACT_FIELD_NAMES.includes("rawContent") &&
    !/goalSummary[\s\S]{0,200}rawContent/.test(contractSrc) &&
    !/type AutonomousEvaluationTaskContract = \{[\s\S]*rawContent/.test(contractSrc),
  "NO_RAW_CONTENT_FIELDS",
);
ok(
  !blob.includes('from "@/lib/db"') &&
    !blob.includes("createCompletion") &&
    !blob.includes("persistLlmJudgeEvaluation") &&
    !blob.includes("processAutopilotTelemetryOutbox"),
  "P2.0 modules do not call LLM, DB, or processor",
);
const instr = readFileSync(join(root, "src/lib/autopilot/instrumentation.ts"), "utf8");
const processor = readFileSync(join(root, "src/lib/autopilot/processor.ts"), "utf8");
ok(
  !instr.includes("a2p2-") && !processor.includes("a2p2-"),
  "RUNTIME_INTEGRATION_ADDED = NO",
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
