/**
 * V2 证据纪律测试（V2-E1 … V2-E6）
 *
 * Evidence 是硬规则：错页 = fail；错引文 = fail；值对证据错 = fail；
 * whitespace 归一化后的逐字引文允许；跨文档错配拒收；不存在的页不可能被"验证"。
 */

import assert from "node:assert";

import type { FactCandidateV2 } from "../contract";
import { verifyCandidates } from "../verify";
import { doc, input, makeOk } from "./helpers";

const { ok, count } = makeOk();

const PAGE_TEXT =
  "Section 4 — Delivery\nDelivery must be completed within 30 days of purchase order issuance.\nThe warranty period is two (2) years from acceptance.";

function fact(overrides: Partial<FactCandidateV2>): FactCandidateV2 {
  return {
    factType: "delivery",
    claim: "Delivery within 30 days of purchase order",
    rawValue: "30 days",
    sourceDocumentId: "d1",
    pageNumber: 4,
    sourceSnippet:
      "Delivery must be completed within 30 days of purchase order issuance.",
    confidence: "HIGH",
    ...overrides,
  };
}

async function run(): Promise<void> {
  const testInput = input(
    doc("d1", "BASE_TENDER", { 4: PAGE_TEXT, 5: "Annex B pricing tables." }),
    doc("d2", "SPECIFICATION", { 1: "Specification for stainless steel benches." }),
  );

  await ok("V2-E0（基线）：正确 doc+page+逐字引文 → 通过", () => {
    const r = verifyCandidates(testInput, {
      facts: [fact({})],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 1);
    assert.equal(r.rejected.facts.length, 0);
  });

  await ok("V2-E1: 错页（引文实际在 p4，声称 p5）→ FAIL", () => {
    const r = verifyCandidates(testInput, {
      facts: [fact({ pageNumber: 5 })],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 0);
    assert.equal(r.rejected.facts[0]!.reasonCode, "SNIPPET_NOT_ON_PAGE");
  });

  await ok("V2-E2: 错引文（页面上不存在的句子）→ FAIL", () => {
    const r = verifyCandidates(testInput, {
      facts: [
        fact({ sourceSnippet: "Delivery shall occur within 30 business days of contract award." }),
      ],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 0);
    assert.equal(r.rejected.facts[0]!.reasonCode, "SNIPPET_NOT_ON_PAGE");
  });

  await ok("V2-E3: 值正确 + 证据错（引了无关的真句子）→ FAIL（VALUE_NOT_IN_EVIDENCE）", () => {
    const r = verifyCandidates(testInput, {
      facts: [
        // claim 值 30 days 正确，但引文是定价附件那句（页面真实存在、与值无关）
        fact({ pageNumber: 5, sourceSnippet: "Annex B pricing tables." }),
      ],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 0);
    const reason = r.rejected.facts[0]!.reasonCode;
    assert.ok(
      reason === "VALUE_NOT_IN_EVIDENCE" || reason === "NO_SEMANTIC_SUPPORT",
      reason,
    );
  });

  await ok("V2-E4: whitespace/换行归一化后的逐字引文 → 允许", () => {
    const r = verifyCandidates(testInput, {
      facts: [
        fact({
          sourceSnippet:
            "Delivery  must be completed\nwithin 30 days   of purchase order issuance.",
        }),
      ],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 1);
  });

  await ok("V2-E5: 跨文档错配（引文属于 d1，声称 d2）→ FAIL", () => {
    const r = verifyCandidates(testInput, {
      facts: [fact({ sourceDocumentId: "d2", pageNumber: 1 })],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 0);
    assert.equal(r.rejected.facts[0]!.reasonCode, "SNIPPET_NOT_ON_PAGE");
  });

  await ok("V2-E6: 不存在的页码 / 不在范围的文档 → 不可能被验证", () => {
    const r = verifyCandidates(testInput, {
      facts: [fact({ pageNumber: 99 }), fact({ sourceDocumentId: "d_ghost" })],
      requirements: [],
      risks: [],
      ambiguities: [],
    });
    assert.equal(r.facts.length, 0);
    const reasons = r.rejected.facts.map((x) => x.reasonCode).sort();
    assert.deepEqual(reasons, ["DOCUMENT_NOT_IN_SCOPE", "PAGE_NOT_FOUND"]);
  });

  // ── V2-E7..E10：Risk / Ambiguity 语义证据门（Final Review §15/16/18） ──

  const riskCandidate = (description: string, snippet: string) => ({
    riskType: "SUBMISSION" as const,
    description,
    sourceDocumentId: "d1",
    pageNumber: 4,
    sourceSnippet: snippet,
    confidence: "HIGH" as const,
  });

  const ambiguityCandidate = (
    topic: string,
    description: string,
    whatIsUnknown: string,
    snippet: string,
  ) => ({
    topic,
    description,
    whatIsUnknown,
    sourceDocumentId: "d1",
    pageNumber: 4,
    sourceSnippet: snippet,
    confidence: "HIGH" as const,
  });

  // 页面上的真实引文 A（逐字存在于 p4）
  const REAL_QUOTE_A =
    "Delivery must be completed within 30 days of purchase order issuance.";

  await ok("V2-E7: 真实引文 + 完全无关的 risk 断言 → REJECT (NO_SEMANTIC_SUPPORT)", () => {
    const r = verifyCandidates(testInput, {
      facts: [],
      requirements: [],
      risks: [
        riskCandidate(
          "Bidder insurance certificate might be expired causing disqualification",
          REAL_QUOTE_A,
        ),
      ],
      ambiguities: [],
    });
    assert.equal(r.risks.length, 0);
    assert.equal(r.rejected.risks[0]!.reasonCode, "NO_SEMANTIC_SUPPORT");
  });

  await ok("V2-E8: 真实引文 + 无关的 ambiguity → REJECT (NO_SEMANTIC_SUPPORT)", () => {
    const r = verifyCandidates(testInput, {
      facts: [],
      requirements: [],
      risks: [],
      ambiguities: [
        ambiguityCandidate(
          "bond amount unclear",
          "The tender references a bid bond but never states the amount",
          "the required bond percentage",
          REAL_QUOTE_A,
        ),
      ],
    });
    assert.equal(r.ambiguities.length, 0);
    assert.equal(r.rejected.ambiguities[0]!.reasonCode, "NO_SEMANTIC_SUPPORT");
  });

  await ok("V2-E9: 真实引文 + 语义支持的 risk → ACCEPT（正控，防过严）", () => {
    const r = verifyCandidates(testInput, {
      facts: [],
      requirements: [],
      risks: [
        riskCandidate(
          "Tight delivery obligation: goods must be delivered within 30 days of purchase order",
          REAL_QUOTE_A,
        ),
      ],
      ambiguities: [],
    });
    assert.equal(r.risks.length, 1);
    assert.equal(r.rejected.risks.length, 0);
  });

  await ok("V2-E10: 真实引文 + 语义支持的 ambiguity → ACCEPT（正控）", () => {
    const r = verifyCandidates(testInput, {
      facts: [],
      requirements: [],
      risks: [],
      ambiguities: [
        ambiguityCandidate(
          "delivery start trigger",
          "Delivery must be completed within 30 days but the purchase order issuance date basis is not defined",
          "whether the 30 days count from issuance date or receipt of purchase order",
          REAL_QUOTE_A,
        ),
      ],
    });
    assert.equal(r.ambiguities.length, 1);
    assert.equal(r.rejected.ambiguities.length, 0);
  });

  console.log(`\nV2 evidence discipline: ${count()} 组断言全部通过`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
