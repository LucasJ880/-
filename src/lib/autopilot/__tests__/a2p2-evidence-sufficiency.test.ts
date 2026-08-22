/**
 * Autopilot A2-P2.1 sufficiency gate — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-evidence-sufficiency.test.ts
 *
 * SUFFICIENT means enough structurally valid evidence for the next stage.
 * It does not mean TASK_SUCCESS.
 */

import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { MAX_FACTS_PER_REQUIREMENT, MAX_PACKET_SAFE_TEXT_BYTES } from "../a2p2-evidence-types";
import { resolveTaskContract } from "../a2p2-templates";
import {
  closingFact,
  evidenceRef,
  makeAnalysisResultV2,
  mandatoryRequirement,
} from "./a2p2-evidence-fixtures";

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

const NOW = new Date("2026-01-01T00:00:00.000Z");
const tender = resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });

console.log("autopilot A2-P2.1 evidence sufficiency");

ok(MAX_FACTS_PER_REQUIREMENT === 20, "PACKET_LIMIT_IS_BOUNDED per requirement");
ok(MAX_PACKET_SAFE_TEXT_BYTES === 32 * 1024, "PACKET_LIMIT_IS_BOUNDED bytes");

const caseA = buildEvidencePacket({
  contract: tender,
  structuredSources: { tender: makeAnalysisResultV2() },
  now: NOW,
});
ok(caseA.status === "SUFFICIENT", "Tender Case A SUFFICIENT");
ok(
  caseA.requirementAssessments.find((item) => item.requirementId === "submission_deadline")?.state ===
    "READY",
  "deadline READY is structural not semantic success",
);

const caseB = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [],
      criticalFacts: makeAnalysisResultV2().criticalFacts,
    }),
  },
  now: NOW,
});
ok(caseB.status === "INSUFFICIENT", "Tender Case B deadline missing INSUFFICIENT");
ok(
  caseB.requirementAssessments.find((item) => item.requirementId === "submission_deadline")
    ?.reasonCode === "EVIDENCE_MISSING",
  "missing deadline uses EVIDENCE_MISSING",
);

const existenceBitGone = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [],
      requirements: [mandatoryRequirement({ evidence: [] })],
      mandatoryRequirementIds: ["req_bond"],
    }),
  },
  now: NOW,
});
ok(
  existenceBitGone.status === "NOT_EVALUABLE" &&
    existenceBitGone.diagnostics.some((item) => item.code === "EVIDENCE_INVALID_STRUCTURED_SOURCE"),
  "MANDATORY_EXISTENCE_BIT_REMOVED",
);
ok(
  !existenceBitGone.evidenceFacts.some((item) => item.source.sourceId === "tender-mandatory"),
  "NO_FABRICATED_TENDER_SOURCE_ID",
);

const caseC = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [
        closingFact({
          id: "fact_c1",
          normalizedValue: { kind: "date", value: "2026-09-15" },
          evidence: [evidenceRef("doc-c1", 1)],
        }),
        closingFact({
          id: "fact_c2",
          claim: "Closing date is 20 September 2026",
          normalizedValue: { kind: "date", value: "2026-09-20" },
          evidence: [evidenceRef("doc-c2", 1)],
        }),
      ],
    }),
  },
  now: NOW,
});
ok(caseC.status === "CONFLICTING", "STRUCTURAL_CONFLICT_DETECTED");
ok(
  caseC.requirementAssessments.find((item) => item.requirementId === "submission_deadline")
    ?.reasonCode === "EVIDENCE_STRUCTURAL_CONFLICT",
  "conflict is not auto-resolved",
);

const caseD = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [
        closingFact({
          claim: "api_key=sk-live-abcdefghijklmnopqrstuvwxyz",
          normalizedValue: { kind: "text", value: "sk-live-abcdefghijklmnopqrstuvwxyz" },
        }),
      ],
    }),
  },
  now: NOW,
});
ok(caseD.status === "PRIVACY_BLOCKED", "Tender Case D PRIVACY_BLOCKED");
ok(caseD.status !== "INSUFFICIENT", "required secret does not collapse to INSUFFICIENT");

const genericEmpty = buildEvidencePacket({
  contract: resolveTaskContract({ domainHint: "GENERIC", now: NOW }),
  now: NOW,
});
ok(genericEmpty.status === "NOT_EVALUABLE", "GENERIC_EMPTY_CONTRACT_NOT_SEMANTICALLY_SUFFICIENT");
ok(genericEmpty.status !== "SUFFICIENT", "empty generic cannot be SUFFICIENT");

const overflowFacts = Array.from({ length: MAX_FACTS_PER_REQUIREMENT + 1 }, (_, index) =>
  closingFact({
    id: `fact_overflow_${index}`,
    evidence: [evidenceRef(`doc-overflow-${index}`, 1)],
  }),
);
const overflow = buildEvidencePacket({
  contract: tender,
  structuredSources: { tender: makeAnalysisResultV2({ facts: overflowFacts }) },
  now: NOW,
});
ok(overflow.status === "NOT_EVALUABLE", "PACKET_OVERFLOW_DOES_NOT_FALSE_SUCCEED");
ok(overflow.status !== "SUFFICIENT", "overflow cannot become SUFFICIENT");

const notFound = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [],
    }),
  },
  now: NOW,
});
ok(notFound.status === "INSUFFICIENT", "absence of deadline is INSUFFICIENT");
ok(
  !notFound.evidenceFacts.some((item) => item.requirementId === "submission_deadline"),
  "absence is not a negative fact",
);

const conflictDeadline = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [closingFact({ status: "CONFLICT" })],
    }),
  },
  now: NOW,
});
ok(
  conflictDeadline.requirementAssessments.find((item) => item.requirementId === "submission_deadline")
    ?.state !== "READY",
  "CONFLICT fact cannot make READY",
);
ok(conflictDeadline.status !== "SUFFICIENT", "CONFLICT_DEADLINE_DOES_NOT_PRODUCE_SUFFICIENT");

const ghostMandatory = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      mandatoryRequirementIds: ["req_bond", "req_ghost"],
    }),
  },
  now: NOW,
});
ok(ghostMandatory.status !== "SUFFICIENT", "ghost mandatory IDs cannot make READY");

const missingMandatoryEvidence = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      requirements: [mandatoryRequirement({ evidence: [] })],
      mandatoryRequirementIds: ["req_bond"],
    }),
  },
  now: NOW,
});
ok(missingMandatoryEvidence.status !== "SUFFICIENT", "missing mandatory evidence cannot make READY");

const partialMandatorySet = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      requirements: [
        mandatoryRequirement(),
        mandatoryRequirement({
          id: "req_insurance",
          category: "INSURANCE",
          statement: "Bidder must provide proof of insurance coverage.",
          object: "insurance certificate",
          evidence: [],
        }),
      ],
      mandatoryRequirementIds: ["req_bond", "req_insurance"],
    }),
  },
  now: NOW,
});
ok(partialMandatorySet.status !== "SUFFICIENT", "partial mandatory set cannot make READY");

const falseSufficiency = [
  caseB.status === "SUFFICIENT",
  caseC.status === "SUFFICIENT",
  caseD.status === "SUFFICIENT",
  genericEmpty.status === "SUFFICIENT",
  overflow.status === "SUFFICIENT",
  notFound.status === "SUFFICIENT",
  existenceBitGone.status === "SUFFICIENT",
  conflictDeadline.status === "SUFFICIENT",
  ghostMandatory.status === "SUFFICIENT",
  missingMandatoryEvidence.status === "SUFFICIENT",
  partialMandatorySet.status === "SUFFICIENT",
].filter(Boolean).length;
ok(falseSufficiency === 0, "FALSE_SUFFICIENCY_PATHS = ZERO");

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
