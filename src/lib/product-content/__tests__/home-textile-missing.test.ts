/**
 * 家纺行业包必填字段缺失检测
 * 运行：npx tsx src/lib/product-content/__tests__/home-textile-missing.test.ts
 */

import { listMissingFields, listRequiredFields } from "../industry-packs/home-textile";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const required = listRequiredFields();
ok(required.length >= 5, "家纺包至少有 5 个必填字段");
ok(required.some((f) => f.key === "product_name"), "包含 product_name");
ok(required.some((f) => f.key === "material"), "包含 material");

const missing = listMissingFields({
  product_name: "Cotton Sheet Set",
  sku: "HT-001",
});
ok(missing.some((f) => f.key === "material"), "缺 material 应被检出");
ok(missing.some((f) => f.key === "size"), "缺 size 应被检出");
ok(!missing.some((f) => f.key === "product_name"), "已有 product_name 不算缺失");

const complete = listMissingFields({
  product_name: "Sheet",
  sku: "S1",
  category: "bedding",
  material: "cotton",
  fabric_composition: "100% cotton",
  size: "Queen",
  color: "white",
});
ok(complete.length === 0, "必填齐全时 missing 为空");

console.log(`\nhome-textile-missing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
