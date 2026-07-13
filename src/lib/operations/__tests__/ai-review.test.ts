/**
 * AI 预审保守降级测试（不调用真实 AI）
 * 运行：npx tsx src/lib/operations/__tests__/ai-review.test.ts
 */
import { reviewCaptionsAgainstBrand } from "../ai-review";

const asset = { title: "Zebra shades demo", topic: "smart home", language: "en" };

let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

async function main() {
  // 无品牌档案：全放行且不算降级（没有口径可依据）
  const noBrand = await reviewCaptionsAgainstBrand(
    asset,
    [{ accountId: "a1", caption: "hello" }],
    null,
  );
  check("无品牌档案全放行", noBrand.items.get("a1")?.verdict === "pass");
  check("无品牌档案不算降级", noBrand.degraded === false);

  // AI 未配置（测试环境无 OPENAI_API_KEY）：全放行并标记降级
  delete process.env.OPENAI_API_KEY;
  const noAI = await reviewCaptionsAgainstBrand(
    asset,
    [
      { accountId: "a1", caption: "hello" },
      { accountId: "a2", caption: "world" },
    ],
    "品牌名：Sunny Shutter",
  );
  check("AI 未配置全放行", noAI.items.get("a2")?.verdict === "pass");
  check("AI 未配置标记降级", noAI.degraded === true);

  // 空文案列表
  const empty = await reviewCaptionsAgainstBrand(asset, [], "品牌名：Sunny Shutter");
  check("空列表不降级", empty.degraded === false && empty.items.size === 0);

  if (failed > 0) {
    console.error(`\n❌ ai-review: ${failed} 项失败`);
    process.exit(1);
  }
  console.log("\n✅ ai-review: 全部通过");
}

main();
