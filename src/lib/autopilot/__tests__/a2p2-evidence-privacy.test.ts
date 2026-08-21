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

const ROOT = process.cwd();

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

const tender = resolveTaskContract({
  domainHint: "TENDER_ANALYSIS",
  now: new Date("2026-01-01T00:00:00.000Z"),
});
const secretPacket = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz",
          normalizedValue: "Bearer sk-live-abcdefghijklmnopqrstuvwxyz",
          sourceId: "doc-secret",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-1",
    },
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

const piiPacket = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "submit questions to bids@example.com before 2026-09-15",
          normalizedValue: "2026-09-15",
          sourceId: "doc-pii",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-1",
    },
  },
});
const deadline = piiPacket.evidenceFacts.find((item) => item.factKey === "closing_datetime");
ok(deadline?.factSummary.includes("[EMAIL]") === true, "email redacted in factSummary");
ok(deadline?.acceptance === "REDACTED", "acceptance REDACTED after PII");
ok(piiPacket.status === "SUFFICIENT", "redacted PII can still be structurally sufficient");

const rawPacket = buildEvidencePacket({
  contract: tender,
  structuredSources: {
    tender: {
      facts: [
        {
          factType: "closing_datetime",
          claim: "deadline 2026-09-15",
          normalizedValue: "2026-09-15",
          sourceId: "doc-1",
          // @ts-expect-error fixture injects forbidden key
          emailBody: "Dear all, full letter",
        },
      ],
      mandatoryRequirementPresent: true,
      mandatorySourceId: "req-1",
    },
  },
});
ok(
  rawPacket.rejectedFacts.some((item) => item.reasonCode === "EVIDENCE_RAW_CONTENT_REJECTED") ||
    rawPacket.status === "PRIVACY_BLOCKED",
  "raw field fails closed",
);

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
