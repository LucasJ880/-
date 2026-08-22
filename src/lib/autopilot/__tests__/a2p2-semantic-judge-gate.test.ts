/**
 * Autopilot A2-P2.2 deterministic gate — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge-gate.test.ts
 */

import { acceptSemanticProposal, aggregateSemanticOutcome } from "../a2p2-semantic-judge-gate";
import { parseSemanticJudgeProposal } from "../a2p2-semantic-judge-parser";
import { prepareSemanticJudgeInput } from "../a2p2-semantic-judge-input";
import type { SemanticJudgeFacingInput } from "../a2p2-semantic-judge-types";
import { proposalFromRequest, tenderReady } from "./a2p2-semantic-judge-helpers";

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

console.log("autopilot A2-P2.2 semantic judge gate");

ok(
  aggregateSemanticOutcome([
    { judgment: "SATISFIED", confidence: "high" },
    { judgment: "SATISFIED", confidence: "high" },
  ]) === "TASK_SUCCESS",
  "all required high SATISFIED → TASK_SUCCESS",
);
ok(
  aggregateSemanticOutcome([
    { judgment: "SATISFIED", confidence: "high" },
    { judgment: "PARTIAL", confidence: "high" },
  ]) === "PARTIAL_SUCCESS",
  "one required high PARTIAL → PARTIAL_SUCCESS",
);
ok(
  aggregateSemanticOutcome([
    { judgment: "SATISFIED", confidence: "high" },
    { judgment: "NOT_SATISFIED", confidence: "high" },
  ]) === "FAILURE",
  "one required high NOT_SATISFIED → FAILURE",
);
ok(
  aggregateSemanticOutcome([
    { judgment: "SATISFIED", confidence: "high" },
    { judgment: "UNKNOWN", confidence: "high" },
  ]) === "UNKNOWN",
  "required UNKNOWN → UNKNOWN",
);
ok(
  aggregateSemanticOutcome([
    { judgment: "SATISFIED", confidence: "medium" },
    { judgment: "SATISFIED", confidence: "high" },
  ]) === "UNKNOWN",
  "MEDIUM_CONFIDENCE_SUCCESS_ABSTAINS aggregation",
);
ok(
  aggregateSemanticOutcome([{ judgment: "NOT_SATISFIED", confidence: "low" }]) === "UNKNOWN",
  "LOW_CONFIDENCE_FAILURE_ABSTAINS aggregation",
);
ok(aggregateSemanticOutcome([]) === "UNKNOWN", "no required rows → UNKNOWN not success");

const { contract, packet } = tenderReady();
const prepared = prepareSemanticJudgeInput({ contract, evidencePacket: packet });
if (!prepared.ok) {
  console.error("expected tender prepare to succeed", prepared);
  process.exit(1);
}

function gateWith(
  mutate: (
    proposal: Record<string, unknown> & { requirements: Array<Record<string, unknown>> },
    facing: SemanticJudgeFacingInput,
  ) => void,
) {
  const request = {
    systemPrompt: "",
    userContent: prepared.serialized,
    tools: [] as const,
    toolChoice: "none" as const,
    jsonSchema: {} as never,
  };
  const raw = proposalFromRequest(request, mutate);
  const parsed = parseSemanticJudgeProposal(JSON.stringify(raw));
  if (!parsed.ok) return { parse: parsed, accepted: null };
  return {
    parse: parsed,
    accepted: acceptSemanticProposal({
      contract,
      packet,
      facing: prepared.facing,
      proposal: parsed.proposal,
    }),
  };
}

const success = gateWith(() => {});
ok(success.accepted?.ok === true, "grounded success proposal accepted structurally");
ok(
  success.accepted?.ok &&
    success.accepted.outcome === "TASK_SUCCESS" &&
    success.accepted.verdictState === "ACCEPTED",
  "ALL_REQUIRED_HIGH_SATISFIED ACCEPTED_TASK_SUCCESS",
);

const optionalUnknown = gateWith(() => {});
ok(
  optionalUnknown.accepted?.ok &&
    optionalUnknown.accepted.outcome === "TASK_SUCCESS" &&
    contract.requirements.some((item) => !item.required),
  "OPTIONAL_UNKNOWN_DOES_NOT_BLOCK_SUCCESS",
);

const missing = gateWith((proposal) => {
  proposal.requirements = proposal.requirements.filter(
    (item) => item.requirementId !== "evaluation_criteria",
  );
});
ok(
  missing.accepted &&
    !missing.accepted.ok &&
    missing.accepted.ruleId === "SEMANTIC_JUDGE_MISSING_REQUIREMENT",
  "MODEL_MISSING_REQUIREMENT_REJECTED",
);

const unknownReq = gateWith((proposal) => {
  proposal.requirements.push({
    requirementId: "invented_requirement",
    judgment: "UNKNOWN",
    confidence: "high",
    evidenceRefs: [],
    reasonCode: "SEMANTIC_UNCERTAINTY",
    rationale: "extra",
  });
});
ok(
  unknownReq.accepted &&
    !unknownReq.accepted.ok &&
    unknownReq.accepted.ruleId === "SEMANTIC_JUDGE_UNKNOWN_REQUIREMENT",
  "MODEL_UNKNOWN_REQUIREMENT_REJECTED",
);

const packetEcho = gateWith((proposal) => {
  proposal.packetHash = "c".repeat(64);
});
ok(
  packetEcho.accepted &&
    !packetEcho.accepted.ok &&
    packetEcho.accepted.ruleId === "SEMANTIC_JUDGE_PACKET_HASH_ECHO_MISMATCH",
  "PROPOSAL_PACKET_HASH_MISMATCH_REJECTED",
);

const inputEcho = gateWith((proposal) => {
  proposal.judgeInputHash = "c".repeat(64);
});
ok(
  inputEcho.accepted &&
    !inputEcho.accepted.ok &&
    inputEcho.accepted.ruleId === "SEMANTIC_JUDGE_INPUT_HASH_ECHO_MISMATCH",
  "PROPOSAL_INPUT_HASH_MISMATCH_REJECTED",
);

const invented = gateWith((proposal, facing) => {
  const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
  if (deadline) deadline.evidenceRefs = ["fake-123"];
  void facing;
});
ok(
  invented.accepted &&
    !invented.accepted.ok &&
    invented.accepted.ruleId === "SEMANTIC_JUDGE_UNKNOWN_EVIDENCE_REF",
  "UNKNOWN_EVIDENCE_REF_REJECTED",
);

const cross = gateWith((proposal, facing) => {
  const other = facing.evidenceFacts.find((fact) => fact.requirementId === "mandatory_requirements");
  const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
  if (deadline && other) deadline.evidenceRefs = [other.evidenceRef];
});
ok(
  cross.accepted &&
    !cross.accepted.ok &&
    cross.accepted.ruleId === "SEMANTIC_JUDGE_CROSS_REQUIREMENT_EVIDENCE_REF",
  "CROSS_REQUIREMENT_EVIDENCE_REF_REJECTED",
);

const ungroundedSatisfied = gateWith((proposal) => {
  const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
  if (deadline) deadline.evidenceRefs = [];
});
ok(
  ungroundedSatisfied.accepted &&
    !ungroundedSatisfied.accepted.ok &&
    ungroundedSatisfied.accepted.ruleId === "SEMANTIC_JUDGE_UNGROUNDED_SATISFIED",
  "SATISFIED_WITHOUT_EVIDENCE_REJECTED",
);

const ungroundedPartial = gateWith((proposal) => {
  const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
  if (deadline) {
    deadline.judgment = "PARTIAL";
    deadline.reasonCode = "EVIDENCE_PARTIALLY_SUPPORTS_REQUIREMENT";
    deadline.evidenceRefs = [];
  }
});
ok(
  ungroundedPartial.accepted &&
    !ungroundedPartial.accepted.ok &&
    ungroundedPartial.accepted.ruleId === "SEMANTIC_JUDGE_UNGROUNDED_PARTIAL",
  "PARTIAL_WITHOUT_EVIDENCE_REJECTED",
);

const ungroundedFailure = gateWith((proposal) => {
  const deadline = proposal.requirements.find((item) => item.requirementId === "submission_deadline");
  if (deadline) {
    deadline.judgment = "NOT_SATISFIED";
    deadline.reasonCode = "EVIDENCE_CONTRADICTS_REQUIREMENT";
    deadline.evidenceRefs = [];
  }
});
ok(
  ungroundedFailure.accepted &&
    !ungroundedFailure.accepted.ok &&
    ungroundedFailure.accepted.ruleId === "SEMANTIC_JUDGE_UNGROUNDED_NOT_SATISFIED",
  "NOT_SATISFIED_WITHOUT_EVIDENCE_REJECTED",
);

const rationaleChange = gateWith((proposal) => {
  for (const item of proposal.requirements) item.rationale = "different display text";
});
ok(
  rationaleChange.accepted?.ok &&
    rationaleChange.accepted.outcome === "TASK_SUCCESS" &&
    rationaleChange.accepted.verdictState === "ACCEPTED",
  "rationale is not authority",
);

if (fail > 0) {
  console.error(`FAIL ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass + fail}`);
