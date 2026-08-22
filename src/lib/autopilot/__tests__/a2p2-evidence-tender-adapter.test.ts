/**
 * Autopilot A2-P2.1 Tender AnalysisResultV2 adapter — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-evidence-tender-adapter.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEvidencePacket } from "../a2p2-evidence-builder";
import {
  adaptAnalysisResultV2,
  flattenNormalizedValueV2,
} from "../a2p2-evidence-tender-adapter";
import { parseTenderEvidenceSource } from "../a2p2-evidence-sources";
import { resolveTaskContract } from "../a2p2-templates";
import {
  closingFact,
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
const adapterSrc = readFileSync(
  join(process.cwd(), "src/lib/autopilot/a2p2-evidence-tender-adapter.ts"),
  "utf8",
);

console.log("autopilot A2-P2.1 tender adapter");

ok(flattenNormalizedValueV2({ kind: "date", value: "2026-09-15" }) === "date:2026-09-15", "flatten date");
ok(
  flattenNormalizedValueV2({ kind: "datetime", date: "2026-09-15", time: "14:00", tz: "ADT" }) ===
    "datetime:2026-09-15T14:00|ADT",
  "flatten datetime",
);
ok(
  flattenNormalizedValueV2({ kind: "money", amount: 100, currency: "CAD" }) === "money:100:CAD",
  "flatten money",
);
ok(flattenNormalizedValueV2({ kind: "boolean", value: true }) === true, "flatten boolean preserves type");
ok(flattenNormalizedValueV2({ kind: "percent", value: 70 }) === "percent:70", "flatten percent");
ok(
  flattenNormalizedValueV2({ kind: "duration_days", days: 30 }) === "duration_days:30",
  "flatten duration",
);

const result = makeAnalysisResultV2();
const adapted = adaptAnalysisResultV2(result);
ok(
  adapted.facts.some((item) => item.requirementId === "submission_deadline") &&
    adapted.facts.some((item) => item.requirementId === "mandatory_requirements"),
  "TENDER_ADAPTER_CONSUMES_ANALYSIS_RESULT_V2",
);
ok(
  adapted.facts.some(
    (item) =>
      item.requirementId === "mandatory_requirements" &&
      item.factKey === "mandatory:req_bond" &&
      item.normalizedValue === "req_bond" &&
      item.locator?.recordKey === "req_bond",
  ),
  "TENDER_MANDATORY_FACT_IDENTIFIES_REQUIREMENT",
);

const adaptedJson = JSON.stringify(adapted);
ok(!adaptedJson.includes("SECRET_RAW_VALUE_MUST_NOT_LEAK"), "TENDER_ADAPTER_IGNORES_RAW_VALUE");
ok(!adaptedJson.includes("SNIPPET_TEXT_MUST_NOT_LEAK"), "TENDER_ADAPTER_IGNORES_EVIDENCE_SNIPPET");
ok(!/contentText/.test(adapterSrc), "TENDER_ADAPTER_HAS_NO_DOCUMENT_TEXT");
ok(!/\.rawValue/.test(adapterSrc), "adapter source does not read rawValue");
ok(!/\.snippet/.test(adapterSrc), "adapter source does not read snippet");

const packet = buildEvidencePacket({
  contract: resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW }),
  structuredSources: { tender: result },
  now: NOW,
});
ok(packet.status === "SUFFICIENT", "AnalysisResultV2 is the main tender success path");
ok(!JSON.stringify(packet).includes("SECRET_RAW_VALUE_MUST_NOT_LEAK"), "packet drops rawValue");
ok(!JSON.stringify(packet).includes("SNIPPET_TEXT_MUST_NOT_LEAK"), "packet drops snippet");
ok(
  packet.evidenceFacts.some(
    (item) =>
      item.requirementId === "mandatory_requirements" &&
      item.source.sourceId === "doc-1" &&
      item.factKey.includes("req_bond"),
  ),
  "MANDATORY_REQUIREMENT_REQUIRES_REAL_EVIDENCE",
);
ok(
  packet.evidenceFacts.some((item) => item.requirementId === "submission_deadline"),
  "ACTIVE_FACT_STILL_COUNTS",
);

const conflictClosing = makeAnalysisResultV2({
  facts: [closingFact({ status: "CONFLICT" })],
});
const conflictAdapted = adaptAnalysisResultV2(conflictClosing);
ok(
  !conflictAdapted.facts.some((item) => item.requirementId === "submission_deadline") &&
    conflictAdapted.rejectedFacts.some((item) => item.reasonCode === "EVIDENCE_STRUCTURAL_CONFLICT"),
  "CONFLICT_FACT_CANNOT_SATISFY_REQUIRED_EVIDENCE",
);
const conflictPacket = buildEvidencePacket({
  contract: resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW }),
  structuredSources: { tender: conflictClosing },
  now: NOW,
});
ok(
  conflictPacket.status !== "SUFFICIENT" &&
    conflictPacket.requirementAssessments.find((item) => item.requirementId === "submission_deadline")
      ?.state !== "READY",
  "CONFLICT_DEADLINE_DOES_NOT_PRODUCE_SUFFICIENT",
);

const supersededClosing = adaptAnalysisResultV2(
  makeAnalysisResultV2({ facts: [closingFact({ status: "SUPERSEDED" })] }),
);
ok(
  !supersededClosing.facts.some((item) => item.requirementId === "submission_deadline"),
  "SUPERSEDED_FACT_STILL_DOES_NOT_COUNT",
);

const noEvidenceMandatorySource = makeAnalysisResultV2({
  requirements: [mandatoryRequirement({ evidence: [] })],
  mandatoryRequirementIds: ["req_bond"],
  facts: [closingFact()],
});
ok(
  parseTenderEvidenceSource(noEvidenceMandatorySource) == null,
  "MANDATORY_WITHOUT_EVIDENCE_FAILS_CLOSED",
);
const noEvidenceMandatory = adaptAnalysisResultV2(noEvidenceMandatorySource);
ok(
  !noEvidenceMandatory.facts.some((item) => item.requirementId === "mandatory_requirements"),
  "mandatory without evidence is not fabricated",
);

const noNorm = adaptAnalysisResultV2(
  makeAnalysisResultV2({
    facts: [closingFact({ normalizedValue: null })],
  }),
);
ok(
  !noNorm.facts.some((item) => item.requirementId === "submission_deadline"),
  "no rawValue fallback when normalizedValue is null",
);

const projected = parseTenderEvidenceSource(makeAnalysisResultV2());
ok(!!projected, "parser returns a canonical projection");
ok(
  projected != null &&
    !("projectSummary" in projected) &&
    !("risks" in projected) &&
    !("nextActions" in projected) &&
    !("rawValue" in (projected.facts[0] ?? {})) &&
    !("snippet" in (projected.facts[0]?.evidence[0] ?? {})),
  "projection drops unused AnalysisResultV2 fields",
);
ok(
  projected != null &&
    !JSON.stringify(projected).includes("SECRET_RAW_VALUE_MUST_NOT_LEAK") &&
    !JSON.stringify(projected).includes("SNIPPET_TEXT_MUST_NOT_LEAK"),
  "projection does not copy rawValue or snippet",
);

function tenderProbe(tender: unknown) {
  let threw = false;
  let packet;
  try {
    packet = buildEvidencePacket({
      contract: resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW }),
      structuredSources: { tender },
      now: NOW,
    });
  } catch {
    threw = true;
  }
  return { threw, packet };
}

const objectDocuments = tenderProbe({
  ...makeAnalysisResultV2(),
  manifest: { ...makeAnalysisResultV2().manifest, documents: { find: "x" } },
});
ok(!objectDocuments.threw, "MALFORMED_MANIFEST_DOCUMENTS_DOES_NOT_THROW");
ok(
  objectDocuments.packet?.status === "NOT_EVALUABLE" &&
    objectDocuments.packet.diagnostics.some((item) => item.code === "EVIDENCE_INVALID_STRUCTURED_SOURCE"),
  "MALFORMED_MANIFEST_FAILS_CLOSED",
);

const unsafeDocId = tenderProbe(
  makeAnalysisResultV2({
    manifest: {
      ...makeAnalysisResultV2().manifest,
      documents: [
        {
          documentId: "jane@example.com",
          name: "ITT.pdf",
          type: "pdf",
          sourceRole: "BASE_TENDER",
          pageCount: 1,
          contentHash: null,
        },
      ],
    },
  }),
);
ok(
  unsafeDocId.packet?.status === "NOT_EVALUABLE" &&
    !JSON.stringify(unsafeDocId.packet).includes("jane@example.com"),
  "UNSAFE_MANIFEST_DOCUMENT_ID_REJECTED",
);

const badAnalyzer = tenderProbe({
  ...makeAnalysisResultV2(),
  metadata: { ...makeAnalysisResultV2().metadata, analyzerVersion: {} },
});
ok(
  badAnalyzer.packet?.status === "NOT_EVALUABLE" &&
    badAnalyzer.packet.diagnostics.some((item) => item.code === "EVIDENCE_INVALID_STRUCTURED_SOURCE"),
  "MALFORMED_ANALYZER_VERSION_FAILS_CLOSED",
);

const probes = [
  { ...makeAnalysisResultV2(), manifest: { ...makeAnalysisResultV2().manifest, documents: {} } },
  { ...makeAnalysisResultV2(), manifest: { ...makeAnalysisResultV2().manifest, documents: { find: "x" } } },
  { ...makeAnalysisResultV2(), metadata: "bad" },
  { ...makeAnalysisResultV2(), metadata: { ...makeAnalysisResultV2().metadata, analyzerVersion: {} } },
  { ...makeAnalysisResultV2(), facts: null },
  { ...makeAnalysisResultV2(), requirements: {} },
  { ...makeAnalysisResultV2(), mandatoryRequirementIds: 123 },
];
ok(
  probes.every((probe) => {
    const result = tenderProbe(probe);
    return !result.threw && result.packet?.status === "NOT_EVALUABLE";
  }),
  "ARBITRARY_MALFORMED_TENDER_SOURCE_NEVER_THROWS",
);

const insurance = mandatoryRequirement({
  id: "req_insurance",
  category: "INSURANCE",
  statement: "Bidder must provide proof of insurance coverage.",
  object: "insurance certificate",
});
ok(
  parseTenderEvidenceSource(
    makeAnalysisResultV2({
      requirements: [mandatoryRequirement(), insurance],
      mandatoryRequirementIds: ["req_bond", "req_bond"],
    }),
  ) == null,
  "MANDATORY_VIEW_DUPLICATE_ID_FAILS_CLOSED",
);
ok(
  parseTenderEvidenceSource(
    makeAnalysisResultV2({
      requirements: [mandatoryRequirement()],
      mandatoryRequirementIds: ["req_bond", "req_ghost"],
    }),
  ) == null &&
    tenderProbe(
      makeAnalysisResultV2({
        requirements: [mandatoryRequirement()],
        mandatoryRequirementIds: ["req_bond", "req_ghost"],
      }),
    ).packet?.status === "NOT_EVALUABLE",
  "MANDATORY_VIEW_GHOST_ID_FAILS_CLOSED",
);
ok(
  parseTenderEvidenceSource(
    makeAnalysisResultV2({
      requirements: [mandatoryRequirement(), insurance],
      mandatoryRequirementIds: ["req_bond"],
    }),
  ) == null,
  "MANDATORY_VIEW_MISSING_ID_FAILS_CLOSED",
);
const partialMandatory = makeAnalysisResultV2({
  requirements: [mandatoryRequirement(), mandatoryRequirement({ ...insurance, evidence: [] })],
  mandatoryRequirementIds: ["req_bond", "req_insurance"],
  facts: [closingFact()],
});
ok(parseTenderEvidenceSource(partialMandatory) == null, "partial mandatory parse fails closed");
ok(
  tenderProbe(partialMandatory).packet?.status !== "SUFFICIENT",
  "PARTIAL_MANDATORY_EVIDENCE_CANNOT_BE_SUFFICIENT",
);
const reversedMandatory = makeAnalysisResultV2({
  requirements: [mandatoryRequirement(), insurance],
  mandatoryRequirementIds: ["req_insurance", "req_bond"],
  facts: [closingFact()],
});
ok(parseTenderEvidenceSource(reversedMandatory) != null, "MANDATORY_VIEW_ORDER_INDEPENDENT");
const bothBacked = buildEvidencePacket({
  contract: resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW }),
  structuredSources: { tender: reversedMandatory },
  now: NOW,
});
ok(
  bothBacked.status === "SUFFICIENT" &&
    bothBacked.evidenceFacts.some((item) => item.factKey === "mandatory:req_bond") &&
    bothBacked.evidenceFacts.some((item) => item.factKey === "mandatory:req_insurance"),
  "ALL_MANDATORY_REQUIREMENTS_EVIDENCE_BACKED",
);

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
