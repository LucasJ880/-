/**
 * V2 幻觉/污染测试（V2-H1 … V2-H7）
 *
 * Cross-Domain Contamination Zero Tolerance：任何 case/domain fallback 都不存在；
 * UNKNOWN 是合法结果；澄清没有最低数量目标；未支撑的 critical fact 必须被拒。
 */

import assert from "node:assert";

import { analyzeTender } from "../analyzer";
import { doc, input, makeOk, scriptedInvoker } from "./helpers";

const { ok, count } = makeOk();

const LEAK_TERMS_BACKPACK = ["backpack", "rcmp", "1000d", "m5000", "cadet", "背包", "olive"];
const LEAK_TERMS_SHADES = ["roller shade", "somfy", "fabric openness", "zebra shade", "卷帘", "斑马帘"];

async function run(): Promise<void> {
  // ── V2-H1：窗饰 tender → 零背包泄漏 ──
  await ok("V2-H1: 窗饰 tender 输出零背包域内容（含空抽取时不回落模板）", async () => {
    const d = doc("d1", "BASE_TENDER", {
      1: "Supply and installation of motorized roller shades for the community centre. All fabric must pass NFPA 701.",
    });
    const invoker = scriptedInvoker({
      extract: () => ({
        requirements: [
          {
            category: "TECHNICAL",
            statement: "All fabric must pass NFPA 701",
            actor: "contractor",
            action: "certify",
            object: "fabric",
            mandatory: true,
            mandatorySignal: "must",
            deadline: null,
            quantity: null,
            unit: null,
            submissionStage: null,
            technicalArea: "fire rating",
            revisionAction: null,
            revisionTargetHint: null,
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "All fabric must pass NFPA 701.",
            confidence: "HIGH",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    const corpus = JSON.stringify(result).toLowerCase();
    for (const t of LEAK_TERMS_BACKPACK) {
      assert.ok(!corpus.includes(t), `leak: ${t}`);
    }
  });

  // ── V2-H2：非窗饰 control case → 不被解释成卷帘 ──
  await ok("V2-H2: 背包类 tender 不出现卷帘/Somfy/织物开孔率等窗饰域内容", async () => {
    const d = doc("d1", "BASE_TENDER", {
      1: "Supply of tactical backpacks. Each backpack must include a laptop sleeve.",
    });
    const invoker = scriptedInvoker({
      extract: () => ({
        requirements: [
          {
            category: "PRODUCT",
            statement: "Each backpack must include a laptop sleeve",
            actor: "supplier",
            action: "include",
            object: "laptop sleeve",
            mandatory: true,
            mandatorySignal: "must",
            deadline: null,
            quantity: null,
            unit: null,
            submissionStage: null,
            technicalArea: null,
            revisionAction: null,
            revisionTargetHint: null,
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "Each backpack must include a laptop sleeve.",
            confidence: "HIGH",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    const corpus = JSON.stringify(result).toLowerCase();
    for (const t of LEAK_TERMS_SHADES) {
      assert.ok(!corpus.includes(t), `leak: ${t}`);
    }
  });

  // ── V2-H3 / H4：缺失信息保持 UNKNOWN ──
  await ok("V2-H3/H4: warranty 与 quantity 未提及 → UNKNOWN（不产生任何默认值）", async () => {
    const d = doc("d1", "BASE_TENDER", { 1: "Supply of office desks for the north campus." });
    const invoker = scriptedInvoker({ extract: () => ({}) });
    const { result } = await analyzeTender(input(d), { invoker });
    assert.equal(result.criticalFacts.warranty.status, "UNKNOWN");
    assert.equal(result.criticalFacts.quantity.status, "UNKNOWN");
    assert.equal(result.facts.length, 0);
    // UNKNOWN 不得被任何 fact 填充
    assert.ok(result.unknowns.some((u) => u.field === "warranty"));
    assert.ok(result.unknowns.some((u) => u.field === "quantity"));
  });

  // ── V2-H5：文档已回答的问题不得生成澄清 ──
  await ok("V2-H5: 歧义在补遗中已有答案（可验证证据）→ 不提问，记入 resolvedAmbiguities", async () => {
    const base = doc("d_base", "BASE_TENDER", {
      1: "Proponents may be required to submit samples of the fabric.",
    });
    const add = doc("d_add", "ADDENDUM", {
      1: "Q: Are samples required at bid time? A: No. Samples will only be requested from shortlisted proponents.",
    });
    const invoker = scriptedInvoker({
      extract: (prompt) =>
        prompt.includes("documentId d_base")
          ? {
              ambiguities: [
                {
                  topic: "sample submission at bid time",
                  description: "Base tender says samples 'may be required' without stating when",
                  whatIsUnknown: "whether samples must be submitted with the bid",
                  sourceDocumentId: "d_base",
                  pageNumber: 1,
                  sourceSnippet: "Proponents may be required to submit samples of the fabric.",
                  confidence: "HIGH",
                },
              ],
            }
          : {},
      resolve: () => ({
        resolved: true,
        answerSummary: "Samples are not required at bid time; only shortlisted proponents will be asked.",
        answerDocumentId: "d_add",
        answerPageNumber: 1,
        answerSnippet: "A: No. Samples will only be requested from shortlisted proponents.",
      }),
    });
    const { result } = await analyzeTender(input(base, add), { invoker });
    assert.equal(result.clarifications.length, 0);
    assert.equal(result.resolvedAmbiguities.length, 1);
    assert.equal(result.resolvedAmbiguities[0]!.evidence[0]!.documentId, "d_add");
  });

  // ── V2-H6：没有最低澄清数量目标 ──
  await ok("V2-H6: 零歧义 → 零澄清（无 '不足 N 条补模板' 行为）", async () => {
    const d = doc("d1", "BASE_TENDER", {
      1: "Closing: 2027-05-01 at 14:00 EST. Submit by email to bids@example.gov.",
    });
    const invoker = scriptedInvoker({
      extract: () => ({
        facts: [
          {
            factType: "closing_datetime",
            claim: "Closing 2027-05-01 14:00 EST",
            rawValue: "2027-05-01 at 14:00 EST",
            sourceDocumentId: "d1",
            pageNumber: 1,
            sourceSnippet: "Closing: 2027-05-01 at 14:00 EST.",
            confidence: "HIGH",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    assert.equal(result.clarifications.length, 0);
  });

  // ── V2-H7：未支撑的 critical fact 被拒收 ──
  await ok("V2-H7: 证据不在页上的 critical fact → 拒收，槽位保持 UNKNOWN", async () => {
    const d = doc("d1", "BASE_TENDER", { 1: "Supply of laboratory refrigerators." });
    const invoker = scriptedInvoker({
      extract: () => ({
        facts: [
          {
            factType: "warranty",
            claim: "Standard warranty is 1 year",
            rawValue: "1 year",
            sourceDocumentId: "d1",
            pageNumber: 1,
            // 页面上并不存在这句话 → 必须被 Evidence Verifier 拒收
            sourceSnippet: "Warranty: one (1) year standard coverage applies.",
            confidence: "HIGH",
          },
        ],
      }),
    });
    const { result } = await analyzeTender(input(d), { invoker });
    assert.equal(result.criticalFacts.warranty.status, "UNKNOWN");
    assert.equal(result.facts.length, 0);
    assert.ok(
      result.metadata.rejectedCandidates.some(
        (r) => r.reasonCode === "SNIPPET_NOT_ON_PAGE" && r.count >= 1,
      ),
    );
  });

  console.log(`\nV2 hallucination guard: ${count()} 组断言全部通过`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
