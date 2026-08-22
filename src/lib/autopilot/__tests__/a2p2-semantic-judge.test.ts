/**
 * Autopilot A2-P2.2 Grounded Semantic Judge — integration locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge.test.ts
 *
 * LLM proposes. Deterministic code decides.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { toEvaluationEvidenceStatus } from "../a2p2-evidence-adapter";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { hashEvidencePacket } from "../a2p2-evidence-hash";
import { routeEvaluation } from "../a2p2-routing";
import { resolveTaskContract } from "../a2p2-templates";
import { hashSemanticJudgeProposal } from "../a2p2-semantic-judge-gate";
import { runSemanticJudge, toP2EvaluationState } from "../a2p2-semantic-judge";
import {
  A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
  MAX_SEMANTIC_JUDGE_OUTPUT_BYTES,
  SEMANTIC_JUDGE_TOOL_COUNT,
} from "../a2p2-semantic-judge-types";
import { makeAnalysisResultV2 } from "./a2p2-evidence-fixtures";
import {
  NOW,
  ZERO_BUDGET,
  cloneJson,
  countingProvider,
  satisfiedProvider,
  tenderContract,
  tenderReady,
} from "./a2p2-semantic-judge-helpers";

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

console.log("autopilot A2-P2.2 grounded semantic judge");

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {

ok(SEMANTIC_JUDGE_TOOL_COUNT === 0, "SEMANTIC_JUDGE_TOOL_COUNT");

const { contract, packet } = tenderReady();
const tracked: Array<{ name: string; outcome: string; verdict: string }> = [];

async function run(name: string, input: Parameters<typeof runSemanticJudge>[0]) {
  const decision = await runSemanticJudge(input);
  tracked.push({
    name,
    outcome: decision.outcome,
    verdict: decision.verdictState,
  });
  ok(decision.failureType === null, `${name} failureType null`);
  ok(!("rawText" in decision), `${name} no raw model output field`);
  return decision;
}

const successCounter = countingProvider(satisfiedProvider());
const success = await run("tender success", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: successCounter.provider,
});
ok(successCounter.calls() === 1, "PROVIDER_CALLED_AT_MOST_ONCE success");
ok(successCounter.lastRequest()?.tools.length === 0, "provider tools empty");
ok(successCounter.lastRequest()?.toolChoice === "none", "tool_choice none");
ok(
  success.outcome === "TASK_SUCCESS" && success.verdictState === "ACCEPTED",
  "ALL_REQUIRED_HIGH_SATISFIED ACCEPTED_TASK_SUCCESS",
);
ok(success.providerStatus === "RETURNED", "success provider RETURNED");
ok(success.proposalStatus === "VALID", "success proposal VALID");
ok(typeof success.proposalHash === "string", "proposalHash computed locally");

const successPayload = successCounter.lastRequest()?.userContent ?? "";
ok(!successPayload.includes("SECRET_RAW_VALUE_MUST_NOT_LEAK"), "JUDGE_RAW_CONTENT_EXPOSED rawValue ZERO");
ok(!successPayload.includes("SNIPPET_TEXT_MUST_NOT_LEAK"), "JUDGE_RAW_CONTENT_EXPOSED snippet ZERO");
ok(!/"sourceId"/.test(successPayload), "JUDGE_RAW_CONTENT_EXPOSED sourceId ZERO");
ok(!successPayload.toLowerCase().includes("authorization"), "no Authorization");
ok(!successPayload.toLowerCase().includes("bearer"), "no Bearer");
ok(!successPayload.toLowerCase().includes("password"), "no password");
ok(!successPayload.toLowerCase().includes("private key"), "no private key");
ok(!successPayload.includes("emailBody"), "no email body");
ok(!successPayload.includes("tenderBody"), "no tender body");
ok(!successPayload.includes("toolPayload"), "no toolPayload");
ok(!successPayload.includes("modelOutput"), "no modelOutput");
ok(!/"prompt"\s*:/.test(successPayload), "no prompt key in judge input");

const lowRoute = routeEvaluation({
  taskContract: contract,
  evaluationState: toP2EvaluationState(success),
  evidenceState: { status: toEvaluationEvidenceStatus(packet.status) },
  recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
  budgetState: {
    judgeCallsUsed: 0,
    recoveryCyclesUsed: 0,
    externalSearchesUsed: 0,
    costUsdUsed: 0,
  },
});
ok(lowRoute.decision === "AUTO_FINALIZE", "LOW risk ACCEPTED TASK_SUCCESS → AUTO_FINALIZE");

const partialCounter = countingProvider(
  satisfiedProvider((proposal) => {
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline) {
      deadline.judgment = "PARTIAL";
      deadline.reasonCode = "EVIDENCE_PARTIALLY_SUPPORTS_REQUIREMENT";
    }
  }),
);
const partial = await run("tender partial", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: partialCounter.provider,
});
ok(
  partial.outcome === "PARTIAL_SUCCESS" && partial.verdictState === "ACCEPTED",
  "ONE_REQUIRED_HIGH_PARTIAL ACCEPTED_PARTIAL_SUCCESS",
);

const failureCounter = countingProvider(
  satisfiedProvider((proposal) => {
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline) {
      deadline.judgment = "NOT_SATISFIED";
      deadline.reasonCode = "EVIDENCE_CONTRADICTS_REQUIREMENT";
    }
  }),
);
const failure = await run("tender failure", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: failureCounter.provider,
});
ok(failure.outcome === "FAILURE" && failure.verdictState === "ACCEPTED", "ONE_REQUIRED_HIGH_NOT_SATISFIED ACCEPTED_FAILURE");
ok(failure.failureType === null, "P2_2_FAILURE_TYPE_CLASSIFICATION_COUNT");

const unknownCounter = countingProvider(
  satisfiedProvider((proposal) => {
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline) {
      deadline.judgment = "UNKNOWN";
      deadline.reasonCode = "SEMANTIC_UNCERTAINTY";
      deadline.evidenceRefs = [];
    }
  }),
);
const unknown = await run("tender unknown", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: unknownCounter.provider,
});
ok(
  unknown.outcome === "UNKNOWN" && unknown.verdictState === "ABSTAINED",
  "ONE_REQUIRED_UNKNOWN ABSTAINED_UNKNOWN",
);
ok(unknown.outcome !== "TASK_SUCCESS", "required UNKNOWN never TASK_SUCCESS");

const abstainRoute = routeEvaluation({
  taskContract: contract,
  evaluationState: toP2EvaluationState(unknown),
  evidenceState: { status: toEvaluationEvidenceStatus(packet.status) },
  recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
  budgetState: {
    judgeCallsUsed: 0,
    recoveryCyclesUsed: 0,
    externalSearchesUsed: 0,
    costUsdUsed: 0,
  },
});
ok(abstainRoute.decision === "AUTO_ABSTAIN", "LOW risk ABSTAINED UNKNOWN → AUTO_ABSTAIN");

const medium = await run("medium confidence", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: satisfiedProvider((proposal) => {
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline) deadline.confidence = "medium";
  }),
});
ok(
  medium.outcome === "UNKNOWN" && medium.verdictState === "ABSTAINED",
  "MEDIUM_CONFIDENCE_SUCCESS_ABSTAINS",
);

const lowConf = await run("low confidence failure", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: satisfiedProvider((proposal) => {
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline) {
      deadline.judgment = "NOT_SATISFIED";
      deadline.confidence = "low";
      deadline.reasonCode = "EVIDENCE_CONTRADICTS_REQUIREMENT";
    }
  }),
});
ok(
  lowConf.outcome === "UNKNOWN" && lowConf.verdictState === "ABSTAINED",
  "LOW_CONFIDENCE_FAILURE_ABSTAINS",
);

const inventedCounter = countingProvider(
  satisfiedProvider((proposal) => {
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline) deadline.evidenceRefs = ["fake-123"];
  }),
);
const invented = await run("invented citation", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: inventedCounter.provider,
});
ok(
  invented.verdictState === "NOT_EVALUATED" && invented.outcome === "UNKNOWN",
  "INVENTED_CITATION_CANNOT_CREATE_SUCCESS",
);
ok(invented.outcome !== "TASK_SUCCESS", "invented citation not success");

const cross = await run("cross requirement", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: satisfiedProvider((proposal, facing) => {
    const other = facing.evidenceFacts.find((fact) => fact.requirementId === "mandatory_requirements");
    const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
    if (deadline && other) deadline.evidenceRefs = [other.evidenceRef];
  }),
});
ok(
  cross.verdictState === "NOT_EVALUATED" && cross.outcome === "UNKNOWN",
  "CROSS_REQUIREMENT_CITATION_CANNOT_CREATE_SUCCESS",
);

const verdictFromModel = await run("model verdictState", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: async (request) => {
    const inner = await satisfiedProvider()(request);
    const proposal = JSON.parse(inner.text) as Record<string, unknown>;
    proposal.verdictState = "ACCEPTED";
    return { text: JSON.stringify(proposal) };
  },
});
ok(
  verdictFromModel.verdictState === "NOT_EVALUATED" && verdictFromModel.outcome === "UNKNOWN",
  "MODEL_CANNOT_SET_VERDICT_STATE",
);

const extraTextCounter = countingProvider(async (request) => {
  const inner = await satisfiedProvider()(request);
  return { text: `Here is JSON\n${inner.text}` };
});
const extraText = await run("extra text", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: extraTextCounter.provider,
});
ok(
  extraText.verdictState === "NOT_EVALUATED" && extraText.outcome === "UNKNOWN",
  "MODEL_EXTRA_TEXT_REJECTED end to end",
);
ok(extraTextCounter.calls() === 1, "PROVIDER_CALLED_AT_MOST_ONCE parse failure");
ok(extraText.outcome !== "FAILURE", "MODEL_PARSE_FAILURE_IS_NOT_TASK_FAILURE");

const unavailableCounter = countingProvider(async () => {
  throw new Error("provider down");
});
const unavailable = await run("provider throw", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: unavailableCounter.provider,
});
ok(
  unavailable.providerStatus === "UNAVAILABLE" &&
    unavailable.verdictState === "NOT_EVALUATED" &&
    unavailable.outcome === "UNKNOWN",
  "PROVIDER_FAILURE_IS_NOT_TASK_FAILURE",
);
ok(unavailableCounter.calls() === 1, "provider throw still at most once");

const skipCounter = countingProvider(satisfiedProvider());
const insufficient = buildEvidencePacket({
  contract,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [],
      criticalFacts: makeAnalysisResultV2().criticalFacts,
    }),
  },
  now: NOW,
});
const missingEvidence = await run("missing evidence packet", {
  taskContract: contract,
  evidencePacket: insufficient,
  budgetState: ZERO_BUDGET,
  provider: skipCounter.provider,
});
ok(skipCounter.calls() === 0, "INSUFFICIENT_PACKET_SKIPS_MODEL");
ok(
  missingEvidence.outcome === "UNKNOWN" && missingEvidence.verdictState === "NOT_EVALUATED",
  "MISSING_EVIDENCE_IS_NOT_SEMANTIC_FAILURE",
);

const callBudget = countingProvider(satisfiedProvider());
const callBudgetSkip = await run("judge call budget", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: { judgeCallsUsed: contract.evaluationBudget.maxJudgeCalls, costUsdUsed: 0 },
  provider: callBudget.provider,
});
ok(callBudget.calls() === 0, "JUDGE_CALL_BUDGET_EXHAUSTED_SKIPS_PROVIDER");
ok(callBudgetSkip.providerStatus === "NOT_CALLED", "budget skip NOT_CALLED");

const costBudget = countingProvider(satisfiedProvider());
const costSkip = await run("cost budget", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: { judgeCallsUsed: 0, costUsdUsed: contract.evaluationBudget.maxCostUsd },
  provider: costBudget.provider,
});
ok(costBudget.calls() === 0, "COST_BUDGET_EXHAUSTED_SKIPS_PROVIDER");
ok(costSkip.providerStatus === "NOT_CALLED", "cost skip NOT_CALLED");

const genericEmptyCounter = countingProvider(satisfiedProvider());
const genericEmpty = await run("generic empty", {
  taskContract: resolveTaskContract({ domainHint: "GENERIC", now: NOW }),
  evidencePacket: buildEvidencePacket({
    contract: resolveTaskContract({ domainHint: "GENERIC", now: NOW }),
    now: NOW,
  }),
  budgetState: ZERO_BUDGET,
  provider: genericEmptyCounter.provider,
});
ok(genericEmptyCounter.calls() === 0, "GENERIC_EMPTY_CONTRACT_SKIPS_PROVIDER");
ok(genericEmpty.ruleId === "SEMANTIC_JUDGE_GENERIC_EMPTY", "generic empty rule");

const researchCounter = countingProvider(satisfiedProvider());
const research = await run("research", {
  taskContract: resolveTaskContract({ domainHint: "RESEARCH", now: NOW }),
  evidencePacket: buildEvidencePacket({
    contract: resolveTaskContract({ domainHint: "RESEARCH", now: NOW }),
    now: NOW,
  }),
  budgetState: ZERO_BUDGET,
  provider: researchCounter.provider,
});
ok(researchCounter.calls() === 0, "RESEARCH_NOT_JUDGE_ELIGIBLE_YET");
ok(research.providerStatus === "NOT_CALLED", "research provider not called");

const emailCounter = countingProvider(satisfiedProvider());
const emailContract = resolveTaskContract({ domainHint: "EMAIL_DRAFT", now: NOW });
const email = await run("email", {
  taskContract: emailContract,
  evidencePacket: buildEvidencePacket({
    contract: emailContract,
    structuredSources: {
      emailDraft: {
        purposeAddressed: true,
        requiredQuestionIds: ["q1"],
        unsupportedCommitmentAbsent: true,
        recipientResolved: true,
      },
    },
    now: NOW,
  }),
  budgetState: ZERO_BUDGET,
  provider: emailCounter.provider,
});
ok(emailCounter.calls() === 0, "EMAIL_DRAFT_NOT_JUDGE_ELIGIBLE_YET");

const highContract = resolveTaskContract({
  now: NOW,
  explicitContract: { ...cloneJson(tenderContract()), riskClass: "HIGH" },
});
const highPacket = buildEvidencePacket({
  contract: highContract,
  structuredSources: { tender: makeAnalysisResultV2() },
  now: NOW,
});
const highDecision = await run("high risk success", {
  taskContract: highContract,
  evidencePacket: highPacket,
  budgetState: ZERO_BUDGET,
  provider: satisfiedProvider(),
});
ok(
  highDecision.verdictState === "ACCEPTED" && highDecision.outcome === "TASK_SUCCESS",
  "HIGH risk can still be semantically ACCEPTED",
);
const highRoute = routeEvaluation({
  taskContract: highContract,
  evaluationState: toP2EvaluationState(highDecision),
  evidenceState: { status: toEvaluationEvidenceStatus(highPacket.status) },
  recoveryState: { status: "AVAILABLE", cyclesUsed: 0 },
  budgetState: {
    judgeCallsUsed: 0,
    recoveryCyclesUsed: 0,
    externalSearchesUsed: 0,
    costUsdUsed: 0,
  },
});
ok(highRoute.decision === "HUMAN_ESCALATE", "HIGH_RISK_ACCEPTED_VERDICT_STILL_HUMAN");

const malformedCounter = countingProvider(satisfiedProvider());
const malformed = await run("malformed packet", {
  taskContract: contract,
  evidencePacket: { version: 1, nested: { x: null } },
  budgetState: ZERO_BUDGET,
  provider: malformedCounter.provider,
});
ok(malformedCounter.calls() === 0, "malformed packet skips provider");
ok(
  malformed.outcome === "UNKNOWN" && malformed.verdictState === "NOT_EVALUATED",
  "ARBITRARY_MALFORMED_PACKET_NEVER_THROWS e2e",
);

const descContractRaw = cloneJson(contract);
descContractRaw.requirements = descContractRaw.requirements.map((item) =>
  item.id === "submission_deadline"
    ? { ...item, normalizedDescription: "a different deadline description" }
    : item,
);
const descContract = resolveTaskContract({ now: NOW, explicitContract: descContractRaw });
const descCounter = countingProvider(satisfiedProvider());
const descSkip = await run("semantic description mismatch", {
  taskContract: descContract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: descCounter.provider,
});
ok(descCounter.calls() === 0, "SEMANTIC_DESCRIPTION_MISMATCH_SKIPS_PROVIDER e2e");
ok(
  descSkip.outcome === "UNKNOWN" && descSkip.verdictState === "NOT_EVALUATED",
  "OLD_PACKET_CANNOT_BE_REUSED_WITH_NEW_REQUIREMENT_SEMANTICS e2e",
);

const piiCounter = countingProvider(
  satisfiedProvider((proposal) => {
    for (const row of proposal.requirements) {
      row.rationale = "contact bidder@example.com";
    }
  }),
);
const pii = await run("pii rationale", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: piiCounter.provider,
});
ok(
  pii.requirementJudgments.every(
    (item) =>
      item.rationale.includes("[EMAIL]") && !item.rationale.includes("bidder@example.com"),
  ),
  "PII_IN_MODEL_RATIONALE_REDACTED e2e",
);
ok(
  typeof pii.proposalHash === "string" &&
    pii.packetHash &&
    pii.judgeInputHash &&
    pii.proposalHash ===
      hashSemanticJudgeProposal({
        version: A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
        packetHash: pii.packetHash,
        judgeInputHash: pii.judgeInputHash,
        requirements: [...pii.requirementJudgments],
      }),
  "proposalHash matches safe redacted proposal",
);

const forgedCounter = countingProvider(satisfiedProvider());
const forgedPacket = cloneJson(packet);
if (forgedPacket.evidenceFacts[0]) {
  forgedPacket.evidenceFacts[0].privacyClass = "SECRET" as never;
}
forgedPacket.packetHash = hashEvidencePacket(forgedPacket);
const forged = await run("forged self-hash", {
  taskContract: contract,
  evidencePacket: forgedPacket,
  budgetState: ZERO_BUDGET,
  provider: forgedCounter.provider,
});
ok(forgedCounter.calls() === 0, "forged packet skips provider");
ok(
  forged.outcome === "UNKNOWN" && forged.verdictState === "NOT_EVALUATED",
  "SELF_HASHED_FORGED_PACKET_CANNOT_CREATE_SUCCESS",
);

const oversizeCounter = countingProvider(async () => ({
  text: "x".repeat(MAX_SEMANTIC_JUDGE_OUTPUT_BYTES + 1),
}));
const oversize = await run("oversize output", {
  taskContract: contract,
  evidencePacket: packet,
  budgetState: ZERO_BUDGET,
  provider: oversizeCounter.provider,
});
ok(oversize.outcome === "UNKNOWN" && oversize.verdictState === "NOT_EVALUATED", "oversize not evaluated");
ok(oversize.outcome !== "FAILURE", "OVERSIZED_PROVIDER_OUTPUT_IS_NOT_TASK_FAILURE");
ok(oversize.ruleId === "SEMANTIC_JUDGE_OUTPUT_LIMIT_EXCEEDED", "OVERSIZED_PROVIDER_OUTPUT_NOT_PARSED e2e");

const falseSuccess = tracked.filter(
  (item) => item.outcome === "TASK_SUCCESS" && item.verdict === "ACCEPTED",
);
ok(
  falseSuccess.every(
    (item) =>
      item.name === "tender success" ||
      item.name === "high risk success" ||
      item.name === "pii rationale",
  ),
  "FALSE_TASK_SUCCESS_PATHS",
);
ok(
  tracked.every((item) => item.outcome !== "TASK_SUCCESS" || item.verdict === "ACCEPTED"),
  "TASK_SUCCESS never without ACCEPTED",
);

const p2Dir = join(process.cwd(), "src/lib/autopilot");
const p22Files = readdirSync(p2Dir).filter((name) => name.startsWith("a2p2-semantic-judge"));
const p22Src = p22Files.map((name) => readFileSync(join(p2Dir, name), "utf8")).join("\n");
ok(!p22Src.includes("createCompletion"), "no second SDK client");
ok(!p22Src.includes("from \"./evaluate-judge\""), "does not import A2-P1 judge");
ok(!p22Src.includes("from \"./processor\""), "RUNTIME_INTEGRATION_ADDED NO processor");
ok(!/HALLUCINATION|REASONING_ERROR|WRONG_TOOL|INTENT_ERROR|CONTEXT_MISSING/.test(p22Src), "no A3 failureType classification");
ok(!p22Src.includes("@prisma/client"), "DATABASE_WRITE_PATH_ADDED NO");

const p1 = readFileSync(join(p2Dir, "evaluate-judge.ts"), "utf8");
ok(p1.includes("A2-P1 LLM Judge"), "A2_P1_BEHAVIOR_CHANGED NO");
ok(p1.includes("You only see structural run telemetry"), "A2-P1 prompt unchanged");

if (fail > 0) {
  console.error(`FAIL ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass + fail}`);
}
