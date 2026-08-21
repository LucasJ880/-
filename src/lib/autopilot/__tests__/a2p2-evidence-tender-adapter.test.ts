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

const noEvidenceMandatory = adaptAnalysisResultV2(
  makeAnalysisResultV2({
    requirements: [mandatoryRequirement({ evidence: [] })],
    mandatoryRequirementIds: ["req_bond"],
    facts: [closingFact()],
  }),
);
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

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
