/**
 * Autopilot A2-P2.2 strict proposal parser — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-semantic-judge-parser.test.ts
 */

import { parseSemanticJudgeProposal } from "../a2p2-semantic-judge-parser";
import {
  A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
  MAX_SEMANTIC_JUDGE_OUTPUT_BYTES,
} from "../a2p2-semantic-judge-types";

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

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function row(overrides: Record<string, unknown> = {}) {
  return {
    requirementId: "submission_deadline",
    judgment: "SATISFIED",
    confidence: "high",
    evidenceRefs: [HASH_A],
    reasonCode: "EVIDENCE_SUPPORTS_REQUIREMENT",
    rationale: "ok",
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    version: A2P2_SEMANTIC_JUDGE_PROPOSAL_VERSION,
    packetHash: HASH_A,
    judgeInputHash: HASH_B,
    requirements: [row()],
    ...overrides,
  };
}

console.log("autopilot A2-P2.2 semantic judge parser");

const valid = parseSemanticJudgeProposal(JSON.stringify(proposal()));
ok(valid.ok === true, "strict JSON object accepted");

const extraText = parseSemanticJudgeProposal(`note\n${JSON.stringify(proposal())}`);
ok(
  !extraText.ok && extraText.ruleId === "SEMANTIC_JUDGE_EXTRA_TEXT",
  "MODEL_EXTRA_TEXT_REJECTED",
);

const fenced = parseSemanticJudgeProposal("```json\n" + JSON.stringify(proposal()) + "\n```");
ok(!fenced.ok && fenced.ruleId === "SEMANTIC_JUDGE_EXTRA_TEXT", "markdown fences rejected");

const unknownTop = parseSemanticJudgeProposal(
  JSON.stringify(proposal({ verdictState: "ACCEPTED" })),
);
ok(
  !unknownTop.ok && unknownTop.ruleId === "SEMANTIC_JUDGE_UNKNOWN_FIELD",
  "MODEL_UNKNOWN_FIELD_REJECTED",
);

const routeField = parseSemanticJudgeProposal(
  JSON.stringify(proposal({ AUTO_FINALIZE: true })),
);
ok(
  !routeField.ok && routeField.ruleId === "SEMANTIC_JUDGE_UNKNOWN_FIELD",
  "MODEL_CANNOT_SET_ROUTE_DECISION",
);

const automation = parseSemanticJudgeProposal(
  JSON.stringify(proposal({ automationLevel: "L4_CONTROLLED_EXTERNAL_ACTION" })),
);
ok(
  !automation.ok && automation.ruleId === "SEMANTIC_JUDGE_UNKNOWN_FIELD",
  "MODEL_CANNOT_EXPAND_AUTOMATION",
);

const unknownReqField = parseSemanticJudgeProposal(
  JSON.stringify(
    proposal({
      requirements: [row({ outcome: "TASK_SUCCESS" })],
    }),
  ),
);
ok(
  !unknownReqField.ok && unknownReqField.ruleId === "SEMANTIC_JUDGE_UNKNOWN_FIELD",
  "unknown requirement field rejected",
);

const badEnum = parseSemanticJudgeProposal(
  JSON.stringify(proposal({ requirements: [row({ judgment: "YES" })] })),
);
ok(
  !badEnum.ok && badEnum.ruleId === "SEMANTIC_JUDGE_INVALID_ENUM",
  "MODEL_INVALID_ENUM_REJECTED",
);

const dupReq = parseSemanticJudgeProposal(
  JSON.stringify(
    proposal({
      requirements: [row(), row({ requirementId: "submission_deadline" })],
    }),
  ),
);
ok(
  !dupReq.ok && dupReq.ruleId === "SEMANTIC_JUDGE_DUPLICATE_REQUIREMENT",
  "MODEL_DUPLICATE_REQUIREMENT_REJECTED",
);

const dupRef = parseSemanticJudgeProposal(
  JSON.stringify(
    proposal({
      requirements: [row({ evidenceRefs: [HASH_A, HASH_A] })],
    }),
  ),
);
ok(
  !dupRef.ok && dupRef.ruleId === "SEMANTIC_JUDGE_DUPLICATE_EVIDENCE_REF",
  "DUPLICATE_EVIDENCE_REF_REJECTED",
);

const longRationale = parseSemanticJudgeProposal(
  JSON.stringify(proposal({ requirements: [row({ rationale: "x".repeat(161) })] })),
);
ok(!longRationale.ok, "oversized rationale rejected");

const malformed = parseSemanticJudgeProposal("{not json");
ok(!malformed.ok, "malformed JSON rejected");

ok(
  parseSemanticJudgeProposal(JSON.stringify(proposal({ version: "nope" }))).ok === false,
  "unknown proposal version rejected",
);

ok(
  parseSemanticJudgeProposal(
    JSON.stringify(proposal({ requirements: [row({ reasonCode: "EVIDENCE_CONTRADICTS_REQUIREMENT" })] })),
  ).ruleId === "SEMANTIC_JUDGE_JUDGMENT_REASON_MISMATCH",
  "SATISFIED_WITH_CONTRADICTS_REASON_REJECTED",
);
ok(
  parseSemanticJudgeProposal(
    JSON.stringify(
      proposal({
        requirements: [
          row({
            judgment: "PARTIAL",
            reasonCode: "EVIDENCE_SUPPORTS_REQUIREMENT",
          }),
        ],
      }),
    ),
  ).ruleId === "SEMANTIC_JUDGE_JUDGMENT_REASON_MISMATCH",
  "PARTIAL_WITH_SUPPORTS_REASON_REJECTED",
);
ok(
  parseSemanticJudgeProposal(
    JSON.stringify(
      proposal({
        requirements: [
          row({
            judgment: "NOT_SATISFIED",
            reasonCode: "EVIDENCE_SUPPORTS_REQUIREMENT",
          }),
        ],
      }),
    ),
  ).ruleId === "SEMANTIC_JUDGE_JUDGMENT_REASON_MISMATCH",
  "NOT_SATISFIED_WITH_SUPPORTS_REASON_REJECTED",
);
ok(
  parseSemanticJudgeProposal(
    JSON.stringify(
      proposal({
        requirements: [
          row({
            judgment: "UNKNOWN",
            reasonCode: "EVIDENCE_SUPPORTS_REQUIREMENT",
            evidenceRefs: [],
          }),
        ],
      }),
    ),
  ).ruleId === "SEMANTIC_JUDGE_JUDGMENT_REASON_MISMATCH",
  "UNKNOWN_WITH_SUPPORTS_REASON_REJECTED",
);

ok(
  parseSemanticJudgeProposal("x".repeat(MAX_SEMANTIC_JUDGE_OUTPUT_BYTES + 1)).ruleId ===
    "SEMANTIC_JUDGE_OUTPUT_LIMIT_EXCEEDED",
  "OVERSIZED_PROVIDER_OUTPUT_NOT_PARSED",
);

const tooMany = parseSemanticJudgeProposal(
  JSON.stringify(
    proposal({
      requirements: Array.from({ length: 33 }, (_, index) =>
        row({ requirementId: `req_${index}` }),
      ),
    }),
  ),
);
ok(
  !tooMany.ok && tooMany.ruleId === "SEMANTIC_JUDGE_REQUIREMENT_ARRAY_LIMIT",
  "MODEL_REQUIREMENT_ARRAY_LIMIT_ENFORCED",
);

ok(
  parseSemanticJudgeProposal(
    JSON.stringify(proposal({ requirements: [row({ rationale: "password: hunter2" })] })),
  ).ruleId === "SEMANTIC_JUDGE_UNSAFE_RATIONALE",
  "SECRET_IN_MODEL_RATIONALE_REJECTED",
);
ok(
  parseSemanticJudgeProposal(
    JSON.stringify(proposal({ requirements: [row({ rationale: "<b>html</b>" })] })),
  ).ruleId === "SEMANTIC_JUDGE_UNSAFE_RATIONALE",
  "HTML_IN_MODEL_RATIONALE_REJECTED",
);
const piiRationale = parseSemanticJudgeProposal(
  JSON.stringify(proposal({ requirements: [row({ rationale: "contact bidder@example.com" })] })),
);
ok(
  piiRationale.ok &&
    piiRationale.proposal.requirements[0]?.rationale.includes("[EMAIL]") &&
    !piiRationale.proposal.requirements[0]?.rationale.includes("bidder@example.com"),
  "PII_IN_MODEL_RATIONALE_REDACTED",
);

if (fail > 0) {
  console.error(`FAIL ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`PASS ${pass}/${pass + fail}`);
