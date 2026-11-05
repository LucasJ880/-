/**
 * 运行：npx tsx src/lib/projects/__tests__/tender-result.test.ts
 */
import { isOwnOrgWinner, isTenderResult, parseOutcomeWinner, WINNER_NAME_MAX } from "../tender-result";
import { normalizeVendorName } from "@/lib/tender-intel/awards";
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

// P2-0：结果表单的「中标方（选填）」
{
  const lostOk = parseOutcomeWinner("lost", "  ABC   Blinds  Ltd ");
  ok(lostOk.ok && lostOk.winnerName === "ABC Blinds Ltd", "未中标填中标方：去首尾与多余空白");
  const blank = parseOutcomeWinner("lost", "   ");
  ok(blank.ok && blank.winnerName === null, "空白视为未填");
  const none = parseOutcomeWinner("won", undefined);
  ok(none.ok && none.winnerName === null, "没传 → 未填");
  ok(!parseOutcomeWinner("won", "ABC").ok, "中标时不接受中标方（就是我方）");
  ok(!parseOutcomeWinner("no_bid", "ABC").ok, "未投标不接受中标方");
  ok(!parseOutcomeWinner("lost", 123).ok, "不是文字 → 拒绝");
  ok(!parseOutcomeWinner("lost", "x".repeat(WINNER_NAME_MAX + 1)).ok, "超长 → 拒绝");
  ok(isOwnOrgWinner("FIXTURE SHUTTERS INC", "Fixture Shutters Inc.", normalizeVendorName), "中标方 = 我方（大小写 / 标点不同）→ 识别");
  ok(!isOwnOrgWinner("ABC Blinds Ltd", "Fixture Shutters Inc.", normalizeVendorName), "其他公司 → 不是我方");
  ok(!isOwnOrgWinner("ABC Blinds Ltd", null, normalizeVendorName), "组织名缺失 → 不判为我方");
}

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
