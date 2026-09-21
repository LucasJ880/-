/**
 * 货号匹配与寄样状态机。
 * 运行：npx tsx src/lib/trade/__tests__/product-sample.test.ts
 */
import { parseInquiryQuantity, rankProductMatch, tokenizeProductQuery } from "../product-match";
import { canTransitionSample, isTradeSampleStatus } from "../sample-constants";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function run() {
  ok(parseInquiryQuantity("2000 bathrobes") === 2000, "从询盘数量抽出数字");
  ok(parseInquiryQuantity("2,000") === 2000, "带逗号数量");
  ok(parseInquiryQuantity("abc") === 1, "无法解析时默认为 1");

  ok(tokenizeProductQuery("Coral Fleece Bathrobe").includes("coral"), "产品词分词");

  const product = { sku: "MX-BR-001", name: "珊瑚绒浴袍", nameEn: "Coral Fleece Bathrobe" };
  ok(rankProductMatch(product, { sku: "MX-BR-001" }) >= 100, "货号精确匹配分最高");
  ok(
    rankProductMatch(product, { productName: "bathrobe" }) >
      rankProductMatch(product, { productName: "blanket" }),
    "品名相关高于无关",
  );

  ok(isTradeSampleStatus("requested") && !isTradeSampleStatus("lost"), "寄样状态枚举");
  ok(canTransitionSample("requested", "preparing"), "申请 → 备样");
  ok(canTransitionSample("preparing", "shipped"), "备样 → 寄出");
  ok(canTransitionSample("requested", "cancelled"), "申请可取消");
  ok(!canTransitionSample("shipped", "preparing"), "已寄出不能回退");
  ok(!canTransitionSample("cancelled", "shipped"), "已取消不能再寄");

  console.log(`product-sample: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

run();
