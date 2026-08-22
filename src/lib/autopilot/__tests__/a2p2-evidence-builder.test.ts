/**
 * Autopilot A2-P2.1 Evidence Builder — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-evidence-builder.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toEvaluationEvidenceStatus } from "../a2p2-evidence-adapter";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import { selectEvidenceCollector } from "../a2p2-evidence-collectors";
import { hashEvidencePacket, judgeFacingPacketBytes, makeEvidenceRef } from "../a2p2-evidence-hash";
import { MAX_EVIDENCE_FACTS, MAX_PACKET_SAFE_TEXT_BYTES } from "../a2p2-evidence-types";
import { resolveTaskContract } from "../a2p2-templates";
import {
  closingFact,
  evidenceRef,
  makeAnalysisResultV2,
  mandatoryRequirement,
  UPSTREAM_HASH_A,
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

function tenderContract() {
  return resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
}

function genericContract(
  requirements: Array<{
    id: string;
    required: boolean;
    evidenceKinds?: string[];
    allowUnknown?: boolean;
  }>,
) {
  const base = JSON.parse(
    JSON.stringify(resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW })),
  ) as Record<string, unknown>;
  return resolveTaskContract({
    now: NOW,
    explicitContract: {
      ...base,
      taskType: "GENERIC",
      requirements: requirements.map((item) => ({
        id: item.id,
        label: item.id,
        required: item.required,
        evidenceKinds: item.evidenceKinds ?? ["SOURCE_FACT"],
        minimumEvidenceRefs: 1,
        allowUnknown: item.allowUnknown ?? !item.required,
        criticality: item.required ? "HIGH" : "LOW",
        normalizedDescription: item.id,
      })),
    },
  });
}

console.log("autopilot A2-P2.1 evidence builder");

const contract = tenderContract();
const analysis = makeAnalysisResultV2();
const packetA = buildEvidencePacket({
  contract,
  structuredSources: { tender: analysis },
  now: NOW,
});
const packetA2 = buildEvidencePacket({
  contract,
  structuredSources: { tender: analysis },
  now: NOW,
});
ok(packetA.status === "SUFFICIENT", "Tender Case A sufficient from AnalysisResultV2");
ok(packetA.packetHash === packetA2.packetHash, "PACKET_HASH_DETERMINISTIC");
ok(
  packetA.evidenceFacts[0]?.evidenceRef === packetA2.evidenceFacts[0]?.evidenceRef,
  "EVIDENCE_REF_REPLAY_STABLE",
);

const first = packetA.evidenceFacts[0];
ok(
  makeEvidenceRef({
    evidenceKind: first.evidenceKind,
    requirementId: first.requirementId,
    factKey: first.factKey,
    sourceType: first.source.sourceType,
    sourceId: first.source.sourceId,
    canonicalFactHash: first.canonicalFactHash,
  }) === first.evidenceRef,
  "EVIDENCE_REF_DETERMINISTIC",
);

const methodFact = closingFact({
  id: "fact_method",
  factType: "submission_method",
  claim: "Bids must be submitted by email",
  normalizedValue: { kind: "text", value: "email" },
  evidence: [evidenceRef("doc-2", 1)],
});
const reversed = makeAnalysisResultV2({
  facts: [methodFact, closingFact()],
});
const ordered = makeAnalysisResultV2({
  facts: [closingFact(), methodFact],
});
ok(
  buildEvidencePacket({ contract, structuredSources: { tender: reversed }, now: NOW }).packetHash ===
    buildEvidencePacket({ contract, structuredSources: { tender: ordered }, now: NOW }).packetHash,
  "SOURCE_ORDER_DOES_NOT_CHANGE_PACKET",
);

ok(selectEvidenceCollector("TENDER_ANALYSIS").name === "collectTenderEvidence", "COLLECTOR_SELECTION_AUTOMATIC");
ok(selectEvidenceCollector("RESEARCH").name === "collectResearchEvidence", "collector research");
ok(selectEvidenceCollector("EMAIL_DRAFT").name === "collectEmailDraftEvidence", "collector email");
ok(packetA.taskType === "TENDER_ANALYSIS", "collector selected from taskType");

const genericUnknown = buildEvidencePacket({
  contract: genericContract([{ id: "only_known", required: true }]),
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
  contract: genericContract([
    { id: "needed", required: true, evidenceKinds: ["SOURCE_FACT"] },
  ]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "k1",
          summary: "runtime note",
          sourceId: "src-1",
          evidenceKind: "RUNTIME_FACT",
        },
      ],
    },
  },
  now: NOW,
});
ok(
  mismatch.requirementAssessments[0]?.state === "INSUFFICIENT" && mismatch.status === "INSUFFICIENT",
  "EVIDENCE_KIND_MISMATCH_NOT_COUNTED",
);

const dup = buildEvidencePacket({
  contract,
  structuredSources: { tender: makeAnalysisResultV2({ facts: [closingFact(), closingFact()] }) },
  now: NOW,
});
ok(
  dup.evidenceFacts.filter((item) => item.requirementId === "submission_deadline").length === 1,
  "DUPLICATE_EVIDENCE_NOT_DOUBLE_COUNTED",
);

const frozen = Object.freeze({ tender: Object.freeze(makeAnalysisResultV2()) });
const before = JSON.stringify(contract);
buildEvidencePacket({ contract, structuredSources: frozen, now: NOW });
ok(JSON.stringify(contract) === before, "BUILDER_INPUT_IMMUTABLE");
ok(packetA.contract.riskClass === contract.riskClass, "EVIDENCE_BUILDER_CANNOT_DOWNGRADE_RISK");
ok(
  packetA.contract.automationLevel === contract.automationLevel,
  "EVIDENCE_BUILDER_CANNOT_EXPAND_AUTOMATION",
);

ok(toEvaluationEvidenceStatus("SUFFICIENT") === "SUFFICIENT", "adapter SUFFICIENT");
ok(toEvaluationEvidenceStatus("NOT_EVALUABLE") === "INSUFFICIENT", "adapter NOT_EVALUABLE fail-closed");
ok(toEvaluationEvidenceStatus("PRIVACY_BLOCKED") === "PRIVACY_BLOCKED", "adapter privacy");

const research = buildEvidencePacket({
  contract: resolveTaskContract({ domainHint: "RESEARCH", now: NOW }),
  structuredSources: {
    research: {
      claims: [
        {
          requirementId: "question_answered",
          claimKey: "q1",
          summary: "answered in notes",
          sourceId: "r1",
          evidenceKind: "ARTIFACT_FACT",
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
ok(research.status === "INSUFFICIENT", "RESEARCH_SAFE_INTERFACE_CANNOT_BECOME_SUFFICIENT");
ok(
  research.diagnostics.some((item) => item.code === "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE"),
  "ARBITRARY_RESEARCH_CLAIMS_NOT_AUTHORITY",
);

const emailContract = resolveTaskContract({ domainHint: "EMAIL_DRAFT", now: NOW });
const emailSynth = buildEvidencePacket({
  contract: emailContract,
  structuredSources: {
    emailDraft: {
      purposeAddressed: true,
      requiredQuestionIds: ["q-delivery"],
      unsupportedCommitmentAbsent: true,
      sourceId: "pending-action-meta-1",
    },
  },
  now: NOW,
});
ok(emailSynth.status === "INSUFFICIENT", "EMAIL_SAFE_INTERFACE_CANNOT_BECOME_SUFFICIENT");
ok(
  emailSynth.diagnostics.some((item) => item.code === "EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE"),
  "ARBITRARY_EMAIL_BOOLEAN_CHECKLIST_NOT_AUTHORITY",
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

const sameHashDifferentValue = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "deadline",
          summary: "first date",
          sourceId: "doc-a",
          normalizedValue: "2026-09-15",
          contentHash: UPSTREAM_HASH_A,
        },
        {
          requirementId: "needed",
          factKey: "deadline",
          summary: "second date",
          sourceId: "doc-b",
          normalizedValue: "2026-09-20",
          contentHash: UPSTREAM_HASH_A,
        },
      ],
    },
  },
  now: NOW,
});
const refs = new Set(sameHashDifferentValue.evidenceFacts.map((item) => item.evidenceRef));
ok(refs.size === 2, "SAME_UPSTREAM_HASH_DIFFERENT_NORMALIZED_VALUE DISTINCT_EVIDENCE_REFS");
ok(
  sameHashDifferentValue.status === "CONFLICTING",
  "SAME_UPSTREAM_HASH_DIFFERENT_NORMALIZED_VALUE_CONFLICT",
);
ok(
  sameHashDifferentValue.evidenceFacts.every(
    (fact) => fact.canonicalFactHash !== UPSTREAM_HASH_A && fact.provenance.sourceContentHash === UPSTREAM_HASH_A,
  ),
  "UPSTREAM_HASH_CANNOT_OVERRIDE_CANONICAL_FACT_HASH",
);

const extractorA = makeAnalysisResultV2({
  metadata: {
    ...makeAnalysisResultV2().metadata,
    analyzerVersion: "tender-understanding/v2",
  },
});
const extractorB = makeAnalysisResultV2({
  metadata: {
    ...makeAnalysisResultV2().metadata,
    analyzerVersion: "tender-understanding/v2-test",
  },
});
ok(
  buildEvidencePacket({ contract, structuredSources: { tender: extractorA }, now: NOW }).packetHash !==
    buildEvidencePacket({ contract, structuredSources: { tender: extractorB }, now: NOW }).packetHash,
  "PACKET_HASH_CHANGES_ON_EXTRACTOR_VERSION_CHANGE",
);
ok(
  buildEvidencePacket({ contract, structuredSources: { tender: analysis }, now: new Date("2026-02-01") })
    .packetHash === packetA.packetHash,
  "PACKET_HASH_CREATED_AT_ONLY_CHANGE_IS_STABLE",
);

const rejectedOrderA = buildEvidencePacket({
  contract: genericContract([{ id: "only_known", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        { requirementId: "ghost_b", factKey: "b", summary: "b", sourceId: "g2" },
        { requirementId: "ghost_a", factKey: "a", summary: "a", sourceId: "g1" },
      ],
    },
  },
  now: NOW,
});
const rejectedOrderB = buildEvidencePacket({
  contract: genericContract([{ id: "only_known", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        { requirementId: "ghost_a", factKey: "a", summary: "a", sourceId: "g1" },
        { requirementId: "ghost_b", factKey: "b", summary: "b", sourceId: "g2" },
      ],
    },
  },
  now: NOW,
});
ok(
  rejectedOrderA.packetHash === rejectedOrderB.packetHash,
  "REJECTED_FACT_ORDER_DOES_NOT_CHANGE_PACKET_HASH",
);
ok(
  hashEvidencePacket({
    ...packetA,
    diagnostics: [
      { code: "EVIDENCE_READY", detail: "b" },
      { code: "EVIDENCE_MISSING", detail: "a" },
    ],
  }) ===
    hashEvidencePacket({
      ...packetA,
      diagnostics: [
        { code: "EVIDENCE_MISSING", detail: "a" },
        { code: "EVIDENCE_READY", detail: "b" },
      ],
    }),
  "DIAGNOSTIC_ORDER_DOES_NOT_CHANGE_PACKET_HASH",
);

const malformed = buildEvidencePacket({
  contract,
  structuredSources: { tender: { facts: [] }, unexpected: true },
});
ok(malformed.status === "NOT_EVALUABLE", "MALFORMED_SOURCE_SNAPSHOT_FAILS_CLOSED");
ok(
  malformed.diagnostics.some((item) => item.code === "EVIDENCE_INVALID_STRUCTURED_SOURCE"),
  "UNKNOWN_SOURCE_FIELD_REJECTED",
);

let threw = false;
try {
  buildEvidencePacket({
    contract,
    structuredSources: { generic: { facts: { requirementId: 1 } } },
  });
} catch {
  threw = true;
}
ok(!threw && buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: { generic: { facts: { requirementId: 1 } } },
}).status === "NOT_EVALUABLE", "MALFORMED_SOURCE_ID_DOES_NOT_THROW");
ok(
  buildEvidencePacket({
    contract: genericContract([{ id: "needed", required: true }]),
    structuredSources: { generic: { facts: "nope" } },
  }).status === "NOT_EVALUABLE",
  "INVALID_SOURCE_ARRAY_REJECTED",
);
ok(
  buildEvidencePacket({
    contract: genericContract([{ id: "needed", required: true }]),
    structuredSources: {
      generic: {
        facts: [
          {
            requirementId: "needed",
            factKey: "k1",
            summary: "nested",
            sourceId: "src-1",
            normalizedValue: { nested: true },
          },
        ],
      },
    },
  }).status === "NOT_EVALUABLE",
  "INVALID_NORMALIZED_VALUE_REJECTED",
);

ok(MAX_EVIDENCE_FACTS === 100, "PACKET_LIMIT_IS_BOUNDED");

const large = "x".repeat(400);
const bulky = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: Array.from({ length: 90 }, (_, index) => ({
        requirementId: "needed",
        factKey: `k${index}`,
        summary: large,
        sourceId: `id${String(index).padStart(2, "0")}${"y".repeat(110)}`,
        normalizedValue: large,
        locator: { section: large.slice(0, 80), field: large.slice(0, 80) },
      })),
    },
  },
  now: NOW,
});
ok(bulky.status === "NOT_EVALUABLE", "FULL_PACKET_BYTE_LIMIT_ENFORCED");
ok(bulky.status !== "SUFFICIENT", "OVERFLOW_PACKET_NEVER_SUFFICIENT");
ok(bulky.status === "NOT_EVALUABLE", "LARGE_NORMALIZED_VALUE_CANNOT_BYPASS_LIMIT");
ok(bulky.status === "NOT_EVALUABLE", "LARGE_SOURCE_IDS_CANNOT_BYPASS_LIMIT");
ok(bulky.status === "NOT_EVALUABLE", "LARGE_LOCATORS_CANNOT_BYPASS_LIMIT");
ok(
  Buffer.byteLength(JSON.stringify(bulky), "utf8") <= MAX_PACKET_SAFE_TEXT_BYTES + 2048 &&
    bulky.evidenceFacts.length === 0,
  "OVERFLOW_PACKET_OUTPUT_IS_BOUNDED",
);
ok(
  judgeFacingPacketBytes(bulky) <= MAX_PACKET_SAFE_TEXT_BYTES,
  "FINAL_JUDGE_PAYLOAD_ALWAYS_WITHIN_LIMIT",
);
ok(bulky.rejectedFacts.length === 0, "REJECTED_FACT_OVERFLOW_OUTPUT_IS_BOUNDED");
ok(
  bulky.diagnostics.length <= 8 &&
    bulky.diagnostics.every((item) => !item.detail || item.detail.length <= 80),
  "DIAGNOSTIC_OVERFLOW_OUTPUT_IS_BOUNDED",
);

const maxId = `u000${"x".repeat(76)}`;
const maxKey = `k000${"x".repeat(76)}`;
const maxSource = `s${"y".repeat(127)}`;
const rejectedFlood = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: Array.from({ length: 200 }, (_, index) => ({
        requirementId: `u${String(index).padStart(3, "0")}${"x".repeat(76)}`,
        factKey: `k${String(index).padStart(3, "0")}${"z".repeat(76)}`,
        summary: "unknown requirement",
        sourceId: `s${String(index).padStart(3, "0")}${"y".repeat(124)}`,
      })),
    },
  },
  now: NOW,
});
ok(maxId.length === 80 && maxKey.length === 80 && maxSource.length === 128, "max-length opaque ids");
ok(rejectedFlood.status !== "SUFFICIENT", "rejected flood cannot become SUFFICIENT");
ok(
  judgeFacingPacketBytes(rejectedFlood) <= MAX_PACKET_SAFE_TEXT_BYTES &&
    rejectedFlood.rejectedFacts.length < 200 &&
    rejectedFlood.rejectedFacts.length <= 32,
  "REJECTED_FACTS_CANNOT_BYPASS_PACKET_LIMIT",
);

const privacyOverflow = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "secret_key",
          summary: "Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz",
          sourceId: "src-secret",
        },
        ...Array.from({ length: 199 }, (_, index) => ({
          requirementId: `u${String(index).padStart(3, "0")}${"x".repeat(76)}`,
          factKey: `k${String(index).padStart(3, "0")}${"z".repeat(76)}`,
          summary: "unknown requirement",
          sourceId: `s${String(index).padStart(3, "0")}${"y".repeat(124)}`,
        })),
      ],
    },
  },
  now: NOW,
});
ok(
  privacyOverflow.status === "PRIVACY_BLOCKED" &&
    privacyOverflow.evidenceFacts.length === 0 &&
    !JSON.stringify(privacyOverflow).includes("sk-live-abcdefghijklmnopqrstuvwxyz") &&
    judgeFacingPacketBytes(privacyOverflow) <= MAX_PACKET_SAFE_TEXT_BYTES,
  "OVERFLOW_PRIVACY_BLOCK_PRECEDENCE_PRESERVED",
);

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
