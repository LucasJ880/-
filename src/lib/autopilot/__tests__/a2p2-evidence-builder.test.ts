/**
 * Autopilot A2-P2.1 Evidence Builder — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-evidence-builder.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toEvaluationEvidenceStatus } from "../a2p2-evidence-adapter";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { collectEvidenceForContract, selectEvidenceCollector } from "../a2p2-evidence-collectors";
import { makeEvidenceRef } from "../a2p2-evidence-hash";
import { MAX_EVIDENCE_FACTS } from "../a2p2-evidence-types";
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

function tenderContract() {
  return resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
}

function sufficientTenderSources() {
  return {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "closing 2026-09-15 14:00",
          normalizedValue: "2026-09-15T14:00:00",
          sourceId: "doc-1",
          page: 3,
          field: "closing_datetime",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-set-1",
    },
  };
}

console.log("autopilot A2-P2.1 evidence builder");

const contract = tenderContract();
const packetA = buildEvidencePacket({
  contract,
  structuredSources: sufficientTenderSources(),
  now: NOW,
});
const packetA2 = buildEvidencePacket({
  contract,
  structuredSources: sufficientTenderSources(),
  now: NOW,
});
ok(packetA.status === "SUFFICIENT", "Tender Case A sufficient");
ok(packetA.packetHash === packetA2.packetHash, "PACKET_HASH_DETERMINISTIC");
ok(packetA.evidenceFacts[0]?.evidenceRef === packetA2.evidenceFacts[0]?.evidenceRef, "EVIDENCE_REF_REPLAY_STABLE");

const ref = makeEvidenceRef({
  evidenceKind: packetA.evidenceFacts[0].evidenceKind,
  requirementId: packetA.evidenceFacts[0].requirementId,
  factKey: packetA.evidenceFacts[0].factKey,
  sourceType: packetA.evidenceFacts[0].source.sourceType,
  sourceId: packetA.evidenceFacts[0].source.sourceId,
  contentHash: packetA.evidenceFacts[0].contentHash,
});
ok(ref === packetA.evidenceFacts[0].evidenceRef, "EVIDENCE_REF_DETERMINISTIC");

const reversed = {
  tender: {
    facts: [
      {
        factType: "submission_method",
        claim: "email submission",
        normalizedValue: "email",
        sourceId: "doc-2",
      },
      ...sufficientTenderSources().tender.facts,
    ],
    mandatoryRequirementPresent: true,
    mandatorySourceId: "req-set-1",
  },
};
const ordered = {
  tender: {
    facts: [
      ...sufficientTenderSources().tender.facts,
      {
        factType: "submission_method",
        claim: "email submission",
        normalizedValue: "email",
        sourceId: "doc-2",
      },
    ],
    mandatoryRequirementPresent: true,
    mandatorySourceId: "req-set-1",
  },
};
const packetOrderA = buildEvidencePacket({ contract, structuredSources: reversed, now: NOW });
const packetOrderB = buildEvidencePacket({ contract, structuredSources: ordered, now: NOW });
ok(
  packetOrderA.packetHash === packetOrderB.packetHash,
  "SOURCE_ORDER_DOES_NOT_CHANGE_PACKET",
);

ok(
  selectEvidenceCollector("TENDER_ANALYSIS").name === "collectTenderEvidence",
  "COLLECTOR_SELECTION_AUTOMATIC tender",
);
ok(selectEvidenceCollector("RESEARCH").name === "collectResearchEvidence", "collector research");
ok(selectEvidenceCollector("EMAIL_DRAFT").name === "collectEmailDraftEvidence", "collector email");
ok(selectEvidenceCollector("GENERIC").name === "collectGenericEvidence", "collector generic");
ok(packetA.taskType === "TENDER_ANALYSIS", "collector selected from taskType");

const unknown = buildEvidencePacket({
  contract,
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "not_a_requirement",
          factKey: "x",
          summary: "nope",
          sourceId: "g1",
        },
      ],
    },
    ...sufficientTenderSources(),
  },
  now: NOW,
});
ok(
  !unknown.rejectedFacts.some((item) => item.requirementId === "not_a_requirement") ||
    collectEvidenceForContract(contract, {
      generic: {
        facts: [{ requirementId: "not_a_requirement", factKey: "x", summary: "nope", sourceId: "g1" }],
      },
    }).rejectedFacts.length === 0,
  "tender collector ignores unrelated generic snapshot",
);

const genericUnknown = buildEvidencePacket({
  contract: resolveTaskContract({
    domainHint: "GENERIC",
    now: NOW,
    explicitContract: {
      ...JSON.parse(JSON.stringify(resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW }))),
      taskType: "GENERIC",
      requirements: [
        {
          id: "only_known",
          label: "only known",
          required: true,
          evidenceKinds: ["SOURCE_FACT"],
          minimumEvidenceRefs: 1,
          allowUnknown: false,
          criticality: "HIGH",
          normalizedDescription: "only known",
        },
      ],
    },
  }),
  structuredSources: {
    generic: {
      facts: [{ requirementId: "ghost_req", factKey: "x", summary: "nope", sourceId: "g1" }],
    },
  },
  now: NOW,
});
ok(
  genericUnknown.rejectedFacts.some((item) => item.reasonCode === "EVIDENCE_UNKNOWN_REQUIREMENT"),
  "UNKNOWN_REQUIREMENT_REF_REJECTED",
);
ok(genericUnknown.status !== "SUFFICIENT", "unknown requirement cannot create sufficiency");

const mismatch = buildEvidencePacket({
  contract: resolveTaskContract({ domainHint: "RESEARCH", now: NOW }),
  structuredSources: {
    research: {
      claims: [
        {
          requirementId: "question_answered",
          claimKey: "q1",
          summary: "answered in notes",
          sourceId: "r1",
          evidenceKind: "SOURCE_FACT",
        },
        {
          requirementId: "source_evidence_present",
          claimKey: "src",
          summary: "source listed",
          sourceId: "r1",
          evidenceKind: "SOURCE_FACT",
        },
      ],
    },
  },
  now: NOW,
});
const qa = mismatch.requirementAssessments.find((item) => item.requirementId === "question_answered");
ok(qa?.state === "INSUFFICIENT", "EVIDENCE_KIND_MISMATCH_NOT_COUNTED");
ok(mismatch.status === "INSUFFICIENT", "kind mismatch does not satisfy required ARTIFACT_FACT");

const dup = buildEvidencePacket({
  contract,
  structuredSources: {
    tender: {
      facts: [
        sufficientTenderSources().tender.facts[0],
        sufficientTenderSources().tender.facts[0],
        sufficientTenderSources().tender.facts[0],
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-set-1",
    },
  },
  now: NOW,
});
const deadlineRefs = dup.evidenceFacts.filter((item) => item.requirementId === "submission_deadline");
ok(deadlineRefs.length === 1, "DUPLICATE_EVIDENCE_NOT_DOUBLE_COUNTED");
ok(
  dup.requirementAssessments.find((item) => item.requirementId === "submission_deadline")
    ?.validEvidenceRefs.length === 1,
  "unique refs counted once",
);

const frozenSources = Object.freeze({
  tender: Object.freeze({
    facts: Object.freeze([...sufficientTenderSources().tender.facts]),
    mandatoryRequirementPresent: true,
    mandatorySourceId: "req-set-1",
  }),
});
const before = JSON.stringify(contract);
buildEvidencePacket({ contract, structuredSources: frozenSources, now: NOW });
ok(JSON.stringify(contract) === before, "BUILDER_INPUT_IMMUTABLE");

ok(packetA.contract.riskClass === contract.riskClass, "EVIDENCE_BUILDER_CANNOT_DOWNGRADE_RISK");
ok(
  packetA.contract.automationLevel === contract.automationLevel,
  "EVIDENCE_BUILDER_CANNOT_EXPAND_AUTOMATION",
);

ok(toEvaluationEvidenceStatus("SUFFICIENT") === "SUFFICIENT", "adapter SUFFICIENT");
ok(toEvaluationEvidenceStatus("NOT_EVALUABLE") === "INSUFFICIENT", "adapter NOT_EVALUABLE fail-closed");
ok(toEvaluationEvidenceStatus("PRIVACY_BLOCKED") === "PRIVACY_BLOCKED", "adapter privacy");

const emailContract = resolveTaskContract({ domainHint: "EMAIL_DRAFT", now: NOW });
const emailMissing = buildEvidencePacket({ contract: emailContract, now: NOW });
ok(emailMissing.status === "INSUFFICIENT", "email without structured metadata is insufficient");
ok(
  emailMissing.diagnostics.some((item) => item.code === "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE"),
  "EMAIL_DRAFT SAFE_INTERFACE_ONLY",
);

const emailOk = buildEvidencePacket({
  contract: emailContract,
  structuredSources: {
    emailDraft: {
      purposeAddressed: true,
      requiredQuestionIds: ["q-delivery", "q-color"],
      unsupportedCommitmentAbsent: true,
      sourceId: "pending-action-meta-1",
    },
  },
  now: NOW,
});
ok(emailOk.status === "SUFFICIENT", "email structured checklist can be sufficient");
ok(
  !JSON.stringify(emailOk).includes("Dear") && !("body" in (emailOk.evidenceFacts[0] ?? {})),
  "email packet has no body",
);

const collectorSrc = readFileSync(
  join(process.cwd(), "src/lib/autopilot/a2p2-evidence-collectors.ts"),
  "utf8",
);
const builderSrc = readFileSync(
  join(process.cwd(), "src/lib/autopilot/a2p2-evidence-builder.ts"),
  "utf8",
);
ok(
  !/sendMail|sendEmail|gmail\.users|messages\.send|authorize send/i.test(collectorSrc + builderSrc),
  "EMAIL_EVIDENCE_BUILDER_CANNOT_SEND",
);

ok(MAX_EVIDENCE_FACTS === 100, "PACKET_LIMIT_IS_BOUNDED");

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
