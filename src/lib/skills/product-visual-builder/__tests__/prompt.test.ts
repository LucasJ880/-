/**
 * product-visual-builder prompt 纯函数测试（Phase 1A-Test）
 *
 * 锁定防错逻辑：禁编造、缺失标 not provided、固定 warnings、人工确认规则、
 * 风格/用途映射、源图角色标注。
 *
 * 运行：npx tsx src/lib/skills/product-visual-builder/__tests__/prompt.test.ts
 * 不连库、不调 AI、不上传 Blob。
 */
import { buildProductVisualPrompt } from "../prompt";
import type { VisualBuilderInput } from "../types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function baseInput(overrides: Partial<VisualBuilderInput> = {}): VisualBuilderInput {
  return {
    orgId: "org_test",
    userId: "user_test",
    productType: "blanket",
    productName: "Coral Fleece Throw",
    useCase: "website",
    style: "warm_home",
    sourceImageUrls: ["https://blob.example/source-0.jpg"],
    sourceImageRoles: ["front"],
    productFacts: {
      material: "100% polyester coral fleece",
      sizes: ["150x200cm"],
      colors: ["beige", "grey"],
    },
    certifications: [{ name: "OEKO-TEX Standard 100" }],
    constraints: {
      mustKeep: ["woven edge"],
      mustNotAdd: ["fake embroidery"],
      forbiddenClaims: ["organic"],
    },
    language: "en",
    ...overrides,
  };
}

// 1. basic prompt generation
{
  const { finalPrompt, warnings, productFactsUsed } = buildProductVisualPrompt(baseInput());
  ok(finalPrompt.includes("Coral Fleece Throw"), "basic: 含 productName");
  ok(finalPrompt.includes("100% polyester coral fleece"), "basic: 含 material");
  ok(finalPrompt.includes("150x200cm"), "basic: 含 sizes");
  ok(finalPrompt.includes("beige") && finalPrompt.includes("grey"), "basic: 含 colors");
  ok(finalPrompt.includes("OEKO-TEX Standard 100"), "basic: 含 certification 原文");
  ok(finalPrompt.includes("woven edge"), "basic: 含 mustKeep");
  ok(finalPrompt.includes("fake embroidery"), "basic: 含 mustNotAdd");
  ok(finalPrompt.includes("organic"), "basic: 含 forbiddenClaims");
  ok(warnings.length >= 4, "basic: warnings 至少 4 条");
  ok(
    productFactsUsed.material !== undefined &&
      productFactsUsed.sizes !== undefined &&
      productFactsUsed.colors !== undefined,
    "basic: productFactsUsed 含输入事实",
  );
  ok(finalPrompt.trim().length > 0, "basic: finalPrompt 非空");
}

// 2. missing facts must be explicit
{
  const { finalPrompt, warnings, productFactsUsed } = buildProductVisualPrompt(
    baseInput({ productFacts: undefined, certifications: undefined, constraints: undefined }),
  );
  ok(
    finalPrompt.includes("not provided") || finalPrompt.includes("未提供"),
    "missing: 出现 not provided / 未提供",
  );
  // careInstructions 等未提供事实必须显式标缺失，且 productFactsUsed 为空（未脑补任何事实）
  ok(Object.keys(productFactsUsed).length === 0, "missing: 未使用任何事实（无脑补）");
  ok(
    finalPrompt.includes("护理说明 careInstructions: not provided") ||
      finalPrompt.includes("careInstructions"),
    "missing: careInstructions 显式列为缺失",
  );
  ok(warnings.length >= 4, "missing: warnings 仍存在");
}

// 3. human review guardrail
{
  const { finalPrompt, warnings } = buildProductVisualPrompt(baseInput());
  ok(finalPrompt.includes("humanReviewRequired=true"), "review: 含 humanReviewRequired=true");
  ok(finalPrompt.includes("不自动发布"), "review: 含 不自动发布");
  ok(
    warnings.some((w) => w.includes("规格") && w.includes("证明")),
    "review: warnings 含 不得作为规格/合规证明",
  );
  ok(
    warnings.some((w) => w.includes("人工确认")),
    "review: warnings 含 需人工确认",
  );
}

// 4. no fabrication guardrail
{
  const { finalPrompt } = buildProductVisualPrompt(baseInput());
  ok(finalPrompt.includes("严禁编造"), "fabrication: 含 严禁编造");
  ok(finalPrompt.includes("认证"), "fabrication: 禁编造认证");
  ok(finalPrompt.includes("材质"), "fabrication: 禁编造材质");
  ok(finalPrompt.includes("尺寸"), "fabrication: 禁编造尺寸");
  ok(finalPrompt.includes("GSM"), "fabrication: 禁编造 GSM");
  ok(finalPrompt.includes("MOQ"), "fabrication: 禁编造 MOQ");
  ok(finalPrompt.includes("护理说明"), "fabrication: 禁编造护理说明");
  ok(finalPrompt.includes("不得改变产品本体"), "fabrication: 不得改变产品本体");
}

// 5. style and useCase mapping
{
  const white = buildProductVisualPrompt(baseInput({ style: "white_background" })).finalPrompt;
  const spec = buildProductVisualPrompt(baseInput({ style: "spec_sheet" })).finalPrompt;
  ok(
    white.includes("纯白背景") || white.toLowerCase().includes("white background"),
    "style: white_background 体现纯白背景",
  );
  ok(
    spec.includes("规格说明图") || spec.toLowerCase().includes("spec-sheet"),
    "style: spec_sheet 体现规格说明",
  );
  ok(white !== spec, "style: 不同风格 prompt 不同");
}

// 6. source image role mapping
{
  const { finalPrompt } = buildProductVisualPrompt(
    baseInput({
      sourceImageUrls: ["u0", "u1", "u2"],
      sourceImageRoles: ["front", "texture", "packaging"],
    }),
  );
  ok(finalPrompt.includes("角色=front"), "roles: 标注 front");
  ok(finalPrompt.includes("角色=texture"), "roles: 标注 texture");
  ok(finalPrompt.includes("角色=packaging"), "roles: 标注 packaging");
}

console.log(`product-visual-builder prompt: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
