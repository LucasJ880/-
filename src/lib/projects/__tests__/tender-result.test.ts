/**
 * 运行：npx tsx src/lib/projects/__tests__/tender-result.test.ts
 */
import { isTenderResult } from "../tender-result";
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

console.log("▶ Tender result + Mask price sample");

ok(isTenderResult("lost"), "lost 合法");
ok(isTenderResult("no_bid"), "no_bid 合法");
ok(!isTenderResult("bid_submitted"), "进行中状态不作为终态 result");

{
  const g = computePriceGap({
    ourBidPrice: 240000,
    winningBidPrice: 200000,
    currency: "CAD",
  });
  ok(!!g, "可计算");
  ok(g!.winningAsPctOfOurs === 83.33, "中标为我方 83.33%");
  ok(g!.oursPremiumPctVsWinning === 20, "我方高 20%");
  ok(g!.absoluteDiff === 40000, "差 40000");
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
