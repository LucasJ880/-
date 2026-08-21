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
  structuredSources: {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "closing 2026-09-15",
          normalizedValue: "2026-09-15",
          sourceId: "doc-a",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-a",
    },
  },
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
    tender: {
      facts: [],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-b",
    },
  },
  now: NOW,
});
ok(caseB.status === "INSUFFICIENT", "Tender Case B deadline missing INSUFFICIENT");
ok(
  caseB.requirementAssessments.find((item) => item.requirementId === "submission_deadline")
    ?.reasonCode === "EVIDENCE_MISSING",
  "missing deadline uses EVIDENCE_MISSING",
);

const caseC = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "closing 2026-09-15",
          normalizedValue: "2026-09-15",
          sourceId: "doc-c1",
        },
        {
          factType: "closing_datetime",
          claim: "closing 2026-09-20",
          normalizedValue: "2026-09-20",
          sourceId: "doc-c2",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-c",
    },
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
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "api_key=sk-live-abcdefghijklmnopqrstuvwxyz",
          normalizedValue: "sk-live-abcdefghijklmnopqrstuvwxyz",
          sourceId: "doc-d",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-d",
    },
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

const overflowFacts = Array.from({ length: MAX_FACTS_PER_REQUIREMENT + 1 }, (_, index) => ({
  factType: "closing_datetime",
  claim: "closing 2026-09-15",
  normalizedValue: "2026-09-15",
  sourceId: `doc-overflow-${index}`,
}));
const overflow = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: {
      facts: overflowFacts,
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-overflow",
    },
  },
  now: NOW,
});
ok(overflow.status === "NOT_EVALUABLE", "PACKET_OVERFLOW_DOES_NOT_FALSE_SUCCEED");
ok(overflow.status !== "SUFFICIENT", "overflow cannot become SUFFICIENT");

const notFound = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "budget",
          normalizedValue: 0,
          sourceState: "NOT_FOUND",
          sourceId: "doc-absent",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-absent",
    },
  },
  now: NOW,
});
ok(notFound.status === "INSUFFICIENT", "NOT_FOUND does not become a fake value");
ok(
  !notFound.evidenceFacts.some((item) => item.requirementId === "submission_deadline"),
  "absence is not a negative fact",
);

const falseSufficiency = [
  caseB.status === "SUFFICIENT",
  caseC.status === "SUFFICIENT",
  caseD.status === "SUFFICIENT",
  genericEmpty.status === "SUFFICIENT",
  overflow.status === "SUFFICIENT",
  notFound.status === "SUFFICIENT",
].filter(Boolean).length;
ok(falseSufficiency === 0, "FALSE_SUFFICIENCY_PATHS = ZERO");

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
