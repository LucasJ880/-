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

  console.log(`\nV2 evidence discipline: ${count()} 组断言全部通过`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
