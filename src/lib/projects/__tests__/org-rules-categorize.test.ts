/**
 * 运行：npx tsx src/lib/projects/__tests__/org-rules-categorize.test.ts
 */
import { categorizeTag } from "../org-rules";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("▶ Org project rule categorizeTag");

ok(categorizeTag("报价过高导致丢标") === "price", "价格类");
ok(categorizeTag("缺少阻燃认证") === "tech", "技术/认证类");
ok(categorizeTag("无制造商资格") === "qualification", "资格类");
ok(categorizeTag("Addendum 提交超时") === "execution", "执行类");
ok(categorizeTag("指定品牌竞品") === "competition", "竞争类");
ok(categorizeTag("客户关系维护") === "general", "通用类");

console.log(`  ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
