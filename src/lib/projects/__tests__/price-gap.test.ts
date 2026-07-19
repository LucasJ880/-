/**
 * 运行：npx tsx src/lib/projects/__tests__/price-gap.test.ts
 */
import { computePriceGap } from "../price-gap";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("▶ Project price-gap");

{
  const g = computePriceGap({
    ourBidPrice: 125000,
    winningBidPrice: 100000,
    currency: "CAD",
  });
  ok(!!g, "可计算");
  ok(g!.winningAsPctOfOurs === 80, "中标价为我方 80%");
  ok(g!.oursPremiumPctVsWinning === 25, "我方相对中标高 25%");
  ok(g!.absoluteDiff === 25000, "绝对差 25000");
  ok(
    g!.summaryLines.some((l) => l.includes("80%")) &&
      g!.summaryLines.some((l) => l.includes("25%")),
    "双比例文案",
  );
}

ok(computePriceGap({ ourBidPrice: null, winningBidPrice: 1 }) === null, "缺我方价");
ok(computePriceGap({ ourBidPrice: 0, winningBidPrice: 1 }) === null, "零无效");

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
