/**
 * S2-T1..T8 + §57 golden — SupplierSearchBrief：
 * 需求为真相源 / 三值三桶（uncertain 不静默降级）/ 四组词分开生成 / 预算去重 /
 * LLM 扩词降级 / prompt 版本留痕。
 */
import assert from "node:assert/strict";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import {
  BRIEF_TERM_BUDGET,
  SCENARIO_TERMS_ZH,
  SUPPLIER_BRIEF_GENERATION_VERSION,
  SUPPLIER_BRIEF_PROMPT_NAME,
  SUPPLIER_BRIEF_PROMPT_VERSION,
  buildDeterministicBrief,
  buildSupplierSearchBrief,
  type SupplierSearchBriefInput,
} from "../search-brief";

// §57 golden fixture：500 把人体工学办公椅
const goldenInput: SupplierSearchBriefInput = {
  projectId: "proj_golden",
  productCategory: "ergonomic office chair",
  quantity: 500,
  requirements: [
    { id: "r1", code: "R-001", text: "ANSI/BIFMA X5.1 certification required", category: "MANDATORY", mandatory: true, mandatorySignal: "required" },
    { id: "r2", code: "R-002", text: "300 lb minimum weight capacity", category: "TECHNICAL", mandatory: true, mandatorySignal: "minimum" },
    { id: "r3", code: "R-003", text: "mesh back preferred", category: "PRODUCT", mandatory: false, mandatorySignal: null },
    { id: "r4", code: "R-004", text: "lumbar support", category: "PRODUCT", mandatory: false, mandatorySignal: null },
    { id: "r5", code: "R-005", text: "on-site assembly may be required", category: "INSTALLATION", mandatory: "uncertain", mandatorySignal: "may be required" },
  ],
  productKeywordsZh: ["人体工学办公椅", "办公椅"],
  productKeywordsEn: ["ergonomic office chair"],
  capabilityHintsZh: ["办公椅BIFMA认证厂家"],
  delivery: { country: "Canada", province: "Ontario", city: "Toronto", requiredDate: "2026-11-01" },
  exclusions: ["二手"],
};

async function main() {
  const now = new Date("2026-08-31T12:00:00Z");

  console.log("S2-T1：requirements → 确定性归一 brief（同输入同输出）");
  const det = buildDeterministicBrief(goldenInput, { now });
  assert.deepEqual(det, buildDeterministicBrief(goldenInput, { now }));
  assert.equal(det.generationVersion, SUPPLIER_BRIEF_GENERATION_VERSION);
  assert.equal(det.generatedAt, now.toISOString());
  assert.equal(det.quantity, 500);
  assert.equal(det.deliveryCity, "Toronto");
  assert.equal(det.deliveryProvince, "Ontario");
  assert.deepEqual(det.exclusions, ["二手"]);

  console.log("S2-T2：mandatory=true → mandatory 桶（带 certainty=CERTAIN）");
  assert.deepEqual(det.mandatoryRequirements.map((r) => r.code), ["R-001", "R-002"]);
  assert.ok(det.mandatoryRequirements.every((r) => r.certainty === "CERTAIN"));

  console.log("S2-T3：uncertain 独立桶——绝不静默变成 preferred");
  assert.deepEqual(det.uncertainRequirements.map((r) => r.code), ["R-005"]);
  assert.equal(det.uncertainRequirements[0].certainty, "UNCERTAIN");
  assert.ok(!det.preferredRequirements.some((r) => r.code === "R-005"));
  assert.deepEqual(det.preferredRequirements.map((r) => r.code), ["R-003", "R-004"]);

  console.log("S2-T4/T5/T6：中文 commercial / capability / social 分组生成（确定性基线）");
  assert.ok(det.commercialSearchTermsZh.includes("人体工学办公椅厂家"));
  assert.ok(det.commercialSearchTermsZh.includes("办公椅源头工厂"));
  assert.equal(det.capabilitySearchTermsZh[0], "办公椅BIFMA认证厂家", "能力提示优先");
  assert.ok(det.capabilitySearchTermsZh.includes("人体工学办公椅加工"));
  assert.ok(det.socialSearchTermsZh.includes("人体工学办公椅 工厂实拍"));
  assert.deepEqual(det.scenarioSearchTermsZh, [...SCENARIO_TERMS_ZH]);

  console.log("golden：EN 词含制造商词 + 强制需求文本进 EN 检索（需求是真相源，不是标题）");
  assert.ok(det.searchTermsEn.includes("ergonomic office chair manufacturer China"));
  assert.ok(
    det.searchTermsEn.some((t) => t.includes("ANSI/BIFMA X5.1")),
    `EN 词应包含强制需求文本头：${JSON.stringify(det.searchTermsEn)}`,
  );

  console.log("S2-T7：预算封顶 + 去重（commercial ≤8 / en ≤6 / 重复词只留一份）");
  const many = buildDeterministicBrief(
    {
      ...goldenInput,
      productKeywordsZh: ["椅子", "椅子", "办公椅", "转椅", "电竞椅", "会议椅"],
      productKeywordsEn: ["chair", "chair", "office chair", "task chair", "mesh chair"],
    },
    { now },
  );
  assert.ok(many.commercialSearchTermsZh.length <= BRIEF_TERM_BUDGET.COMMERCIAL_ZH);
  assert.ok(many.searchTermsEn.length <= BRIEF_TERM_BUDGET.EN);
  assert.equal(new Set(many.commercialSearchTermsZh).size, many.commercialSearchTermsZh.length);

  console.log("LLM 扩词：注入 invoker → 并入 + prompt 版本留痕（§10）");
  const fakeInvoker: LlmInvoker = async (req) => {
    assert.equal(req.promptName, SUPPLIER_BRIEF_PROMPT_NAME);
    assert.equal(req.promptVersion, SUPPLIER_BRIEF_PROMPT_VERSION);
    assert.ok(req.userPrompt.includes("ANSI/BIFMA X5.1"), "需求文本作为素材进入 LLM");
    return {
      content: JSON.stringify({
        commercialZh: ["BIFMA办公椅厂家"],
        capabilityZh: ["办公椅承重测试"],
        socialZh: ["办公椅生产线"],
        en: ["BIFMA X5.1 chair factory"],
      }),
      model: "fake",
      elapsedMs: 1,
    };
  };
  const expanded = await buildSupplierSearchBrief(goldenInput, { invoker: fakeInvoker, now });
  assert.ok(expanded.commercialSearchTermsZh.includes("BIFMA办公椅厂家"));
  assert.ok(expanded.capabilitySearchTermsZh.includes("办公椅承重测试"));
  assert.ok(expanded.socialSearchTermsZh.includes("办公椅生产线"));
  assert.deepEqual(expanded.generator.llm, {
    promptName: SUPPLIER_BRIEF_PROMPT_NAME,
    promptVersion: SUPPLIER_BRIEF_PROMPT_VERSION,
  });

  console.log("S2-T8：LLM 抛错/非法输出 → 确定性兜底（generator.llm=null，不空手不报错）");
  const throwing: LlmInvoker = async () => {
    throw new Error("model down");
  };
  const degraded = await buildSupplierSearchBrief(goldenInput, { invoker: throwing, now });
  assert.equal(degraded.generator.llm, null);
  assert.ok(degraded.commercialSearchTermsZh.length > 0);
  const junk: LlmInvoker = async () => ({ content: "not json", model: "fake", elapsedMs: 1 });
  const degraded2 = await buildSupplierSearchBrief(goldenInput, { invoker: junk, now });
  assert.equal(degraded2.generator.llm, null);

  console.log("allowLlm:false → 纯确定性");
  const noLlm = await buildSupplierSearchBrief(goldenInput, { allowLlm: false, now });
  assert.equal(noLlm.generator.llm, null);

  console.log("非法需求快照拒收（mandatory 三值严格）");
  try {
    buildDeterministicBrief({ ...goldenInput, requirements: [{ id: "x", code: "X", text: "t", mandatory: "true" }] });
    assert.fail("期望 INVALID_REQUIREMENT_SNAPSHOT");
  } catch (e) {
    assert.ok(e instanceof Error && e.message.includes("mandatory"));
  }

  console.log("\nsearch-brief S2-T1..T8 + golden 全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
