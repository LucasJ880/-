/**
 * 投标业务档案探针（TP-01..05）
 * 运行：npx tsx src/lib/tender-profile/__tests__/tender-profile.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emptyTenderProfile, formatTenderProfileContext, isTenderProfileUsable, tenderProfileSchema } from "@/lib/tender-profile/contract";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("投标业务档案探针");
ok(tenderProfileSchema.safeParse({ entityName: 42, junk: 1 }).success && emptyTenderProfile().entityName === "", "TP-01: schema 逐字段预处理，坏形不抛，空档案可构造");
ok(!isTenderProfileUsable(null) && !isTenderProfileUsable(emptyTenderProfile()) && isTenderProfileUsable(tenderProfileSchema.parse({ capabilities: "媒体监测平台" })), "TP-02: 可用性 = 至少填了主体/能力/定位之一");
{
  const ctx = formatTenderProfileContext(tenderProfileSchema.parse({ entityName: "Sunny Tender Inc.", capabilities: "X", forbiddenClaims: "业界第一" }));
  ok(ctx.includes("投标主体名称") && ctx.includes("Sunny Tender Inc.") && !ctx.includes("业界第一"), "TP-03: 语料拼装省略空字段，禁用语不入语料");
}
{
  const gather = code("src/lib/tender-bid-draft/gather.ts");
  ok(gather.includes("getTenderProfile(") && !gather.includes("getBrandContext") && !gather.includes("brandProfile.findUnique"), "TP-04（反例守卫）: 起草装配只读投标档案，不回退窗饰品牌档案");
  const route = code("src/app/api/operations/tender-profile/route.ts");
  ok(route.includes("canManageUsers(") && route.includes("resolveRequestOrgIdForUser("), "TP-05: 档案接口管理权限 + 组织隔离");
}
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
