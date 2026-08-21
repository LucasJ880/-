/**
 * Autopilot A2-P2.1 privacy gate — unit locks.
 * 运行：npx tsx src/lib/autopilot/__tests__/a2p2-evidence-privacy.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORBIDDEN_EVIDENCE_FIELD_NAMES,
  containsSecretMaterial,
  redactPiiText,
  scanForbiddenEvidenceFields,
} from "../a2p2-evidence-privacy";
import { A2P2_EVIDENCE_PACKET_VERSION } from "../a2p2-evidence-types";
import {
  buildEvidencePacket,
  evidencePacketHasSemanticVerdict,
} from "../a2p2-evidence-builder";
import { resolveTaskContract } from "../a2p2-templates";
import { closingFact, makeAnalysisResultV2, mandatoryRequirement } from "./a2p2-evidence-fixtures";

const ROOT = process.cwd();
const NOW = new Date("2026-01-01T00:00:00.000Z");

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

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      collectKeys(child, out);
    }
  }
  return out;
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

console.log("autopilot A2-P2.1 evidence privacy");

ok(A2P2_EVIDENCE_PACKET_VERSION === "a2p2-evidence-packet-v1", "packet version");
ok(
  FORBIDDEN_EVIDENCE_FIELD_NAMES.includes("rawContent") &&
    FORBIDDEN_EVIDENCE_FIELD_NAMES.includes("emailBody") &&
    FORBIDDEN_EVIDENCE_FIELD_NAMES.includes("rawPrompt"),
  "forbidden raw fields inherited and extended",
);
ok(
  scanForbiddenEvidenceFields({ nested: { rawEmail: "hi" } })?.endsWith(".rawEmail") === true,
  "recursive rawEmail rejected",
);
ok(
  scanForbiddenEvidenceFields({ a: [{ documentText: "page" }] }) != null,
  "recursive documentText rejected",
);
ok(containsSecretMaterial("Authorization: Bearer abcdefghijklmnop"), "Bearer secret detected");
ok(containsSecretMaterial("postgres://user:secret@localhost/db"), "credential URL detected");
ok(containsSecretMaterial("-----BEGIN RSA PRIVATE KEY-----"), "private key detected");
ok(!containsSecretMaterial("deadline 2026-09-15 via portal"), "ordinary date is not a secret");

const pii = redactPiiText("contact jane@example.com or +1 555-123-4567");
ok(pii.text.includes("[EMAIL]") && pii.text.includes("[PHONE]"), "PII_REDACTION_DETERMINISTIC");
ok(!pii.text.includes("jane@example.com"), "email not left raw");
ok(!redactPiiText("deadline 2026-09-15").redacted, "ISO date is not a phone");

const tender = resolveTaskContract({ domainHint: "TENDER_ANALYSIS", now: NOW });
const secretPacket = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [
        closingFact({
          claim: "Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz",
          normalizedValue: { kind: "text", value: "Bearer sk-live-abcdefghijklmnopqrstuvwxyz" },
        }),
      ],
    }),
  },
});
ok(secretPacket.status === "PRIVACY_BLOCKED", "SECRET_EVIDENCE_FAILS_CLOSED");
ok(
  secretPacket.rejectedFacts.some((item) => item.reasonCode === "EVIDENCE_SECRET_BLOCKED"),
  "secret reason code recorded",
);
ok(
  !JSON.stringify(secretPacket).includes("sk-live-abcdefghijklmnopqrstuvwxyz"),
  "secret token never enters packet",
);

const prohibited = buildEvidencePacket({
  contract: genericContract([
    { id: "only_known", required: true },
  ]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "only_known",
          factKey: "k1",
          summary: "ordinary fact",
          sourceId: "src-1",
          privacyClass: "PROHIBITED",
        },
      ],
    },
  },
  now: NOW,
});
ok(prohibited.status === "PRIVACY_BLOCKED", "required prohibited class blocks packet");
ok(
  prohibited.evidenceFacts.length === 0,
  "PROHIBITED_CANDIDATE_NEVER_ENTERS_PACKET",
);

const optionalProhibited = buildEvidencePacket({
  contract: genericContract([
    { id: "needed", required: true },
    { id: "extra", required: false, allowUnknown: true },
  ]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "ok",
          summary: "safe required fact",
          sourceId: "src-ok",
        },
        {
          requirementId: "extra",
          factKey: "bad",
          summary: "should not ride",
          sourceId: "src-bad",
          privacyClass: "PROHIBITED",
        },
      ],
    },
  },
  now: NOW,
});
ok(optionalProhibited.status === "SUFFICIENT", "optional prohibited does not block required sufficiency");
ok(
  optionalProhibited.evidenceFacts.every((fact) => fact.requirementId !== "extra") &&
    optionalProhibited.rejectedFacts.some(
      (item) => item.reasonCode === "EVIDENCE_PROHIBITED_CLASS_BLOCKED",
    ),
  "OPTIONAL_PROHIBITED_FACT_CANNOT_RIDE_IN_SUFFICIENT_PACKET",
);

const piiSource = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "k1",
          summary: "contact later",
          sourceId: "jane@example.com",
        },
      ],
    },
  },
  now: NOW,
});
ok(
  piiSource.rejectedFacts.some((item) => item.reasonCode === "EVIDENCE_UNSAFE_IDENTIFIER") &&
    !JSON.stringify(piiSource).includes("jane@example.com") &&
    !JSON.stringify(piiSource.evidenceFacts).includes("[EMAIL]"),
  "PII_IN_SOURCE_ID_REJECTED",
);

const locatorPii = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "k1",
          summary: "closing note",
          sourceId: "src-loc",
          locator: { section: "contact jane@example.com", page: 2 },
        },
      ],
    },
  },
  now: NOW,
});
const locFact = locatorPii.evidenceFacts[0];
ok(
  locFact?.source.locator?.section?.includes("[EMAIL]") === true &&
    locFact.acceptance === "REDACTED" &&
    locFact.privacyClass === "SENSITIVE",
  "PII_IN_LOCATOR_REDACTED",
);

const nvPii = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "k1",
          summary: "normalized contact",
          sourceId: "src-nv",
          normalizedValue: "write to bids@example.com",
        },
      ],
    },
  },
  now: NOW,
});
ok(
  nvPii.evidenceFacts[0]?.acceptance === "REDACTED" &&
    String(nvPii.evidenceFacts[0]?.normalizedValue).includes("[EMAIL]") &&
    nvPii.evidenceFacts[0]?.privacyClass === "SENSITIVE",
  "NORMALIZED_VALUE_PII_MARKS_FACT_REDACTED",
);
ok(nvPii.privacySummary.redactedCount >= 1, "privacySummary counts redacted facts");
ok(secretPacket.privacySummary.prohibitedCount >= 1, "PRIVACY_SUMMARY_COUNTS_BLOCKED_FACTS");

const htmlFact = buildEvidencePacket({
  contract: genericContract([{ id: "needed", required: true }]),
  structuredSources: {
    generic: {
      facts: [
        {
          requirementId: "needed",
          factKey: "k1",
          summary: "<div>full markup payload</div>",
          sourceId: "src-html",
        },
      ],
    },
  },
  now: NOW,
});
ok(
  htmlFact.rejectedFacts.some((item) => item.reasonCode === "EVIDENCE_HTML_REJECTED") &&
    htmlFact.evidenceFacts.length === 0,
  "HTML_FACT_REJECTED",
);

const piiPacket = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: makeAnalysisResultV2({
      facts: [
        closingFact({
          claim: "submit questions to bids@example.com before 2026-09-15",
        }),
      ],
      requirements: [mandatoryRequirement()],
    }),
  },
  now: NOW,
});
const deadline = piiPacket.evidenceFacts.find((item) => item.factKey === "closing_datetime");
ok(deadline?.factSummary.includes("[EMAIL]") === true, "email redacted in factSummary");
ok(deadline?.acceptance === "REDACTED", "acceptance REDACTED after PII");
ok(piiPacket.status === "SUFFICIENT", "redacted PII can still be structurally sufficient");

const keys = collectKeys(piiPacket);
const rawKeys = keys.filter((key) =>
  (FORBIDDEN_EVIDENCE_FIELD_NAMES as readonly string[]).includes(key),
);
ok(rawKeys.length === 0, "RAW_SOURCE_FIELD_COUNT = 0");

const src = [
  "a2p2-evidence-types.ts",
  "a2p2-evidence-privacy.ts",
  "a2p2-evidence-hash.ts",
  "a2p2-evidence-collectors.ts",
  "a2p2-evidence-sufficiency.ts",
  "a2p2-evidence-builder.ts",
  "a2p2-evidence-adapter.ts",
  "a2p2-evidence-tender-adapter.ts",
  "a2p2-evidence-sources.ts",
]
  .map((file) => readFileSync(join(ROOT, "src/lib/autopilot", file), "utf8"))
  .join("\n");
ok(
  !/status:\s*"TASK_SUCCESS"|status:\s*"PARTIAL_SUCCESS"|outcome:\s*"TASK_SUCCESS"/.test(src),
  "P2_1_SEMANTIC_VERDICT_COUNT = 0",
);
ok(
  !evidencePacketHasSemanticVerdict(secretPacket) &&
    !evidencePacketHasSemanticVerdict(piiPacket),
  "packets do not carry semantic task outcomes",
);
ok(!/persistLlmJudgeEvaluation|openai|anthropic|googleapis/.test(src), "LLM_CALL_ADDED = NO");

if (fail > 0) {
  console.error(`FAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass}/${pass + fail}`);
