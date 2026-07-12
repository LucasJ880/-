/**
 * 发布内容规则拦截测试
 * 运行：npx tsx src/lib/operations/__tests__/content-rules.test.ts
 */
import { checkContentRules } from "../content-rules";

let total = 0;
let failed = 0;

function expectVerdict(text: string, expected: "pass" | "review" | "block") {
  total += 1;
  const result = checkContentRules(text);
  if (result.verdict !== expected) {
    failed += 1;
    console.error(
      `✗ 期望 ${expected} 实际 ${result.verdict}（${result.reasons.join("；") || "无原因"}）: ${text}`,
    );
  } else {
    console.log(`✓ ${expected}: ${text.slice(0, 40)}`);
  }
}

// block：夸大 / 绝对化承诺
expectVerdict("跟我们做，保证爆单！", "block");
expectVerdict("全网最低价窗帘，错过再无", "block");
expectVerdict("Guaranteed results in 7 days!", "block");
expectVerdict("Risk-free purchase, lifetime warranty included", "block");
expectVerdict("100% 满意，不满意退款", "block");

// review：价格 / 促销 / 补贴，人工确认后可发
expectVerdict("Motorized blinds starting at $299", "review");
expectVerdict("全屋窗帘 8 折，仅限今日", "review");
expectVerdict("Free measurement for GTA homeowners", "review");
expectVerdict("符合政府节能补贴条件的智能遮阳方案", "review");

// pass：常规内容
expectVerdict("Before and after: motorized zebra shades in a North York living room", "pass");
expectVerdict("三个信号告诉你，家里的窗帘该换电动的了", "pass");
expectVerdict("Smart shading keeps your home cooler in summer", "pass");

console.log(`\n${failed === 0 ? "✅" : "❌"} content-rules: ${total - failed}/${total} 通过`);
if (failed > 0) process.exit(1);
